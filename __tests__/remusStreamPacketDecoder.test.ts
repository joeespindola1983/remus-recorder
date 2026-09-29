import { Buffer } from 'buffer';

import {
  RemusGpsStreamPacketDecoder,
  RemusRelayedStreamPacketDecoder,
  RemusStreamPacketDecoder,
} from '../src/services/blade/RemusStreamPacketDecoder';

const crc32 = (data: Uint8Array): number => {
  /* eslint-disable no-bitwise -- mirrors the firmware CRC32 contract. */
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  const result = (~crc) >>> 0;
  /* eslint-enable no-bitwise */
  return result;
};

const makeBatch = (
  batchSequence = 7,
  firstSampleSequence = 100,
  firstTimestampUs = 1_000_000,
): Buffer => {
  const sampleCount = 2;
  const result = Buffer.alloc(23 + sampleCount * 15 + 4);
  result[0] = 1;
  result[1] = 1;
  result[3] = 23;
  result.writeUInt32LE(batchSequence, 4);
  result.writeUInt32LE(firstSampleSequence, 8);
  result.writeBigUInt64LE(BigInt(firstTimestampUs), 12);
  result.writeUInt16LE(5_000, 20);
  result[22] = sampleCount;
  const axes = [4096, -2048, 1024, 66, -131, 0];
  axes.forEach((value, index) => result.writeInt16LE(value, 23 + index * 2));
  result.writeInt16LE(100, 35);
  result[37] = 0;
  axes.forEach((value, index) => result.writeInt16LE(value + 1, 38 + index * 2));
  result.writeInt16LE(-50, 50);
  result[52] = 3;
  result.writeUInt32LE(crc32(result.subarray(0, result.length - 4)), result.length - 4);
  return result;
};

const makeRelayedPacket = (payload = makeBatch()): Buffer => {
  const result = Buffer.alloc(12 + payload.length + 4);
  result[0] = 1;
  result[1] = 0x21;
  result.writeUInt32LE(0x11223344, 2);
  result.writeUInt32LE(9876, 6);
  result.writeUInt16LE(payload.length, 10);
  payload.copy(result, 12);
  result.writeUInt32LE(crc32(result.subarray(0, result.length - 4)), result.length - 4);
  return result;
};

const makeGpsBatch = (): Buffer => {
  const result = Buffer.alloc(23 + 2 * 40 + 4);
  result[0] = 1;
  result[1] = 0x05;
  result[3] = 23;
  result.writeUInt32LE(9, 4);
  result.writeUInt32LE(100, 8);
  result.writeBigUInt64LE(5_000_000n, 12);
  result[20] = 2;
  result[21] = 40;
  const writeObservation = (offset: number, deltaUs: number, iTow: number) => {
    result.writeUInt32LE(deltaUs, offset);
    result.writeUInt32LE(iTow, offset + 4);
    result.writeInt32LE(-157490560, offset + 8);
    result.writeInt32LE(-478697480, offset + 12);
    result.writeUInt32LE(203, offset + 16);
    result.writeUInt32LE(26, offset + 20);
    result.writeInt32LE(32361581, offset + 24);
    result.writeUInt32LE(4156269, offset + 28);
    result.writeUInt32LE(1300, offset + 32);
    result[offset + 36] = 10;
    result[offset + 37] = 43;
    result[offset + 38] = 3;
    result[offset + 39] = 1;
  };
  writeObservation(23, 0, 216507200);
  writeObservation(63, 200_000, 216507400);
  result.writeUInt32LE(crc32(result.subarray(0, result.length - 4)), result.length - 4);
  return result;
};

describe('RemusGpsStreamPacketDecoder', () => {
  it('decodes coherent receiver-native observations without inventing epoch time', () => {
    const decoder = new RemusGpsStreamPacketDecoder();
    const decoded = decoder.ingest(makeGpsBatch());
    expect(decoded?.batchSequence).toBe(9);
    expect(decoded?.observations).toHaveLength(2);
    expect(decoded?.observations[0]).toMatchObject({
      observationSequence: 100,
      nativeTimestampUs: 5_000_000,
      gpsTimeOfWeekMilliseconds: 216507200,
      positionWgs84: {latitude: -15.749056, longitude: -47.869748},
      groundSpeedMetersPerSecond: 2.03,
      speedAccuracyMetersPerSecond: 0.26,
      horizontalAccuracyMeters: 1.3,
      hasValidFix: true,
    });
    expect(decoded?.observations[1].nativeTimestampUs).toBe(5_200_000);
    expect(decoder.getAccounting()).toMatchObject({
      decodedBatchCount: 1,
      decodedObservationCount: 2,
      lostPackets: 0,
      lostObservations: 0,
    });
  });

  it('detects missing GNSS observations independently from IMU continuity', () => {
    const decoder = new RemusGpsStreamPacketDecoder();
    decoder.ingest(makeGpsBatch());
    const next = makeGpsBatch();
    next.writeUInt32LE(11, 4);
    next.writeUInt32LE(104, 8);
    next.writeUInt32LE(crc32(next.subarray(0, next.length - 4)), next.length - 4);
    decoder.ingest(next);
    expect(decoder.getAccounting()).toMatchObject({lostPackets: 1, lostObservations: 2});
  });
});

describe('RemusStreamPacketDecoder', () => {
  it('decodes and validates a versioned raw IMU batch', () => {
    const decoded = new RemusStreamPacketDecoder().ingest(makeBatch());

    expect(decoded?.batchSequence).toBe(7);
    expect(decoded?.samples).toHaveLength(2);
    expect(decoded?.samples[0]).toMatchObject({
      sampleSequence: 100,
      nativeTimestampUs: 1_000_100,
      rawAccel: { x: 4096, y: -2048, z: 1024 },
      rawGyro: { x: 66, y: -131, z: 0 },
      status: 0,
    });
    expect(decoded?.samples[1].sampleSequence).toBe(101);
    expect(decoded?.samples[1].nativeTimestampUs).toBe(1_004_950);
    expect(decoded?.samples[1].status).toBe(3);
  });

  it('rejects a batch whose payload CRC does not match', () => {
    const batch = makeBatch();
    batch[23] = batch[23] === 0 ? 1 : 0;

    expect(new RemusStreamPacketDecoder().ingest(batch)).toBeNull();
  });

  it('reassembles fragments before decoding the batch', () => {
    const batch = makeBatch();
    const split = 30;
    const fragments = [batch.subarray(0, split), batch.subarray(split)].map((payload, index) => {
      const frame = Buffer.alloc(9 + payload.length);
      frame[0] = 1;
      frame[1] = 0x11;
      frame.writeUInt32LE(7, 2);
      frame[6] = index;
      frame[7] = 2;
      frame[8] = payload.length;
      payload.copy(frame, 9);
      return frame;
    });
    const decoder = new RemusStreamPacketDecoder();

    expect(decoder.ingest(fragments[0])).toBeNull();
    expect(decoder.ingest(fragments[1])?.samples).toHaveLength(2);
    expect(decoder.getAccounting()).toMatchObject({
      transportNotificationCount: 2,
      decodedBatchCount: 1,
      decodedImuSampleCount: 2,
      invalidNotificationCount: 0,
      pendingFragmentCount: 0,
    });
  });

  it('accounts for invalid transport notifications without calling them samples', () => {
    const decoder = new RemusStreamPacketDecoder();

    expect(decoder.ingest(Buffer.from([1, 1, 0]))).toBeNull();

    expect(decoder.getAccounting()).toMatchObject({
      transportNotificationCount: 1,
      decodedBatchCount: 0,
      decodedImuSampleCount: 0,
      invalidNotificationCount: 1,
    });
  });

  it('counts rail saturation independently for every accelerometer and gyroscope axis', () => {
    const batch = makeBatch();
    batch.writeInt16LE(32767, 23);
    batch.writeInt16LE(-32768, 25);
    batch.writeInt16LE(32767, 29);
    batch.writeUInt32LE(crc32(batch.subarray(0, batch.length - 4)), batch.length - 4);
    const decoder = new RemusStreamPacketDecoder();

    decoder.ingest(batch);

    expect(decoder.getAccounting()).toMatchObject({
      accelSaturationCountX: 1,
      accelSaturationCountY: 1,
      accelSaturationCountZ: 0,
      gyroSaturationCountX: 1,
      gyroSaturationCountY: 0,
      gyroSaturationCountZ: 0,
      samplesWithAnySaturationCount: 1,
      samplesWithAnySaturationPercent: 50,
    });
  });

  it('starts every recording with independent sequence, gap, and saturation accounting', () => {
    const decoder = new RemusStreamPacketDecoder();
    const saturated = makeBatch(0, 0, 1_000_000);
    saturated.writeInt16LE(32767, 23);
    saturated.writeUInt32LE(
      crc32(saturated.subarray(0, saturated.length - 4)),
      saturated.length - 4,
    );

    decoder.beginRecording();
    decoder.ingest(saturated);
    decoder.ingest(makeBatch(1, 2, 1_010_000));
    expect(decoder.getAccounting()).toMatchObject({
      decodedBatchCount: 2,
      decodedImuSampleCount: 4,
      samplesWithAnySaturationCount: 1,
      outOfOrderPackets: 0,
      lostPackets: 0,
      lostSamples: 0,
    });

    decoder.beginRecording();
    decoder.ingest(makeBatch(0, 0, 2_000_000));
    expect(decoder.getAccounting()).toMatchObject({
      decodedBatchCount: 1,
      decodedImuSampleCount: 2,
      samplesWithAnySaturationCount: 0,
      outOfOrderPackets: 0,
      lostPackets: 0,
      lostSamples: 0,
      maxSampleGapMs: 4.85,
    });
  });

  it('does not turn missing or reordered batches into a native sample gap', () => {
    const decoder = new RemusStreamPacketDecoder();
    decoder.beginRecording();

    decoder.ingest(makeBatch(0, 0, 1_000_000));
    decoder.ingest(makeBatch(2, 4, 900_000_000));
    decoder.ingest(makeBatch(1, 2, 1_010_000));

    expect(decoder.getAccounting()).toMatchObject({
      lostPackets: 1,
      lostSamples: 2,
      outOfOrderPackets: 1,
      maxSampleGapMs: 4.85,
    });
  });
});

describe('RemusRelayedStreamPacketDecoder', () => {
  it('validates the relay envelope and decodes the original Blade batch', () => {
    const decoded = new RemusRelayedStreamPacketDecoder().ingest(makeRelayedPacket());

    expect(decoded?.sourceIdentityHash).toBe(0x11223344);
    expect(decoded?.computerReceivedAtMs).toBe(9876);
    expect(decoded?.batch.batchSequence).toBe(7);
    expect(decoded?.batch.samples).toHaveLength(2);
  });

  it('reassembles Computer relay fragments before decoding the Blade packet', () => {
    const relay = makeRelayedPacket();
    const split = 80;
    const frames = [relay.subarray(0, split), relay.subarray(split)].map((payload, index) => {
      const frame = Buffer.alloc(9 + payload.length);
      frame[0] = 1;
      frame[1] = 0x11;
      frame.writeUInt32LE(55, 2);
      frame[6] = index;
      frame[7] = 2;
      frame[8] = payload.length;
      payload.copy(frame, 9);
      return frame;
    });
    const decoder = new RemusRelayedStreamPacketDecoder();

    expect(decoder.ingest(frames[0])).toBeNull();
    expect(decoder.ingest(frames[1])?.batch.samples).toHaveLength(2);
  });

  it('rejects a relay envelope with a corrupt CRC', () => {
    const relay = makeRelayedPacket();
    relay[12] = relay[12] === 0 ? 1 : 0;

    expect(new RemusRelayedStreamPacketDecoder().ingest(relay)).toBeNull();
  });

  it('reassembles fragments independently when two blades share the same relay sequence with different fragment counts', () => {
    const relayA = makeRelayedPacket(); // 2 fragments
    const splitA = 80;
    const framesA = [relayA.subarray(0, splitA), relayA.subarray(splitA)].map((payload, index) => {
      const frame = Buffer.alloc(9 + payload.length);
      frame[0] = 1;
      frame[1] = 0x11;
      frame.writeUInt32LE(42, 2); // seq 42
      frame[6] = index;
      frame[7] = 2; // count 2
      frame[8] = payload.length;
      payload.copy(frame, 9);
      return frame;
    });

    const relayB = makeRelayedPacket(); // 3 fragments
    relayB.writeUInt32LE(0x99887766, 2); // Different blade hash
    relayB.writeUInt32LE(crc32(relayB.subarray(0, relayB.length - 4)), relayB.length - 4);

    const splitB1 = 50;
    const splitB2 = 100;
    const framesB = [
      relayB.subarray(0, splitB1),
      relayB.subarray(splitB1, splitB2),
      relayB.subarray(splitB2),
    ].map((payload, index) => {
      const frame = Buffer.alloc(9 + payload.length);
      frame[0] = 1;
      frame[1] = 0x11;
      frame.writeUInt32LE(42, 2); // SAME seq 42!
      frame[6] = index;
      frame[7] = 3; // count 3
      frame[8] = payload.length;
      payload.copy(frame, 9);
      return frame;
    });

    const decoder = new RemusRelayedStreamPacketDecoder();

    // Ingest frame 0 of A
    expect(decoder.ingest(framesA[0])).toBeNull();
    // Ingest frame 0 of B (same seq 42, should NOT clobber A)
    expect(decoder.ingest(framesB[0])).toBeNull();
    // Complete A
    const decodedA = decoder.ingest(framesA[1]);
    expect(decodedA).not.toBeNull();
    expect(decodedA?.sourceIdentityHash).toBe(0x11223344);

    // Complete B
    expect(decoder.ingest(framesB[1])).toBeNull();
    const decodedB = decoder.ingest(framesB[2]);
    expect(decodedB).not.toBeNull();
    expect(decodedB?.sourceIdentityHash).toBe(0x99887766);
  });

  it('resets accumulator when a new fragment 0 arrives for the same sequence', () => {
    const relay = makeRelayedPacket();
    const split = 80;
    const frames = [relay.subarray(0, split), relay.subarray(split)].map((payload, index) => {
      const frame = Buffer.alloc(9 + payload.length);
      frame[0] = 1;
      frame[1] = 0x11;
      frame.writeUInt32LE(99, 2);
      frame[6] = index;
      frame[7] = 2;
      frame[8] = payload.length;
      payload.copy(frame, 9);
      return frame;
    });

    const decoder = new RemusRelayedStreamPacketDecoder();

    // Send fragment 0
    expect(decoder.ingest(frames[0])).toBeNull();
    // Send fragment 0 again (simulating drop of old batch and start of new batch on same seq)
    expect(decoder.ingest(frames[0])).toBeNull();
    // Send fragment 1
    const decoded = decoder.ingest(frames[1]);
    expect(decoded).not.toBeNull();
    expect(decoded?.batch.samples).toHaveLength(2);
  });
});

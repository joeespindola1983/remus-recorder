import { Buffer } from 'buffer';

import {
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

const makeBatch = (): Buffer => {
  const sampleCount = 2;
  const result = Buffer.alloc(23 + sampleCount * 15 + 4);
  result[0] = 1;
  result[1] = 1;
  result[3] = 23;
  result.writeUInt32LE(7, 4);
  result.writeUInt32LE(100, 8);
  result.writeBigUInt64LE(1_000_000n, 12);
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

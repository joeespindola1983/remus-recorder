import { Buffer } from 'buffer';
import {
  RemusBladeAdapter,
  REMUS_DEVICE_INFO_CHARACTERISTIC_UUID,
  REMUS_IMU_STREAM_CHARACTERISTIC_UUID,
  REMUS_BLADE_RELAY_CHARACTERISTIC_UUID,
} from '../src/services/blade/RemusBladeAdapter';
import { SensorSample } from '../src/types/wearables';

const crc32 = (data: Uint8Array): number => {
  /* eslint-disable no-bitwise */
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

const makeBatchBuffer = (
  batchSequence = 0,
  firstSampleSequence = 0,
  firstTimestampUs = 1_000_000,
  sampleCount = 2,
): Buffer => {
  const result = Buffer.alloc(23 + sampleCount * 15 + 4);
  result[0] = 1;
  result[1] = 1;
  result[3] = 23;
  result.writeUInt32LE(batchSequence, 4);
  result.writeUInt32LE(firstSampleSequence, 8);
  result.writeBigUInt64LE(BigInt(firstTimestampUs), 12);
  result.writeUInt16LE(5_000, 20);
  result[22] = sampleCount;

  for (let s = 0; s < sampleCount; s += 1) {
    const offset = 23 + s * 15;
    result.writeInt16LE(4096, offset);
    result.writeInt16LE(-2048, offset + 2);
    result.writeInt16LE(1024, offset + 4);
    result.writeInt16LE(66, offset + 6);
    result.writeInt16LE(-131, offset + 8);
    result.writeInt16LE(0, offset + 10);
    result.writeInt16LE(0, offset + 12);
    result[offset + 14] = 0;
  }
  result.writeUInt32LE(crc32(result.subarray(0, result.length - 4)), result.length - 4);
  return result;
};

const makeRelayedPacketBuffer = (
  sourceIdentityHash: number,
  batchSequence = 0,
  firstSampleSequence = 0,
  firstTimestampUs = 1_000_000,
): Buffer => {
  const payload = makeBatchBuffer(batchSequence, firstSampleSequence, firstTimestampUs);
  const result = Buffer.alloc(12 + payload.length + 4);
  result[0] = 1;
  result[1] = 0x21;
  result.writeUInt32LE(sourceIdentityHash, 2);
  result.writeUInt32LE(9876, 6);
  result.writeUInt16LE(payload.length, 10);
  payload.copy(result, 12);
  result.writeUInt32LE(crc32(result.subarray(0, result.length - 4)), result.length - 4);
  return result;
};

const makeDeviceInfoV3Buffer = (bootId: number): Buffer => {
  const serial = Buffer.from('RB-P1-A1B2C3D4');
  const firmware = Buffer.from('1.4.0');
  const packet = Buffer.alloc(16 + serial.length + 1 + firmware.length);
  packet.set([3, 2, 1, 1, 3, 0, 200, 0, 2, 3, 3], 0);
  packet.writeUInt32LE(bootId, 11);
  packet[15] = serial.length;
  serial.copy(packet, 16);
  packet[16 + serial.length] = firmware.length;
  firmware.copy(packet, 17 + serial.length);
  return packet;
};

describe('RemusBladeAdapter Continuity Integration (TDD)', () => {
  it('annotates SensorSamples with recordingId and clockDomainId from continuity tracker', () => {
    const adapter = new RemusBladeAdapter('blade-dev-1', 'REMUS-BLD-A1B2C3D4');
    const samples: SensorSample[] = [];
    adapter.onSensorData(sample => samples.push(sample));

    const packetBase64 = makeBatchBuffer(0, 0, 1000000, 2).toString('base64');
    adapter.handleSnapshotPayload({
      deviceId: 'blade-dev-1',
      characteristicUuid: REMUS_IMU_STREAM_CHARACTERISTIC_UUID,
      rawBase64: packetBase64,
    });

    expect(samples.length).toBe(2);
    const firstSample = samples[0];
    expect(firstSample.sourcePayload?.recordingId).toBe('rec:blade:a1b2c3d4:001');
    expect(firstSample.sourcePayload?.clockDomainId).toBe('clk:blade:a1b2c3d4:001');

    const recordings = adapter.getAllRecordings();
    expect(recordings.length).toBe(1);
    expect(recordings[0].recordingId).toBe('rec:blade:a1b2c3d4:001');
    expect(recordings[0].sampleCounts.rawImu).toBe(2);
  });

  it('splits recording and updates sample recordingId when sensor reboot is signaled via Device Info', () => {
    const adapter = new RemusBladeAdapter('blade-dev-1', 'REMUS-BLD-A1B2C3D4');
    const samples: SensorSample[] = [];
    adapter.onSensorData(sample => samples.push(sample));

    // Device Info v3 with bootId 0x11223344
    adapter.handleSnapshotPayload({
      deviceId: 'blade-dev-1',
      characteristicUuid: REMUS_DEVICE_INFO_CHARACTERISTIC_UUID,
      rawBase64: makeDeviceInfoV3Buffer(0x11223344).toString('base64'),
    });

    // Send first batch under bootId 0x11223344
    adapter.handleSnapshotPayload({
      deviceId: 'blade-dev-1',
      characteristicUuid: REMUS_IMU_STREAM_CHARACTERISTIC_UUID,
      rawBase64: makeBatchBuffer(0, 0, 1000000, 2).toString('base64'),
    });

    expect(samples.length).toBe(2);
    expect(samples[0].sourcePayload?.recordingId).toBe('rec:blade:a1b2c3d4:001');

    // Sensor reboots! New Device Info v3 with bootId 0x99887766
    adapter.handleSnapshotPayload({
      deviceId: 'blade-dev-1',
      characteristicUuid: REMUS_DEVICE_INFO_CHARACTERISTIC_UUID,
      rawBase64: makeDeviceInfoV3Buffer(0x99887766).toString('base64'),
    });

    // Send batch after reboot
    adapter.handleSnapshotPayload({
      deviceId: 'blade-dev-1',
      characteristicUuid: REMUS_IMU_STREAM_CHARACTERISTIC_UUID,
      rawBase64: makeBatchBuffer(0, 0, 50000, 2).toString('base64'),
    });

    expect(samples.length).toBe(4);
    const thirdSample = samples[2];
    expect(thirdSample.sourcePayload?.recordingId).toBe('rec:blade:a1b2c3d4:002');
    expect(thirdSample.sourcePayload?.clockDomainId).toBe('clk:blade:a1b2c3d4:002');

    const recordings = adapter.getAllRecordings();
    expect(recordings.length).toBe(2);
    expect(recordings[0].endReason).toBe('device_restarted');
    expect(recordings[0].deviceBootId).toBe('0x11223344');
    expect(recordings[1].startReason).toBe('device_restarted');
    expect(recordings[1].deviceBootId).toBe('0x99887766');
  });

  it('tracks relayed blades independently with separate clock domains and recordings', () => {
    const adapter = new RemusBladeAdapter('computer-1', 'REMUS-PC-01');
    const samples: SensorSample[] = [];
    adapter.onSensorData(sample => samples.push(sample));

    // Relayed packet from Blade A (hash 0x11112222)
    adapter.handleSnapshotPayload({
      deviceId: 'computer-1',
      characteristicUuid: REMUS_BLADE_RELAY_CHARACTERISTIC_UUID,
      rawBase64: makeRelayedPacketBuffer(0x11112222, 0, 0, 1000000).toString('base64'),
    });

    // Relayed packet from Blade B (hash 0x33334444)
    adapter.handleSnapshotPayload({
      deviceId: 'computer-1',
      characteristicUuid: REMUS_BLADE_RELAY_CHARACTERISTIC_UUID,
      rawBase64: makeRelayedPacketBuffer(0x33334444, 0, 0, 2000000).toString('base64'),
    });

    expect(samples.length).toBe(4);
    const bladeASample = samples[0];
    const bladeBSample = samples[2];

    expect(bladeASample.deviceId).toBe('blade:11112222');
    expect(bladeASample.sourcePayload?.recordingId).toBe('rec:blade:11112222:001');
    expect(bladeASample.sourcePayload?.clockDomainId).toBe('clk:blade:11112222:001');

    expect(bladeBSample.deviceId).toBe('blade:33334444');
    expect(bladeBSample.sourcePayload?.recordingId).toBe('rec:blade:33334444:001');
    expect(bladeBSample.sourcePayload?.clockDomainId).toBe('clk:blade:33334444:001');

    const allRecordings = adapter.getAllRecordings();
    const relayedRecordings = allRecordings.filter(r => r.sampleCounts.rawImu > 0);
    expect(relayedRecordings.length).toBe(2);
    expect(relayedRecordings.map(r => r.sourceId).sort()).toEqual(['blade:11112222', 'blade:33334444']);
  });
});

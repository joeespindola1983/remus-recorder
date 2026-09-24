import { Buffer } from 'buffer';

/* eslint-disable no-bitwise -- the versioned wire codec and CRC require bit operations. */

export const REMUS_BLADE_PROTOCOL_VERSION = 1;
export const REMUS_BLADE_DEVICE_INFO_UUID = 'beb5483f-36e1-4688-b7f5-ea07361b26a8';
export const REMUS_BLADE_CONTROL_UUID = 'beb54840-36e1-4688-b7f5-ea07361b26a8';
export const REMUS_BLADE_IMU_STREAM_UUID = 'beb54841-36e1-4688-b7f5-ea07361b26a8';
export const REMUS_BLADE_STATUS_UUID = 'beb54842-36e1-4688-b7f5-ea07361b26a8';
export const REMUS_BLADE_CLOCK_SYNC_UUID = 'beb54843-36e1-4688-b7f5-ea07361b26a8';

const MESSAGE_IMU_BATCH = 0x01;
const MESSAGE_STATUS = 0x02;
const MESSAGE_FRAGMENT = 0x11;
const BATCH_HEADER_BYTES = 23;
const SAMPLE_BYTES = 15;

export interface BladeDeviceInfo {
  protocolVersion: number;
  deviceFamily: number;
  deviceModelRevision: number;
  hardwareRevision: number;
  capabilities: number;
  samplingRateHertz: number;
  accelerometerRangeId: number;
  gyroscopeRangeId: number;
  deviceSerialNumber: string;
  firmwareVersion: string;
}

export interface BladeRawImuSample {
  sampleSequence: number;
  nativeTimestampUs: string;
  accelRawX: number;
  accelRawY: number;
  accelRawZ: number;
  gyroRawX: number;
  gyroRawY: number;
  gyroRawZ: number;
  sampleStatus: number;
  timingJitterMicroseconds: number;
}

export interface BladeImuBatch {
  protocolVersion: number;
  batchSequence: number;
  firstSampleSequence: number;
  firstSampleTimestampUs: string;
  nominalSamplePeriodUs: number;
  samples: BladeRawImuSample[];
}

export interface BladeStatus {
  protocolVersion: number;
  state: number;
  imuHealthy: boolean;
  connected: boolean;
  nextSampleSequence: number;
  nextBatchSequence: number;
  imuReadFailureCount: number;
  queueDropCount: number;
  notificationErrorCount: number;
  mtu: number;
}

function readUint64Le(buffer: Buffer, offset: number): bigint {
  const low = BigInt(buffer.readUInt32LE(offset));
  const high = BigInt(buffer.readUInt32LE(offset + 4));
  return low | (high << 32n);
}

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

export function decodeBladeDeviceInfo(data: Uint8Array): BladeDeviceInfo {
  const buffer = Buffer.from(data);
  if (buffer.length < 12 || buffer[0] !== REMUS_BLADE_PROTOCOL_VERSION) {
    throw new Error('INVALID_DEVICE_INFO');
  }
  const serialLength = buffer[10];
  const firmwareLengthOffset = 11 + serialLength;
  if (firmwareLengthOffset >= buffer.length) throw new Error('TRUNCATED_DEVICE_INFO');
  const firmwareLength = buffer[firmwareLengthOffset];
  if (firmwareLengthOffset + 1 + firmwareLength !== buffer.length) {
    throw new Error('INVALID_DEVICE_INFO_LENGTH');
  }
  return {
    protocolVersion: buffer[0],
    deviceFamily: buffer[1],
    deviceModelRevision: buffer[2],
    hardwareRevision: buffer[3],
    capabilities: buffer.readUInt16LE(4),
    samplingRateHertz: buffer.readUInt16LE(6),
    accelerometerRangeId: buffer[8],
    gyroscopeRangeId: buffer[9],
    deviceSerialNumber: buffer.subarray(11, 11 + serialLength).toString('utf8'),
    firmwareVersion: buffer.subarray(firmwareLengthOffset + 1).toString('utf8'),
  };
}

export function decodeBladeImuBatch(data: Uint8Array): BladeImuBatch {
  const buffer = Buffer.from(data);
  if (buffer.length < BATCH_HEADER_BYTES + 4 ||
      buffer[0] !== REMUS_BLADE_PROTOCOL_VERSION ||
      buffer[1] !== MESSAGE_IMU_BATCH ||
      buffer[3] !== BATCH_HEADER_BYTES) {
    throw new Error('INVALID_IMU_BATCH');
  }
  const sampleCount = buffer[22];
  const expectedLength = BATCH_HEADER_BYTES + sampleCount * SAMPLE_BYTES + 4;
  if (sampleCount === 0 || sampleCount > 10 || buffer.length !== expectedLength) {
    throw new Error('INVALID_IMU_BATCH_LENGTH');
  }
  const expectedCrc = buffer.readUInt32LE(buffer.length - 4);
  const actualCrc = crc32(buffer.subarray(0, buffer.length - 4));
  if (actualCrc !== expectedCrc) throw new Error('IMU_BATCH_CRC_MISMATCH');

  const batchSequence = buffer.readUInt32LE(4);
  const firstSampleSequence = buffer.readUInt32LE(8);
  const firstTimestamp = readUint64Le(buffer, 12);
  const nominalSamplePeriodUs = buffer.readUInt16LE(20);
  const samples: BladeRawImuSample[] = [];
  let offset = BATCH_HEADER_BYTES;
  for (let index = 0; index < sampleCount; index += 1) {
    const timingJitterMicroseconds = buffer.readInt16LE(offset + 12);
    const nativeTimestamp = firstTimestamp +
      BigInt(index * nominalSamplePeriodUs + timingJitterMicroseconds);
    samples.push({
      sampleSequence: firstSampleSequence + index,
      nativeTimestampUs: nativeTimestamp.toString(),
      accelRawX: buffer.readInt16LE(offset),
      accelRawY: buffer.readInt16LE(offset + 2),
      accelRawZ: buffer.readInt16LE(offset + 4),
      gyroRawX: buffer.readInt16LE(offset + 6),
      gyroRawY: buffer.readInt16LE(offset + 8),
      gyroRawZ: buffer.readInt16LE(offset + 10),
      timingJitterMicroseconds,
      sampleStatus: buffer[offset + 14],
    });
    offset += SAMPLE_BYTES;
  }
  return {
    protocolVersion: buffer[0],
    batchSequence,
    firstSampleSequence,
    firstSampleTimestampUs: firstTimestamp.toString(),
    nominalSamplePeriodUs,
    samples,
  };
}

export function decodeBladeStatus(data: Uint8Array): BladeStatus {
  const buffer = Buffer.from(data);
  if (buffer.length !== 26 || buffer[0] !== REMUS_BLADE_PROTOCOL_VERSION ||
      buffer[1] !== MESSAGE_STATUS) throw new Error('INVALID_BLADE_STATUS');
  return {
    protocolVersion: buffer[0],
    state: buffer[2],
    imuHealthy: (buffer[3] & 0x01) !== 0,
    connected: (buffer[3] & 0x02) !== 0,
    nextSampleSequence: buffer.readUInt32LE(4),
    nextBatchSequence: buffer.readUInt32LE(8),
    imuReadFailureCount: buffer.readUInt32LE(12),
    queueDropCount: buffer.readUInt32LE(16),
    notificationErrorCount: buffer.readUInt32LE(20),
    mtu: buffer.readUInt16LE(24),
  };
}

export function encodeBladeControl(command: 'start' | 'stop', requestId: number): Buffer {
  const buffer = Buffer.alloc(6);
  buffer[0] = REMUS_BLADE_PROTOCOL_VERSION;
  buffer[1] = command === 'start' ? 0x01 : 0x02;
  buffer.writeUInt32LE(requestId >>> 0, 2);
  return buffer;
}

interface FragmentSet {
  fragmentCount: number;
  fragments: Array<Buffer | undefined>;
  received: number;
}

export class BladeFragmentReassembler {
  private readonly pending = new Map<string, FragmentSet>();

  accept(deviceId: string, data: Uint8Array): Buffer | null {
    const buffer = Buffer.from(data);
    if (buffer.length < 2) throw new Error('TRUNCATED_BLADE_FRAME');
    if (buffer[0] !== REMUS_BLADE_PROTOCOL_VERSION) throw new Error('UNSUPPORTED_BLADE_PROTOCOL');
    if (buffer[1] === MESSAGE_IMU_BATCH) return buffer;
    if (buffer[1] !== MESSAGE_FRAGMENT || buffer.length < 9) return null;

    const batchSequence = buffer.readUInt32LE(2);
    const fragmentIndex = buffer[6];
    const fragmentCount = buffer[7];
    const payloadLength = buffer[8];
    if (fragmentCount === 0 || fragmentIndex >= fragmentCount ||
        payloadLength !== buffer.length - 9) throw new Error('INVALID_BLADE_FRAGMENT');
    const key = `${deviceId}:${batchSequence}`;
    let set = this.pending.get(key);
    if (!set || set.fragmentCount !== fragmentCount) {
      set = { fragmentCount, fragments: new Array(fragmentCount), received: 0 };
      this.pending.set(key, set);
    }
    if (!set.fragments[fragmentIndex]) {
      set.fragments[fragmentIndex] = buffer.subarray(9);
      set.received += 1;
    }
    if (set.received !== set.fragmentCount) return null;
    this.pending.delete(key);
    return Buffer.concat(set.fragments as Buffer[]);
  }

  clearDevice(deviceId: string): void {
    for (const key of this.pending.keys()) {
      if (key.startsWith(`${deviceId}:`)) this.pending.delete(key);
    }
  }
}

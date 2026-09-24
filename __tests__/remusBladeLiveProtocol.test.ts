import { Buffer } from 'buffer';

/* eslint-disable no-bitwise -- corruption fixture flips one protocol byte. */
import {
  BladeFragmentReassembler,
  crc32,
  decodeBladeDeviceInfo,
  decodeBladeImuBatch,
  decodeBladeStatus,
  encodeBladeControl,
} from '../src/services/blade/RemusBladeLiveProtocol';

function makeBatch(): Buffer {
  const buffer = Buffer.alloc(23 + 15 * 2 + 4);
  buffer[0] = 1;
  buffer[1] = 1;
  buffer[3] = 23;
  buffer.writeUInt32LE(7, 4);
  buffer.writeUInt32LE(41, 8);
  buffer.writeUInt32LE(123456789, 12);
  buffer.writeUInt32LE(0, 16);
  buffer.writeUInt16LE(5000, 20);
  buffer[22] = 2;
  const axes = [-1, 2, -3, 4, -5, 6, 7, -8, 9, -10, 11, -12];
  axes.forEach((axis, index) => {
    const sample = Math.floor(index / 6);
    const axisIndex = index % 6;
    buffer.writeInt16LE(axis, 23 + sample * 15 + axisIndex * 2);
  });
  buffer.writeInt16LE(0, 35);
  buffer[37] = 0;
  buffer.writeInt16LE(7, 50);
  buffer[52] = 3;
  buffer.writeUInt32LE(crc32(buffer.subarray(0, buffer.length - 4)), buffer.length - 4);
  return buffer;
}

describe('Remus Blade live protocol', () => {
  it('decodes durable device info', () => {
    const serial = Buffer.from('RB-D-ABC');
    const firmware = Buffer.from('0.4.0');
    const info = Buffer.alloc(12 + serial.length + firmware.length);
    info.set([1, 2, 1, 1, 3, 0, 200, 0, 1, 1, serial.length], 0);
    serial.copy(info, 11);
    info[11 + serial.length] = firmware.length;
    firmware.copy(info, 12 + serial.length);
    expect(decodeBladeDeviceInfo(info)).toEqual(expect.objectContaining({
      deviceSerialNumber: 'RB-D-ABC',
      firmwareVersion: '0.4.0',
      samplingRateHertz: 200,
    }));
  });

  it('decodes raw samples, timing jitter and CRC', () => {
    const decoded = decodeBladeImuBatch(makeBatch());
    expect(decoded.batchSequence).toBe(7);
    expect(decoded.samples).toHaveLength(2);
    expect(decoded.samples[0]).toEqual(expect.objectContaining({
      sampleSequence: 41,
      nativeTimestampUs: '123456789',
      accelRawX: -1,
      gyroRawZ: 6,
    }));
    expect(decoded.samples[1]).toEqual(expect.objectContaining({
      sampleSequence: 42,
      nativeTimestampUs: '123461796',
      timingJitterMicroseconds: 7,
      sampleStatus: 3,
    }));
  });

  it('rejects a corrupted batch', () => {
    const batch = makeBatch();
    batch[24] ^= 0xff;
    expect(() => decodeBladeImuBatch(batch)).toThrow('IMU_BATCH_CRC_MISMATCH');
  });

  it('reassembles out-of-order fragments and ignores duplicates', () => {
    const batch = makeBatch();
    const chunks = [batch.subarray(0, 30), batch.subarray(30)];
    const frame = (index: number) => {
      const value = Buffer.alloc(9 + chunks[index].length);
      value.set([1, 0x11], 0);
      value.writeUInt32LE(7, 2);
      value[6] = index;
      value[7] = 2;
      value[8] = chunks[index].length;
      chunks[index].copy(value, 9);
      return value;
    };
    const reassembler = new BladeFragmentReassembler();
    expect(reassembler.accept('blade-a', frame(1))).toBeNull();
    expect(reassembler.accept('blade-a', frame(1))).toBeNull();
    expect(reassembler.accept('blade-a', frame(0))).toEqual(batch);
  });

  it('encodes idempotent binary control and decodes status', () => {
    expect([...encodeBladeControl('start', 99)]).toEqual([1, 1, 99, 0, 0, 0]);
    const status = Buffer.alloc(26);
    status.set([1, 2, 2, 3], 0);
    status.writeUInt32LE(200, 4);
    status.writeUInt32LE(20, 8);
    status.writeUInt32LE(1, 12);
    status.writeUInt32LE(2, 16);
    status.writeUInt32LE(3, 20);
    status.writeUInt16LE(185, 24);
    expect(decodeBladeStatus(status)).toEqual(expect.objectContaining({
      imuHealthy: true,
      connected: true,
      mtu: 185,
      queueDropCount: 2,
    }));
  });
});

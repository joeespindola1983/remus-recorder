import { Buffer } from 'buffer';
import {
  decodeRemusBladeBinary,
  convertRemusBladeBinaryToCsv,
} from '../src/services/blade/RemusBladeBinaryDecoder';

describe('RemusBladeBinaryDecoder (TDD)', () => {
  it('parses RBP1 header and decodes 200 Hz IMU, GPS and SPM binary records', () => {
    // 32-byte header: "RBP1" + version 1 + fs_accel 1 + fs_gyro 1 + rate 200 + started_at_ms (1000) + session_id + padding
    const header = Buffer.alloc(32);
    header.write('RBP1', 0, 4, 'ascii');
    header.writeUInt8(1, 4); // version
    header.writeUInt8(1, 5); // fs_accel (±8g)
    header.writeUInt8(1, 6); // fs_gyro (±500 dps)
    header.writeUInt8(200, 7); // 200 Hz
    header.writeUInt32LE(1000, 8); // started_at_ms

    // IMU record (17 bytes): type 0x01 + timestamp_ms 1005 + ax 4096 (1.0g) + ay 0 + az 0 + gx 655 (10.0 dps) + gy 0 + gz 0
    const imu1 = Buffer.alloc(17);
    imu1.writeUInt8(0x01, 0);
    imu1.writeUInt32LE(1005, 1);
    imu1.writeInt16LE(4096, 5); // 1.0 g
    imu1.writeInt16LE(0, 7);
    imu1.writeInt16LE(0, 9);
    imu1.writeInt16LE(655, 11); // ~10.0 dps
    imu1.writeInt16LE(0, 13);
    imu1.writeInt16LE(0, 15);

    // GPS record (19 bytes): type 0x02 + timestamp_ms 1010 + lat -235505200 + lon -466333080 + speed_cm_s 500 (18 km/h) + sats 6 + snr 32 + acc_cm 320 (3.2m)
    const gps1 = Buffer.alloc(19);
    gps1.writeUInt8(0x02, 0);
    gps1.writeUInt32LE(1010, 1);
    gps1.writeInt32LE(-235505200, 5); // -23.550520
    gps1.writeInt32LE(-466333080, 9); // -46.633308
    gps1.writeUInt16LE(500, 13); // 500 cm/s = 18.0 km/h
    gps1.writeUInt8(6, 15); // 6 sats
    gps1.writeUInt8(32, 16); // 32 dB-Hz
    gps1.writeUInt16LE(320, 17); // 3.2 m

    // SPM record (7 bytes): type 0x03 + timestamp_ms 1015 + spm_x10 245 (24.5 SPM)
    const spm1 = Buffer.alloc(7);
    spm1.writeUInt8(0x03, 0);
    spm1.writeUInt32LE(1015, 1);
    spm1.writeUInt16LE(245, 5);

    const fullBinary = Buffer.concat([header, imu1, gps1, spm1]);

    const decoded = decodeRemusBladeBinary(fullBinary);

    expect(decoded.header.magic).toBe('RBP1');
    expect(decoded.header.version).toBe(1);
    expect(decoded.header.imuRateHz).toBe(200);

    expect(decoded.imuSamples).toHaveLength(1);
    expect(decoded.imuSamples[0].timestampMs).toBe(1005);
    expect(decoded.imuSamples[0].accelG.x).toBeCloseTo(1.0, 2);
    expect(decoded.imuSamples[0].gyroDps.x).toBeCloseTo(10.0, 1);

    expect(decoded.gpsFixes).toHaveLength(1);
    expect(decoded.gpsFixes[0].latitude).toBeCloseTo(-23.550520, 6);
    expect(decoded.gpsFixes[0].longitude).toBeCloseTo(-46.633308, 6);
    expect(decoded.gpsFixes[0].speedKmh).toBeCloseTo(18.0, 1);
    expect(decoded.gpsFixes[0].satsInUse).toBe(6);
    expect(decoded.gpsFixes[0].accuracyMeters).toBeCloseTo(3.2, 1);

    expect(decoded.spmEvents).toHaveLength(1);
    expect(decoded.spmEvents[0].strokeRateSpm).toBeCloseTo(24.5, 1);
  });

  it('converts binary to standard canonical CSV for export and evidence storage', () => {
    const header = Buffer.alloc(32);
    header.write('RBP1', 0, 4, 'ascii');
    header.writeUInt8(1, 4);

    const imu1 = Buffer.alloc(17);
    imu1.writeUInt8(0x01, 0);
    imu1.writeUInt32LE(1000, 1);
    imu1.writeInt16LE(4096, 5);
    imu1.writeInt16LE(0, 7);
    imu1.writeInt16LE(0, 9);
    imu1.writeInt16LE(0, 11);
    imu1.writeInt16LE(0, 13);
    imu1.writeInt16LE(0, 15);

    const fullBinary = Buffer.concat([header, imu1]);
    const csv = convertRemusBladeBinaryToCsv(fullBinary);

    expect(csv).toContain('timestamp_us,ax,ay,az,gx,gy,gz,lat,lon,speed_kmh,sats');
    expect(csv).toContain('1000000,1.000,0.000,0.000,0.00,0.00,0.00');
  });
});

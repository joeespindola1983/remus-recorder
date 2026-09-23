import { Buffer } from 'buffer';

export interface RemusBladeBinaryHeader {
  magic: string;
  version: number;
  imuFsAccel: number;
  imuFsGyro: number;
  imuRateHz: number;
  startedAtMs: number;
  sessionId?: number;
}

export interface RemusBladeImuSample {
  timestampMs: number;
  rawAccel: { x: number; y: number; z: number };
  rawGyro: { x: number; y: number; z: number };
  accelG: { x: number; y: number; z: number };
  gyroDps: { x: number; y: number; z: number };
}

export interface RemusBladeGpsFix {
  timestampMs: number;
  latitude: number;
  longitude: number;
  speedKmh: number;
  satsInUse: number;
  maxSnr: number;
  accuracyMeters: number;
}

export interface RemusBladeSpmEvent {
  timestampMs: number;
  strokeRateSpm: number;
}

export interface DecodedRemusBladeSession {
  header: RemusBladeBinaryHeader;
  imuSamples: RemusBladeImuSample[];
  gpsFixes: RemusBladeGpsFix[];
  spmEvents: RemusBladeSpmEvent[];
}

export function decodeRemusBladeBinary(buffer: Buffer | Uint8Array): DecodedRemusBladeSession {
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  if (uint8.length < 32) {
    throw new Error('Buffer too small for Remus Blade binary header');
  }

  const magic = String.fromCharCode(uint8[0], uint8[1], uint8[2], uint8[3]);
  if (magic !== 'RBP1') {
    throw new Error('Invalid magic header: ' + magic + ', expected RBP1');
  }

  const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);

  const header: RemusBladeBinaryHeader = {
    magic,
    version: view.getUint8(4),
    imuFsAccel: view.getUint8(5),
    imuFsGyro: view.getUint8(6),
    imuRateHz: view.getUint8(7),
    startedAtMs: view.getUint32(8, true),
    sessionId: view.getUint32(12, true),
  };

  const imuSamples: RemusBladeImuSample[] = [];
  const gpsFixes: RemusBladeGpsFix[] = [];
  const spmEvents: RemusBladeSpmEvent[] = [];

  let offset = 32;
  while (offset < uint8.length) {
    const recordType = view.getUint8(offset);

    if (recordType === 0x01) {
      // IMU Record (17 bytes)
      if (offset + 17 > uint8.length) break;
      const timestampMs = view.getUint32(offset + 1, true);
      const rawAx = view.getInt16(offset + 5, true);
      const rawAy = view.getInt16(offset + 7, true);
      const rawAz = view.getInt16(offset + 9, true);
      const rawGx = view.getInt16(offset + 11, true);
      const rawGy = view.getInt16(offset + 13, true);
      const rawGz = view.getInt16(offset + 15, true);

      imuSamples.push({
        timestampMs,
        rawAccel: { x: rawAx, y: rawAy, z: rawAz },
        rawGyro: { x: rawGx, y: rawGy, z: rawGz },
        accelG: {
          x: rawAx / 4096.0,
          y: rawAy / 4096.0,
          z: rawAz / 4096.0,
        },
        gyroDps: {
          x: rawGx / 65.5,
          y: rawGy / 65.5,
          z: rawGz / 65.5,
        },
      });
      offset += 17;
    } else if (recordType === 0x02) {
      // GPS Record (19 bytes)
      if (offset + 19 > uint8.length) break;
      const timestampMs = view.getUint32(offset + 1, true);
      const latE7 = view.getInt32(offset + 5, true);
      const lonE7 = view.getInt32(offset + 9, true);
      const speedCmS = view.getUint16(offset + 13, true);
      const satsInUse = view.getUint8(offset + 15);
      const maxSnr = view.getUint8(offset + 16);
      const accuracyCm = view.getUint16(offset + 17, true);

      gpsFixes.push({
        timestampMs,
        latitude: latE7 / 1e7,
        longitude: lonE7 / 1e7,
        speedKmh: speedCmS * 0.036,
        satsInUse,
        maxSnr,
        accuracyMeters: accuracyCm / 100.0,
      });
      offset += 19;
    } else if (recordType === 0x03) {
      // SPM Record (7 bytes)
      if (offset + 7 > uint8.length) break;
      const timestampMs = view.getUint32(offset + 1, true);
      const spmX10 = view.getUint16(offset + 5, true);

      spmEvents.push({
        timestampMs,
        strokeRateSpm: spmX10 / 10.0,
      });
      offset += 7;
    } else {
      offset += 1;
    }
  }

  return {
    header,
    imuSamples,
    gpsFixes,
    spmEvents,
  };
}

export function convertRemusBladeBinaryToCsv(buffer: Buffer | Uint8Array): string {
  const decoded = decodeRemusBladeBinary(buffer);
  const lines: string[] = ['timestamp_us,ax,ay,az,gx,gy,gz,lat,lon,speed_kmh,sats'];

  let gpsIndex = 0;
  for (const imu of decoded.imuSamples) {
    const timestampUs = imu.timestampMs * 1000;
    while (
      gpsIndex + 1 < decoded.gpsFixes.length &&
      decoded.gpsFixes[gpsIndex + 1].timestampMs <= imu.timestampMs
    ) {
      gpsIndex++;
    }

    const currentGps = decoded.gpsFixes[gpsIndex];
    const hasGps = currentGps && Math.abs(currentGps.timestampMs - imu.timestampMs) < 2500;

    if (hasGps) {
      const satsStr = currentGps.satsInUse + '/' + currentGps.satsInUse + ':' + currentGps.maxSnr + ':' + currentGps.accuracyMeters.toFixed(1) + 'm';
      lines.push(
        timestampUs + ',' + imu.accelG.x.toFixed(3) + ',' + imu.accelG.y.toFixed(3) + ',' + imu.accelG.z.toFixed(3) + ',' +
        imu.gyroDps.x.toFixed(2) + ',' + imu.gyroDps.y.toFixed(2) + ',' + imu.gyroDps.z.toFixed(2) + ',' +
        currentGps.latitude.toFixed(6) + ',' + currentGps.longitude.toFixed(6) + ',' + currentGps.speedKmh.toFixed(2) + ',' + satsStr
      );
    } else {
      lines.push(
        timestampUs + ',' + imu.accelG.x.toFixed(3) + ',' + imu.accelG.y.toFixed(3) + ',' + imu.accelG.z.toFixed(3) + ',' +
        imu.gyroDps.x.toFixed(2) + ',' + imu.gyroDps.y.toFixed(2) + ',' + imu.gyroDps.z.toFixed(2) + ',,,,0/0:0:0.0m'
      );
    }
  }

  return lines.join(String.fromCharCode(10));
}

import { NativeEventEmitter } from 'react-native';

jest.mock('react-native', () => {
  const listeners: Record<string, Function> = {};
  return {
    NativeEventEmitter: jest.fn().mockImplementation(() => ({
      addListener: jest.fn((event: string, callback: Function) => {
        listeners[event] = callback;
        return { remove: jest.fn() };
      }),
      emit: (event: string, ...args: any[]) => {
        if (listeners[event]) listeners[event](...args);
      },
    })),
  };
});

import {
  RemusBladeAdapter,
  canonicalRemusSourceId,
  decodeRemusDeviceInfo,
  mapEstimatorReasonToPresentationAvailabilityReason,
  parseBladeIdentityHash,
  rawGyroToRadiansPerSecond,
  REMUS_BLADE_SERVICE_UUID,
  REMUS_BLADE_CHARACTERISTIC_UUID,
  REMUS_CLOCK_SYNC_CHARACTERISTIC_UUID,
  REMUS_IMU_STREAM_CHARACTERISTIC_UUID,
  NativeBladeBridge,
} from '../src/services/blade/RemusBladeAdapter';

describe('RemusBladeAdapter (TDD)', () => {
  it('decodes Blade gyro at ±1000 dps without changing the Computer ±500 dps scale', () => {
    expect(rawGyroToRadiansPerSecond(3280, 'remus_blade')).toBeCloseTo(100 * Math.PI / 180);
    expect(rawGyroToRadiansPerSecond(6550, 'remus_computer')).toBeCloseTo(100 * Math.PI / 180);
  });

  it('extracts only the full stable 32-bit identity advertised by a Blade', () => {
    expect(parseBladeIdentityHash('REMUS-BLD-A1B2C3D4')).toBe(0xA1B2C3D4);
    expect(parseBladeIdentityHash('REMUS-BLD-C3D4')).toBeNull();
    expect(parseBladeIdentityHash('REMUS-P1-1234')).toBeNull();
  });

  it('uses the advertised Blade identity instead of the temporary BLE identifier', () => {
    expect(canonicalRemusSourceId('temporary-ios-uuid', 'REMUS-BLD-A1B2C3D4'))
      .toBe('blade:a1b2c3d4');
  });

  it('decodes the versioned firmware device metadata contract', () => {
    const serial = Buffer.from('RB-P1-A1B2C3D4');
    const firmware = Buffer.from('1.4.0');
    const packet = Buffer.alloc(12 + serial.length + firmware.length);
    packet.set([1, 2, 1, 1, 3, 0, 200, 0, 1, 2, serial.length], 0);
    serial.copy(packet, 11);
    packet[11 + serial.length] = firmware.length;
    firmware.copy(packet, 12 + serial.length);

    expect(decodeRemusDeviceInfo(packet)).toEqual({
      protocolVersion: 1,
      deviceFamily: 'remus_blade',
      deviceModel: 'rbp1',
      hardwareRevision: 1,
      capabilities: 3,
      nominalSampleRateHz: 200,
      accelerometerRangeG: 8,
      gyroscopeRangeDps: 1000,
      dlpfSetting: null,
      deviceSerialNumber: 'RB-P1-A1B2C3D4',
      firmwareVersion: '1.4.0',
      deviceBootId: null,
    });
  });

  it('decodes Device Info v3 containing deviceBootId without breaking v1 or v2', () => {
    const serial = Buffer.from('RB-P1-A1B2C3D4');
    const firmware = Buffer.from('1.4.0');
    const packet = Buffer.alloc(16 + serial.length + 1 + firmware.length);
    packet.set([3, 2, 1, 1, 3, 0, 200, 0, 2, 3, 3], 0);
    packet.writeUInt32LE(0xA1B2C3D4, 11);
    packet[15] = serial.length;
    serial.copy(packet, 16);
    packet[16 + serial.length] = firmware.length;
    firmware.copy(packet, 17 + serial.length);

    expect(decodeRemusDeviceInfo(packet)).toEqual({
      protocolVersion: 3,
      deviceFamily: 'remus_blade',
      deviceModel: 'rbp1',
      hardwareRevision: 1,
      capabilities: 3,
      nominalSampleRateHz: 200,
      accelerometerRangeG: 16,
      gyroscopeRangeDps: 2000,
      dlpfSetting: 3,
      deviceSerialNumber: 'RB-P1-A1B2C3D4',
      firmwareVersion: '1.4.0',
      deviceBootId: 0xA1B2C3D4,
    });
  });

  it('decodes ClockSync v2 response with deviceBootId and invalidates observations when sensor reboots', () => {
    const adapter = new RemusBladeAdapter('blade-transport', 'REMUS-BLD-A1B2C3D4');

    // First observation from boot session 0x11112222
    const packet1 = Buffer.alloc(34);
    packet1[0] = 1;
    packet1[1] = 0x04;
    packet1.writeUInt32LE(1, 2);
    packet1.writeBigUInt64LE(1_000_000n, 6);
    packet1.writeBigUInt64LE(1_001_200n, 14);
    packet1.writeBigUInt64LE(1_001_300n, 22);
    packet1.writeUInt32LE(0x11112222, 30);

    adapter.handleSnapshotPayload({
      deviceId: 'blade-transport',
      characteristicUuid: 'beb54843-36e1-4688-b7f5-ea07361b26a8',
      rawBase64: packet1.toString('base64'),
      receivedAtMonotonicUs: 1_000_500,
    });

    expect(adapter.getClockSync()).toMatchObject({
      deviceBootId: 0x11112222,
      observationCount: 1,
      estimatedClockOffsetUs: 1000,
    });

    // Second observation from rebooted sensor session 0x33334444
    const packet2 = Buffer.alloc(34);
    packet2[0] = 1;
    packet2[1] = 0x04;
    packet2.writeUInt32LE(2, 2);
    packet2.writeBigUInt64LE(2_000_000n, 6);
    packet2.writeBigUInt64LE(500_000n, 14);
    packet2.writeBigUInt64LE(500_100n, 22);
    packet2.writeUInt32LE(0x33334444, 30);

    adapter.handleSnapshotPayload({
      deviceId: 'blade-transport',
      characteristicUuid: 'beb54843-36e1-4688-b7f5-ea07361b26a8',
      rawBase64: packet2.toString('base64'),
      receivedAtMonotonicUs: 2_000_300,
    });

    // Previous observation from 0x11112222 must NOT be merged with 0x33334444!
    expect(adapter.getClockSync()).toMatchObject({
      deviceBootId: 0x33334444,
      observationCount: 1, // Reset to 1, previous observation dropped!
      estimatedClockOffsetUs: -1_500_100,
    });
  });

  it('maps the sensor monotonic clock to the host clock with an explicit error bound', () => {
    const adapter = new RemusBladeAdapter('blade-transport', 'REMUS-BLD-A1B2C3D4');
    const packet = Buffer.alloc(30);
    packet[0] = 1;
    packet[1] = 0x04;
    packet.writeUInt32LE(7, 2);
    packet.writeBigUInt64LE(1_000_000n, 6);
    packet.writeBigUInt64LE(1_001_200n, 14);
    packet.writeBigUInt64LE(1_001_300n, 22);

    adapter.handleSnapshotPayload({
      deviceId: 'blade-transport',
      characteristicUuid: 'beb54843-36e1-4688-b7f5-ea07361b26a8',
      rawBase64: packet.toString('base64'),
      receivedAtMonotonicUs: 1_000_500,
    });

    expect(adapter.getClockSync()).toMatchObject({
      estimatedClockOffsetUs: 1000,
      roundTripUs: 400,
      maximumErrorUs: 200,
      currentOffsetUncertaintyUs: 200,
      sessionWorstCaseUncertaintyUs: 200,
      syncQuality: 'approximate',
      observationCount: 1,
    });
  });

  it('classifies sync quality as approximate when uncertainty is between 5ms and 25ms and tracks sessionWorstCaseUncertaintyUs', () => {
    const adapter = new RemusBladeAdapter('blade-transport', 'REMUS-BLD-A1B2C3D4');
    
    // First sync: RTT = 40ms -> uncertainty = 20ms -> approximate
    const packet1 = Buffer.alloc(30);
    packet1[0] = 1;
    packet1[1] = 0x04;
    packet1.writeUInt32LE(1, 2);
    packet1.writeBigUInt64LE(10_000_000n, 6);
    packet1.writeBigUInt64LE(10_020_000n, 14);
    packet1.writeBigUInt64LE(10_020_000n, 22);

    adapter.handleSnapshotPayload({
      deviceId: 'blade-transport',
      characteristicUuid: 'beb54843-36e1-4688-b7f5-ea07361b26a8',
      rawBase64: packet1.toString('base64'),
      receivedAtMonotonicUs: 10_040_000,
    });

    expect(adapter.getClockSync()).toMatchObject({
      roundTripUs: 40_000,
      currentOffsetUncertaintyUs: 20_000,
      sessionWorstCaseUncertaintyUs: 20_000,
      syncQuality: 'approximate',
      observationCount: 1,
    });

    // Second sync: RTT = 100ms -> uncertainty = 50ms -> low_confidence
    const packet2 = Buffer.alloc(30);
    packet2[0] = 1;
    packet2[1] = 0x04;
    packet2.writeUInt32LE(2, 2);
    packet2.writeBigUInt64LE(20_000_000n, 6);
    packet2.writeBigUInt64LE(20_050_000n, 14);
    packet2.writeBigUInt64LE(20_050_000n, 22);

    adapter.handleSnapshotPayload({
      deviceId: 'blade-transport',
      characteristicUuid: 'beb54843-36e1-4688-b7f5-ea07361b26a8',
      rawBase64: packet2.toString('base64'),
      receivedAtMonotonicUs: 20_100_000,
    });

    expect(adapter.getClockSync()).toMatchObject({
      roundTripUs: 100_000,
      currentOffsetUncertaintyUs: 50_000,
      sessionWorstCaseUncertaintyUs: 50_000,
      maximumErrorUs: 20_000,
      syncQuality: 'approximate',
      observationCount: 2,
    });

    // Third sync: RTT = 6ms -> uncertainty = 3ms -> qualified
    const packet3 = Buffer.alloc(30);
    packet3[0] = 1;
    packet3[1] = 0x04;
    packet3.writeUInt32LE(3, 2);
    packet3.writeBigUInt64LE(30_000_000n, 6);
    packet3.writeBigUInt64LE(30_003_000n, 14);
    packet3.writeBigUInt64LE(30_003_000n, 22);

    adapter.handleSnapshotPayload({
      deviceId: 'blade-transport',
      characteristicUuid: 'beb54843-36e1-4688-b7f5-ea07361b26a8',
      rawBase64: packet3.toString('base64'),
      receivedAtMonotonicUs: 30_006_000,
    });

    expect(adapter.getClockSync()).toMatchObject({
      roundTripUs: 6_000,
      currentOffsetUncertaintyUs: 3_000,
      sessionWorstCaseUncertaintyUs: 50_000, // Preserves worst-case across session
      syncQuality: 'qualified',
      observationCount: 3,
    });
  });

  it('does not replace a qualified mapping with the final high-latency observation', () => {
    const adapter = new RemusBladeAdapter('blade-transport', 'REMUS-BLD-A1B2C3D4');
    const observations = [
      {host: 1_000_000, offset: 2_000, rtt: 4_000},
      {host: 2_000_000, offset: 2_010, rtt: 5_000},
      {host: 3_000_000, offset: 1_990, rtt: 4_500},
      {host: 4_000_000, offset: 40_000, rtt: 100_000},
    ];

    observations.forEach((observation, index) => {
      const packet = Buffer.alloc(30);
      packet[0] = 1;
      packet[1] = 0x04;
      packet.writeUInt32LE(index + 1, 2);
      packet.writeBigUInt64LE(BigInt(observation.host), 6);
      const sensorTime = observation.host + observation.rtt / 2 + observation.offset;
      packet.writeBigUInt64LE(BigInt(sensorTime), 14);
      packet.writeBigUInt64LE(BigInt(sensorTime), 22);
      adapter.handleSnapshotPayload({
        deviceId: 'blade-transport',
        characteristicUuid: 'beb54843-36e1-4688-b7f5-ea07361b26a8',
        rawBase64: packet.toString('base64'),
        receivedAtMonotonicUs: observation.host + observation.rtt,
      });
    });

    expect(adapter.getClockSync()).toMatchObject({
      currentOffsetUncertaintyUs: 50_000,
      sessionWorstCaseUncertaintyUs: 50_000,
      syncQuality: 'qualified',
      observationCount: 4,
    });
    expect(adapter.getClockSync()!.maximumErrorUs).toBeLessThanOrEqual(5_000);
    expect(Math.abs(adapter.getClockSync()!.estimatedClockOffsetUs - 2_000)).toBeLessThan(100);
  });

  it('invalidates clock sync snapshot and mapping estimator on disconnect', () => {
    const adapter = new RemusBladeAdapter('blade-transport', 'REMUS-BLD-A1B2C3D4');
    const packet = Buffer.alloc(30);
    packet[0] = 1;
    packet[1] = 0x04;
    packet.writeUInt32LE(1, 2);
    packet.writeBigUInt64LE(10_000_000n, 6);
    packet.writeBigUInt64LE(10_001_000n, 14);
    packet.writeBigUInt64LE(10_001_000n, 22);

    adapter.handleSnapshotPayload({
      deviceId: 'blade-transport',
      characteristicUuid: REMUS_CLOCK_SYNC_CHARACTERISTIC_UUID,
      rawBase64: packet.toString('base64'),
      receivedAtMonotonicUs: 10_002_000,
    });

    expect(adapter.getClockSync()).not.toBeNull();
    expect(adapter.getClockMappingEstimator().getAcceptedAnchors().length).toBe(1);

    adapter.handleStatePayload({
      deviceId: 'blade-transport',
      state: 'disconnected',
    });

    expect(adapter.getClockSync()).toBeNull();
    expect(adapter.getClockMappingEstimator().getAcceptedAnchors().length).toBe(0);
  });

  it('invalidates clock mapping estimator and resets clockSync on sendStart', async () => {
    const adapter = new RemusBladeAdapter('blade-transport', 'REMUS-BLD-A1B2C3D4');
    const packet = Buffer.alloc(30);
    packet[0] = 1;
    packet[1] = 0x04;
    packet.writeUInt32LE(1, 2);
    packet.writeBigUInt64LE(10_000_000n, 6);
    packet.writeBigUInt64LE(10_001_000n, 14);
    packet.writeBigUInt64LE(10_001_000n, 22);

    adapter.handleSnapshotPayload({
      deviceId: 'blade-transport',
      characteristicUuid: REMUS_CLOCK_SYNC_CHARACTERISTIC_UUID,
      rawBase64: packet.toString('base64'),
      receivedAtMonotonicUs: 10_002_000,
    });

    expect(adapter.getClockSync()).not.toBeNull();

    await adapter.sendStart();

    expect(adapter.getClockSync()).toBeNull();
    expect(adapter.getClockMappingEstimator().getAcceptedAnchors().length).toBe(0);
  });

  it('omits commonTimelineTimestampUs when mapping is stale (>5s since anchor)', () => {
    const crc32Helper = (data: Uint8Array): number => {
      /* eslint-disable no-bitwise */
      let crc = 0xffffffff;
      for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
          crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
      }
      return (~crc) >>> 0;
      /* eslint-enable no-bitwise */
    };

    const makeMockBatchBuffer = (
      batchSequence = 0,
      firstSampleSequence = 0,
      firstTimestampUs = 1_000_000,
      sampleCount = 1,
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
      result.writeUInt32LE(crc32Helper(result.subarray(0, result.length - 4)), result.length - 4);
      return result;
    };

    const adapter = new RemusBladeAdapter('blade-transport', 'REMUS-BLD-A1B2C3D4');
    const emitted: any[] = [];
    adapter.onSensorData(sample => emitted.push(sample));

    const syncPacket = Buffer.alloc(30);
    syncPacket[0] = 1;
    syncPacket[1] = 0x04;
    syncPacket.writeUInt32LE(1, 2);
    syncPacket.writeBigUInt64LE(10_000_000n, 6);
    syncPacket.writeBigUInt64LE(10_001_000n, 14);
    syncPacket.writeBigUInt64LE(10_001_000n, 22);

    adapter.handleSnapshotPayload({
      deviceId: 'blade-transport',
      characteristicUuid: REMUS_CLOCK_SYNC_CHARACTERISTIC_UUID,
      rawBase64: syncPacket.toString('base64'),
      receivedAtMonotonicUs: 10_002_000,
    });

    // Sample within validity (< 5s from anchor): at sensor 12_000_000us (2s after anchor)
    const freshBatch = makeMockBatchBuffer(0, 0, 12_000_000, 1).toString('base64');
    adapter.handleSnapshotPayload({
      deviceId: 'blade-transport',
      characteristicUuid: REMUS_IMU_STREAM_CHARACTERISTIC_UUID,
      rawBase64: freshBatch,
    });

    expect(emitted.length).toBe(1);
    expect(emitted[0].sourcePayload?.commonTimelineTimestampUs).toBeDefined();

    // Sample beyond validity (> 5s from anchor): at sensor 20_000_000us (10s after anchor)
    const staleBatch = makeMockBatchBuffer(1, 1, 20_000_000, 1).toString('base64');
    adapter.handleSnapshotPayload({
      deviceId: 'blade-transport',
      characteristicUuid: REMUS_IMU_STREAM_CHARACTERISTIC_UUID,
      rawBase64: staleBatch,
    });

    expect(emitted.length).toBe(2);
    expect(emitted[1].sourcePayload?.commonTimelineTimestampUs).toBeUndefined();
  });

  it('has canonical BLE UUIDs matching remus-sensor firmware', () => {
    expect(REMUS_BLADE_SERVICE_UUID).toBe('4fafc201-1fb5-459e-8fcc-c5c9c331914b');
    expect(REMUS_BLADE_CHARACTERISTIC_UUID).toBe('beb5483e-36e1-4688-b7f5-ea07361b26a8');
  });

  describe('CSV Snapshot Parsing', () => {
    let adapter: RemusBladeAdapter;

    beforeEach(() => {
      adapter = new RemusBladeAdapter("remus-blade:p1", "Remus Blade P1");
    });

    it('parses snapshot with valid 3D GPS lock correctly', () => {
      // Format: timestampMs,ax,ay,az,gx,gy,gz,lat,lon,speed_kmh,satsInUse/satsInView:snr:acc,lines,chars,spm
      const raw = '124456,0.012,-0.045,0.982,1.20,-0.40,0.15,-23.550520,-46.633308,8.50,6/10:32:3.2m,120,480,24.5';
      const parsed = adapter.parseSnapshotCsv(raw);

      expect(parsed).not.toBeNull();
      expect(parsed?.timestampMs).toBe(124456);
      expect(parsed?.accelG).toEqual({ x: 0.012, y: -0.045, z: 0.982 });
      expect(parsed?.gyroDps).toEqual({ x: 1.2, y: -0.4, z: 0.15 });
      expect(parsed?.location).toEqual({
        latitude: -23.55052,
        longitude: -46.633308,
        groundSpeedMetersPerSecond: expect.closeTo(8.5 / 3.6, 2),
        horizontalAccuracyMeters: 3.2,
      });
      expect(parsed?.satsInUse).toBe(6);
      expect(parsed?.satsInView).toBe(10);
      expect(parsed?.maxSnrDbHz).toBe(32);
      expect(parsed?.horizontalAccuracyMeters).toBe(3.2);
      expect(parsed?.linesWritten).toBe(120);
      expect(parsed?.charsRx).toBe(480);
      expect(parsed?.liveSpm).toBe(24.5);
    });

    it('parses snapshot without GPS lock and never encodes missing coordinates as zero', () => {
      const raw = '123456,0.012,-0.045,0.982,1.20,-0.40,0.15,,,,0/4:18:0.0m,0,240,0.0';
      const parsed = adapter.parseSnapshotCsv(raw);

      expect(parsed).not.toBeNull();
      expect(parsed?.timestampMs).toBe(123456);
      expect(parsed?.accelG).toEqual({ x: 0.012, y: -0.045, z: 0.982 });
      expect(parsed?.location).toBeUndefined();
      expect(parsed?.satsInUse).toBe(0);
      expect(parsed?.satsInView).toBe(4);
      expect(parsed?.maxSnrDbHz).toBe(18);
      // Invariant: missing accuracy or 0.0m with no fix is undefined or unconfirmed, not misleading 0m
      expect(parsed?.horizontalAccuracyMeters).toBeUndefined();
      // Invariant: liveSpm of 0.0 means unavailable/waiting, NOT 0 spm
      expect(parsed?.liveSpm).toBeUndefined();
    });

    it('handles negative acceleration and gyroscope values correctly', () => {
      const raw = '200000,-0.812,-0.145,-0.082,-15.50,-4.20,-1.15,,,,3/8:25:5.0m,50,300,18.0';
      const parsed = adapter.parseSnapshotCsv(raw);

      expect(parsed?.accelG.x).toBe(-0.812);
      expect(parsed?.accelG.y).toBe(-0.145);
      expect(parsed?.accelG.z).toBe(-0.082);
      expect(parsed?.gyroDps.x).toBe(-15.5);
      expect(parsed?.gyroDps.y).toBe(-4.2);
      expect(parsed?.gyroDps.z).toBe(-1.15);
      expect(parsed?.liveSpm).toBe(18.0);
    });

    it('distinguishes durable records from queued records and live-stream drops', () => {
      const raw = '3230168,-0.609,0.081,0.784,-4.52,1.73,-3.04,-15.749585,-47.869635,0.11,10/13:41:1.2m,345655,2250839,18.4,1,1,0,6,0,0,0.21,189.52657,42.69154,3,382304200,657898,1,12,1,6400,6398,2,0,0,3';

      const parsed = adapter.parseSnapshotCsv(raw);

      expect(parsed?.linesWritten).toBe(345655);
      expect(parsed?.recordsQueued).toBe(657898);
      expect(parsed?.storageWriteFailures).toBe(1);
      expect(parsed?.liveStreamQueueDrops).toBe(12);
      expect(parsed?.bladeRelayConnected).toBe(true);
      expect(parsed?.bladeRelayNotificationsReceived).toBe(6400);
      expect(parsed?.bladeRelayPacketsPersisted).toBe(6398);
      expect(parsed?.bladeRelayQueueDrops).toBe(2);
      expect(parsed?.bladeRelayWriteFailures).toBe(0);
      expect(parsed?.bladeRelayStorageFault).toBe(false);
      expect(parsed?.bladeRelayLiveDrops).toBe(3);
    });

    it('parses extended fields 35-37 for available, held, and unavailable SPM states', () => {
      // 38 fields with available
      const rawAvailable = '124456,0.012,-0.045,0.982,1.20,-0.40,0.15,-23.550520,-46.633308,8.50,6/10:32:3.2m,120,480,24.5,1,1,0,0,0,0,0.20,0.0,0.0,3,1000,10,0,0,0,0,0,0,0,0,0,available,,124450';
      const parsedAvail = adapter.parseSnapshotCsv(rawAvailable);
      expect(parsedAvail?.liveSpmAvailabilityState).toBe('available');
      expect(parsedAvail?.liveSpmAvailabilityReason).toBe('available');
      expect(parsedAvail?.liveSpmSupportedNativeTimestamp).toBe(124450);

      // 38 fields with held
      const rawHeld = '124456,0.012,-0.045,0.982,1.20,-0.40,0.15,-23.550520,-46.633308,8.50,6/10:32:3.2m,120,480,24.5,1,1,0,0,0,0,0.20,0.0,0.0,3,1000,10,0,0,0,0,0,0,0,0,0,held,held_recent_weak_periodicity,124450';
      const parsedHeld = adapter.parseSnapshotCsv(rawHeld);
      expect(parsedHeld?.liveSpmAvailabilityState).toBe('held');
      expect(parsedHeld?.liveSpmAvailabilityReason).toBe('held_last_supported_value');
      expect(parsedHeld?.liveSpmInternalReason).toBe('held_recent_weak_periodicity');
      expect(parsedHeld?.liveSpmSupportedNativeTimestamp).toBe(124450);

      // 38 fields with confirmed stop (recent_quiet)
      const rawStop = '124456,0.012,-0.045,0.982,1.20,-0.40,0.15,-23.550520,-46.633308,8.50,6/10:32:3.2m,120,480,0.0,1,1,0,0,0,0,0.20,0.0,0.0,3,1000,10,0,0,0,0,0,0,0,0,0,unavailable,recent_quiet,0';
      const parsedStop = adapter.parseSnapshotCsv(rawStop);
      expect(parsedStop?.liveSpmAvailabilityState).toBe('unavailable');
      expect(parsedStop?.liveSpmAvailabilityReason).toBe('confirmed_stop');
      expect(parsedStop?.liveSpmInternalReason).toBe('recent_quiet');
      expect(parsedStop?.liveSpmSupportedNativeTimestamp).toBeUndefined();

      // 38 fields with ambiguous periodicity (weak_periodicity)
      const rawWeak = '124456,0.012,-0.045,0.982,1.20,-0.40,0.15,-23.550520,-46.633308,8.50,6/10:32:3.2m,120,480,0.0,1,1,0,0,0,0,0.20,0.0,0.0,3,1000,10,0,0,0,0,0,0,0,0,0,unavailable,weak_periodicity,0';
      const parsedWeak = adapter.parseSnapshotCsv(rawWeak);
      expect(parsedWeak?.liveSpmAvailabilityState).toBe('unavailable');
      expect(parsedWeak?.liveSpmAvailabilityReason).toBe('ambiguous_periodicity');
      expect(parsedWeak?.liveSpmInternalReason).toBe('weak_periodicity');
      expect(parsedWeak?.liveSpmSupportedNativeTimestamp).toBeUndefined();
    });

    it('preserves backward compatibility for legacy snapshots without fields 35-37', () => {
      // Legacy with positive SPM
      const legacyAvail = '124456,0.012,-0.045,0.982,1.20,-0.40,0.15,-23.550520,-46.633308,8.50,6/10:32:3.2m,120,480,24.5';
      const parsedAvail = adapter.parseSnapshotCsv(legacyAvail);
      expect(parsedAvail?.liveSpmAvailabilityState).toBe('available');
      expect(parsedAvail?.liveSpmAvailabilityReason).toBe('available');
      expect(parsedAvail?.liveSpmSupportedNativeTimestamp).toBe(124456);

      // Legacy with no SPM (0.0)
      const legacyUnavail = '123456,0.012,-0.045,0.982,1.20,-0.40,0.15,,,,0/4:18:0.0m,0,240,0.0';
      const parsedUnavail = adapter.parseSnapshotCsv(legacyUnavail);
      expect(parsedUnavail?.liveSpmAvailabilityState).toBe('unavailable');
      expect(parsedUnavail?.liveSpmAvailabilityReason).toBe('source_unavailable');
      expect(parsedUnavail?.liveSpmSupportedNativeTimestamp).toBeUndefined();
    });

    it('returns null for corrupted or invalid CSV format', () => {
      expect(adapter.parseSnapshotCsv('')).toBeNull();
      expect(adapter.parseSnapshotCsv('corrupted,data')).toBeNull();
      expect(adapter.parseSnapshotCsv('not,enough,fields,here')).toBeNull();
    });
  });

  describe('Commands & Bridge Communication', () => {
    let mockBridge: jest.Mocked<NativeBladeBridge>;
    let adapter: RemusBladeAdapter;

    beforeEach(() => {
      mockBridge = {
        isSupported: jest.fn().mockResolvedValue(true),
        startScan: jest.fn().mockResolvedValue(true),
        stopScan: jest.fn().mockResolvedValue(undefined),
        connectPeripheral: jest.fn().mockResolvedValue(true),
        disconnectPeripheral: jest.fn().mockResolvedValue(undefined),
        sendCommand: jest.fn().mockResolvedValue(true),
        sendBinaryCommand: jest.fn().mockResolvedValue(true),
        addListener: jest.fn(),
        removeListeners: jest.fn(),
      };
      adapter = new RemusBladeAdapter("remus-blade:p1", "Remus Blade P1", mockBridge);
    });

    it('sends the binary stream command to a Remus Blade', async () => {
      const result = await adapter.sendStart();
      expect(result).toBe(true);
      expect(mockBridge.sendBinaryCommand).toHaveBeenCalledWith(
        'remus-blade:p1',
        'AQEAAAAA',
      );
      expect(mockBridge.sendCommand).not.toHaveBeenCalled();
    });

    it('sends the binary stop-stream command to a Remus Blade', async () => {
      const result = await adapter.sendStop();
      expect(result).toBe(true);
      expect(mockBridge.sendBinaryCommand).toHaveBeenCalledWith(
        'remus-blade:p1',
        'AQIAAAAA',
      );
      expect(mockBridge.sendCommand).not.toHaveBeenCalled();
    });

    it('sends textual START and STOP commands only to a Remus Computer', async () => {
      const computer = new RemusBladeAdapter(
        'computer-123',
        'REMUS-P1-123',
        mockBridge,
      );

      await expect(computer.sendStart()).resolves.toBe(true);
      await expect(computer.sendStop()).resolves.toBe(true);

      expect(mockBridge.sendCommand).toHaveBeenNthCalledWith(
        1,
        'computer-123',
        'START',
      );
      expect(mockBridge.sendCommand).toHaveBeenNthCalledWith(
        2,
        'computer-123',
        'STOP',
      );
      expect(mockBridge.sendBinaryCommand).not.toHaveBeenCalled();
    });

    it('sends a stable identity and canonical side assignment to the Computer', async () => {
      const computer = new RemusBladeAdapter(
        'computer-123',
        'REMUS-P1-123',
        mockBridge,
      );

      await expect(computer.configureBladeSlot(0xA1B2C3D4, 'left_paddle')).resolves.toBe(true);
      expect(mockBridge.sendCommand).toHaveBeenCalledWith(
        'computer-123',
        'BLADE_SLOT,L,A1B2C3D4',
      );
    });

    it('rejects slot configuration on a Blade peripheral', async () => {
      await expect(adapter.configureBladeSlot(0xA1B2C3D4, 'right_paddle')).resolves.toBe(false);
      expect(mockBridge.sendCommand).not.toHaveBeenCalled();
    });

    it('publishes the two Blades reported by a Computer roster', () => {
      const computer = new RemusBladeAdapter(
        'computer-123',
        'REMUS-P1-123',
        mockBridge,
      );
      const rosterSpy = jest.fn();
      computer.onBladeRoster(rosterSpy);

      computer.handleSnapshotPayload({
        deviceId: 'computer-123',
        rawCsv: 'BLADE_ROSTER,3,A1B2C3D4:1:L,55667788:1:R',
      });

      expect(rosterSpy).toHaveBeenCalledWith([
        { sourceIdentityHash: 0xA1B2C3D4, connected: true, assignedSide: 'left_paddle' },
        { sourceIdentityHash: 0x55667788, connected: true, assignedSide: 'right_paddle' },
      ]);
    });

    it('emits SensorSample when bridge receives onRemusBladeSnapshot', async () => {
      const sensorSpy = jest.fn();
      await adapter.initialize();
      adapter.onSensorData(sensorSpy);

      const emitter = new NativeEventEmitter();
      (emitter as any).emit("onRemusBladeSnapshot", { deviceId: "remus-blade:p1", 
        rawCsv: '124456,0.012,-0.045,0.982,1.20,-0.40,0.15,-23.550520,-46.633308,8.50,6/10:32:3.2m,120,480,24.5',
      });

      expect(sensorSpy).toHaveBeenCalledTimes(1);
      const sample = sensorSpy.mock.calls[0][0];
      expect(sample.deviceFamily).toBe('remus_blade');
      expect(sample.deviceId).toContain('remus-blade');
      expect(sample.accelerationIncludingGravityG).toEqual({ x: 0.012, y: -0.045, z: 0.982 });
      // Gyro in rad/s: 1.2 * PI / 180 = ~0.02094
      expect(sample.rotationRateRadiansPerSecond?.x).toBeCloseTo(1.2 * (Math.PI / 180), 3);
      expect(sample.location?.latitude).toBe(-23.55052);
      expect(sample.location?.horizontalAccuracyMeters).toBe(3.2);
    });

    it('normalizes scanning state as disconnected so initial readiness is not marked detected', async () => {
      const stateSpy = jest.fn();
      await adapter.initialize();
      adapter.onDeviceStateChanged(stateSpy);

      const emitter = new NativeEventEmitter();
      (emitter as any).emit("onRemusBladeStateChanged", { deviceId: "remus-blade:p1",  state: 'scanning' });

      expect(stateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'disconnected' }),
      );
    });

    it('calls disconnectPeripheral on native bridge when disconnect is called', async () => {
      const disconnectBridge = {
        isSupported: jest.fn().mockResolvedValue(true),
        getBluetoothState: jest.fn().mockResolvedValue('poweredOn'),
        startScan: jest.fn().mockResolvedValue(true),
        stopScan: jest.fn().mockResolvedValue(undefined),
        disconnectPeripheral: jest.fn().mockResolvedValue(undefined),
      };
      const disconnectAdapter = new RemusBladeAdapter("remus-blade:p1", "Remus Blade P1", disconnectBridge as any);
      await disconnectAdapter.disconnect();
      expect(disconnectBridge.disconnectPeripheral).toHaveBeenCalledTimes(1);
    });

    it('calls startScan on native bridge when startScan is called', async () => {
      const scanBridge = {
        isSupported: jest.fn().mockResolvedValue(true),
        getBluetoothState: jest.fn().mockResolvedValue('poweredOn'),
        startScan: jest.fn().mockResolvedValue(true),
        stopScan: jest.fn().mockResolvedValue(undefined),
      };
      const scanAdapter = new RemusBladeAdapter("remus-blade:p1", "Remus Blade P1", scanBridge as any);
      const res = await scanAdapter.startScan();
      expect(scanBridge.startScan).toHaveBeenCalledTimes(1);
      expect(res).toBe(true);
    });

    it('calls connectPeripheral on native bridge when connect is called', async () => {
      const connectBridge = {
        connectPeripheral: jest.fn().mockResolvedValue(true),
      };
      const connectAdapter = new RemusBladeAdapter("remus-blade:p1", "Remus Blade P1", connectBridge as any);
      const res = await connectAdapter.connect();
      expect(connectBridge.connectPeripheral).toHaveBeenCalledWith('remus-blade:p1');
      expect(res).toBe(true);
    });

    it('normalizes detected state as detected when emitted from native bridge', async () => {
      const emitter = new NativeEventEmitter();
      const detectedBridge = {};
      const detectedAdapter = new RemusBladeAdapter("remus-blade:p1", "Remus Blade P1", detectedBridge as any);
      await detectedAdapter.initialize();

      let detectedDevice: any = null;
      detectedAdapter.onDeviceStateChanged(dev => {
        detectedDevice = dev;
      });

      (emitter as any).emit("onRemusBladeStateChanged", { deviceId: "remus-blade:p1",  state: 'detected', deviceName: 'Remus Blade P1' });
      expect(detectedDevice).toEqual(
        expect.objectContaining({
          state: 'detected',
          name: 'Remus Blade P1',
        }),
      );
    });

    it('does not request slow BLE file transfer when live evidence is authoritative', async () => {
      const result = await adapter.downloadSessionFile();

      expect(result.filename).toBe('');
      expect(result.data).toHaveLength(0);
      expect(mockBridge.sendCommand).not.toHaveBeenCalled();
    });
  });

  describe('mapEstimatorReasonToPresentationAvailabilityReason', () => {
    it('maps available and held states to canonical reasons', () => {
      expect(mapEstimatorReasonToPresentationAvailabilityReason('available', '')).toBe('available');
      expect(mapEstimatorReasonToPresentationAvailabilityReason('held', 'held_recent_weak_periodicity')).toBe('held_last_supported_value');
      expect(mapEstimatorReasonToPresentationAvailabilityReason('held', '')).toBe('held_last_supported_value');
    });

    it('maps confirmed stop reasons', () => {
      expect(mapEstimatorReasonToPresentationAvailabilityReason('unavailable', 'recent_quiet')).toBe('confirmed_stop');
      expect(mapEstimatorReasonToPresentationAvailabilityReason('unavailable', 'stopped')).toBe('confirmed_stop');
      expect(mapEstimatorReasonToPresentationAvailabilityReason('unavailable', 'confirmed_stop')).toBe('confirmed_stop');
    });

    it('maps ambiguous periodicity reasons', () => {
      expect(mapEstimatorReasonToPresentationAvailabilityReason('unavailable', 'weak_periodicity')).toBe('ambiguous_periodicity');
      expect(mapEstimatorReasonToPresentationAvailabilityReason('unavailable', 'recent_weak_periodicity')).toBe('ambiguous_periodicity');
      expect(mapEstimatorReasonToPresentationAvailabilityReason('unavailable', 'competing_axes')).toBe('ambiguous_periodicity');
      expect(mapEstimatorReasonToPresentationAvailabilityReason('unavailable', 'recent_competing_axes')).toBe('ambiguous_periodicity');
    });

    it('maps gap and telemetry timeout reasons', () => {
      expect(mapEstimatorReasonToPresentationAvailabilityReason('unavailable', 'sample_gap')).toBe('telemetry_timeout');
      expect(mapEstimatorReasonToPresentationAvailabilityReason('unavailable', 'telemetry_timeout')).toBe('telemetry_timeout');
    });

    it('maps fallback / missing signal to source_unavailable', () => {
      expect(mapEstimatorReasonToPresentationAvailabilityReason('unavailable', 'insufficient_signal')).toBe('source_unavailable');
      expect(mapEstimatorReasonToPresentationAvailabilityReason('unavailable', 'invalid_sample')).toBe('source_unavailable');
      expect(mapEstimatorReasonToPresentationAvailabilityReason('unavailable', 'startup')).toBe('source_unavailable');
      expect(mapEstimatorReasonToPresentationAvailabilityReason('unavailable', '')).toBe('source_unavailable');
    });
  });
});

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
  parseBladeIdentityHash,
  REMUS_BLADE_SERVICE_UUID,
  REMUS_BLADE_CHARACTERISTIC_UUID,
  NativeBladeBridge,
} from '../src/services/blade/RemusBladeAdapter';

describe('RemusBladeAdapter (TDD)', () => {
  it('extracts only the full stable 32-bit identity advertised by a Blade', () => {
    expect(parseBladeIdentityHash('REMUS-BLD-A1B2C3D4')).toBe(0xA1B2C3D4);
    expect(parseBladeIdentityHash('REMUS-BLD-C3D4')).toBeNull();
    expect(parseBladeIdentityHash('REMUS-P1-1234')).toBeNull();
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
});

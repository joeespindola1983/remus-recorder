import { Buffer } from 'buffer';
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
  REMUS_BLADE_SERVICE_UUID,
  REMUS_BLADE_CHARACTERISTIC_UUID,
  NativeBladeBridge,
} from '../src/services/blade/RemusBladeAdapter';

describe('RemusBladeAdapter (TDD)', () => {
  it('has canonical BLE UUIDs matching remus-sensor firmware', () => {
    expect(REMUS_BLADE_SERVICE_UUID).toBe('4fafc201-1fb5-459e-8fcc-c5c9c331914b');
    expect(REMUS_BLADE_CHARACTERISTIC_UUID).toBe('beb5483e-36e1-4688-b7f5-ea07361b26a8');
  });

  describe('CSV Snapshot Parsing', () => {
    let adapter: RemusBladeAdapter;

    beforeEach(() => {
      adapter = new RemusBladeAdapter();
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
        addListener: jest.fn(),
        removeListeners: jest.fn(),
      };
      adapter = new RemusBladeAdapter(mockBridge);
    });

    it('sends START command to start 200 Hz recording on MicroSD', async () => {
      const result = await adapter.sendStart();
      expect(result).toBe(true);
      expect(mockBridge.sendCommand).toHaveBeenCalledWith('START');
    });

    it('sends STOP command to stop recording on MicroSD', async () => {
      const result = await adapter.sendStop();
      expect(result).toBe(true);
      expect(mockBridge.sendCommand).toHaveBeenCalledWith('STOP');
    });

    it('emits SensorSample when bridge receives onRemusBladeSnapshot', async () => {
      const sensorSpy = jest.fn();
      await adapter.initialize();
      adapter.onSensorData(sensorSpy);

      const emitter = new NativeEventEmitter();
      (emitter as any).emit('onRemusBladeSnapshot', {
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
      (emitter as any).emit('onRemusBladeStateChanged', { state: 'scanning' });

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
      const disconnectAdapter = new RemusBladeAdapter(disconnectBridge as any);
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
      const scanAdapter = new RemusBladeAdapter(scanBridge as any);
      const res = await scanAdapter.startScan();
      expect(scanBridge.startScan).toHaveBeenCalledTimes(1);
      expect(res).toBe(true);
    });

    it('calls connectPeripheral on native bridge when connect is called', async () => {
      const connectBridge = {
        connectPeripheral: jest.fn().mockResolvedValue(true),
      };
      const connectAdapter = new RemusBladeAdapter(connectBridge as any);
      const res = await connectAdapter.connect('blade-123');
      expect(connectBridge.connectPeripheral).toHaveBeenCalledWith('blade-123');
      expect(res).toBe(true);
    });

    it('normalizes detected state as detected when emitted from native bridge', async () => {
      const emitter = new NativeEventEmitter();
      const detectedBridge = {};
      const detectedAdapter = new RemusBladeAdapter(detectedBridge as any);
      await detectedAdapter.initialize();

      let detectedDevice: any = null;
      detectedAdapter.onDeviceStateChanged(dev => {
        detectedDevice = dev;
      });

      (emitter as any).emit('onRemusBladeStateChanged', { state: 'detected', deviceName: 'Remus Blade P1' });
      expect(detectedDevice).toEqual(
        expect.objectContaining({
          state: 'detected',
          name: 'Remus Blade P1',
        }),
      );
    });

    it('sends GET command and receives binary file chunks until FILE_END', async () => {
      const emitter = new NativeEventEmitter();
      mockBridge = {
        sendCommand: jest.fn().mockResolvedValue(true),
      };
      adapter = new RemusBladeAdapter(mockBridge as any);
      await adapter.initialize();

      const progressSpy = jest.fn();
      const downloadPromise = adapter.downloadSessionFile(progressSpy);
      expect(mockBridge.sendCommand).toHaveBeenCalledWith('GET');

      // 1. FILE_START
      (emitter as any).emit('onRemusBladeSnapshot', {
        rawCsv: 'FILE_START:/remus_sensor_1234.bin:34:2',
      });

      // 2. Binary chunk 1 (0x20 + offset + len + 34 bytes)
      const chunk = Buffer.alloc(7 + 34);
      chunk.writeUInt8(0x20, 0);
      chunk.writeUInt32LE(0, 1);
      chunk.writeUInt16LE(34, 5);
      chunk.write('RBP1', 7, 4, 'ascii');

      (emitter as any).emit('onRemusBladeSnapshot', {
        rawBase64: chunk.toString('base64'),
      });

      expect(progressSpy).toHaveBeenCalledWith(100, 34, 34);

      // 3. FILE_END
      (emitter as any).emit('onRemusBladeSnapshot', {
        rawCsv: 'FILE_END:/remus_sensor_1234.bin:34',
      });

      const result = await downloadPromise;
      expect(result.filename).toBe('/remus_sensor_1234.bin');
      expect(result.data.length).toBe(34);
    });

    it('handles FILE_ERR gracefully and rejects download promise', async () => {
      const emitter = new NativeEventEmitter();
      mockBridge = {
        sendCommand: jest.fn().mockResolvedValue(true),
      };
      adapter = new RemusBladeAdapter(mockBridge as any);
      await adapter.initialize();

      const downloadPromise = adapter.downloadSessionFile();
      (emitter as any).emit('onRemusBladeSnapshot', {
        rawCsv: 'FILE_ERR:NOT_FOUND',
      });

      await expect(downloadPromise).rejects.toThrow('NOT_FOUND');
    });

    it('does not count a repeated offset twice and verifies the final CRC32', async () => {
      const emitter = new NativeEventEmitter();
      mockBridge = { sendCommand: jest.fn().mockResolvedValue(true) };
      adapter = new RemusBladeAdapter(mockBridge as any);
      await adapter.initialize();

      const payload = Buffer.alloc(32);
      payload.write('RBP2', 0, 4, 'ascii');
      const crc = (() => {
        /* eslint-disable no-bitwise -- mirrors the firmware CRC32 contract. */
        let value = 0xffffffff;
        for (const byte of payload) {
          value ^= byte;
          for (let bit = 0; bit < 8; bit += 1) {
            value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
          }
        }
        const result = (~value) >>> 0;
        /* eslint-enable no-bitwise */
        return result;
      })();
      const progressSpy = jest.fn();
      const downloadPromise = adapter.downloadSessionFile(progressSpy);
      (emitter as any).emit('onRemusBladeSnapshot', {
        rawCsv: 'FILE_START:/session.bin:32:0',
      });
      const chunk = Buffer.alloc(39);
      chunk.writeUInt8(0x20, 0);
      chunk.writeUInt32LE(0, 1);
      chunk.writeUInt16LE(32, 5);
      payload.copy(chunk, 7);
      const rawBase64 = chunk.toString('base64');
      (emitter as any).emit('onRemusBladeSnapshot', { rawBase64 });
      (emitter as any).emit('onRemusBladeSnapshot', { rawBase64 });
      (emitter as any).emit('onRemusBladeSnapshot', {
        rawCsv: `FILE_END:/session.bin:32:${crc.toString(16).padStart(8, '0')}`,
      });

      const result = await downloadPromise;
      expect(result.data.equals(payload)).toBe(true);
      expect(progressSpy).toHaveBeenLastCalledWith(100, 32, 32);
    });

    it('rejects FILE_END when byte coverage is incomplete', async () => {
      const emitter = new NativeEventEmitter();
      mockBridge = { sendCommand: jest.fn().mockResolvedValue(true) };
      adapter = new RemusBladeAdapter(mockBridge as any);
      await adapter.initialize();

      const downloadPromise = adapter.downloadSessionFile();
      (emitter as any).emit('onRemusBladeSnapshot', {
        rawCsv: 'FILE_START:/session.bin:32:0',
      });
      const chunk = Buffer.alloc(7 + 4);
      chunk.writeUInt8(0x20, 0);
      chunk.writeUInt32LE(0, 1);
      chunk.writeUInt16LE(4, 5);
      chunk.write('RBP2', 7, 4, 'ascii');
      (emitter as any).emit('onRemusBladeSnapshot', {
        rawBase64: chunk.toString('base64'),
      });
      (emitter as any).emit('onRemusBladeSnapshot', {
        rawCsv: 'FILE_END:/session.bin:32',
      });

      await expect(downloadPromise).rejects.toThrow('INCOMPLETE_TRANSFER');
    });
  });
});

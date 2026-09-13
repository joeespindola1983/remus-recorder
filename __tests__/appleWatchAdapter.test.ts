import { AppleWatchAdapter, RawWatchPayload } from '../src/services/wearables/AppleWatchAdapter';
import { SensorSample } from '../src/types/wearables';

describe('AppleWatchAdapter (TDD)', () => {
  let adapter: AppleWatchAdapter;
  let mockNativeModule: any;

  beforeEach(() => {
    mockNativeModule = {
      isSupported: jest.fn().mockResolvedValue(true),
      isPaired: jest.fn().mockResolvedValue(true),
      isWatchAppInstalled: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue({ status: 'ok' }),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };

    adapter = new AppleWatchAdapter(mockNativeModule);
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('should initialize and report connected watch', async () => {
    const initialized = await adapter.initialize();
    expect(initialized).toBe(true);

    const devices = await adapter.getConnectedDevices();
    expect(devices).toHaveLength(1);
      expect(devices[0].deviceFamily).toBe('apple_watch');
    expect(devices[0].state).toBe('connected');
  });

  it('requires the companion watch app to be installed', async () => {
    mockNativeModule.isWatchAppInstalled.mockResolvedValue(false);

    await expect(adapter.initialize()).resolves.toBe(false);
    await expect(adapter.getConnectedDevices()).resolves.toEqual([]);
  });

  it('should normalize a raw watch payload into a canonical SensorSample', done => {
    adapter.onSensorData((sample: SensorSample) => {
      expect(sample.deviceFamily).toBe('apple_watch');
      expect(sample.deviceId).toBe('apple-watch');
      expect(sample.heartRateBeatsPerMinute).toBe(142);
      expect(sample.location?.latitude).toBe(-23.5505);
      expect(sample.location?.longitude).toBe(-46.6333);
      expect(sample.location?.groundSpeedMetersPerSecond).toBe(5.1);
      expect(sample.accelerationIncludingGravityG?.x).toBe(0.05);
      expect(sample.rotationRateRadiansPerSecond?.z).toBe(1.2);
      done();
    });

    const rawPayload: RawWatchPayload = {
      type: 'SENSOR_UPDATE',
      nativeTimestamp: 1690000001000,
      heartRateBeatsPerMinute: 142,
      lat: -23.5505,
      lng: -46.6333,
      alt: 750,
      groundSpeedMetersPerSecond: 5.1,
      horizontalAccuracyMeters: 3.5,
      accelerationIncludingGravityG: { x: 0.05, y: 0.98, z: -0.12 },
      rotationRateRadiansPerSecond: { x: 0.01, y: -0.02, z: 1.2 },
    };

    adapter.handleRawWatchMessage(rawPayload);
  });

  it('should connect native watch events to the canonical sensor interface', async () => {
    await adapter.initialize();
    const [, nativeListener] = mockNativeModule.addListener.mock.calls.find(
      ([eventName]: [string]) => eventName === 'onWatchMessage'
    );
    const received = jest.fn();
    adapter.onSensorData(received);

    nativeListener({
      type: 'SENSOR_UPDATE',
      nativeTimestamp: 1690000003000,
      heartRateBeatsPerMinute: 138,
    });

    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeTimestamp: 1690000003000,
        deviceFamily: 'apple_watch',
        heartRateBeatsPerMinute: 138,
      })
    );
  });

  it('should send data to the Apple Watch via native module', async () => {
    const sent = await adapter.sendData('apple-watch', { command: 'START_RECORD' });
    expect(sent).toBe(true);
    expect(mockNativeModule.sendMessage).toHaveBeenCalledWith({ command: 'START_RECORD' });
  });

  it('publishes and retains the watch heart-rate permission state', async () => {
    await adapter.initialize();
    const [, stateListener] = mockNativeModule.addListener.mock.calls.find(
      ([eventName]: [string]) => eventName === 'onWatchStateChanged',
    );
    const changed = jest.fn();
    adapter.onDeviceStateChanged(changed);

    stateListener({
      isPaired: true,
      isWatchAppInstalled: true,
      heartRatePermissionState: 'denied',
    });

    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({heartRatePermissionState: 'denied'}),
    );
    await expect(adapter.getConnectedDevices()).resolves.toEqual([
      expect.objectContaining({heartRatePermissionState: 'denied'}),
    ]);
  });

  it('does not publish missing, zero, or invalid heart-rate observations', () => {
    const received = jest.fn();
    adapter.onSensorData(received);

    adapter.handleRawWatchMessage({type: 'STATE_SNAPSHOT'});
    adapter.handleRawWatchMessage({type: 'SENSOR_UPDATE', heartRateBeatsPerMinute: 0});
    adapter.handleRawWatchMessage({type: 'SENSOR_UPDATE', heartRateBeatsPerMinute: Number.NaN});

    expect(received).not.toHaveBeenCalled();
  });
});

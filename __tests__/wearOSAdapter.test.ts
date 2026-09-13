import { WearOSAdapter, RawWearOSPayload } from '../src/services/wearables/WearOSAdapter';
import { SensorSample } from '../src/types/wearables';

describe('WearOSAdapter (TDD)', () => {
  let adapter: WearOSAdapter;
  let mockNativeModule: any;

  beforeEach(() => {
    mockNativeModule = {
      isAvailable: jest.fn().mockResolvedValue(true),
      getConnectedNodes: jest.fn().mockResolvedValue([
        { id: 'wearos-node-1', name: 'Galaxy Watch 6' },
      ]),
      sendMessage: jest.fn().mockResolvedValue({ status: 'sent' }),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };

    adapter = new WearOSAdapter(mockNativeModule);
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('should initialize and list Wear OS nodes', async () => {
    const initialized = await adapter.initialize();
    expect(initialized).toBe(true);

    const devices = await adapter.getConnectedDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].deviceFamily).toBe('wear_os');
    expect(devices[0].name).toBe('Galaxy Watch 6');
  });

  it('connects native Wear OS events to the canonical sensor interface', async () => {
    const subscription = {remove: jest.fn()};
    mockNativeModule.addListener.mockReturnValue(subscription);
    await adapter.initialize();
    const [, nativeListener] = mockNativeModule.addListener.mock.calls.find(
      ([eventName]: [string]) => eventName === 'onWearOSMessage',
    );
    const received = jest.fn();
    adapter.onSensorData(received);

    nativeListener({
      nodeId: 'wearos-node-1',
      type: 'HEART_RATE_OBSERVATION',
      nativeTimestamp: 1690000003000,
      heartRateBeatsPerMinute: 126,
    });

    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeTimestamp: 1690000003000,
        deviceId: 'wearos-node-1',
        deviceFamily: 'wear_os',
        heartRateBeatsPerMinute: 126,
      }),
    );

    adapter.destroy();
    expect(subscription.remove).toHaveBeenCalled();
  });

  it('should normalize raw Wear OS data into a canonical SensorSample', done => {
    adapter.onSensorData((sample: SensorSample) => {
      expect(sample.deviceFamily).toBe('wear_os');
      expect(sample.deviceId).toBe('wearos-node-1');
      expect(sample.heartRateBeatsPerMinute).toBe(120);
      expect(sample.location?.latitude).toBe(-22.9068);
      expect(sample.location?.longitude).toBe(-43.1729);
      expect(sample.stepCount).toBe(4500);
      done();
    });

    const rawData: RawWearOSPayload = {
      nodeId: 'wearos-node-1',
      nativeTimestamp: 1690000002000,
      heartRateBeatsPerMinute: 120,
      latitude: -22.9068,
      longitude: -43.1729,
      steps: 4500,
    };

    adapter.handleRawWearOSMessage(rawData);
  });

  it('publishes and retains the Wear OS heart-rate permission state', async () => {
    await adapter.initialize();
    const [, stateListener] = mockNativeModule.addListener.mock.calls.find(
      ([eventName]: [string]) => eventName === 'onWearOSStateChanged',
    );
    const changed = jest.fn();
    adapter.onDeviceStateChanged(changed);

    stateListener({nodeId: 'wearos-node-1', heartRatePermissionState: 'denied'});

    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({heartRatePermissionState: 'denied'}),
    );
    await expect(adapter.getConnectedDevices()).resolves.toEqual([
      expect.objectContaining({heartRatePermissionState: 'denied'}),
    ]);
  });

  it('should send data to Wear OS node via native bridge', async () => {
    const sent = await adapter.sendData('wearos-node-1', { action: 'PING' });
    expect(sent).toBe(true);
    expect(mockNativeModule.sendMessage).toHaveBeenCalledWith(
      'wearos-node-1',
      { action: 'PING' }
    );
  });

  it('does not publish missing, zero, or invalid heart-rate observations', () => {
    const received = jest.fn();
    adapter.onSensorData(received);

    adapter.handleRawWearOSMessage({type: 'STATE_SNAPSHOT'});
    adapter.handleRawWearOSMessage({type: 'HEART_RATE_OBSERVATION', heartRateBeatsPerMinute: -1});
    adapter.handleRawWearOSMessage({type: 'HEART_RATE_OBSERVATION', heartRateBeatsPerMinute: Infinity});

    expect(received).not.toHaveBeenCalled();
  });
});

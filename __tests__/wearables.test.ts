import { WearableHub } from '../src/services/wearables/WearableHub';
import { IWearableAdapter, SensorSample, WearableDevice } from '../src/types/wearables';

class MockAppleWatchAdapter implements IWearableAdapter {
  readonly deviceFamily = 'apple_watch' as const;
  private sensorListeners: ((data: SensorSample) => void)[] = [];
  private stateListeners: ((device: WearableDevice) => void)[] = [];
  public sentData: { deviceId: string; payload: Record<string, unknown> }[] = [];

  async initialize(): Promise<boolean> {
    return true;
  }

  async getConnectedDevices(): Promise<WearableDevice[]> {
    return [
      {
        id: 'apple-watch-1',
        name: 'Apple Watch Series 9',
        deviceFamily: 'apple_watch',
        state: 'connected',
        batteryLevel: 85,
      },
    ];
  }

  async sendData(deviceId: string, payload: Record<string, unknown>): Promise<boolean> {
    this.sentData.push({ deviceId, payload });
    return true;
  }

  onSensorData(listener: (data: SensorSample) => void): () => void {
    this.sensorListeners.push(listener);
    return () => {
      this.sensorListeners = this.sensorListeners.filter(l => l !== listener);
    };
  }

  onDeviceStateChanged(listener: (device: WearableDevice) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== listener);
    };
  }

  simulateIncomingSensorData(sample: SensorSample) {
    this.sensorListeners.forEach(l => l(sample));
  }

  destroy(): void {
    this.sensorListeners = [];
    this.stateListeners = [];
  }
}

describe('WearableHub & Normalized Interface (TDD)', () => {
  let hub: WearableHub;
  let appleAdapter: MockAppleWatchAdapter;

  beforeEach(() => {
    hub = new WearableHub();
    appleAdapter = new MockAppleWatchAdapter();
    hub.registerAdapter(appleAdapter);
  });

  afterEach(() => {
    hub.destroy();
  });

  it('should initialize registered adapters', async () => {
    const initialized = await hub.initialize();
    expect(initialized).toBe(true);
  });

  it('should retrieve all connected devices across adapters', async () => {
    await hub.initialize();
    const devices = await hub.getAllConnectedDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].deviceFamily).toBe('apple_watch');
    expect(devices[0].name).toBe('Apple Watch Series 9');
  });

  it('should receive and broadcast normalized sensor data', done => {
    hub.initialize().then(() => {
      const unsubscribe = hub.onSensorData(sample => {
        expect(sample.deviceId).toBe('apple-watch-1');
        expect(sample.deviceFamily).toBe('apple_watch');
        expect(sample.heartRateBeatsPerMinute).toBe(135);
        expect(sample.location?.latitude).toBe(-23.55052);
        expect(sample.location?.longitude).toBe(-46.633308);
        expect(sample.accelerationIncludingGravityG?.x).toBe(0.12);
        unsubscribe();
        done();
      });

      appleAdapter.simulateIncomingSensorData({
        nativeTimestamp: 1690000000000,
        deviceId: 'apple-watch-1',
        deviceFamily: 'apple_watch',
        heartRateBeatsPerMinute: 135,
        location: {
          latitude: -23.55052,
          longitude: -46.633308,
          altitude: 760,
          horizontalAccuracyMeters: 5,
          groundSpeedMetersPerSecond: 4.2,
        },
        accelerationIncludingGravityG: {
          x: 0.12,
          y: 0.98,
          z: -0.05,
        },
      });
    });
  });

  it('should send data to a specific device via its adapter', async () => {
    await hub.initialize();
    const success = await hub.sendDataToDevice('apple-watch-1', { command: 'START_RECORDING' });
    expect(success).toBe(true);
    expect(appleAdapter.sentData).toContainEqual({
      deviceId: 'apple-watch-1',
      payload: { command: 'START_RECORDING' },
    });
  });

  it('should dispatch startRecording to connected device exactly once with correlation metadata and no duplicate broadcast', async () => {
    await hub.initialize();
    appleAdapter.sentData = [];
    await hub.startRecording({
      activityCorrelationId: 'act-corr-123',
      recordingId: 'rec:watch:apple:primary:001',
      startCommandId: 'cmd-start-999',
    });

    expect(appleAdapter.sentData).toHaveLength(1);
    expect(appleAdapter.sentData[0]).toEqual({
      deviceId: 'apple-watch-1',
      payload: expect.objectContaining({
        command: 'START_RECORD',
        action: 'START_RECORD',
        protocolVersion: '1.1.0',
        activityCorrelationId: 'act-corr-123',
        recordingId: 'rec:watch:apple:primary:001',
        startCommandId: 'cmd-start-999',
      }),
    });
  });

  it('should dispatch startRecording via broadcast exactly once when no device is connected', async () => {
    await hub.initialize();
    jest.spyOn(appleAdapter, 'getConnectedDevices').mockResolvedValue([]);
    appleAdapter.sentData = [];

    await hub.startRecording();

    expect(appleAdapter.sentData).toHaveLength(1);
    expect(appleAdapter.sentData[0].deviceId).toBe('broadcast');
    expect(appleAdapter.sentData[0].payload.command).toBe('START_RECORD');
  });

  it('should dispatch stopRecording to connected device exactly once with stopCommandId and no duplicate broadcast', async () => {
    await hub.initialize();
    appleAdapter.sentData = [];
    await hub.stopRecording({
      stopCommandId: 'cmd-stop-888',
    });

    expect(appleAdapter.sentData).toHaveLength(1);
    expect(appleAdapter.sentData[0]).toEqual({
      deviceId: 'apple-watch-1',
      payload: expect.objectContaining({
        command: 'STOP_RECORD',
        action: 'STOP_RECORD',
        protocolVersion: '1.1.0',
        stopCommandId: 'cmd-stop-888',
      }),
    });
  });
});

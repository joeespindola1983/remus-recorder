import {
  IWearableAdapter,
  SensorSample,
  WearableDevice,
  DeviceFamily,
} from '../../types/wearables';

export class WearableHub {
  private adapters: Map<DeviceFamily, IWearableAdapter> = new Map();
  private sensorListeners: Set<(data: SensorSample) => void> = new Set();
  private deviceStateListeners: Set<(device: WearableDevice) => void> = new Set();
  private adapterUnsubscribes: (() => void)[] = [];

  registerAdapter(adapter: IWearableAdapter): void {
    this.adapters.set(adapter.deviceFamily, adapter);

    const unsubSensor = adapter.onSensorData(sample => {
      this.sensorListeners.forEach(listener => listener(sample));
    });

    const unsubState = adapter.onDeviceStateChanged(device => {
      this.deviceStateListeners.forEach(listener => listener(device));
    });

    this.adapterUnsubscribes.push(unsubSensor, unsubState);
  }

  async initialize(): Promise<boolean> {
    const results = await Promise.all(
      Array.from(this.adapters.values()).map(adapter =>
        adapter.initialize().catch(() => false)
      )
    );
    return results.every(res => res === true);
  }

  async getAllConnectedDevices(): Promise<WearableDevice[]> {
    const devicesArrays = await Promise.all(
      Array.from(this.adapters.values()).map(adapter =>
        adapter.getConnectedDevices().catch(() => [])
      )
    );
    return devicesArrays.flat();
  }

  async sendDataToDevice(
    deviceId: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    for (const adapter of this.adapters.values()) {
      const devices = await adapter.getConnectedDevices().catch(() => []);
      if (devices.some(d => d.id === deviceId)) {
        return adapter.sendData(deviceId, payload);
      }
    }
    return false;
  }

  onSensorData(listener: (data: SensorSample) => void): () => void {
    this.sensorListeners.add(listener);
    return () => {
      this.sensorListeners.delete(listener);
    };
  }

  onDeviceStateChanged(listener: (device: WearableDevice) => void): () => void {
    this.deviceStateListeners.add(listener);
    return () => {
      this.deviceStateListeners.delete(listener);
    };
  }

  destroy(): void {
    this.adapterUnsubscribes.forEach(unsub => unsub());
    this.adapterUnsubscribes = [];
    this.sensorListeners.clear();
    this.deviceStateListeners.clear();
    this.adapters.forEach(adapter => adapter.destroy());
    this.adapters.clear();
  }
}

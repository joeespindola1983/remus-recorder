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

  async startRecording(): Promise<void> {
    const payload = { command: 'START_RECORD', action: 'START_RECORD' };
    console.log('[WearableHub] startRecording called. Adapters count:', this.adapters.size);
    const devices = await this.getAllConnectedDevices().catch(() => []);
    console.log('[WearableHub] Connected devices found:', devices.length, JSON.stringify(devices));
    if (devices.length > 0) {
      await Promise.allSettled(
        devices.map(device => {
          console.log(`[WearableHub] Sending START_RECORD to device ${device.id}...`);
          return this.sendDataToDevice(device.id, payload);
        })
      );
    }
    await Promise.allSettled(
      Array.from(this.adapters.entries()).map(async ([family, adapter]) => {
        console.log(`[WearableHub] Broadcasting START_RECORD to adapter ${family}...`);
        const ok = await adapter.sendData('broadcast', payload).catch(err => {
          console.error(`[WearableHub] Error sending to adapter ${family}:`, err);
          return false;
        });
        console.log(`[WearableHub] Adapter ${family} returned:`, ok);
        return ok;
      })
    );
  }

  async stopRecording(): Promise<void> {
    const payload = { command: 'STOP_RECORD', action: 'STOP_RECORD' };
    console.log('[WearableHub] stopRecording called.');
    const devices = await this.getAllConnectedDevices().catch(() => []);
    if (devices.length > 0) {
      await Promise.allSettled(
        devices.map(device => this.sendDataToDevice(device.id, payload))
      );
    }
    await Promise.allSettled(
      Array.from(this.adapters.values()).map(adapter =>
        adapter.sendData('broadcast', payload).catch(() => false)
      )
    );
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

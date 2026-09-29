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

  async startRecording(options?: {
    activityCorrelationId?: string;
    recordingId?: string;
    startCommandId?: string;
  }): Promise<void> {
    const payload = {
      command: 'START_RECORD',
      action: 'START_RECORD',
      protocolVersion: '1.1.0',
      activityCorrelationId: options?.activityCorrelationId,
      recordingId: options?.recordingId ?? 'rec:watch:apple:primary:001',
      startCommandId: options?.startCommandId ?? `cmd-start-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    };
    console.log('[WearableHub] startRecording called. Adapters count:', this.adapters.size);
    const targetedAdapters = new Set<IWearableAdapter>();

    for (const [, adapter] of this.adapters.entries()) {
      const devices = await adapter.getConnectedDevices().catch(() => []);
      if (devices.length > 0) {
        targetedAdapters.add(adapter);
        await Promise.allSettled(
          devices.map(device => {
            console.log(`[WearableHub] Sending START_RECORD to device ${device.id}...`);
            return adapter.sendData(device.id, payload);
          })
        );
      }
    }

    await Promise.allSettled(
      Array.from(this.adapters.entries()).map(async ([family, adapter]) => {
        if (!targetedAdapters.has(adapter)) {
          console.log(`[WearableHub] Broadcasting START_RECORD to adapter ${family}...`);
          const ok = await adapter.sendData('broadcast', payload).catch(err => {
            console.error(`[WearableHub] Error sending to adapter ${family}:`, err);
            return false;
          });
          console.log(`[WearableHub] Adapter ${family} returned:`, ok);
          return ok;
        }
        return true;
      })
    );
  }

  async stopRecording(options?: {
    stopCommandId?: string;
  }): Promise<void> {
    const payload = {
      command: 'STOP_RECORD',
      action: 'STOP_RECORD',
      protocolVersion: '1.1.0',
      stopCommandId: options?.stopCommandId ?? `cmd-stop-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    };
    console.log('[WearableHub] stopRecording called.');
    const targetedAdapters = new Set<IWearableAdapter>();

    for (const [, adapter] of this.adapters.entries()) {
      const devices = await adapter.getConnectedDevices().catch(() => []);
      if (devices.length > 0) {
        targetedAdapters.add(adapter);
        await Promise.allSettled(
          devices.map(device => adapter.sendData(device.id, payload))
        );
      }
    }

    await Promise.allSettled(
      Array.from(this.adapters.values()).map(adapter => {
        if (!targetedAdapters.has(adapter)) {
          return adapter.sendData('broadcast', payload).catch(() => false);
        }
        return Promise.resolve(true);
      })
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

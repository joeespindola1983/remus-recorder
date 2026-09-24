import { NativeEventEmitter, NativeModules } from 'react-native';
import { RemusBladeDeviceService } from './RemusBladeDeviceService';
import { RemusBladeAdapter } from './RemusBladeAdapter';
import { CaptureSourceState } from '../../application/capture/ActivityCapture';

export class RemusBladeManager {
  private nativeBridge: any;
  private eventEmitter: NativeEventEmitter | null = null;
  private devices: Map<string, RemusBladeDeviceService> = new Map();
  private listeners: Set<(sourceState: CaptureSourceState) => void> = new Set();
  private stateSubscription: { remove(): void } | null = null;

  constructor() {
    this.nativeBridge = NativeModules.RemusBladeBridge;
    if (this.nativeBridge) {
      this.eventEmitter = new NativeEventEmitter(this.nativeBridge);
    }
  }

  async initialize(): Promise<boolean> {
    if (!this.nativeBridge || !this.eventEmitter) {
      console.warn('[RemusBladeManager] NativeBridge or EventEmitter not available.');
      return false;
    }

    try {
      const supported = this.nativeBridge.isSupported ? await this.nativeBridge.isSupported() : true;
      if (!supported) {
        console.warn('[RemusBladeManager] NativeBridge is not supported.');
        return false;
      }
      
      console.log('[RemusBladeManager] Initialized. Listening for new devices...');

      this.stateSubscription = this.eventEmitter.addListener(
        'onRemusBladeStateChanged',
        (payload: any) => {
          const deviceId = payload?.deviceId;
          if (!deviceId) return;
          const deviceName = payload?.deviceName ?? 'Remus Blade';
          
          if (!this.devices.has(deviceId)) {
            console.log(`[RemusBladeManager] Discovered new device: ${deviceName} (${deviceId})`);
            const adapter = new RemusBladeAdapter(deviceId, deviceName, this.nativeBridge);
            const service = new RemusBladeDeviceService(adapter);
            this.devices.set(deviceId, service);
            
            service.onStateChange(state => {
              this.listeners.forEach(l => l(state));
            });
            
            service.initialize()
              .then(() => {
                // Manually inject the initial event so it is not missed!
                adapter.handleStatePayload(payload);
              })
              .catch(err => {
                console.warn(`[RemusBladeManager] Failed to initialize device ${deviceId}:`, err);
              });
          }
        }
      );

      // Start a scan if the bridge provides it
      if (this.nativeBridge.startScan) {
        this.nativeBridge.startScan();
      }

      return true;
    } catch (err) {
      console.error('[RemusBladeManager] Error during initialization:', err);
      return false;
    }
  }

  getDevice(deviceId: string): RemusBladeDeviceService | undefined {
    return this.devices.get(deviceId);
  }

  getAllDevices(): RemusBladeDeviceService[] {
    return Array.from(this.devices.values());
  }

  onStateChange(listener: (state: CaptureSourceState) => void): () => void {
    this.listeners.add(listener);
    // Emit initial state for already discovered devices
    this.devices.forEach(device => {
      listener(device.getSourceState());
    });
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    console.log('[RemusBladeManager] Destroying manager and all device services.');
    this.stateSubscription?.remove();
    this.devices.forEach(d => d.destroy());
    this.devices.clear();
    this.listeners.clear();
  }

  // Facade methods for App.tsx compatibility

  getLatestSnapshot(): any {
    // Return the snapshot of the first connected device, or null
    for (const device of this.devices.values()) {
      const snap = device.getLatestSnapshot();
      if (snap) return snap;
    }
    return null;
  }

  getConnectionState(): string {
    // If any device is connected, return connected
    for (const device of this.devices.values()) {
      if (device.getConnectionState() === 'connected') return 'connected';
    }
    for (const device of this.devices.values()) {
      if (device.getConnectionState() === 'connecting') return 'connecting';
    }
    return 'disconnected';
  }

  async startWorkoutCapture(): Promise<boolean> {
    console.log('[RemusBladeManager] Starting capture for all devices...');
    const results = await Promise.all(
      Array.from(this.devices.values()).map(d => d.startWorkoutCapture())
    );
    return results.some(r => r);
  }

  async stopWorkoutCapture(): Promise<boolean> {
    console.log('[RemusBladeManager] Stopping capture for all devices...');
    const results = await Promise.all(
      Array.from(this.devices.values()).map(d => d.stopWorkoutCapture())
    );
    return results.some(r => r);
  }

  async connect(): Promise<boolean> {
    // The native bridge handles connect globally in scanner usually, or we can just try to connect all detected
    const results = await Promise.all(
      Array.from(this.devices.values()).map(d => d.connect())
    );
    return results.some(r => r);
  }

  async disconnect(): Promise<void> {
    await Promise.all(
      Array.from(this.devices.values()).map(d => d.disconnect())
    );
  }

  setPlacement(sourceId: string, placement: any): void {
    for (const device of this.devices.values()) {
      if (device.getSourceState().sourceId === sourceId) {
        device.setPlacement(placement);
        return;
      }
    }
  }

  async downloadSessionFile(onProgress?: any): Promise<any> {
    // Download from the first connected device for now, or ideally from all.
    // For App.tsx compatibility, we'll try to find one device that is connected.
    for (const device of this.devices.values()) {
      if (device.getConnectionState() === 'connected') {
        try {
          return await device.downloadSessionFile(onProgress);
        } catch (err) {
          console.warn(`[RemusBladeManager] Download failed for device`, err);
        }
      }
    }
    return null;
  }
}

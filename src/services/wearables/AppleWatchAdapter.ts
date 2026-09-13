import {
  IWearableAdapter,
  SensorSample,
  WearableDevice,
} from '../../types/wearables';

export interface RawWatchPayload {
  type: string;
  nativeTimestamp?: number;
  heartRateBeatsPerMinute?: number;
  groundSpeedMetersPerSecond?: number;
  horizontalAccuracyMeters?: number;
  headingDegrees?: number;
  accelerationIncludingGravityG?: { x: number; y: number; z: number };
  rotationRateRadiansPerSecond?: { x: number; y: number; z: number };
  // Legacy transport aliases accepted only at this adapter boundary.
  timestamp?: number;
  heartRate?: number;
  lat?: number;
  lng?: number;
  alt?: number;
  spd?: number;
  acc?: number;
  head?: number;
  accelX?: number;
  accelY?: number;
  accelZ?: number;
  gyroX?: number;
  gyroY?: number;
  gyroZ?: number;
  [key: string]: unknown;
}

export interface NativeWatchBridge {
  isSupported?(): Promise<boolean>;
  isPaired?(): Promise<boolean>;
  isWatchAppInstalled?(): Promise<boolean>;
  sendMessage?(message: Record<string, unknown>): Promise<unknown>;
  addListener?(
    eventName: string,
    listener: (data: unknown) => void
  ): { remove(): void } | void;
  removeListeners?(count: number): void;
}

export class AppleWatchAdapter implements IWearableAdapter {
  readonly deviceFamily = 'apple_watch' as const;
  private sensorListeners: Set<(data: SensorSample) => void> = new Set();
  private deviceStateListeners: Set<(device: WearableDevice) => void> = new Set();
  private nativeBridge: NativeWatchBridge | null;
  private isConnected = false;
  private messageSubscription: { remove(): void } | null = null;

  constructor(nativeBridge?: NativeWatchBridge) {
    this.nativeBridge = nativeBridge || null;
  }

  async initialize(): Promise<boolean> {
    if (!this.nativeBridge) {
      return false;
    }

    try {
      const isSupported = this.nativeBridge.isSupported
        ? await this.nativeBridge.isSupported()
        : true;
      const isPaired = this.nativeBridge.isPaired
        ? await this.nativeBridge.isPaired()
        : true;

      this.isConnected = isSupported && isPaired;
      if (this.isConnected && !this.messageSubscription && this.nativeBridge.addListener) {
        this.messageSubscription =
          this.nativeBridge.addListener('onWatchMessage', data => {
            if (data && typeof data === 'object') {
              this.handleRawWatchMessage(data as RawWatchPayload);
            }
          }) || null;
      }
      return this.isConnected;
    } catch {
      this.isConnected = false;
      return false;
    }
  }

  async getConnectedDevices(): Promise<WearableDevice[]> {
    if (!this.isConnected) {
      return [];
    }

    return [
      {
        id: 'apple-watch',
        name: 'Apple Watch',
        deviceFamily: 'apple_watch',
        state: 'connected',
      },
    ];
  }

  async sendData(_deviceId: string, payload: Record<string, unknown>): Promise<boolean> {
    if (!this.nativeBridge?.sendMessage) {
      return false;
    }

    try {
      await this.nativeBridge.sendMessage(payload);
      return true;
    } catch {
      return false;
    }
  }

  handleRawWatchMessage(payload: RawWatchPayload): void {
    const normalized: SensorSample = {
      nativeTimestamp: payload.nativeTimestamp ?? payload.timestamp ?? Date.now(),
      deviceId: 'apple-watch',
      deviceFamily: 'apple_watch',
      heartRateBeatsPerMinute:
        payload.heartRateBeatsPerMinute ?? payload.heartRate,
      location:
        payload.lat !== undefined && payload.lng !== undefined
          ? {
              latitude: payload.lat,
              longitude: payload.lng,
              altitude: payload.alt,
              groundSpeedMetersPerSecond:
                payload.groundSpeedMetersPerSecond ?? payload.spd,
              horizontalAccuracyMeters:
                payload.horizontalAccuracyMeters ?? payload.acc,
              headingDegrees: payload.headingDegrees ?? payload.head,
            }
          : undefined,
      accelerationIncludingGravityG:
        payload.accelerationIncludingGravityG ?? (payload.accelX !== undefined &&
        payload.accelY !== undefined &&
        payload.accelZ !== undefined
          ? {
              x: payload.accelX,
              y: payload.accelY,
              z: payload.accelZ,
            }
          : undefined),
      rotationRateRadiansPerSecond:
        payload.rotationRateRadiansPerSecond ?? (payload.gyroX !== undefined &&
        payload.gyroY !== undefined &&
        payload.gyroZ !== undefined
          ? {
              x: payload.gyroX,
              y: payload.gyroY,
              z: payload.gyroZ,
            }
          : undefined),
      sourcePayload: payload,
    };

    this.sensorListeners.forEach(listener => listener(normalized));
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
    this.messageSubscription?.remove();
    this.messageSubscription = null;
    this.sensorListeners.clear();
    this.deviceStateListeners.clear();
    this.isConnected = false;
  }
}

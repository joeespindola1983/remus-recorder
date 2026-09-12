import {
  IWearableAdapter,
  SensorSample,
  WearableDevice,
} from '../../types/wearables';

export interface RawWearOSPayload {
  nodeId?: string;
  nativeTimestamp?: number;
  heartRateBeatsPerMinute?: number;
  groundSpeedMetersPerSecond?: number;
  horizontalAccuracyMeters?: number;
  accelerationIncludingGravityG?: { x: number; y: number; z: number };
  rotationRateRadiansPerSecond?: { x: number; y: number; z: number };
  // Legacy transport aliases accepted only at this adapter boundary.
  timestamp?: number;
  heartRate?: number;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  speed?: number;
  accuracy?: number;
  steps?: number;
  accelX?: number;
  accelY?: number;
  accelZ?: number;
  gyroX?: number;
  gyroY?: number;
  gyroZ?: number;
  [key: string]: unknown;
}

export interface NativeWearOSBridge {
  isAvailable?(): Promise<boolean>;
  getConnectedNodes?(): Promise<{ id: string; name: string }[]>;
  sendMessage?(nodeId: string, payload: Record<string, unknown>): Promise<unknown>;
  addListener?(eventName: string, listener: (data: unknown) => void): void;
  removeListeners?(count: number): void;
}

export class WearOSAdapter implements IWearableAdapter {
  readonly deviceFamily = 'wear_os' as const;
  private sensorListeners: Set<(data: SensorSample) => void> = new Set();
  private deviceStateListeners: Set<(device: WearableDevice) => void> = new Set();
  private nativeBridge: NativeWearOSBridge | null;
  private isAvailable = false;

  constructor(nativeBridge?: NativeWearOSBridge) {
    this.nativeBridge = nativeBridge || null;
  }

  async initialize(): Promise<boolean> {
    if (!this.nativeBridge) {
      return false;
    }

    try {
      this.isAvailable = this.nativeBridge.isAvailable
        ? await this.nativeBridge.isAvailable()
        : true;
      return this.isAvailable;
    } catch {
      this.isAvailable = false;
      return false;
    }
  }

  async getConnectedDevices(): Promise<WearableDevice[]> {
    if (!this.isAvailable || !this.nativeBridge?.getConnectedNodes) {
      return [];
    }

    try {
      const nodes = await this.nativeBridge.getConnectedNodes();
      return nodes.map(node => ({
        id: node.id,
        name: node.name,
        deviceFamily: 'wear_os',
        state: 'connected',
      }));
    } catch {
      return [];
    }
  }

  async sendData(deviceId: string, payload: Record<string, unknown>): Promise<boolean> {
    if (!this.nativeBridge?.sendMessage) {
      return false;
    }

    try {
      await this.nativeBridge.sendMessage(deviceId, payload);
      return true;
    } catch {
      return false;
    }
  }

  handleRawWearOSMessage(payload: RawWearOSPayload): void {
    const deviceId = payload.nodeId || 'wearos-device';
    const normalized: SensorSample = {
      nativeTimestamp: payload.nativeTimestamp ?? payload.timestamp ?? Date.now(),
      deviceId,
      deviceFamily: 'wear_os',
      heartRateBeatsPerMinute:
        payload.heartRateBeatsPerMinute ?? payload.heartRate,
      stepCount: payload.steps,
      location:
        payload.latitude !== undefined && payload.longitude !== undefined
          ? {
              latitude: payload.latitude,
              longitude: payload.longitude,
              altitude: payload.altitude,
              groundSpeedMetersPerSecond:
                payload.groundSpeedMetersPerSecond ?? payload.speed,
              horizontalAccuracyMeters:
                payload.horizontalAccuracyMeters ?? payload.accuracy,
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
    this.sensorListeners.clear();
    this.deviceStateListeners.clear();
    this.isAvailable = false;
  }
}

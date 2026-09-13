import {
  IWearableAdapter,
  SensorSample,
  WearableDevice,
} from '../../types/wearables';

export interface RawWearOSPayload {
  type?: string;
  nodeId?: string;
  deviceId?: string;
  messageId?: string;
  sequenceNumber?: string;
  receivedAtEpochMilliseconds?: number;
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
  getLatestHeartRate?(): Promise<unknown>;
  addListener?(
    eventName: string,
    listener: (data: unknown) => void
  ): { remove(): void } | void;
  removeListeners?(count: number): void;
}

export class WearOSAdapter implements IWearableAdapter {
  readonly deviceFamily = 'wear_os' as const;
  private sensorListeners: Set<(data: SensorSample) => void> = new Set();
  private deviceStateListeners: Set<(device: WearableDevice) => void> = new Set();
  private nativeBridge: NativeWearOSBridge | null;
  private isAvailable = false;
  private messageSubscription: { remove(): void } | null = null;
  private stateSubscription: { remove(): void } | null = null;
  private permissionStates = new Map<string, WearableDevice['heartRatePermissionState']>();

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
      if (
        this.isAvailable &&
        !this.messageSubscription &&
        this.nativeBridge.addListener
      ) {
        this.messageSubscription =
          this.nativeBridge.addListener('onWearOSMessage', data => {
            if (data && typeof data === 'object') {
              this.handleRawWearOSMessage(data as RawWearOSPayload);
            }
          }) || null;
        this.stateSubscription =
          this.nativeBridge.addListener('onWearOSStateChanged', data => {
            if (!data || typeof data !== 'object') return;
            const state = data as {
              nodeId?: string;
              heartRatePermissionState?: WearableDevice['heartRatePermissionState'];
            };
            const deviceId = state.nodeId ?? 'wearos-device';
            this.permissionStates.set(deviceId, state.heartRatePermissionState);
            const device: WearableDevice = {
              id: deviceId,
              name: 'Wear OS',
              deviceFamily: 'wear_os',
              state: 'connected',
              heartRatePermissionState: state.heartRatePermissionState,
            };
            this.deviceStateListeners.forEach(listener => listener(device));
          }) || null;
      }
      if (this.isAvailable && this.nativeBridge.getLatestHeartRate) {
        const latest = await this.nativeBridge.getLatestHeartRate();
        if (latest && typeof latest === 'object') {
          this.handleRawWearOSMessage(latest as RawWearOSPayload);
        }
      }
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
        heartRatePermissionState: this.permissionStates.get(node.id),
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
    const heartRateBeatsPerMinute =
      payload.heartRateBeatsPerMinute ?? payload.heartRate;
    if (
      typeof heartRateBeatsPerMinute !== 'number' ||
      !Number.isFinite(heartRateBeatsPerMinute) ||
      heartRateBeatsPerMinute <= 0
    ) {
      return;
    }
    const deviceId = payload.deviceId || payload.nodeId || 'wearos-device';
    const normalized: SensorSample = {
      nativeTimestamp: payload.nativeTimestamp ?? payload.timestamp ?? Date.now(),
      deviceId,
      deviceFamily: 'wear_os',
      heartRateBeatsPerMinute,
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
    this.messageSubscription?.remove();
    this.stateSubscription?.remove();
    this.messageSubscription = null;
    this.stateSubscription = null;
    this.permissionStates.clear();
    this.sensorListeners.clear();
    this.deviceStateListeners.clear();
    this.isAvailable = false;
  }
}

import {
  IWearableAdapter,
  SensorSample,
  WearableDevice,
} from '../../types/wearables';

export interface RawWatchPayload {
  type: string;
  nativeTimestamp?: number;
  deviceId?: string;
  messageId?: string;
  sequenceNumber?: string;
  clockDomainId?: string;
  receivedAtEpochMilliseconds?: number;
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
  isReachable?(): Promise<boolean>;
  getLatestHeartRate?(): Promise<unknown>;
  sendMessage?(message: Record<string, unknown>): Promise<unknown>;
  addListener?(
    event: string,
    callback: (data: unknown) => void,
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
  private stateSubscription: { remove(): void } | null = null;
  private permissionState: WearableDevice['heartRatePermissionState'];

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
      const isWatchAppInstalled = this.nativeBridge.isWatchAppInstalled
        ? await this.nativeBridge.isWatchAppInstalled()
        : true;
      const isReachable = this.nativeBridge.isReachable
        ? await this.nativeBridge.isReachable()
        : true;

      const isConfigured = isSupported && isPaired && isWatchAppInstalled;
      this.isConnected = isConfigured && isReachable;

      if (isConfigured && !this.messageSubscription && this.nativeBridge.addListener) {
        this.messageSubscription =
          this.nativeBridge.addListener('onWatchMessage', data => {
            if (data && typeof data === 'object') {
              this.handleRawWatchMessage(data as RawWatchPayload);
            }
          }) || null;
        this.stateSubscription =
          this.nativeBridge.addListener('onWatchStateChanged', data => {
            if (!data || typeof data !== 'object') return;
            const state = data as {
              isPaired?: boolean;
              isWatchAppInstalled?: boolean;
              isReachable?: boolean;
              heartRatePermissionState?: WearableDevice['heartRatePermissionState'];
            };
            this.isConnected =
              state.isPaired !== false &&
              state.isWatchAppInstalled !== false &&
              state.isReachable !== false;
            this.permissionState = state.heartRatePermissionState;
            const device: WearableDevice = {
              id: 'apple-watch',
              name: 'Apple Watch',
              deviceFamily: 'apple_watch',
              state: this.isConnected ? 'connected' : 'disconnected',
              heartRatePermissionState: state.heartRatePermissionState,
            };
            this.deviceStateListeners.forEach(listener => listener(device));
          }) || null;
      }
      if (this.isConnected && this.nativeBridge.getLatestHeartRate) {
        const latest = await this.nativeBridge.getLatestHeartRate();
        if (latest && typeof latest === 'object') {
          this.handleRawWatchMessage(latest as RawWatchPayload);
        }
      }
      return isConfigured;
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
        heartRatePermissionState: this.permissionState,
      },
    ];
  }

  async sendData(_deviceId: string, payload: Record<string, unknown>): Promise<boolean> {
    console.log('[AppleWatchAdapter] sendData called. Payload:', JSON.stringify(payload));
    if (!this.nativeBridge?.sendMessage) {
      console.warn('[AppleWatchAdapter] nativeBridge.sendMessage is undefined!');
      return false;
    }

    try {
      const res = await this.nativeBridge.sendMessage(payload);
      console.log('[AppleWatchAdapter] nativeBridge.sendMessage result:', JSON.stringify(res));
      return true;
    } catch (err) {
      console.error('[AppleWatchAdapter] nativeBridge.sendMessage error:', err);
      return false;
    }
  }

  handleRawWatchMessage(payload: RawWatchPayload): void {
    const heartRateBeatsPerMinute =
      payload.heartRateBeatsPerMinute ?? payload.heartRate;
    if (
      typeof heartRateBeatsPerMinute !== 'number' ||
      !Number.isFinite(heartRateBeatsPerMinute) ||
      heartRateBeatsPerMinute <= 0
    ) {
      return;
    }
    const normalized: SensorSample = {
      nativeTimestamp: payload.nativeTimestamp ?? payload.timestamp ?? Date.now(),
      deviceId: payload.deviceId ?? 'apple-watch',
      deviceFamily: 'apple_watch',
      heartRateBeatsPerMinute,
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
    this.stateSubscription?.remove();
    this.messageSubscription = null;
    this.stateSubscription = null;
    this.sensorListeners.clear();
    this.deviceStateListeners.clear();
    this.isConnected = false;
    this.permissionState = undefined;
  }
}

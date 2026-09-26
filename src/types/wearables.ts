export type DeviceFamily =
  | 'apple_watch'
  | 'wear_os'
  | 'garmin'
  | 'ble_sensor'
  | 'remus_blade'
  | 'remus_computer'
  | 'phone'
  | 'mock';

export type WearableConnectionState = 'disconnected' | 'detected' | 'connecting' | 'connected' | 'error';
export type HeartRatePermissionState =
  | 'not_determined'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'unknown';

export interface WearableDevice {
  id: string;
  name: string;
  deviceFamily: DeviceFamily;
  state: WearableConnectionState;
  batteryLevel?: number;
  heartRatePermissionState?: HeartRatePermissionState;
}

export interface PositionCoordinates {
  latitude: number;
  longitude: number;
  altitude?: number | null;
  horizontalAccuracyMeters?: number | null;
  groundSpeedMetersPerSecond?: number | null;
  headingDegrees?: number | null;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface SensorSample {
  nativeTimestamp: number;
  deviceId: string;
  deviceFamily: DeviceFamily;
  location?: PositionCoordinates;
  heartRateBeatsPerMinute?: number;
  accelerationIncludingGravityG?: Vector3;
  rotationRateRadiansPerSecond?: Vector3;
  stepCount?: number;
  sourcePayload?: Record<string, unknown>;
}

export interface IWearableAdapter {
  readonly deviceFamily: DeviceFamily;
  initialize(): Promise<boolean>;
  getConnectedDevices(): Promise<WearableDevice[]>;
  sendData(deviceId: string, payload: Record<string, unknown>): Promise<boolean>;
  onSensorData(listener: (data: SensorSample) => void): () => void;
  onDeviceStateChanged(listener: (device: WearableDevice) => void): () => void;
  destroy(): void;
}

import { NativeEventEmitter } from 'react-native';
import {
  IWearableAdapter,
  SensorSample,
  WearableDevice,
  Vector3,
  PositionCoordinates,
} from '../../types/wearables';

export const REMUS_BLADE_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const REMUS_BLADE_CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

export interface RemusBladeSnapshot {
  timestampMs: number;
  accelG: Vector3;
  gyroDps: Vector3;
  location?: PositionCoordinates;
  satsInUse: number;
  satsInView: number;
  maxSnrDbHz: number;
  horizontalAccuracyMeters?: number;
  linesWritten: number;
  charsRx: number;
  liveSpm?: number;
}

export interface NativeBladeBridge {
  isSupported?(): Promise<boolean>;
  getBluetoothState?(): Promise<string>;
  startScan?(): Promise<boolean>;
  stopScan?(): Promise<void>;
  connectPeripheral?(id: string): Promise<boolean>;
  disconnectPeripheral?(): Promise<void>;
  sendCommand?(command: string): Promise<boolean>;
  addListener?(
    eventName: string,
    listener: (data: any) => void
  ): { remove(): void } | void;
  removeListeners?(count: number): void;
}


const DEG_TO_RAD = Math.PI / 180;

export class RemusBladeAdapter implements IWearableAdapter {
  readonly deviceFamily = 'remus_blade' as const;
  private sensorListeners: Set<(data: SensorSample) => void> = new Set();
  private snapshotListeners: Set<(data: RemusBladeSnapshot) => void> = new Set();
  private deviceStateListeners: Set<(device: WearableDevice) => void> = new Set();
  private nativeBridge: NativeBladeBridge | null;
  private eventEmitter: NativeEventEmitter | null = null;
  private isConnected = false;
  private deviceId = 'remus-blade:p1';
  private deviceName = 'Remus Blade P1';
  private snapshotSubscription: { remove(): void } | null = null;
  private stateSubscription: { remove(): void } | null = null;

  constructor(nativeBridge?: NativeBladeBridge) {
    this.nativeBridge = nativeBridge || null;
    if (this.nativeBridge) {
      this.eventEmitter = new NativeEventEmitter(this.nativeBridge as any);
    }
  }

  async initialize(): Promise<boolean> {
    if (!this.nativeBridge || !this.eventEmitter) {
      return false;
    }

    try {
      const supported = this.nativeBridge.isSupported
        ? await this.nativeBridge.isSupported()
        : true;

      if (!supported) {
        return false;
      }

      if (!this.snapshotSubscription) {
        this.snapshotSubscription =
          this.eventEmitter.addListener('onRemusBladeSnapshot', (payload: any) => {
            const data = payload as { rawCsv?: string; deviceId?: string; deviceName?: string };
            if (data?.deviceId) this.deviceId = data.deviceId;
            if (data?.deviceName) this.deviceName = data.deviceName;
            if (data?.rawCsv) {
              const snapshot = this.parseSnapshotCsv(data.rawCsv);
              if (snapshot) {
                this.handleParsedSnapshot(snapshot);
              }
            }
          });

        this.stateSubscription =
          this.eventEmitter.addListener('onRemusBladeStateChanged', (payload: any) => {
            const statePayload = payload as { state: string; deviceId?: string; deviceName?: string };
            if (statePayload?.deviceId) this.deviceId = statePayload.deviceId;
            if (statePayload?.deviceName) this.deviceName = statePayload.deviceName;
            const state = this.normalizeConnectionState(statePayload.state);
            this.isConnected = state === 'connected';
            this.notifyDeviceState(state);
          });
      }

      return true;
    } catch {
      return false;
    }
  }

  async getConnectedDevices(): Promise<WearableDevice[]> {
    if (!this.isConnected) {
      return [];
    }
    return [
      {
        id: this.deviceId,
        name: this.deviceName,
        deviceFamily: 'remus_blade',
        state: 'connected',
      },
    ];
  }

  async sendData(_deviceId: string, payload: Record<string, unknown>): Promise<boolean> {
    if (typeof payload.command === 'string') {
      return this.sendCommand(payload.command);
    }
    return false;
  }

  async sendCommand(cmd: string): Promise<boolean> {
    if (!this.nativeBridge?.sendCommand) {
      return false;
    }
    try {
      const res = await this.nativeBridge.sendCommand(cmd);
      return res ?? true;
    } catch {
      return false;
    }
  }

  async sendStart(): Promise<boolean> {
    return this.sendCommand('START');
  }

  async sendStop(): Promise<boolean> {
    return this.sendCommand('STOP');
  }

  async sendGpsAid(lat: number, lon: number): Promise<boolean> {
    const latStr = lat.toFixed(6);
    const lonStr = lon.toFixed(6);
    return this.sendCommand(`AID,${latStr},${lonStr}`);
  }

  parseSnapshotCsv(rawCsv: string): RemusBladeSnapshot | null {
    if (!rawCsv || typeof rawCsv !== 'string') {
      return null;
    }

    const trimmed = rawCsv.trim();
    const parts = trimmed.split(',');
    // Must have at least 14 parts:
    // 0: timestampMs
    // 1..3: ax, ay, az
    // 4..6: gx, gy, gz
    // 7..8: lat, lon (empty if no fix)
    // 9: speed_kmh (empty if no fix)
    // 10: sats (satsInUse/satsInView:snr:acc)
    // 11: linesWritten
    // 12: charsRx
    // 13: liveSpm
    if (parts.length < 14) {
      return null;
    }

    const timestampMs = parseInt(parts[0], 10);
    const ax = parseFloat(parts[1]);
    const ay = parseFloat(parts[2]);
    const az = parseFloat(parts[3]);
    const gx = parseFloat(parts[4]);
    const gy = parseFloat(parts[5]);
    const gz = parseFloat(parts[6]);

    if (isNaN(timestampMs) || isNaN(ax) || isNaN(ay) || isNaN(az) || isNaN(gx) || isNaN(gy) || isNaN(gz)) {
      return null;
    }

    const latStr = parts[7]?.trim();
    const lonStr = parts[8]?.trim();
    const spdStr = parts[9]?.trim();
    const satsRaw = parts[10]?.trim() || '';
    const linesWritten = parseInt(parts[11], 10) || 0;
    const charsRx = parseInt(parts[12], 10) || 0;
    const rawSpm = parseFloat(parts[13]);

    // Parse sats format: "%d/%d:%d:%.1fm"
    let satsInUse = 0;
    let satsInView = 0;
    let maxSnrDbHz = 0;
    let horizontalAccuracyMeters: number | undefined;

    const slashIdx = satsRaw.indexOf('/');
    const firstColonIdx = satsRaw.indexOf(':');
    const secondColonIdx = satsRaw.indexOf(':', firstColonIdx + 1);

    if (slashIdx > 0 && firstColonIdx > slashIdx) {
      satsInUse = parseInt(satsRaw.substring(0, slashIdx), 10) || 0;
      satsInView = parseInt(satsRaw.substring(slashIdx + 1, firstColonIdx), 10) || 0;
      if (secondColonIdx > firstColonIdx) {
        maxSnrDbHz = parseInt(satsRaw.substring(firstColonIdx + 1, secondColonIdx), 10) || 0;
        const accStr = satsRaw.substring(secondColonIdx + 1).replace('m', '').trim();
        const parsedAcc = parseFloat(accStr);
        if (!isNaN(parsedAcc) && parsedAcc > 0) {
          horizontalAccuracyMeters = parsedAcc;
        }
      }
    }

    // Coordinates: strictly undefined if missing or invalid, NEVER 0
    let location: PositionCoordinates | undefined;
    if (latStr && lonStr) {
      const lat = parseFloat(latStr);
      const lon = parseFloat(lonStr);
      if (!isNaN(lat) && !isNaN(lon)) {
        const speedKmh = spdStr ? parseFloat(spdStr) : NaN;
        location = {
          latitude: lat,
          longitude: lon,
          groundSpeedMetersPerSecond: !isNaN(speedKmh) ? speedKmh / 3.6 : undefined,
          horizontalAccuracyMeters,
        };
      }
    }

    // Live SPM: if 0.0 or <= 0, SPM is unavailable / waiting, NEVER 0 spm
    const liveSpm = (!isNaN(rawSpm) && rawSpm > 0) ? rawSpm : undefined;

    return {
      timestampMs,
      accelG: { x: ax, y: ay, z: az },
      gyroDps: { x: gx, y: gy, z: gz },
      location,
      satsInUse,
      satsInView,
      maxSnrDbHz,
      horizontalAccuracyMeters,
      linesWritten,
      charsRx,
      liveSpm,
    };
  }

  private handleParsedSnapshot(snapshot: RemusBladeSnapshot): void {
    // A valid payload is the only positive evidence that the Blade is online.
    this.isConnected = true;
    // Notify snapshot listeners
    this.snapshotListeners.forEach(listener => listener(snapshot));

    // Convert to canonical SensorSample
    const sample: SensorSample = {
      nativeTimestamp: snapshot.timestampMs,
      deviceId: this.deviceId,
      deviceFamily: 'remus_blade',
      accelerationIncludingGravityG: snapshot.accelG,
      rotationRateRadiansPerSecond: {
        x: snapshot.gyroDps.x * DEG_TO_RAD,
        y: snapshot.gyroDps.y * DEG_TO_RAD,
        z: snapshot.gyroDps.z * DEG_TO_RAD,
      },
      location: snapshot.location,
      sourcePayload: {
        satsInUse: snapshot.satsInUse,
        satsInView: snapshot.satsInView,
        maxSnrDbHz: snapshot.maxSnrDbHz,
        horizontalAccuracyMeters: snapshot.horizontalAccuracyMeters,
        linesWritten: snapshot.linesWritten,
        charsRx: snapshot.charsRx,
        liveSpm: snapshot.liveSpm,
      },
    };

    this.sensorListeners.forEach(listener => listener(sample));
  }

  private normalizeConnectionState(
    state: string,
  ): 'connected' | 'disconnected' | 'connecting' | 'error' {
    if (state === 'connected') return 'connected';
    if (state === 'connecting' || state === 'detected') {
      return 'connecting';
    }
    if (state === 'error') return 'error';
    return 'disconnected';
  }

  private notifyDeviceState(state: 'connected' | 'disconnected' | 'connecting' | 'error'): void {
    const device: WearableDevice = {
      id: this.deviceId,
      name: this.deviceName,
      deviceFamily: 'remus_blade',
      state,
    };
    this.deviceStateListeners.forEach(listener => listener(device));
  }

  onSnapshot(listener: (data: RemusBladeSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
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

  async getBluetoothState(): Promise<string> {
    if (this.nativeBridge?.getBluetoothState) {
      return this.nativeBridge.getBluetoothState();
    }
    return 'unsupported';
  }

  destroy(): void {
    this.snapshotSubscription?.remove();
    this.snapshotSubscription = null;
    this.stateSubscription?.remove();
    this.stateSubscription = null;
    this.sensorListeners.clear();
    this.snapshotListeners.clear();
    this.deviceStateListeners.clear();
    this.isConnected = false;
  }
}

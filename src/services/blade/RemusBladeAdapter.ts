import { Buffer } from 'buffer';
import { NativeEventEmitter } from 'react-native';
import {
  IWearableAdapter,
  SensorSample,
  WearableDevice,
  Vector3,
  PositionCoordinates,
  WearableConnectionState,
} from '../../types/wearables';
import {
  BladeFragmentReassembler,
  BladeImuBatch,
  REMUS_BLADE_CLOCK_SYNC_UUID,
  REMUS_BLADE_CONTROL_UUID,
  REMUS_BLADE_DEVICE_INFO_UUID,
  REMUS_BLADE_IMU_STREAM_UUID,
  REMUS_BLADE_STATUS_UUID,
  decodeBladeDeviceInfo,
  decodeBladeImuBatch,
  decodeBladeStatus,
  encodeBladeControl,
} from './RemusBladeLiveProtocol';

export const REMUS_BLADE_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const REMUS_BLADE_CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
export {
  REMUS_BLADE_DEVICE_INFO_UUID,
  REMUS_BLADE_CONTROL_UUID,
  REMUS_BLADE_IMU_STREAM_UUID,
  REMUS_BLADE_STATUS_UUID,
  REMUS_BLADE_CLOCK_SYNC_UUID,
};

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
  sdOk?: boolean;
  imuOk?: boolean;
}

export interface NativeBladeBridge {
  isSupported?(): Promise<boolean>;
  getBluetoothState?(): Promise<string>;
  startScan?(): Promise<boolean>;
  stopScan?(): Promise<void>;
  connectPeripheral?(id: string): Promise<boolean>;
  disconnectPeripheral?(): Promise<void>;
  sendCommand?(command: string): Promise<boolean>;
  sendLegacyCommand?(deviceId: string, command: string): Promise<boolean>;
  sendBinaryCommand?(deviceId: string, base64Value: string): Promise<boolean>;
  registerBlade?(deviceSerialNumber: string): Promise<string>;
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
  private batchListeners: Set<(deviceId: string, batch: BladeImuBatch) => void> = new Set();
  private nativeBridge: NativeBladeBridge | null;
  private eventEmitter: NativeEventEmitter | null = null;
  private isConnected = false;
  private deviceId = 'remus-blade:p1';
  private deviceName = 'Remus Blade P1';
  private snapshotSubscription: { remove(): void } | null = null;
  private stateSubscription: { remove(): void } | null = null;
  private frameSubscription: { remove(): void } | null = null;
  private connectedDevices = new Map<string, WearableDevice>();
  private discoveredDevices = new Map<string, WearableDevice>();
  private transportToSerial = new Map<string, string>();
  private fragmentReassembler = new BladeFragmentReassembler();
  private nextRequestId = 1;
  private readonly DOWNLOAD_INACTIVITY_TIMEOUT_MS = 15_000;
  private activeDownload: {
    filename: string;
    totalBytes: number;
    buffer: Buffer;
    receivedBytes: number;
    receivedMask: Uint8Array;
    onProgress?: (progress: number, received: number, total: number) => void;
    resolve: (result: { filename: string; data: Buffer }) => void;
    reject: (error: Error) => void;
    timeout?: any;
  } | null = null;

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
            const data = payload as {
              rawCsv?: string;
              rawBase64?: string;
              deviceId?: string;
              deviceName?: string;
            };
            if (data?.deviceId) this.deviceId = data.deviceId;
            if (data?.deviceName) this.deviceName = data.deviceName;
            if (data?.rawCsv) {
              if (this.handleControlMessage(data.rawCsv)) {
                return;
              }
              const snapshot = this.parseSnapshotCsv(data.rawCsv);
              if (snapshot) {
                this.handleParsedSnapshot(snapshot);
              }
            }
            if (data?.rawBase64) {
              this.handleBinaryChunk(data.rawBase64);
            }
          });

        this.stateSubscription =
          this.eventEmitter.addListener('onRemusBladeStateChanged', (payload: any) => {
            const statePayload = payload as { state: string; deviceId?: string; deviceName?: string };
            if (statePayload?.deviceId) this.deviceId = statePayload.deviceId;
            if (statePayload?.deviceName) this.deviceName = statePayload.deviceName;
            const state = this.normalizeConnectionState(statePayload.state);
            const transportId = statePayload.deviceId || this.deviceId;
            const stableId = this.transportToSerial.get(transportId) || transportId;
            if (transportId) {
              const device: WearableDevice = {
                id: stableId,
                name: statePayload.deviceName || this.deviceName,
                deviceFamily: 'remus_blade',
                state,
                remusProductKind: this.inferProductKind(statePayload.deviceName),
              };
              this.discoveredDevices.set(stableId, device);
              if (state === 'connected') this.connectedDevices.set(stableId, device);
            }
            if (state === 'disconnected' || state === 'error') {
              this.connectedDevices.delete(stableId);
              this.fragmentReassembler.clearDevice(stableId);
            }
            this.isConnected = this.connectedDevices.size > 0;
            this.notifyDeviceState(state, stableId, statePayload.deviceName);
          });

        this.frameSubscription =
          this.eventEmitter.addListener('onRemusBladeFrame', (payload: any) => {
            this.handleLiveFrame(payload as {
              characteristicUuid?: string;
              rawBase64?: string;
              deviceId?: string;
              deviceName?: string;
            });
          });
      }

      await this.startScan();
      return true;
    } catch {
      return false;
    }
  }

  async getConnectedDevices(): Promise<WearableDevice[]> {
    if (this.connectedDevices.size > 0) return [...this.connectedDevices.values()];
    if (!this.isConnected) return [];
    return [{ id: this.deviceId, name: this.deviceName, deviceFamily: 'remus_blade', state: 'connected' }];
  }

  getRemusDevices(): WearableDevice[] {
    return [...this.discoveredDevices.values()];
  }

  async connectAllDetected(): Promise<void> {
    const candidates = this.getRemusDevices().filter(
      device => device.state === 'detected' || device.state === 'disconnected' || device.state === 'error',
    );
    await Promise.allSettled(candidates.map(device => this.connect(device.id)));
  }

  private inferProductKind(name?: string): 'blade' | 'computer' {
    const normalized = (name || '').toUpperCase();
    return normalized.includes('BLD') || normalized.includes('BLADE') ? 'blade' : 'computer';
  }

  async sendData(deviceId: string, payload: Record<string, unknown>): Promise<boolean> {
    if (typeof payload.command === 'string') {
      const command = payload.command.toUpperCase();
      if (command === 'START' || command === 'START_STREAM') return this.sendStart(deviceId);
      if (command === 'STOP' || command === 'STOP_STREAM') return this.sendStop(deviceId);
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

  private async sendStreamControl(command: 'start' | 'stop', deviceId?: string): Promise<boolean> {
    const target = deviceId || this.deviceId;
    const targetDevice = this.discoveredDevices.get(target);
    if (targetDevice?.remusProductKind === 'computer') {
      if (this.nativeBridge?.sendLegacyCommand) {
        return this.nativeBridge.sendLegacyCommand(
          target,
          command === 'start' ? 'START' : 'STOP',
        );
      }
      return this.sendCommand(command === 'start' ? 'START' : 'STOP');
    }
    if (this.nativeBridge?.sendBinaryCommand) {
      const requestId = this.nextRequestId++;
      return this.nativeBridge.sendBinaryCommand(
        target,
        encodeBladeControl(command, requestId).toString('base64'),
      );
    }
    return this.sendCommand(command === 'start' ? 'START' : 'STOP');
  }

  async sendStart(deviceId?: string): Promise<boolean> {
    return this.sendStreamControl('start', deviceId);
  }

  async sendStop(deviceId?: string): Promise<boolean> {
    return this.sendStreamControl('stop', deviceId);
  }

  async disconnect(): Promise<void> {
    if (this.nativeBridge?.disconnectPeripheral) {
      await this.nativeBridge.disconnectPeripheral();
    }
  }

  async connect(deviceId?: string): Promise<boolean> {
    if (this.nativeBridge?.connectPeripheral) {
      return this.nativeBridge.connectPeripheral(deviceId ?? this.deviceId);
    }
    return false;
  }

  async startScan(): Promise<boolean> {
    if (this.nativeBridge?.startScan) {
      return this.nativeBridge.startScan();
    }
    return false;
  }

  async downloadSessionFile(
    arg1?: string | ((progress: number, received: number, total: number) => void),
    arg2?: string | ((progress: number, received: number, total: number) => void)
  ): Promise<{ filename: string; data: Buffer }> {
    let filename: string | undefined;
    let onProgress: ((progress: number, received: number, total: number) => void) | undefined;

    if (typeof arg1 === 'function') {
      onProgress = arg1;
      if (typeof arg2 === 'string') {
        filename = arg2;
      }
    } else if (typeof arg1 === 'string') {
      filename = arg1;
      if (typeof arg2 === 'function') {
        onProgress = arg2;
      }
    } else if (typeof arg2 === 'function') {
      onProgress = arg2;
    }

    if (this.activeDownload) {
      throw new Error('Download already in progress');
    }

    return new Promise((resolve, reject) => {
      this.activeDownload = {
        filename: filename || '',
        totalBytes: 0,
        receivedBytes: 0,
        buffer: Buffer.alloc(0),
        receivedMask: new Uint8Array(0),
        onProgress,
        resolve,
        reject,
      };

      // A transferência pode durar mais de 30 s. O timeout agora significa
      // 15 s sem qualquer atividade BLE de arquivo, e não 30 s desde o início.
      this.resetDownloadInactivityTimeout();

      const cmd = filename && filename.trim().length > 0 ? `GET ${filename.trim()}` : 'GET';
      this.sendCommand(cmd).then(accepted => {
        if (!accepted) {
          this.failActiveDownload(new Error('GET command was not accepted'));
        }
      }).catch((err) => {
        this.failActiveDownload(
          err instanceof Error ? err : new Error(String(err)),
        );
      });
    });
  }

  private resetDownloadInactivityTimeout(): void {
    const download = this.activeDownload;
    if (!download) return;

    if (download.timeout) {
      clearTimeout(download.timeout);
    }

    download.timeout = setTimeout(() => {
      if (this.activeDownload !== download) return;
      this.activeDownload = null;
      download.reject(new Error('TIMEOUT'));
    }, this.DOWNLOAD_INACTIVITY_TIMEOUT_MS);
  }

  private failActiveDownload(error: Error): void {
    const download = this.activeDownload;
    if (!download) return;

    if (download.timeout) {
      clearTimeout(download.timeout);
    }
    this.activeDownload = null;
    download.reject(error);
  }

  private handleControlMessage(msg: string): boolean {
    if (!this.activeDownload) return false;
    const trimmed = msg.trim();
    if (trimmed.startsWith('FILE_START:')) {
      const parts = trimmed.split(':');
      this.activeDownload.filename = parts[1] || 'remus_session.bin';
      this.activeDownload.totalBytes = parseInt(parts[2], 10) || 0;
      this.activeDownload.buffer = Buffer.alloc(this.activeDownload.totalBytes);
      this.activeDownload.receivedBytes = 0;
      this.activeDownload.receivedMask = new Uint8Array(this.activeDownload.totalBytes);
      this.resetDownloadInactivityTimeout();
      return true;
    }
    if (trimmed.startsWith('FILE_END:')) {
      const download = this.activeDownload;
      const parts = trimmed.split(':');
      const completedBytes = Number.parseInt(parts[2], 10);
      const expectedCrc = parts[3]?.trim();
      if (
        !Number.isFinite(completedBytes) ||
        completedBytes !== download.totalBytes ||
        download.receivedBytes !== download.totalBytes
      ) {
        this.failActiveDownload(new Error('INCOMPLETE_TRANSFER'));
        return true;
      }
      const magic = download.buffer.subarray(0, 4).toString('ascii');
      if (magic !== 'RBP1' && magic !== 'RBP2') {
        this.failActiveDownload(new Error('INVALID_RBP_HEADER'));
        return true;
      }
      if (expectedCrc) {
        const actualCrc = this.crc32(download.buffer)
          .toString(16)
          .padStart(8, '0');
        if (actualCrc.toLowerCase() !== expectedCrc.toLowerCase()) {
          this.failActiveDownload(new Error('CRC_MISMATCH'));
          return true;
        }
      }
      if (download.timeout) clearTimeout(download.timeout);
      this.activeDownload = null;
      download.resolve({ filename: download.filename, data: download.buffer });
      return true;
    }
    if (trimmed.startsWith('FILE_ERR:')) {
      const err = trimmed.substring(9);
      this.failActiveDownload(new Error(err || 'Transfer failed'));
      return true;
    }
    return false;
  }

  private handleBinaryChunk(base64Str: string): void {
    if (!this.activeDownload) return;
    try {
      const chunk = Buffer.from(base64Str, 'base64');
      const uint8 = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      if (uint8.length >= 7 && uint8[0] === 0x20) {
        const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
        const offset = view.getUint32(1, true);
        const len = view.getUint16(5, true);
        if (len !== uint8.length - 7 || offset + len > this.activeDownload.totalBytes) {
          this.failActiveDownload(new Error('INVALID_CHUNK'));
          return;
        }
        const data = uint8.subarray(7, 7 + len);

        const targetUint8 = new Uint8Array(
          this.activeDownload.buffer.buffer,
          this.activeDownload.buffer.byteOffset,
          this.activeDownload.buffer.byteLength
        );
        targetUint8.set(data, offset);
        for (let index = 0; index < data.length; index += 1) {
          const targetIndex = offset + index;
          if (this.activeDownload.receivedMask[targetIndex] === 0) {
            this.activeDownload.receivedMask[targetIndex] = 1;
            this.activeDownload.receivedBytes += 1;
          }
        }
        this.resetDownloadInactivityTimeout();

        const progress =
          this.activeDownload.totalBytes > 0
            ? Math.min(100, Math.round((this.activeDownload.receivedBytes / this.activeDownload.totalBytes) * 100))
            : 0;

        if (typeof this.activeDownload.onProgress === 'function') {
          this.activeDownload.onProgress(
            progress,
            this.activeDownload.receivedBytes,
            this.activeDownload.totalBytes
          );
        }
      }
    } catch (err) {
      console.warn('[RemusBladeAdapter] Error handling binary chunk:', err);
    }
  }

  private crc32(data: Uint8Array): number {
    /* eslint-disable no-bitwise -- CRC32 is defined in terms of bit operations. */
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }
    const result = (~crc) >>> 0;
    /* eslint-enable no-bitwise */
    return result;
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
    const imuOk = parts[14] !== undefined ? parts[14].trim() === '1' : true;
    const sdOk = parts[15] !== undefined ? parts[15].trim() === '1' : (linesWritten > 0);

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
      sdOk,
      imuOk,
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
    state?: string,
  ): WearableConnectionState {
    if (state === 'connected') return 'connected';
    if (state === 'connecting') return 'connecting';
    if (state === 'detected') return 'detected';
    if (state === 'error') return 'error';
    return 'disconnected';
  }

  private notifyDeviceState(
    state: WearableConnectionState,
    deviceId = this.deviceId,
    deviceName?: string,
  ): void {
    const device: WearableDevice = {
      id: deviceId,
      name: deviceName || this.deviceName,
      deviceFamily: 'remus_blade',
      state,
      remusProductKind:
        this.discoveredDevices.get(deviceId)?.remusProductKind ||
        this.inferProductKind(deviceName),
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

  onRawImuBatch(listener: (deviceId: string, batch: BladeImuBatch) => void): () => void {
    this.batchListeners.add(listener);
    return () => this.batchListeners.delete(listener);
  }

  private handleLiveFrame(payload: {
    characteristicUuid?: string;
    rawBase64?: string;
    deviceId?: string;
    deviceName?: string;
  }): void {
    if (!payload.rawBase64 || !payload.deviceId || !payload.characteristicUuid) return;
    const uuid = payload.characteristicUuid.toLowerCase();
    const bytes = Buffer.from(payload.rawBase64, 'base64');
    const transportId = payload.deviceId;
    try {
      if (uuid === REMUS_BLADE_DEVICE_INFO_UUID) {
        const info = decodeBladeDeviceInfo(bytes);
        const previousId = this.transportToSerial.get(transportId) || transportId;
        const stableId = info.deviceSerialNumber;
        this.transportToSerial.set(transportId, stableId);
        if (previousId !== stableId) this.connectedDevices.delete(previousId);
        const device = {
          id: stableId,
          name: payload.deviceName || `Remus Blade ${stableId.slice(-4)}`,
          deviceFamily: 'remus_blade' as const,
          state: 'connected' as const,
          remusProductKind: 'blade' as const,
        };
        this.discoveredDevices.delete(previousId);
        this.discoveredDevices.set(stableId, device);
        this.connectedDevices.set(stableId, device);
        this.deviceId = stableId;
        this.deviceName = device.name;
        this.isConnected = true;
        this.deviceStateListeners.forEach(listener => listener(device));
        if (this.nativeBridge?.registerBlade) {
          this.nativeBridge.registerBlade(stableId).then(alias => {
            const registered = { ...device, name: alias };
            this.connectedDevices.set(stableId, registered);
            this.discoveredDevices.set(stableId, registered);
            if (this.deviceId === stableId) this.deviceName = alias;
            this.deviceStateListeners.forEach(listener => listener(registered));
          }).catch(() => undefined);
        }
        return;
      }

      const stableId = this.transportToSerial.get(transportId) || transportId;
      if (uuid === REMUS_BLADE_STATUS_UUID) {
        const status = decodeBladeStatus(bytes);
        if (!status.connected) return;
        this.connectedDevices.set(stableId, {
          id: stableId,
          name: payload.deviceName || this.deviceName,
          deviceFamily: 'remus_blade',
          state: 'connected',
        });
        return;
      }
      if (uuid !== REMUS_BLADE_IMU_STREAM_UUID) return;
      const logicalBatch = this.fragmentReassembler.accept(stableId, bytes);
      if (!logicalBatch) return;
      const batch = decodeBladeImuBatch(logicalBatch);
      this.batchListeners.forEach(listener => listener(stableId, batch));
      for (const raw of batch.samples) {
        this.sensorListeners.forEach(listener => listener({
          nativeTimestamp: Number(raw.nativeTimestampUs),
          deviceId: stableId,
          deviceFamily: 'remus_blade',
          accelerationIncludingGravityG: {
            x: raw.accelRawX / 4096,
            y: raw.accelRawY / 4096,
            z: raw.accelRawZ / 4096,
          },
          rotationRateRadiansPerSecond: {
            x: (raw.gyroRawX / 65.5) * DEG_TO_RAD,
            y: (raw.gyroRawY / 65.5) * DEG_TO_RAD,
            z: (raw.gyroRawZ / 65.5) * DEG_TO_RAD,
          },
          sourcePayload: {
            batchSequence: batch.batchSequence,
            sampleSequence: raw.sampleSequence,
            nativeTimestampUs: raw.nativeTimestampUs,
            timingJitterMicroseconds: raw.timingJitterMicroseconds,
            sampleStatus: raw.sampleStatus,
          },
        }));
      }
      const last = batch.samples[batch.samples.length - 1];
      this.handleParsedSnapshot({
        timestampMs: Number(last.nativeTimestampUs) / 1000,
        accelG: { x: last.accelRawX / 4096, y: last.accelRawY / 4096, z: last.accelRawZ / 4096 },
        gyroDps: { x: last.gyroRawX / 65.5, y: last.gyroRawY / 65.5, z: last.gyroRawZ / 65.5 },
        satsInUse: 0,
        satsInView: 0,
        maxSnrDbHz: 0,
        linesWritten: 0,
        charsRx: 0,
        imuOk: true,
        sdOk: false,
      });
    } catch (error) {
      console.warn('[RemusBladeAdapter] Invalid Blade v1 frame:', error);
    }
  }

  async getBluetoothState(): Promise<string> {
    if (this.nativeBridge?.getBluetoothState) {
      return this.nativeBridge.getBluetoothState();
    }
    return 'unsupported';
  }

  destroy(): void {
    if (this.activeDownload?.timeout) {
      clearTimeout(this.activeDownload.timeout);
    }
    this.activeDownload = null;
    this.snapshotSubscription?.remove();
    this.snapshotSubscription = null;
    this.stateSubscription?.remove();
    this.stateSubscription = null;
    this.frameSubscription?.remove();
    this.frameSubscription = null;
    this.sensorListeners.clear();
    this.snapshotListeners.clear();
    this.deviceStateListeners.clear();
    this.batchListeners.clear();
    this.connectedDevices.clear();
    this.transportToSerial.clear();
    this.isConnected = false;
  }
}

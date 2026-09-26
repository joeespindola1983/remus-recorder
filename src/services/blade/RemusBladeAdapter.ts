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
  RemusRelayedStreamPacketDecoder,
  RemusStreamPacketDecoder,
} from './RemusStreamPacketDecoder';

export const REMUS_BLADE_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const REMUS_BLADE_CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
export const REMUS_IMU_STREAM_CHARACTERISTIC_UUID = 'beb54841-36e1-4688-b7f5-ea07361b26a8';
export const REMUS_BLADE_RELAY_CHARACTERISTIC_UUID = 'beb54844-36e1-4688-b7f5-ea07361b26a8';

export const parseBladeIdentityHash = (deviceName: string): number | null => {
  const match = deviceName.trim().toUpperCase().match(/^REMUS-BLD-([0-9A-F]{8})$/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return Number.isSafeInteger(value) && value > 0 && value <= 0xFFFFFFFF ? value : null;
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
  recordsQueued?: number;
  storageWriteFailures?: number;
  liveStreamQueueDrops?: number;
  bladeRelayConnected?: boolean;
  bladeRelayNotificationsReceived?: number;
  bladeRelayPacketsPersisted?: number;
  bladeRelayQueueDrops?: number;
  bladeRelayWriteFailures?: number;
  bladeRelayStorageFault?: boolean;
  bladeRelayLiveDrops?: number;
}

export interface BladeRosterEntry {
  sourceIdentityHash: number;
  connected: boolean;
  assignedSide: 'left_paddle' | 'right_paddle' | null;
}

export interface NativeBladeBridge {
  isSupported?(): Promise<boolean>;
  getBluetoothState?(): Promise<string>;
  startScan?(): Promise<boolean>;
  stopScan?(): Promise<void>;
  connectPeripheral?(id: string): Promise<boolean>;
  disconnectPeripheral?(): Promise<void>;
  sendCommand?(identifier: string, command: string): Promise<boolean>;
  sendBinaryCommand?(identifier: string, base64Command: string): Promise<boolean>;
  addListener?(
    eventName: string,
    listener: (data: any) => void
  ): { remove(): void } | void;
  removeListeners?(count: number): void;
}


const DEG_TO_RAD = Math.PI / 180;

export type RemusDeviceFamily = 'remus_blade' | 'remus_computer';

export const classifyRemusDeviceName = (deviceName: string): RemusDeviceFamily => {
  const normalized = deviceName.trim().toUpperCase();
  return normalized.includes('COMPUTER') ||
    normalized.includes('CMP') ||
    normalized.includes('REMUS-PC') ||
    normalized.includes('REMUS-P1') ||
    normalized.includes('REMUS-P2') ||
    normalized.includes('REMUS-PR1') ||
    normalized.includes('REMUS-PR2')
    ? 'remus_computer'
    : 'remus_blade';
};

export class RemusBladeAdapter implements IWearableAdapter {
  readonly deviceFamily: RemusDeviceFamily;
  private sensorListeners: Set<(data: SensorSample) => void> = new Set();
  private snapshotListeners: Set<(data: RemusBladeSnapshot) => void> = new Set();
  private deviceStateListeners: Set<(device: WearableDevice) => void> = new Set();
  private bladeRosterListeners: Set<(entries: BladeRosterEntry[]) => void> = new Set();
  private nativeBridge: NativeBladeBridge | null;
  private readonly relayedStreamPacketDecoder = new RemusRelayedStreamPacketDecoder();
  private readonly expectedRelayedSampleSequence = new Map<number, number>();
  private eventEmitter: NativeEventEmitter | null = null;
  private isConnected = false;
  private readonly streamPacketDecoder = new RemusStreamPacketDecoder();
  private expectedLiveSampleSequence: number | null = null;
  private snapshotSubscription: { remove(): void } | null = null;
  private stateSubscription: { remove(): void } | null = null;
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

  constructor(
    public readonly targetDeviceId: string,
    public targetDeviceName: string,
    nativeBridge?: NativeBladeBridge,
    deviceFamily: RemusDeviceFamily = classifyRemusDeviceName(targetDeviceName),
  ) {
    this.deviceFamily = deviceFamily;
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
          this.eventEmitter.addListener('onRemusBladeSnapshot', (payload: any) => this.handleSnapshotPayload(payload));

        this.stateSubscription =
          this.eventEmitter.addListener('onRemusBladeStateChanged', (payload: any) => this.handleStatePayload(payload));
      }

      return true;
    } catch {
      return false;
    }
  }

  public handleSnapshotPayload(payload: any): void {
    const data = payload as {
      rawCsv?: string;
      rawBase64?: string;
      deviceId?: string;
      deviceName?: string;
      characteristicUuid?: string;
    };
    if (!data?.deviceId || data.deviceId !== this.targetDeviceId) {
      return;
    }
    if (data?.deviceName) {
      this.targetDeviceName = data.deviceName;
    }
    if (data?.rawCsv) {
      console.log(`[RemusBladeAdapter:${this.targetDeviceId}] Received rawCsv: ${data.rawCsv}`);
      if (this.handleControlMessage(data.rawCsv)) {
        return;
      }
      const snapshot = this.parseSnapshotCsv(data.rawCsv);
      if (snapshot) {
        this.handleParsedSnapshot(snapshot);
      } else {
        console.log(`[RemusBladeAdapter:${this.targetDeviceId}] Failed to parse CSV: ${data.rawCsv}`);
      }
    }
    if (data?.rawBase64) {
      if (data.characteristicUuid?.toLowerCase() === REMUS_IMU_STREAM_CHARACTERISTIC_UUID) {
        this.handleLiveImuPacket(data.rawBase64);
      } else if (data.characteristicUuid?.toLowerCase() === REMUS_BLADE_RELAY_CHARACTERISTIC_UUID) {
        this.handleRelayedImuPacket(data.rawBase64);
      } else {
        this.handleBinaryChunk(data.rawBase64);
      }
    }
  }

  private handleRelayedImuPacket(rawBase64: string): void {
    const relayed = this.relayedStreamPacketDecoder.ingestBase64(rawBase64);
    if (!relayed) return;
    const sourceId = `blade:${relayed.sourceIdentityHash.toString(16).padStart(8, '0')}`;
    let expected = this.expectedRelayedSampleSequence.get(relayed.sourceIdentityHash) ?? null;
    for (const raw of relayed.batch.samples) {
      const missingSamplesBefore = expected === null
        ? 0
        : Math.max(0, raw.sampleSequence - expected);
      expected = raw.sampleSequence + 1;
      const sample: SensorSample = {
        nativeTimestamp: raw.nativeTimestampUs / 1000,
        deviceId: sourceId,
        deviceFamily: 'remus_blade',
        accelerationIncludingGravityG: {
          x: raw.rawAccel.x / 4096,
          y: raw.rawAccel.y / 4096,
          z: raw.rawAccel.z / 4096,
        },
        rotationRateRadiansPerSecond: {
          x: raw.rawGyro.x / 65.5 * DEG_TO_RAD,
          y: raw.rawGyro.y / 65.5 * DEG_TO_RAD,
          z: raw.rawGyro.z / 65.5 * DEG_TO_RAD,
        },
        sourcePayload: {
          transportDeviceId: this.targetDeviceId,
          sourceIdentityHash: relayed.sourceIdentityHash,
          computerReceivedAtMs: relayed.computerReceivedAtMs,
          batchSequence: relayed.batch.batchSequence,
          sampleSequence: raw.sampleSequence,
          nativeTimestampUs: raw.nativeTimestampUs,
          sampleStatus: raw.status,
          missingSamplesBefore,
        },
      };
      this.sensorListeners.forEach(listener => listener(sample));
    }
    if (expected !== null) {
      this.expectedRelayedSampleSequence.set(relayed.sourceIdentityHash, expected);
    }
  }

  private handleLiveImuPacket(rawBase64: string): void {
    const batch = this.streamPacketDecoder.ingestBase64(rawBase64);
    if (!batch) return;
    for (const raw of batch.samples) {
      const missingSamplesBefore = this.expectedLiveSampleSequence === null
        ? 0
        : Math.max(0, raw.sampleSequence - this.expectedLiveSampleSequence);
      this.expectedLiveSampleSequence = raw.sampleSequence + 1;
      const sample: SensorSample = {
        nativeTimestamp: raw.nativeTimestampUs / 1000,
        deviceId: this.targetDeviceId,
        deviceFamily: this.deviceFamily,
        accelerationIncludingGravityG: {
          x: raw.rawAccel.x / 4096,
          y: raw.rawAccel.y / 4096,
          z: raw.rawAccel.z / 4096,
        },
        rotationRateRadiansPerSecond: {
          x: raw.rawGyro.x / 65.5 * DEG_TO_RAD,
          y: raw.rawGyro.y / 65.5 * DEG_TO_RAD,
          z: raw.rawGyro.z / 65.5 * DEG_TO_RAD,
        },
        sourcePayload: {
          batchSequence: batch.batchSequence,
          sampleSequence: raw.sampleSequence,
          nativeTimestampUs: raw.nativeTimestampUs,
          sampleStatus: raw.status,
          missingSamplesBefore,
        },
      };
      this.sensorListeners.forEach(listener => listener(sample));
    }
  }

  public handleStatePayload(payload: any): void {
    const statePayload = payload as { state: string; deviceId?: string; deviceName?: string };
    if (!statePayload?.deviceId || statePayload.deviceId !== this.targetDeviceId) {
      return;
    }
    if (statePayload?.deviceName) {
      this.targetDeviceName = statePayload.deviceName;
    }
    const state = this.normalizeConnectionState(statePayload.state);
    this.isConnected = state === 'connected';
    this.notifyDeviceState(state);
  }

  async getConnectedDevices(): Promise<WearableDevice[]> {
    if (!this.isConnected) {
      return [];
    }
    return [
      {
        id: this.targetDeviceId,
        name: this.targetDeviceName,
        deviceFamily: this.deviceFamily,
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
      const res = await this.nativeBridge.sendCommand(this.targetDeviceId, cmd);
      return res ?? true;
    } catch {
      return false;
    }
  }

  async sendBinaryCommand(base64Command: string): Promise<boolean> {
    if (!this.nativeBridge?.sendBinaryCommand) {
      return false;
    }
    try {
      const res = await this.nativeBridge.sendBinaryCommand(this.targetDeviceId, base64Command);
      return res ?? true;
    } catch {
      return false;
    }
  }

  async sendStart(): Promise<boolean> {
    this.expectedLiveSampleSequence = null;
    if (this.deviceFamily === 'remus_computer') {
      return this.sendCommand('START');
    } else {
      // Blade uses binary StartStream command: [0x01, 0x01, 0x00, 0x00, 0x00, 0x00]
      return this.sendBinaryCommand('AQEAAAAA');
    }
  }

  async sendStop(): Promise<boolean> {
    if (this.deviceFamily === 'remus_computer') {
      return this.sendCommand('STOP');
    } else {
      // Blade uses binary StopStream command: [0x01, 0x02, 0x00, 0x00, 0x00, 0x00]
      return this.sendBinaryCommand('AQIAAAAA');
    }
  }

  async configureBladeSlot(
    sourceIdentityHash: number,
    placement: 'left_paddle' | 'right_paddle',
  ): Promise<boolean> {
    if (this.deviceFamily !== 'remus_computer' || !Number.isSafeInteger(sourceIdentityHash) || sourceIdentityHash <= 0) {
      return false;
    }
    const side = placement === 'left_paddle' ? 'L' : 'R';
    const identity = sourceIdentityHash.toString(16).toUpperCase().padStart(8, '0');
    return this.sendCommand(`BLADE_SLOT,${side},${identity}`);
  }

  async calibrateBladeAlignment(): Promise<boolean> {
    return this.deviceFamily === 'remus_computer'
      ? this.sendCommand('BLADE_CALIBRATE')
      : false;
  }

  async disconnect(): Promise<void> {
    if (this.nativeBridge?.disconnectPeripheral) {
      // For now the bridge disconnects all peripherals if no ID is passed, but we should pass it if supported
      await this.nativeBridge.disconnectPeripheral();
    }
  }

  async connect(): Promise<boolean> {
    if (this.nativeBridge?.connectPeripheral) {
      return this.nativeBridge.connectPeripheral(this.targetDeviceId);
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
    _arg1?: string | ((progress: number, received: number, total: number) => void),
    _arg2?: string | ((progress: number, received: number, total: number) => void)
  ): Promise<{ filename: string; data: Buffer }> {
    if (this.activeDownload) {
      throw new Error('Download already in progress');
    }

    // O usuário solicitou que o Remus PC também não faça o download do arquivo via BLE,
    // pois um treino longo demora muito e ele vai pegar o arquivo bruto manualmente do SD.
    // Assim, dependemos apenas da telemetria ao vivo.
    return { filename: '', data: Buffer.alloc(0) };
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
    const trimmed = msg.trim();
    if (trimmed.startsWith('BLADE_SLOTS,')) {
      return true;
    }
    if (trimmed.startsWith('BLADE_ROSTER,')) {
      const entries = trimmed.split(',').slice(2).flatMap(part => {
        const [hashText, connectedText, sideText] = part.split(':');
        if (!/^[0-9A-Fa-f]{8}$/.test(hashText)) return [];
        const sourceIdentityHash = Number.parseInt(hashText, 16);
        if (sourceIdentityHash === 0) return [];
        const assignedSide = sideText === 'L'
          ? 'left_paddle' as const
          : sideText === 'R'
            ? 'right_paddle' as const
            : null;
        return [{
          sourceIdentityHash,
          connected: connectedText === '1',
          assignedSide,
        }];
      });
      this.bladeRosterListeners.forEach(listener => listener(entries));
      return true;
    }
    if (!this.activeDownload) return false;
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
    const recordsQueued = parts[25] !== undefined ? parseInt(parts[25], 10) : undefined;
    const storageWriteFailures = parts[26] !== undefined ? parseInt(parts[26], 10) : undefined;
    const liveStreamQueueDrops = parts[27] !== undefined ? parseInt(parts[27], 10) : undefined;
    const bladeRelayConnected = parts[28] !== undefined ? parts[28].trim() === '1' : undefined;
    const bladeRelayNotificationsReceived = parts[29] !== undefined ? parseInt(parts[29], 10) : undefined;
    const bladeRelayPacketsPersisted = parts[30] !== undefined ? parseInt(parts[30], 10) : undefined;
    const bladeRelayQueueDrops = parts[31] !== undefined ? parseInt(parts[31], 10) : undefined;
    const bladeRelayWriteFailures = parts[32] !== undefined ? parseInt(parts[32], 10) : undefined;
    const bladeRelayStorageFault = parts[33] !== undefined ? parts[33].trim() === '1' : undefined;
    const bladeRelayLiveDrops = parts[34] !== undefined ? parseInt(parts[34], 10) : undefined;

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
      recordsQueued: Number.isFinite(recordsQueued) ? recordsQueued : undefined,
      storageWriteFailures: Number.isFinite(storageWriteFailures) ? storageWriteFailures : undefined,
      liveStreamQueueDrops: Number.isFinite(liveStreamQueueDrops) ? liveStreamQueueDrops : undefined,
      bladeRelayConnected,
      bladeRelayNotificationsReceived: Number.isFinite(bladeRelayNotificationsReceived) ? bladeRelayNotificationsReceived : undefined,
      bladeRelayPacketsPersisted: Number.isFinite(bladeRelayPacketsPersisted) ? bladeRelayPacketsPersisted : undefined,
      bladeRelayQueueDrops: Number.isFinite(bladeRelayQueueDrops) ? bladeRelayQueueDrops : undefined,
      bladeRelayWriteFailures: Number.isFinite(bladeRelayWriteFailures) ? bladeRelayWriteFailures : undefined,
      bladeRelayStorageFault,
      bladeRelayLiveDrops: Number.isFinite(bladeRelayLiveDrops) ? bladeRelayLiveDrops : undefined,
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
      deviceId: this.targetDeviceId,
      deviceFamily: this.deviceFamily,
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
        recordsQueued: snapshot.recordsQueued,
        storageWriteFailures: snapshot.storageWriteFailures,
        liveStreamQueueDrops: snapshot.liveStreamQueueDrops,
        bladeRelayConnected: snapshot.bladeRelayConnected,
        bladeRelayNotificationsReceived: snapshot.bladeRelayNotificationsReceived,
        bladeRelayPacketsPersisted: snapshot.bladeRelayPacketsPersisted,
        bladeRelayQueueDrops: snapshot.bladeRelayQueueDrops,
        bladeRelayWriteFailures: snapshot.bladeRelayWriteFailures,
        bladeRelayStorageFault: snapshot.bladeRelayStorageFault,
        bladeRelayLiveDrops: snapshot.bladeRelayLiveDrops,
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

  private notifyDeviceState(state: WearableConnectionState): void {
    const device: WearableDevice = {
      id: this.targetDeviceId,
      name: this.targetDeviceName,
      deviceFamily: this.deviceFamily,
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

  onBladeRoster(listener: (entries: BladeRosterEntry[]) => void): () => void {
    this.bladeRosterListeners.add(listener);
    return () => {
      this.bladeRosterListeners.delete(listener);
    };
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
    this.sensorListeners.clear();
    this.snapshotListeners.clear();
    this.deviceStateListeners.clear();
    this.bladeRosterListeners.clear();
    this.isConnected = false;
  }
}

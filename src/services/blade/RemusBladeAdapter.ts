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
  TelemetryAccounting,
} from './RemusStreamPacketDecoder';
import {
  PresentationAvailabilityReason,
  PresentationAvailabilityState,
  CanonicalRecording,
} from '../recording/RecordingService';
import { StreamContinuityTracker } from './StreamContinuityTracker';
import { BoundedClockMappingEstimator } from './BoundedClockMappingEstimator';

export const REMUS_BLADE_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const REMUS_BLADE_CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
export const REMUS_DEVICE_INFO_CHARACTERISTIC_UUID = 'beb5483f-36e1-4688-b7f5-ea07361b26a8';
export const REMUS_IMU_STREAM_CHARACTERISTIC_UUID = 'beb54841-36e1-4688-b7f5-ea07361b26a8';
export const REMUS_BLADE_RELAY_CHARACTERISTIC_UUID = 'beb54844-36e1-4688-b7f5-ea07361b26a8';
export const REMUS_CLOCK_SYNC_CHARACTERISTIC_UUID = 'beb54843-36e1-4688-b7f5-ea07361b26a8';

export const parseBladeIdentityHash = (deviceName: string): number | null => {
  const match = deviceName.trim().toUpperCase().match(/^REMUS-BLD-([0-9A-F]{8})$/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return Number.isSafeInteger(value) && value > 0 && value <= 0xFFFFFFFF ? value : null;
};

export const canonicalRemusSourceId = (transportDeviceId: string, deviceName: string): string => {
  const identityHash = parseBladeIdentityHash(deviceName);
  if (identityHash !== null) {
    return `blade:${identityHash.toString(16).padStart(8, '0')}`;
  }
  const family = classifyRemusDeviceName(deviceName);
  return `${family === 'remus_computer' ? 'computer' : 'blade'}:${transportDeviceId}`;
};

export const mapEstimatorReasonToPresentationAvailabilityReason = (
  state: PresentationAvailabilityState,
  internalReason?: string,
): PresentationAvailabilityReason => {
  if (state === 'available') {
    return 'available';
  }
  if (state === 'held') {
    return 'held_last_supported_value';
  }
  const reason = (internalReason || '').trim().toLowerCase();
  if (
    reason === 'recent_quiet' ||
    reason === 'stopped' ||
    reason === 'confirmed_stop' ||
    reason === 'workout_stopped'
  ) {
    return 'confirmed_stop';
  }
  if (
    reason.includes('weak_periodicity') ||
    reason.includes('competing_axes') ||
    reason.includes('ambiguous')
  ) {
    return 'ambiguous_periodicity';
  }
  if (
    reason.includes('sample_gap') ||
    reason.includes('telemetry_timeout') ||
    reason.includes('gap_exceeded')
  ) {
    return 'telemetry_timeout';
  }
  return 'source_unavailable';
};

export interface RemusDeviceInfo {
  protocolVersion: number;
  deviceFamily: RemusDeviceFamily;
  deviceModel: 'rbp1' | 'rcp1' | 'unknown';
  hardwareRevision: number;
  capabilities: number;
  nominalSampleRateHz: number;
  accelerometerRangeG: number | null;
  gyroscopeRangeDps: number | null;
  dlpfSetting: number | null;
  deviceSerialNumber: string;
  firmwareVersion: string;
  deviceBootId?: number | null;
}

export const decodeRemusDeviceInfo = (data: Uint8Array): RemusDeviceInfo | null => {
  if (data.length < 12 || (data[0] !== 1 && data[0] !== 2 && data[0] !== 3)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = data[0];
  let serialLengthOffset: number;
  let deviceBootId: number | null = null;
  if (version === 3) {
    if (data.length < 16) return null;
    deviceBootId = view.getUint32(11, true);
    serialLengthOffset = 15;
  } else if (version === 2) {
    serialLengthOffset = 11;
  } else {
    serialLengthOffset = 10;
  }
  const serialOffset = serialLengthOffset + 1;
  if (serialLengthOffset >= data.length) return null;
  const serialLength = data[serialLengthOffset];
  const firmwareLengthOffset = serialOffset + serialLength;
  if (firmwareLengthOffset >= data.length) return null;
  const firmwareLength = data[firmwareLengthOffset];
  if (firmwareLengthOffset + 1 + firmwareLength !== data.length) return null;
  const family = data[1] === 2 ? 'remus_blade' : data[1] === 1 ? 'remus_computer' : null;
  if (!family) return null;
  return {
    protocolVersion: version,
    deviceFamily: family,
    deviceModel: family === 'remus_blade' && data[2] === 1
      ? 'rbp1'
      : family === 'remus_computer' && data[2] === 1 ? 'rcp1' : 'unknown',
    hardwareRevision: data[3],
    capabilities: view.getUint16(4, true),
    nominalSampleRateHz: view.getUint16(6, true),
    accelerometerRangeG: data[8] === 1 ? 8 : data[8] === 2 ? 16 : null,
    gyroscopeRangeDps: data[9] === 1 ? 500 : data[9] === 2 ? 1000 : data[9] === 3 ? 2000 : null,
    dlpfSetting: version >= 2 ? data[10] : null,
    deviceSerialNumber: Buffer.from(data.subarray(serialOffset, firmwareLengthOffset)).toString('utf8'),
    firmwareVersion: Buffer.from(data.subarray(firmwareLengthOffset + 1)).toString('utf8'),
    deviceBootId,
  };
};

export interface RemusBladeSnapshot {
  sourceId?: string;
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
  liveSpmAvailabilityState?: PresentationAvailabilityState;
  liveSpmInternalReason?: string;
  liveSpmAvailabilityReason?: PresentationAvailabilityReason;
  liveSpmSupportedNativeTimestamp?: number;
  clockDomainId?: string;
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
  requestClockSync?(identifier: string): Promise<boolean>;
  addListener?(
    eventName: string,
    listener: (data: any) => void
  ): { remove(): void } | void;
  removeListeners?(count: number): void;
}

export interface RemusClockSyncSnapshot {
  estimatedClockOffsetUs: number;
  roundTripUs: number;
  clockDriftPpm: number | null;
  lastSyncTimestampUs: number;
  maximumErrorUs: number;
  currentOffsetUncertaintyUs: number;
  sessionWorstCaseUncertaintyUs: number;
  syncQuality: 'qualified' | 'approximate' | 'low_confidence';
  observationCount: number;
  deviceBootId?: number;
}

interface ClockObservation {
  hostUs: number;
  offsetUs: number;
  roundTripUs: number;
}

const fitBoundedClockMapping = (
  observations: ClockObservation[],
  atHostUs: number,
): {offsetUs: number; driftPpm: number | null; maximumErrorUs: number} => {
  const selectedCount = Math.max(1, Math.ceil(observations.length / 3));
  const selected = [...observations]
    .sort((a, b) => a.roundTripUs - b.roundTripUs)
    .slice(0, selectedCount)
    .sort((a, b) => a.hostUs - b.hostUs);
  const minimumTransportErrorUs = selected[0].roundTripUs / 2;
  if (
    selected.length < 2 ||
    selected[selected.length - 1].hostUs === selected[0].hostUs
  ) {
    return {
      offsetUs: selected[0].offsetUs,
      driftPpm: null,
      maximumErrorUs: minimumTransportErrorUs,
    };
  }

  const originUs = selected[0].hostUs;
  let sumW = 0;
  let sumWT = 0;
  let sumWO = 0;
  let sumWTO = 0;
  let sumWTT = 0;
  for (const observation of selected) {
    const weight = 1 / Math.max(1_000, observation.roundTripUs);
    const timeSeconds = (observation.hostUs - originUs) / 1_000_000;
    sumW += weight;
    sumWT += weight * timeSeconds;
    sumWO += weight * observation.offsetUs;
    sumWTO += weight * timeSeconds * observation.offsetUs;
    sumWTT += weight * timeSeconds * timeSeconds;
  }
  const denominator = sumW * sumWTT - sumWT * sumWT;
  if (Math.abs(denominator) <= 1e-12) {
    return {
      offsetUs: selected[0].offsetUs,
      driftPpm: null,
      maximumErrorUs: minimumTransportErrorUs,
    };
  }
  const slopeUsPerSecond = (sumW * sumWTO - sumWT * sumWO) / denominator;
  const interceptUs = (sumWO - slopeUsPerSecond * sumWT) / sumW;
  const predict = (hostUs: number): number =>
    interceptUs + slopeUsPerSecond * ((hostUs - originUs) / 1_000_000);
  const maximumResidualUs = selected.reduce(
    (maximum, observation) => Math.max(
      maximum,
      Math.abs(observation.offsetUs - predict(observation.hostUs)),
    ),
    0,
  );
  return {
    offsetUs: predict(atHostUs),
    driftPpm: slopeUsPerSecond,
    maximumErrorUs: minimumTransportErrorUs + maximumResidualUs,
  };
};


const DEG_TO_RAD = Math.PI / 180;
const GYRO_LSB_PER_DPS_500 = 65.5;
const GYRO_LSB_PER_DPS_1000 = 32.8;
const GYRO_LSB_PER_DPS_2000 = 16.4;

export const rawGyroToRadiansPerSecond = (
  rawValue: number,
  deviceFamily: 'remus_blade' | 'remus_computer',
  configuredRangeDps?: number,
): number => rawValue /
  (configuredRangeDps === 2000
    ? GYRO_LSB_PER_DPS_2000
    : configuredRangeDps === 1000 || deviceFamily === 'remus_blade'
      ? GYRO_LSB_PER_DPS_1000
      : GYRO_LSB_PER_DPS_500) *
  DEG_TO_RAD;

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
  private readonly continuityTracker: StreamContinuityTracker;
  private readonly relayedContinuityTrackers = new Map<number, StreamContinuityTracker>();
  private readonly clockMappingEstimator: BoundedClockMappingEstimator;
  private eventEmitter: NativeEventEmitter | null = null;
  private isConnected = false;
  private readonly streamPacketDecoder = new RemusStreamPacketDecoder();
  private deviceInfo: RemusDeviceInfo | null = null;
  private clockSync: RemusClockSyncSnapshot | null = null;
  private clockObservations: ClockObservation[] = [];
  private sessionWorstCaseUncertaintyUs = 0;
  private currentDeviceBootId: number | null = null;
  private readonly clockSyncListeners: Set<() => void> = new Set();
  private clockSyncTimer: ReturnType<typeof setInterval> | null = null;
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
    const bladeIdentity = parseBladeIdentityHash(targetDeviceName);
    const canonicalSourceId = bladeIdentity !== null
      ? `blade:${bladeIdentity.toString(16).padStart(8, '0').toLowerCase()}`
      : `${deviceFamily === 'remus_computer' ? 'computer' : 'blade'}:${targetDeviceId}`;
    this.continuityTracker = new StreamContinuityTracker(canonicalSourceId, 'activity:pending');
    this.clockMappingEstimator = new BoundedClockMappingEstimator({
      sourceId: canonicalSourceId,
      comparisonClockDomainId: 'phone:primary:monotonic',
    });
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
      receivedAtMonotonicUs?: number;
    };
    if (!data?.deviceId || data.deviceId !== this.targetDeviceId) {
      return;
    }
    if (data?.deviceName) {
      this.targetDeviceName = data.deviceName;
    }
    const characteristicUuid = data.characteristicUuid?.toLowerCase();
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
      if (characteristicUuid === REMUS_DEVICE_INFO_CHARACTERISTIC_UUID) {
        this.deviceInfo = decodeRemusDeviceInfo(Buffer.from(data.rawBase64, 'base64'));
        if (this.deviceInfo?.deviceBootId !== undefined && this.deviceInfo.deviceBootId !== null) {
          if (this.currentDeviceBootId !== null && this.currentDeviceBootId !== this.deviceInfo.deviceBootId) {
            this.clockObservations = [];
            this.sessionWorstCaseUncertaintyUs = 0;
            this.clockSync = null;
            this.clockMappingEstimator.invalidate('boot_change');
          }
          this.currentDeviceBootId = this.deviceInfo.deviceBootId;
        }
      } else if (characteristicUuid === REMUS_CLOCK_SYNC_CHARACTERISTIC_UUID) {
        this.handleClockSyncPacket(data.rawBase64, data.receivedAtMonotonicUs);
      } else if (characteristicUuid === REMUS_IMU_STREAM_CHARACTERISTIC_UUID) {
        this.handleLiveImuPacket(data.rawBase64);
      } else if (characteristicUuid === REMUS_BLADE_RELAY_CHARACTERISTIC_UUID) {
        this.handleRelayedImuPacket(data.rawBase64);
      } else {
        this.handleBinaryChunk(data.rawBase64);
      }
    }
  }

  getDeviceInfo(): RemusDeviceInfo | null {
    return this.deviceInfo;
  }

  getTelemetryAccounting(sourceIdentityHash?: number): TelemetryAccounting {
    if (sourceIdentityHash !== undefined) {
      const tracker = this.relayedContinuityTrackers.get(sourceIdentityHash);
      if (tracker) return tracker.getAccounting();
    }
    return this.continuityTracker.getAccounting();
  }

  getContinuityTracker(): StreamContinuityTracker {
    return this.continuityTracker;
  }

  getRelayedContinuityTracker(sourceIdentityHash: number): StreamContinuityTracker | undefined {
    return this.relayedContinuityTrackers.get(sourceIdentityHash);
  }

  getAllRecordings(): CanonicalRecording[] {
    const list = [...this.continuityTracker.getAllRecordings()];
    for (const tracker of this.relayedContinuityTrackers.values()) {
      list.push(...tracker.getAllRecordings());
    }
    return list;
  }

  getClockSync(): RemusClockSyncSnapshot | null {
    return this.clockSync;
  }

  getClockMappingEstimator(): BoundedClockMappingEstimator {
    return this.clockMappingEstimator;
  }

  onClockSyncResponse(listener: () => void): () => void {
    this.clockSyncListeners.add(listener);
    return () => {
      this.clockSyncListeners.delete(listener);
    };
  }

  private handleClockSyncPacket(rawBase64: string, hostReceiveUs?: number): void {
    const packet = Buffer.from(rawBase64, 'base64');
    if (
      (packet.length !== 30 && packet.length !== 34) ||
      (packet[0] !== 1 && packet[0] !== 2) ||
      packet[1] !== 0x04 ||
      hostReceiveUs === undefined
    ) return;
    const hostSendUs = Number(packet.readBigUInt64LE(6));
    const sensorReceiveUs = Number(packet.readBigUInt64LE(14));
    const sensorSendUs = Number(packet.readBigUInt64LE(22));
    const deviceBootId = packet.length >= 34 ? packet.readUInt32LE(30) : undefined;

    if (deviceBootId !== undefined) {
      if (this.currentDeviceBootId !== null && this.currentDeviceBootId !== deviceBootId) {
        // Sensor rebooted! Clear old observations and reset session uncertainty.
        this.clockObservations = [];
        this.sessionWorstCaseUncertaintyUs = 0;
        this.clockSync = null;
        this.clockMappingEstimator.invalidate('boot_change');
      }
      this.currentDeviceBootId = deviceBootId;
    }

    const roundTripUs = hostReceiveUs - hostSendUs - (sensorSendUs - sensorReceiveUs);
    if (roundTripUs < 0 || roundTripUs > 200_000) return;
    const offsetUs = ((sensorReceiveUs - hostSendUs) + (sensorSendUs - hostReceiveUs)) / 2;
    const currentOffsetUncertaintyUs = roundTripUs / 2;
    this.sessionWorstCaseUncertaintyUs = Math.max(
      this.sessionWorstCaseUncertaintyUs,
      currentOffsetUncertaintyUs,
    );

    this.clockObservations.push({ hostUs: hostReceiveUs, offsetUs, roundTripUs });
    if (this.clockObservations.length > 60) {
      this.clockObservations.shift();
    }

    this.clockMappingEstimator.addObservation({
      t1HostSendUs: hostSendUs,
      t2SensorReceiveUs: sensorReceiveUs,
      t3SensorSendUs: sensorSendUs,
      t4HostReceiveUs: hostReceiveUs,
      deviceBootId,
    });

    const mapping = fitBoundedClockMapping(this.clockObservations, hostReceiveUs);

    let syncQuality: 'qualified' | 'approximate' | 'low_confidence' = 'low_confidence';
    if (mapping.maximumErrorUs <= 5_000 && this.clockObservations.length >= 3) {
      syncQuality = 'qualified';
    } else if (mapping.maximumErrorUs <= 25_000) {
      syncQuality = 'approximate';
    }

    this.clockSync = {
      estimatedClockOffsetUs: mapping.offsetUs,
      roundTripUs,
      clockDriftPpm: mapping.driftPpm,
      lastSyncTimestampUs: hostReceiveUs,
      maximumErrorUs: mapping.maximumErrorUs,
      currentOffsetUncertaintyUs,
      sessionWorstCaseUncertaintyUs: this.sessionWorstCaseUncertaintyUs,
      syncQuality,
      observationCount: this.clockObservations.length,
      deviceBootId: this.currentDeviceBootId ?? undefined,
    };
    this.clockSyncListeners.forEach(listener => listener());
  }

  private handleRelayedImuPacket(rawBase64: string): void {
    const relayed = this.relayedStreamPacketDecoder.ingestBase64(rawBase64);
    if (!relayed) return;
    const sourceId = `blade:${relayed.sourceIdentityHash.toString(16).padStart(8, '0').toLowerCase()}`;
    let tracker = this.relayedContinuityTrackers.get(relayed.sourceIdentityHash);
    if (!tracker) {
      tracker = new StreamContinuityTracker(sourceId, this.continuityTracker.activityId);
      this.relayedContinuityTrackers.set(relayed.sourceIdentityHash, tracker);
    }
    const { recording } = tracker.ingestBatch(relayed.batch, Date.now(), null);
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
          x: rawGyroToRadiansPerSecond(raw.rawGyro.x, 'remus_blade'),
          y: rawGyroToRadiansPerSecond(raw.rawGyro.y, 'remus_blade'),
          z: rawGyroToRadiansPerSecond(raw.rawGyro.z, 'remus_blade'),
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
          recordingId: recording.recordingId,
          clockDomainId: recording.clockDomainId,
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
    const { newRecordingStarted, recording } = this.continuityTracker.ingestBatch(
      batch,
      Date.now(),
      this.currentDeviceBootId,
    );
    this.clockMappingEstimator.setRecordingContext(
      recording.recordingId,
      recording.clockDomainId,
      this.currentDeviceBootId ?? undefined,
    );
    if (newRecordingStarted && recording.startReason !== 'normal_start') {
      this.clockSync = null;
      this.clockObservations = [];
      this.clockMappingEstimator.invalidate('discontinuity');
    }
    for (const raw of batch.samples) {
      const missingSamplesBefore = this.expectedLiveSampleSequence === null
        ? 0
        : Math.max(0, raw.sampleSequence - this.expectedLiveSampleSequence);
      this.expectedLiveSampleSequence = raw.sampleSequence + 1;
      const accelLsbPerG = this.deviceInfo?.accelerometerRangeG === 16 ? 2048 : 4096;
      const converted = this.clockMappingEstimator.convertSensorTimeToComparisonUs(raw.nativeTimestampUs);
      const sample: SensorSample = {
        nativeTimestamp: raw.nativeTimestampUs / 1000,
        deviceId: this.targetDeviceId,
        deviceFamily: this.deviceFamily,
        accelerationIncludingGravityG: {
          x: raw.rawAccel.x / accelLsbPerG,
          y: raw.rawAccel.y / accelLsbPerG,
          z: raw.rawAccel.z / accelLsbPerG,
        },
        rotationRateRadiansPerSecond: {
          x: rawGyroToRadiansPerSecond(raw.rawGyro.x, this.deviceFamily, this.deviceInfo?.gyroscopeRangeDps ?? undefined),
          y: rawGyroToRadiansPerSecond(raw.rawGyro.y, this.deviceFamily, this.deviceInfo?.gyroscopeRangeDps ?? undefined),
          z: rawGyroToRadiansPerSecond(raw.rawGyro.z, this.deviceFamily, this.deviceInfo?.gyroscopeRangeDps ?? undefined),
        },
        sourcePayload: {
          batchSequence: batch.batchSequence,
          sampleSequence: raw.sampleSequence,
          nativeTimestampUs: raw.nativeTimestampUs,
          commonTimelineTimestampUs: converted?.comparisonTimestampUs,
          clockMappingId: converted?.clockMappingId,
          clockMaximumErrorUs: converted?.maximumErrorUs ?? this.clockSync?.maximumErrorUs,
          clockSyncQuality: converted?.mappingQuality ?? this.clockSync?.syncQuality,
          sampleStatus: raw.status,
          missingSamplesBefore,
          recordingId: recording.recordingId,
          clockDomainId: recording.clockDomainId,
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
    if (this.isConnected) {
      this.triggerInitialClockSyncBurst();
      if (!this.clockSyncTimer) {
        this.clockSyncTimer = setInterval(() => {
          this.requestClockSync().catch(() => undefined);
        }, 10_000);
      }
    } else {
      if (this.clockSyncTimer) {
        clearInterval(this.clockSyncTimer);
        this.clockSyncTimer = null;
      }
      this.clockSync = null;
      this.clockObservations = [];
      this.clockMappingEstimator.invalidate('disconnect');
    }
    this.notifyDeviceState(state);
  }

  private triggerInitialClockSyncBurst(count = 8, intervalMs = 250): void {
    let sent = 0;
    const burst = () => {
      if (!this.isConnected || sent >= count) return;
      sent += 1;
      this.requestClockSync().catch(() => undefined);
      setTimeout(burst, intervalMs);
    };
    burst();
  }

  async requestClockSync(): Promise<boolean> {
    if (!this.nativeBridge?.requestClockSync) {
      return false;
    }
    try {
      const res = await this.nativeBridge.requestClockSync(this.targetDeviceId);
      return res ?? true;
    } catch {
      // A missed observation lowers coverage; it must not interrupt acquisition.
      return false;
    }
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
    this.streamPacketDecoder.beginRecording();
    this.relayedStreamPacketDecoder.beginRecording();
    this.expectedLiveSampleSequence = null;
    this.expectedRelayedSampleSequence.clear();
    this.clockSync = null;
    this.clockObservations = [];
    this.clockMappingEstimator.invalidate('begin_recording');
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

    let liveSpmAvailabilityState: PresentationAvailabilityState | undefined;
    let liveSpmInternalReason: string | undefined;
    let liveSpmAvailabilityReason: PresentationAvailabilityReason | undefined;
    let liveSpmSupportedNativeTimestamp: number | undefined;

    const rawState = parts[35]?.trim().toLowerCase();
    if (rawState === 'available' || rawState === 'held' || rawState === 'unavailable') {
      liveSpmAvailabilityState = rawState;
      liveSpmInternalReason = parts[36]?.trim() || undefined;
      liveSpmAvailabilityReason = mapEstimatorReasonToPresentationAvailabilityReason(
        liveSpmAvailabilityState,
        liveSpmInternalReason,
      );
      const supportedMs = parts[37] !== undefined ? parseInt(parts[37], 10) : undefined;
      if (Number.isFinite(supportedMs) && supportedMs! > 0) {
        liveSpmSupportedNativeTimestamp = supportedMs;
      }
    } else {
      // Legacy backward compatibility
      if (liveSpm !== undefined && liveSpm > 0) {
        liveSpmAvailabilityState = 'available';
        liveSpmAvailabilityReason = 'available';
        liveSpmSupportedNativeTimestamp = timestampMs;
      } else {
        liveSpmAvailabilityState = 'unavailable';
        liveSpmAvailabilityReason = 'source_unavailable';
      }
    }

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
      liveSpmAvailabilityState,
      liveSpmInternalReason,
      liveSpmAvailabilityReason,
      liveSpmSupportedNativeTimestamp,
      clockDomainId: this.continuityTracker.getCurrentRecording()?.clockDomainId,
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
        liveSpmAvailabilityState: snapshot.liveSpmAvailabilityState,
        liveSpmAvailabilityReason: snapshot.liveSpmAvailabilityReason,
        liveSpmInternalReason: snapshot.liveSpmInternalReason,
        liveSpmSupportedNativeTimestamp: snapshot.liveSpmSupportedNativeTimestamp,
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
    if (this.clockSyncTimer) clearInterval(this.clockSyncTimer);
    this.clockSyncTimer = null;
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

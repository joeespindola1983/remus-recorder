import {NativeEventEmitter, NativeModules} from 'react-native';
import {BoatMotionObservation} from '../motion/BoatMotionDetector';

export interface RecordingStartResult {
  activityId: string;
  activityCorrelationId: string;
  recordingIdsBySource: Record<string, string>;
  artifactDirectory: string;
}

export type RecordingStartReason =
  | 'normal_start'
  | 'device_restarted'
  | 'suspected_clock_discontinuity'
  | 'stream_reconnect'
  | 'stream_start';

export type RecordingEndReason =
  | 'normal_stop'
  | 'device_restarted'
  | 'suspected_clock_discontinuity'
  | 'stream_disconnect'
  | 'stream_timeout'
  | 'interrupted';

export interface ManifestRecordingPart {
  filename: string;
  byteLength: number;
  sha256: string;
  stream?: string;
  lineCount?: number;
  recordingId?: string;
  sourceId?: string;
}

export interface CanonicalRecording {
  recordingId: string;
  sourceId: string;
  clockDomainId: string;
  deviceBootId?: string | null;
  startReason: RecordingStartReason;
  endReason?: RecordingEndReason | null;
  startedAtNativeMicroseconds?: string | null;
  endedAtNativeMicroseconds?: string | null;
  startedAtReceiptEpochMilliseconds: number;
  endedAtReceiptEpochMilliseconds?: number | null;
  sampleCounts: Record<string, number>;
  configuration?: Record<string, unknown>;
  parts?: ManifestRecordingPart[];
}

export interface RecordingManifest extends RecordingStartResult {
  schemaVersion?: '1.0.0' | '1.1.0';
  producer?: string;
  status: 'recording' | 'finalized' | 'interrupted';
  startedAtEpochMilliseconds: number;
  endedAtEpochMilliseconds?: number;
  sampleCounts: Record<string, number>;
  recordings?: CanonicalRecording[];
  telemetryDiagnosticsBySource?: Record<string, unknown>;
  parts?: ManifestRecordingPart[];
  failureMessage?: string;
}

export interface RecordingProjection {
  elapsedSeconds: number;
  motionSampleCount: number;
  locationSampleCount: number;
  watchHeartRateSampleCount: number;
  remusBladeLiveSampleCount: number;
  groundSpeedMetersPerSecond?: number;
  horizontalAccuracyMeters?: number;
  distanceMeters?: number;
  accelerationIncludingGravityG?: number;
  locationSourceTimeEpochMs?: number;
  speedAccuracyMetersPerSecond?: number;
  courseAccuracyDegrees?: number;
  courseDegrees?: number;
  locationFreshnessMs?: number;
}

export interface RecordedWorkoutSummary {
  activityId: string;
  status: 'finalized' | 'interrupted';
  startedAtEpochMilliseconds: number;
  endedAtEpochMilliseconds?: number;
  durationSeconds: number;
  sourceIds: string[];
  sampleCounts: Record<string, number>;
}

export type PresentationAvailabilityState = 'available' | 'held' | 'unavailable';

export type PresentationAvailabilityReason =
  | 'available'
  | 'source_unavailable'
  | 'below_movement_threshold'
  | 'telemetry_timeout'
  | 'held_last_supported_value'
  | 'ambiguous_periodicity'
  | 'confirmed_stop'
  | 'stale_location'
  | 'poor_speed_accuracy';

export interface LiveMetricPresentation {
  presentationId?: string;
  surfaceId?: string;
  metricIdentifier: 'paceSecondsPer500Meters' | 'strokeRateSpm';
  numericValue: number | null;
  canonicalUnit: 's/500m' | 'strokes/min';
  renderedText: string;
  availabilityState: PresentationAvailabilityState;
  availabilityReason?: PresentationAvailabilityReason | string;
  sourceId: string;
  recordingId?: string;
  supportedAtEpochMilliseconds?: number;
  supportedAtNativeTimestamp?: number;
  clockDomainId?: string;
  presentedAtEpochMilliseconds: number;
  algorithmVersion?: string;
  presentationPolicyVersion?: string;
}

export interface NativeRecordingBridge {
  startRecording(options: {sourceIds: string[]}): Promise<RecordingStartResult>;
  stopRecording(): Promise<RecordingManifest>;
  setTelemetryDiagnostics?(options: {bySource: Record<string, unknown>}): Promise<boolean>;
  getRecordingState(): Promise<{
    isRecording: boolean;
    activityId?: string;
    artifactDirectory?: string;
  }>;
  requestLocationPermission?(): Promise<string>;
  getLocationPermissionStatus?(): Promise<string>;
  exportRecording?(options: {activityId?: string}): Promise<{zipPath: string; shared: boolean}>;
  listRecordings?(): Promise<RecordedWorkoutSummary[]>;
  deleteRecording?(activityId: string): Promise<boolean>;
  saveBladeRawBinary?(activityId: string, base64Data: string, rawCsv?: string): Promise<boolean>;
  recordSourceLifecycleEvent?(options: {
    sourceId: string;
    event: 'source_interrupted' | 'source_recovered';
    reason?: 'telemetry_timeout';
    elapsedSeconds: number;
  }): Promise<boolean>;
  appendLiveMetricPresentation?(presentation: LiveMetricPresentation): Promise<boolean>;
  appendBoatMotionObservation?(observation: BoatMotionObservation): Promise<boolean>;
  getPhoneHardwareProfile?(): Promise<{
    hasGps?: boolean;
    hasAccelerometer?: boolean;
    hasGyroscope?: boolean;
    hasMagnetometer?: boolean;
    hasBarometer?: boolean;
  }>;
  getBatteryLevel?(): Promise<number | null>;
  getCurrentLocationAccuracy?(): Promise<number | null>;
  addListener?(eventName: string): void;
  removeListeners?(count: number): void;
}

export class RecordingService {
  private readonly bridge?: NativeRecordingBridge;
  private readonly emitter?: NativeEventEmitter;

  constructor(bridge: NativeRecordingBridge | undefined = NativeModules.RemusRecordingBridge) {
    this.bridge = bridge;
    this.emitter = bridge ? new NativeEventEmitter(bridge as never) : undefined;
  }

  start(sourceIds: string[]): Promise<RecordingStartResult> {
    if (!this.bridge) {
      return Promise.reject(new Error('Native recording is unavailable'));
    }
    return this.bridge.startRecording({sourceIds});
  }

  stop(): Promise<RecordingManifest> {
    if (!this.bridge) {
      return Promise.reject(new Error('Native recording is unavailable'));
    }
    return this.bridge.stopRecording();
  }

  setTelemetryDiagnostics(bySource: Record<string, unknown>): Promise<boolean> {
    return this.bridge?.setTelemetryDiagnostics?.({bySource}) ?? Promise.resolve(false);
  }

  exportRecording(activityId?: string): Promise<{zipPath: string; shared: boolean}> {
    if (!this.bridge?.exportRecording) {
      return Promise.reject(new Error('Native recording is unavailable'));
    }
    return this.bridge.exportRecording({activityId});
  }

  listRecordings(): Promise<RecordedWorkoutSummary[]> {
    if (!this.bridge?.listRecordings) return Promise.resolve([]);
    return this.bridge.listRecordings();
  }

  deleteRecording(activityId: string): Promise<boolean> {
    if (!this.bridge?.deleteRecording) {
      return Promise.resolve(false);
    }
    return this.bridge.deleteRecording(activityId);
  }

  saveBladeRaw(
    activityId: string,
    base64Data: string,
    rawCsv?: string,
  ): Promise<boolean> {
    if (!this.bridge?.saveBladeRawBinary) {
      return Promise.resolve(false);
    }
    return this.bridge.saveBladeRawBinary(activityId, base64Data, rawCsv);
  }

  recordSourceLifecycleEvent(options: {
    sourceId: string;
    event: 'source_interrupted' | 'source_recovered';
    reason?: 'telemetry_timeout';
    elapsedSeconds: number;
  }): Promise<boolean> {
    if (!this.bridge?.recordSourceLifecycleEvent) return Promise.resolve(false);
    return this.bridge.recordSourceLifecycleEvent(options);
  }

  appendLiveMetricPresentation(presentation: LiveMetricPresentation): Promise<boolean> {
    return this.bridge?.appendLiveMetricPresentation?.(presentation) ?? Promise.resolve(false);
  }

  appendBoatMotionObservation(observation: BoatMotionObservation): Promise<boolean> {
    return this.bridge?.appendBoatMotionObservation?.(observation) ?? Promise.resolve(false);
  }

  getState(): Promise<{isRecording: boolean; activityId?: string; artifactDirectory?: string}> {
    if (!this.bridge) return Promise.resolve({isRecording: false});
    return this.bridge.getRecordingState();
  }

  onUpdate(listener: (projection: RecordingProjection) => void): () => void {
    if (!this.emitter) return () => undefined;
    const subscription = this.emitter.addListener(
      'onRecordingUpdate',
      payload => listener(payload as unknown as RecordingProjection),
    );
    return () => subscription.remove();
  }
}

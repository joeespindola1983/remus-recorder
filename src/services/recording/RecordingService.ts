import {NativeEventEmitter, NativeModules} from 'react-native';

export interface RecordingStartResult {
  activityId: string;
  activityCorrelationId: string;
  recordingIdsBySource: Record<string, string>;
  artifactDirectory: string;
}

export interface RecordingManifest extends RecordingStartResult {
  status: 'finalized' | 'interrupted';
  startedAtEpochMilliseconds: number;
  endedAtEpochMilliseconds: number;
  sampleCounts: Record<string, number>;
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

export interface NativeRecordingBridge {
  startRecording(options: {sourceIds: string[]}): Promise<RecordingStartResult>;
  stopRecording(): Promise<RecordingManifest>;
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
      return Promise.reject(new Error('Native recording is unavailable'));
    }
    return this.bridge.deleteRecording(activityId);
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

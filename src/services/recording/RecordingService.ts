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

export interface NativeRecordingBridge {
  startRecording(options: {sourceIds: string[]}): Promise<RecordingStartResult>;
  stopRecording(): Promise<RecordingManifest>;
  getRecordingState(): Promise<{
    isRecording: boolean;
    activityId?: string;
    artifactDirectory?: string;
  }>;
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

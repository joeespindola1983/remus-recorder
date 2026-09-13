import {
  MeasurementIdentifier,
  SourceDescriptor,
} from '../../contracts/acquisition';

export type ActivityCapturePhase =
  | 'ready'
  | 'recording'
  | 'finalizing'
  | 'completed';
export type RecordingState =
  | 'preparing'
  | 'recording'
  | 'stopping'
  | 'finalized'
  | 'interrupted'
  | 'failed';
export type CaptureFinalizationReason =
  | 'app_stop'
  | 'local_stop'
  | 'user_power_off'
  | 'control_lease_expired'
  | 'power_depleted'
  | 'power_loss'
  | 'storage_exhausted';

export interface SourceCoverageSegment {
  startedAtElapsedSeconds: number;
  endedAtElapsedSeconds?: number;
}

export interface SourceReadinessSnapshot {
  sourceConnectionState: 'connected' | 'detected' | 'unavailable';
  batteryLevelPercent?: number;
  availableMeasurementIdentifiers: MeasurementIdentifier[];
  liveTelemetryState: 'qualified' | 'evaluation_pending' | 'unavailable';
}

export interface CaptureSourceState extends SourceDescriptor {
  required: boolean;
  readiness?: SourceReadinessSnapshot;
  recordingState?: RecordingState;
  finalizationReason?: CaptureFinalizationReason;
  coverageSegments: SourceCoverageSegment[];
}

export interface LiveCaptureMetrics {
  elapsedSeconds: number;
  strokeRateSpm?: number;
  paceSecondsPer500Meters?: number;
  groundSpeedMetersPerSecond?: number;
  heartRateBeatsPerMinute?: number;
  distanceMeters?: number;
}

export interface ActivityCaptureState {
  phase: ActivityCapturePhase;
  activityId?: string;
  activityCorrelationId?: string;
  sources: Record<string, CaptureSourceState>;
  metrics: LiveCaptureMetrics;
}

export type ActivityCaptureEvent =
  | {
      type: 'source_discovered';
      source: SourceDescriptor;
      required?: boolean;
      readiness?: SourceReadinessSnapshot;
    }
  | {
      type: 'capture_committed';
      activityId: string;
      activityCorrelationId: string;
      recordingIdsBySource: Record<string, string>;
    }
  | { type: 'metrics_updated'; metrics: Partial<LiveCaptureMetrics> }
  | {
      type: 'source_interrupted';
      sourceId: string;
      atElapsedSeconds: number;
      reason: Extract<
        CaptureFinalizationReason,
        'power_depleted' | 'power_loss' | 'storage_exhausted'
      >;
    }
  | { type: 'stop_requested' }
  | {
      type: 'source_finalized';
      sourceId: string;
      atElapsedSeconds: number;
      reason: CaptureFinalizationReason;
    };

const toRuntimeSource = (
  source: SourceDescriptor,
  required: boolean,
  readiness?: SourceReadinessSnapshot,
): CaptureSourceState => ({
  ...source,
  required,
  readiness,
  coverageSegments: [],
});

export const createInitialActivityCapture = (
  phoneSource: SourceDescriptor,
): ActivityCaptureState => ({
  phase: 'ready',
  sources: { [phoneSource.sourceId]: toRuntimeSource(phoneSource, true) },
  metrics: { elapsedSeconds: 0 },
});

const closeCoverage = (
  segments: SourceCoverageSegment[],
  atElapsedSeconds: number,
): SourceCoverageSegment[] =>
  segments.map((segment, index) =>
    index === segments.length - 1 && segment.endedAtElapsedSeconds === undefined
      ? { ...segment, endedAtElapsedSeconds: atElapsedSeconds }
      : segment,
  );

const isTerminal = (source: CaptureSourceState): boolean =>
  source.recordingId === undefined ||
  source.recordingState === 'finalized' ||
  source.recordingState === 'interrupted' ||
  source.recordingState === 'failed';

export const activityCaptureReducer = (
  state: ActivityCaptureState,
  event: ActivityCaptureEvent,
): ActivityCaptureState => {
  switch (event.type) {
    case 'source_discovered':
      return {
        ...state,
        sources: {
          ...state.sources,
          [event.source.sourceId]: toRuntimeSource(
            event.source,
            event.required ?? false,
            event.readiness,
          ),
        },
      };
    case 'capture_committed':
      return {
        ...state,
        phase: 'recording',
        activityId: event.activityId,
        activityCorrelationId: event.activityCorrelationId,
        sources: Object.fromEntries(
          Object.entries(state.sources).map(([sourceId, source]) => {
            const recordingId = event.recordingIdsBySource[sourceId];
            return [
              sourceId,
              recordingId
                ? {
                    ...source,
                    recordingId,
                    operationalState: 'capturing' as const,
                    recordingState: 'recording' as const,
                    coverageSegments: [{ startedAtElapsedSeconds: 0 }],
                  }
                : source,
            ];
          }),
        ),
      };
    case 'metrics_updated':
      return { ...state, metrics: { ...state.metrics, ...event.metrics } };
    case 'source_interrupted': {
      const source = state.sources[event.sourceId];
      if (!source) return state;
      return {
        ...state,
        sources: {
          ...state.sources,
          [event.sourceId]: {
            ...source,
            operationalState: 'unavailable',
            recordingState: 'interrupted',
            finalizationReason: event.reason,
            coverageSegments: closeCoverage(
              source.coverageSegments,
              event.atElapsedSeconds,
            ),
          },
        },
      };
    }
    case 'stop_requested':
      return {
        ...state,
        phase: 'finalizing',
        sources: Object.fromEntries(
          Object.entries(state.sources).map(([sourceId, source]) => [
            sourceId,
            source.recordingId && source.recordingState === 'recording'
              ? {
                  ...source,
                  operationalState: 'shutting_down' as const,
                  recordingState: 'stopping' as const,
                }
              : source,
          ]),
        ),
      };
    case 'source_finalized': {
      const source = state.sources[event.sourceId];
      if (!source) return state;
      const sources = {
        ...state.sources,
        [event.sourceId]: {
          ...source,
          operationalState: 'available_idle' as const,
          recordingState: 'finalized' as const,
          finalizationReason: event.reason,
          coverageSegments: closeCoverage(
            source.coverageSegments,
            event.atElapsedSeconds,
          ),
        },
      };
      return {
        ...state,
        phase: Object.values(sources).every(isTerminal)
          ? 'completed'
          : 'finalizing',
        sources,
      };
    }
  }
};

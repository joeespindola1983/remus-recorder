import {
  activityCaptureReducer,
  ActivityCaptureState,
  CaptureFinalizationReason,
  LiveCaptureMetrics,
  SourceReadinessSnapshot,
} from '../capture/ActivityCapture';

export type SimulatedTransportState =
  | 'connected'
  | 'disconnected'
  | 'disconnected_recovering';

export type SimulatedArtifactTransferStatus =
  | 'pending'
  | 'transferring'
  | 'paused'
  | 'blocked_storage'
  | 'transferred'
  | 'persisted_verified';

export interface SimulatedArtifactTransfer {
  artifactId: string;
  sourceId: string;
  recordingId: string;
  byteLength: string;
  transferredByteLength: string;
  status: SimulatedArtifactTransferStatus;
  acceptedRanges: Array<{
    offsetBytes: string;
    byteLength: string;
    contentSha256: string;
  }>;
}

export interface CaptureSimulationEvent {
  sequence: number;
  atElapsedSeconds: number;
  kind:
    | 'capture_committed'
    | 'time_advanced'
    | 'source_disconnected'
    | 'source_reconnected'
    | 'source_interrupted'
    | 'stop_requested'
    | 'source_finalized'
    | 'artifact_discovered'
    | 'artifact_transfer_progressed'
    | 'artifact_transfer_paused'
    | 'artifact_transfer_blocked_storage'
    | 'regenerable_data_evicted'
    | 'artifact_persistence_verified';
  sourceId?: string;
  artifactId?: string;
}

export interface CaptureSimulationState {
  nowElapsedSeconds: number;
  capture: ActivityCaptureState;
  sourceTransport: Record<string, SimulatedTransportState>;
  artifactTransfers: Record<string, SimulatedArtifactTransfer>;
  appStorage: SimulatedAppStorage;
  events: CaptureSimulationEvent[];
}

export interface SimulatedAppStorage {
  capacityByteLength: string;
  evidenceAndStagingByteLength: string;
  regenerableByteLength: string;
}

export type CaptureScenarioStep =
  | {
      type: 'commit_capture';
      activityId: string;
      activityCorrelationId: string;
      recordingIdsBySource: Record<string, string>;
    }
  | {type: 'advance_time'; seconds: number; metrics?: Omit<Partial<LiveCaptureMetrics>, 'elapsedSeconds'>}
  | {type: 'update_live_metrics'; metrics: Omit<Partial<LiveCaptureMetrics>, 'elapsedSeconds'>}
  | {type: 'disconnect_source'; sourceId: string}
  | {type: 'reconnect_source'; sourceId: string}
  | {
      type: 'interrupt_source';
      sourceId: string;
      reason: Extract<CaptureFinalizationReason, 'power_depleted' | 'power_loss' | 'storage_exhausted'>;
    }
  | {type: 'request_stop'}
  | {type: 'finalize_source'; sourceId: string; reason: CaptureFinalizationReason}
  | {
      type: 'artifact_discovered';
      artifactId: string;
      sourceId: string;
      recordingId: string;
      byteLength: string;
    }
  | {
      type: 'transfer_artifact_range';
      artifactId: string;
      offsetBytes: string;
      byteLength: string;
      contentSha256: string;
    }
  | {type: 'evict_regenerable_data'; byteLength: string}
  | {type: 'verify_artifact_persistence'; artifactId: string}
  | {
      type: 'update_source_readiness';
      sourceId: string;
      readiness: SourceReadinessSnapshot;
    }
  | {type: 'reset_to_ready'};

const decimalInteger = (value: string, field: string): bigint => {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${field} must be an unsigned decimal integer string`);
  }
  return BigInt(value);
};

const event = (
  state: CaptureSimulationState,
  kind: CaptureSimulationEvent['kind'],
  details: Pick<CaptureSimulationEvent, 'sourceId' | 'artifactId'> = {},
): CaptureSimulationEvent[] => [
  ...state.events,
  {
    sequence: state.events.length + 1,
    atElapsedSeconds: state.nowElapsedSeconds,
    kind,
    ...details,
  },
];

export const createCaptureSimulation = (
  capture: ActivityCaptureState,
  appStorage: SimulatedAppStorage = {
    capacityByteLength: '9223372036854775807',
    evidenceAndStagingByteLength: '0',
    regenerableByteLength: '0',
  },
): CaptureSimulationState => {
  const capacity = decimalInteger(appStorage.capacityByteLength, 'storage capacityByteLength');
  const evidence = decimalInteger(
    appStorage.evidenceAndStagingByteLength,
    'storage evidenceAndStagingByteLength',
  );
  const regenerable = decimalInteger(
    appStorage.regenerableByteLength,
    'storage regenerableByteLength',
  );
  if (evidence + regenerable > capacity) {
    throw new Error('initial app storage usage exceeds capacity');
  }
  return {
    nowElapsedSeconds: capture.metrics.elapsedSeconds,
    capture,
    sourceTransport: Object.fromEntries(
      Object.keys(capture.sources).map(sourceId => [sourceId, 'connected' as const]),
    ),
    artifactTransfers: {},
    appStorage,
    events: [],
  };
};

const requireSource = (state: CaptureSimulationState, sourceId: string) => {
  const source = state.capture.sources[sourceId];
  if (!source) throw new Error(`unknown source ${sourceId}`);
  return source;
};

const requireArtifact = (state: CaptureSimulationState, artifactId: string) => {
  const artifact = state.artifactTransfers[artifactId];
  if (!artifact) throw new Error(`unknown artifact ${artifactId}`);
  return artifact;
};

export const applyCaptureScenarioStep = (
  state: CaptureSimulationState,
  step: CaptureScenarioStep,
): CaptureSimulationState => {
  switch (step.type) {
    case 'reset_to_ready':
      return {
        ...state,
        nowElapsedSeconds: 0,
        capture: {
          phase: 'ready',
          metrics: {elapsedSeconds: 0},
          sources: Object.fromEntries(
            Object.entries(state.capture.sources).map(([sourceId, source]) => [
              sourceId,
              {
                ...source,
                operationalState:
                  source.readiness?.sourceConnectionState === 'unavailable'
                    ? 'unavailable' as const
                    : 'available_idle' as const,
                recordingId: undefined,
                recordingState: undefined,
                finalizationReason: undefined,
                coverageSegments: [],
              },
            ]),
          ),
        },
        artifactTransfers: {},
        events: [],
      };
    case 'commit_capture':
      return {
        ...state,
        capture: activityCaptureReducer(state.capture, {
          type: 'capture_committed',
          activityId: step.activityId,
          activityCorrelationId: step.activityCorrelationId,
          recordingIdsBySource: step.recordingIdsBySource,
        }),
        events: event(state, 'capture_committed'),
      };
    case 'advance_time': {
      if (!Number.isSafeInteger(step.seconds) || step.seconds < 0) {
        throw new Error('advance_time seconds must be a non-negative safe integer');
      }
      const nowElapsedSeconds = state.nowElapsedSeconds + step.seconds;
      const advanced = {...state, nowElapsedSeconds};
      return {
        ...advanced,
        capture: activityCaptureReducer(state.capture, {
          type: 'metrics_updated',
          metrics: {...step.metrics, elapsedSeconds: nowElapsedSeconds},
        }),
        events: event(advanced, 'time_advanced'),
      };
    }
    case 'update_live_metrics':
      return {
        ...state,
        capture: activityCaptureReducer(state.capture, {
          type: 'metrics_updated',
          metrics: step.metrics,
        }),
      };
    case 'disconnect_source': {
      const source = requireSource(state, step.sourceId);
      const sourceTransport: SimulatedTransportState =
        source.recordingState === 'recording' && source.capabilities.storeAndForward
          ? 'disconnected_recovering'
          : 'disconnected';
      let events = event(state, 'source_disconnected', {sourceId: step.sourceId});
      const artifactTransfers = Object.fromEntries(
        Object.entries(state.artifactTransfers).map(([artifactId, artifact]) => {
          if (artifact.sourceId !== step.sourceId || artifact.status !== 'transferring') {
            return [artifactId, artifact];
          }
          events = [
            ...events,
            {
              sequence: events.length + 1,
              atElapsedSeconds: state.nowElapsedSeconds,
              kind: 'artifact_transfer_paused' as const,
              sourceId: step.sourceId,
              artifactId,
            },
          ];
          return [artifactId, {...artifact, status: 'paused' as const}];
        }),
      );
      return {
        ...state,
        sourceTransport: {...state.sourceTransport, [step.sourceId]: sourceTransport},
        artifactTransfers,
        events,
      };
    }
    case 'reconnect_source':
      requireSource(state, step.sourceId);
      return {
        ...state,
        sourceTransport: {...state.sourceTransport, [step.sourceId]: 'connected'},
        events: event(state, 'source_reconnected', {sourceId: step.sourceId}),
      };
    case 'interrupt_source':
      requireSource(state, step.sourceId);
      return {
        ...state,
        capture: activityCaptureReducer(state.capture, {
          type: 'source_interrupted',
          sourceId: step.sourceId,
          atElapsedSeconds: state.nowElapsedSeconds,
          reason: step.reason,
        }),
        events: event(state, 'source_interrupted', {sourceId: step.sourceId}),
      };
    case 'request_stop':
      return {
        ...state,
        capture: activityCaptureReducer(state.capture, {type: 'stop_requested'}),
        events: event(state, 'stop_requested'),
      };
    case 'finalize_source':
      requireSource(state, step.sourceId);
      return {
        ...state,
        capture: activityCaptureReducer(state.capture, {
          type: 'source_finalized',
          sourceId: step.sourceId,
          atElapsedSeconds: state.nowElapsedSeconds,
          reason: step.reason,
        }),
        events: event(state, 'source_finalized', {sourceId: step.sourceId}),
      };
    case 'artifact_discovered': {
      requireSource(state, step.sourceId);
      decimalInteger(step.byteLength, 'artifact byteLength');
      const existing = state.artifactTransfers[step.artifactId];
      if (existing) {
        if (
          existing.sourceId === step.sourceId &&
          existing.recordingId === step.recordingId &&
          existing.byteLength === step.byteLength
        ) {
          return state;
        }
        throw new Error(`conflicting artifact ${step.artifactId}`);
      }
      return {
        ...state,
        artifactTransfers: {
          ...state.artifactTransfers,
          [step.artifactId]: {
            artifactId: step.artifactId,
            sourceId: step.sourceId,
            recordingId: step.recordingId,
            byteLength: step.byteLength,
            transferredByteLength: '0',
            status: 'pending',
            acceptedRanges: [],
          },
        },
        events: event(state, 'artifact_discovered', {
          sourceId: step.sourceId,
          artifactId: step.artifactId,
        }),
      };
    }
    case 'transfer_artifact_range': {
      const artifact = requireArtifact(state, step.artifactId);
      if (state.sourceTransport[artifact.sourceId] !== 'connected') {
        throw new Error(`${artifact.sourceId} is not connected`);
      }
      if (!/^[a-fA-F0-9]{64}$/.test(step.contentSha256)) {
        throw new Error('transfer range contentSha256 must be a SHA-256 hex digest');
      }
      const offset = decimalInteger(step.offsetBytes, 'transfer offsetBytes');
      const increment = decimalInteger(step.byteLength, 'transfer byteLength');
      if (increment === 0n) throw new Error('transfer byteLength must be greater than zero');
      const total = decimalInteger(artifact.byteLength, 'artifact byteLength');
      const currentOffset = decimalInteger(
        artifact.transferredByteLength,
        'transferred byteLength',
      );
      const replay = artifact.acceptedRanges.find(range =>
        range.offsetBytes === step.offsetBytes && range.byteLength === step.byteLength,
      );
      if (replay) {
        if (replay.contentSha256 !== step.contentSha256) {
          throw new Error(`${artifact.artifactId} replay digest does not match accepted range`);
        }
        return state;
      }
      if (offset !== currentOffset) {
        throw new Error(`${artifact.artifactId} expected offset ${currentOffset.toString()}`);
      }
      const transferred = currentOffset + increment;
      if (transferred > total) throw new Error(`${artifact.artifactId} transfer exceeds byteLength`);
      const capacity = decimalInteger(state.appStorage.capacityByteLength, 'storage capacityByteLength');
      const evidence = decimalInteger(
        state.appStorage.evidenceAndStagingByteLength,
        'storage evidenceAndStagingByteLength',
      );
      const regenerable = decimalInteger(
        state.appStorage.regenerableByteLength,
        'storage regenerableByteLength',
      );
      if (evidence + regenerable + increment > capacity) {
        return {
          ...state,
          artifactTransfers: {
            ...state.artifactTransfers,
            [artifact.artifactId]: {...artifact, status: 'blocked_storage'},
          },
          events: event(state, 'artifact_transfer_blocked_storage', {
            sourceId: artifact.sourceId,
            artifactId: artifact.artifactId,
          }),
        };
      }
      const updated: SimulatedArtifactTransfer = {
        ...artifact,
        transferredByteLength: transferred.toString(),
        status: transferred === total ? 'transferred' : 'transferring',
        acceptedRanges: [...artifact.acceptedRanges, {
          offsetBytes: step.offsetBytes,
          byteLength: step.byteLength,
          contentSha256: step.contentSha256,
        }],
      };
      return {
        ...state,
        artifactTransfers: {...state.artifactTransfers, [artifact.artifactId]: updated},
        appStorage: {
          ...state.appStorage,
          evidenceAndStagingByteLength: (evidence + increment).toString(),
        },
        events: event(state, 'artifact_transfer_progressed', {
          sourceId: artifact.sourceId,
          artifactId: artifact.artifactId,
        }),
      };
    }
    case 'evict_regenerable_data': {
      const requested = decimalInteger(step.byteLength, 'eviction byteLength');
      const regenerable = decimalInteger(
        state.appStorage.regenerableByteLength,
        'storage regenerableByteLength',
      );
      const evicted = requested > regenerable ? regenerable : requested;
      return {
        ...state,
        appStorage: {
          ...state.appStorage,
          regenerableByteLength: (regenerable - evicted).toString(),
        },
        events: event(state, 'regenerable_data_evicted'),
      };
    }
    case 'verify_artifact_persistence': {
      const artifact = requireArtifact(state, step.artifactId);
      if (artifact.status === 'persisted_verified') return state;
      if (artifact.transferredByteLength !== artifact.byteLength) {
        throw new Error(`${artifact.artifactId} is not fully transferred`);
      }
      return {
        ...state,
        artifactTransfers: {
          ...state.artifactTransfers,
          [artifact.artifactId]: {...artifact, status: 'persisted_verified'},
        },
        events: event(state, 'artifact_persistence_verified', {
          sourceId: artifact.sourceId,
          artifactId: artifact.artifactId,
        }),
      };
    }
    case 'update_source_readiness': {
      const source = requireSource(state, step.sourceId);
      const isUnavailable = step.readiness.sourceConnectionState === 'unavailable';
      const updatedOperationalState = isUnavailable
        ? 'unavailable'
        : source.operationalState === 'unavailable'
          ? 'available_idle'
          : source.operationalState;
      return {
        ...state,
        capture: {
          ...state.capture,
          sources: {
            ...state.capture.sources,
            [step.sourceId]: {
              ...source,
              operationalState: updatedOperationalState,
              readiness: step.readiness,
            },
          },
        },
      };
    }
  }
};

export const runCaptureScenario = (
  initialState: CaptureSimulationState,
  steps: readonly CaptureScenarioStep[],
): CaptureSimulationState => steps.reduce(applyCaptureScenarioStep, initialState);

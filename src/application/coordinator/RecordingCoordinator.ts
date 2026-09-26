import {CaptureFinalizationReason} from '../capture/ActivityCapture';
import {SourceDescriptor} from '../../contracts/acquisition';

export type CommandApplicationResult = 'accepted' | 'rejected' | 'already_applied';

export interface SourceCommandPlan {
  recordingId: string;
  prepareCommandId: string;
  startCommandId: string;
  stopCommandId: string;
}

export type CoordinatedSourceLifecycle =
  | 'idle'
  | 'prepare_pending'
  | 'prepared'
  | 'start_pending'
  | 'recording'
  | 'stop_pending'
  | 'finalizing'
  | 'finalized'
  | 'interrupted'
  | 'excluded'
  | 'failed';

export interface CoordinatedSourceState {
  source: SourceDescriptor;
  required: boolean;
  lifecycle: CoordinatedSourceLifecycle;
  commandPlan?: SourceCommandPlan;
  prepareResult?: CommandApplicationResult;
  startResult?: CommandApplicationResult;
  stopResult?: CommandApplicationResult;
  finalizationReason?: CaptureFinalizationReason;
  endedAtElapsedSeconds?: number;
  failureReason?: string;
}

export type CoordinatorEffect =
  | {
      kind: 'prepare_source';
      sourceId: string;
      recordingId: string;
      commandId: string;
    }
  | {
      kind: 'commit_capture_start';
      sourceId: string;
      recordingId: string;
      commandId: string;
      activityId: string;
      activityCorrelationId: string;
    }
  | {
      kind: 'journal_stop_intent';
      sourceId: string;
      recordingId: string;
      commandId: string;
    };

export type RecordingCoordinatorPhase =
  | 'idle'
  | 'preparing'
  | 'committing'
  | 'recording'
  | 'stopping'
  | 'completed'
  | 'failed';

export interface CoordinatorFailure {
  sourceId: string;
  stage: 'prepare' | 'commit_start' | 'stop';
  reason: string;
}

export interface RecordingCoordinatorState {
  phase: RecordingCoordinatorPhase;
  activityId?: string;
  activityCorrelationId?: string;
  sources: Record<string, CoordinatedSourceState>;
  pendingEffects: CoordinatorEffect[];
  failure?: CoordinatorFailure;
}

export type RecordingCoordinatorEvent =
  | {
      type: 'start_requested';
      activityId: string;
      activityCorrelationId: string;
      sourceCommandPlans: Record<string, SourceCommandPlan>;
    }
  | {
      type: 'prepare_result';
      sourceId: string;
      commandId: string;
      result: CommandApplicationResult;
      reason?: string;
    }
  | {
      type: 'start_result';
      sourceId: string;
      commandId: string;
      result: CommandApplicationResult;
      reason?: string;
    }
  | {type: 'stop_requested'}
  | {
      type: 'stop_result';
      sourceId: string;
      commandId: string;
      result: CommandApplicationResult;
      reason?: string;
    }
  | {
      type: 'source_finalized';
      sourceId: string;
      reason: CaptureFinalizationReason;
      atElapsedSeconds: number;
    }
  | {
      type: 'source_interrupted';
      sourceId: string;
      reason: Extract<CaptureFinalizationReason, 'power_depleted' | 'power_loss' | 'telemetry_timeout' | 'storage_exhausted'>;
      atElapsedSeconds: number;
    }
  | {
      type: 'source_finalization_timed_out';
      sourceId: string;
      atElapsedSeconds: number;
    };

export const createRecordingCoordinator = (
  sources: Array<{source: SourceDescriptor; required: boolean}>,
): RecordingCoordinatorState => ({
  phase: 'idle',
  sources: Object.fromEntries(sources.map(({source, required}) => [
    source.sourceId,
    {source, required, lifecycle: 'idle' as const},
  ])),
  pendingEffects: [],
});

const removeEffect = (
  effects: CoordinatorEffect[],
  kind: CoordinatorEffect['kind'],
  sourceId: string,
  commandId: string,
): CoordinatorEffect[] => effects.filter(effect =>
  !(effect.kind === kind && effect.sourceId === sourceId && effect.commandId === commandId),
);

const isTerminal = (source: CoordinatedSourceState): boolean =>
  source.lifecycle === 'finalized' ||
  source.lifecycle === 'interrupted' ||
  source.lifecycle === 'excluded' ||
  source.lifecycle === 'failed' ||
  source.lifecycle === 'idle';

const completedPhase = (
  state: RecordingCoordinatorState,
  sources: Record<string, CoordinatedSourceState>,
): RecordingCoordinatorPhase =>
  Object.values(sources).every(isTerminal)
    ? state.failure ? 'failed' : 'completed'
    : state.phase;

const stopEffect = (source: CoordinatedSourceState): CoordinatorEffect => ({
  kind: 'journal_stop_intent',
  sourceId: source.source.sourceId,
  recordingId: source.commandPlan!.recordingId,
  commandId: source.commandPlan!.stopCommandId,
});

const sameCommandPlan = (left: SourceCommandPlan | undefined, right: SourceCommandPlan): boolean =>
  left?.recordingId === right.recordingId &&
  left.prepareCommandId === right.prepareCommandId &&
  left.startCommandId === right.startCommandId &&
  left.stopCommandId === right.stopCommandId;

export const recordingCoordinatorReducer = (
  state: RecordingCoordinatorState,
  event: RecordingCoordinatorEvent,
): RecordingCoordinatorState => {
  switch (event.type) {
    case 'start_requested': {
      if (state.phase !== 'idle') {
        const sameIntent = state.activityId === event.activityId &&
          state.activityCorrelationId === event.activityCorrelationId &&
          Object.entries(state.sources).every(([sourceId, source]) => {
            const replayPlan = event.sourceCommandPlans[sourceId];
            return replayPlan !== undefined && sameCommandPlan(source.commandPlan, replayPlan);
          });
        if (sameIntent) return state;
        throw new Error('conflicting start intent');
      }
      const sources = Object.fromEntries(Object.entries(state.sources).map(([sourceId, source]) => {
        const commandPlan = event.sourceCommandPlans[sourceId];
        if (!commandPlan) throw new Error(`missing command plan for ${sourceId}`);
        return [sourceId, {...source, commandPlan, lifecycle: 'prepare_pending' as const}];
      }));
      return {
        ...state,
        phase: 'preparing',
        activityId: event.activityId,
        activityCorrelationId: event.activityCorrelationId,
        sources,
        pendingEffects: Object.values(sources).map(source => ({
          kind: 'prepare_source' as const,
          sourceId: source.source.sourceId,
          recordingId: source.commandPlan!.recordingId,
          commandId: source.commandPlan!.prepareCommandId,
        })),
      };
    }
    case 'prepare_result': {
      const source = state.sources[event.sourceId];
      if (!source?.commandPlan || source.commandPlan.prepareCommandId !== event.commandId) return state;
      if (source.prepareResult !== undefined) {
        if (source.prepareResult === event.result) return state;
        throw new Error(`contradictory result for ${event.commandId}`);
      }
      const accepted = event.result !== 'rejected';
      const updated: CoordinatedSourceState = {
        ...source,
        prepareResult: event.result,
        lifecycle: accepted ? 'prepared' : source.required ? 'failed' : 'excluded',
        failureReason: accepted ? undefined : event.reason ?? 'prepare_rejected',
      };
      const sources = {...state.sources, [event.sourceId]: updated};
      const pendingEffects = removeEffect(
        state.pendingEffects, 'prepare_source', event.sourceId, event.commandId,
      );
      if (!accepted && source.required) {
        return {
          ...state,
          phase: 'failed',
          sources,
          pendingEffects: [],
          failure: {sourceId: event.sourceId, stage: 'prepare', reason: updated.failureReason!},
        };
      }
      const preparationResolved = Object.values(sources).every(candidate =>
        candidate.lifecycle === 'prepared' || candidate.lifecycle === 'excluded',
      );
      if (!preparationResolved) return {...state, sources, pendingEffects};
      const committingSources = Object.fromEntries(Object.entries(sources).map(([sourceId, candidate]) => [
        sourceId,
        candidate.lifecycle === 'prepared'
          ? {...candidate, lifecycle: 'start_pending' as const}
          : candidate,
      ]));
      return {
        ...state,
        phase: 'committing',
        sources: committingSources,
        pendingEffects: Object.values(committingSources)
          .filter(candidate => candidate.lifecycle === 'start_pending')
          .map(candidate => ({
            kind: 'commit_capture_start' as const,
            sourceId: candidate.source.sourceId,
            recordingId: candidate.commandPlan!.recordingId,
            commandId: candidate.commandPlan!.startCommandId,
            activityId: state.activityId!,
            activityCorrelationId: state.activityCorrelationId!,
          })),
      };
    }
    case 'start_result': {
      const source = state.sources[event.sourceId];
      if (!source?.commandPlan || source.commandPlan.startCommandId !== event.commandId) return state;
      if (source.startResult !== undefined) {
        if (source.startResult === event.result) return state;
        throw new Error(`contradictory result for ${event.commandId}`);
      }
      if (source.lifecycle !== 'start_pending') return state;
      const accepted = event.result !== 'rejected';
      const updated: CoordinatedSourceState = {
        ...source,
        startResult: event.result,
        lifecycle: accepted ? 'recording' : source.required ? 'failed' : 'excluded',
        failureReason: accepted ? undefined : event.reason ?? 'start_rejected',
      };
      let sources = {...state.sources, [event.sourceId]: updated};
      let pendingEffects = removeEffect(
        state.pendingEffects, 'commit_capture_start', event.sourceId, event.commandId,
      );
      if (!accepted && source.required) {
        const compensating = Object.values(sources).filter(candidate =>
          candidate.lifecycle === 'recording' || candidate.lifecycle === 'start_pending',
        );
        sources = {...sources};
        for (const candidate of compensating) {
          sources[candidate.source.sourceId] = {...candidate, lifecycle: 'stop_pending'};
        }
        pendingEffects = compensating.map(stopEffect);
        return {
          ...state,
          phase: 'stopping',
          sources,
          pendingEffects,
          failure: {
            sourceId: event.sourceId,
            stage: 'commit_start',
            reason: updated.failureReason!,
          },
        };
      }
      const commitResolved = Object.values(sources).every(candidate =>
        candidate.lifecycle === 'recording' || candidate.lifecycle === 'excluded',
      );
      return {
        ...state,
        phase: commitResolved ? 'recording' : state.phase,
        sources,
        pendingEffects,
      };
    }
    case 'stop_requested': {
      if (state.phase !== 'recording') return state;
      const active = Object.values(state.sources).filter(source => source.lifecycle === 'recording');
      const sources = {...state.sources};
      for (const source of active) {
        sources[source.source.sourceId] = {...source, lifecycle: 'stop_pending'};
      }
      return {
        ...state,
        phase: 'stopping',
        sources,
        pendingEffects: active.map(stopEffect),
      };
    }
    case 'stop_result': {
      const source = state.sources[event.sourceId];
      if (!source?.commandPlan || source.commandPlan.stopCommandId !== event.commandId) return state;
      if (source.stopResult !== undefined) {
        if (source.stopResult === event.result) return state;
        throw new Error(`contradictory result for ${event.commandId}`);
      }
      if (source.lifecycle !== 'stop_pending') return state;
      const accepted = event.result !== 'rejected';
      const updated: CoordinatedSourceState = {
        ...source,
        stopResult: event.result,
        lifecycle: accepted ? 'finalizing' : 'stop_pending',
        failureReason: accepted ? source.failureReason : event.reason ?? 'stop_rejected',
      };
      return {
        ...state,
        sources: {...state.sources, [event.sourceId]: updated},
        pendingEffects: removeEffect(
          state.pendingEffects, 'journal_stop_intent', event.sourceId, event.commandId,
        ),
        failure: accepted ? state.failure : {
          sourceId: event.sourceId,
          stage: 'stop',
          reason: updated.failureReason!,
        },
      };
    }
    case 'source_finalized': {
      const source = state.sources[event.sourceId];
      if (!source || isTerminal(source)) return state;
      const sources = {...state.sources, [event.sourceId]: {
        ...source,
        lifecycle: 'finalized' as const,
        finalizationReason: event.reason,
        endedAtElapsedSeconds: event.atElapsedSeconds,
      }};
      return {...state, sources, phase: completedPhase(state, sources)};
    }
    case 'source_interrupted': {
      const source = state.sources[event.sourceId];
      if (!source || isTerminal(source)) return state;
      const sources = {...state.sources, [event.sourceId]: {
        ...source,
        lifecycle: 'interrupted' as const,
        finalizationReason: event.reason,
        endedAtElapsedSeconds: event.atElapsedSeconds,
      }};
      return {...state, sources, phase: completedPhase(state, sources)};
    }
    case 'source_finalization_timed_out': {
      const source = state.sources[event.sourceId];
      if (!source || isTerminal(source)) return state;
      const sources = {...state.sources, [event.sourceId]: {
        ...source,
        lifecycle: 'interrupted' as const,
        finalizationReason: 'control_lease_expired' as const,
        endedAtElapsedSeconds: event.atElapsedSeconds,
      }};
      const pendingEffects = source.commandPlan
        ? removeEffect(
          state.pendingEffects,
          'journal_stop_intent',
          event.sourceId,
          source.commandPlan.stopCommandId,
        )
        : state.pendingEffects;
      return {
        ...state,
        sources,
        pendingEffects,
        phase: completedPhase(state, sources),
      };
    }
  }
};

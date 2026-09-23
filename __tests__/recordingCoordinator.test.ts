import {
  createRecordingCoordinator,
  recordingCoordinatorReducer,
  SourceCommandPlan,
} from '../src/application/coordinator/RecordingCoordinator';
import {appleWatchSource, phoneSource, rbp1Source} from '../src/application/capture/demoSources';

const plans: Record<string, SourceCommandPlan> = {
  [phoneSource.sourceId]: {
    recordingId: 'recording:phone:1',
    prepareCommandId: 'command:prepare:phone:1',
    startCommandId: 'command:start:phone:1',
    stopCommandId: 'command:stop:phone:1',
  },
  [rbp1Source.sourceId]: {
    recordingId: 'recording:rbp1:1',
    prepareCommandId: 'command:prepare:rbp1:1',
    startCommandId: 'command:start:rbp1:1',
    stopCommandId: 'command:stop:rbp1:1',
  },
  [appleWatchSource.sourceId]: {
    recordingId: 'recording:watch:1',
    prepareCommandId: 'command:prepare:watch:1',
    startCommandId: 'command:start:watch:1',
    stopCommandId: 'command:stop:watch:1',
  },
};

const start = (requiredRbp1 = false) => {
  let state = createRecordingCoordinator([
    {source: phoneSource, required: true},
    {source: rbp1Source, required: requiredRbp1},
    {source: appleWatchSource, required: false},
  ]);
  state = recordingCoordinatorReducer(state, {
    type: 'start_requested',
    activityId: 'activity:1',
    activityCorrelationId: 'correlation:1',
    sourceCommandPlans: plans,
  });
  return state;
};

describe('recording coordinator', () => {
  it('replays the same start intent but rejects a conflicting activity identity', () => {
    const state = start();
    const replayed = recordingCoordinatorReducer(state, {
      type: 'start_requested',
      activityId: 'activity:1',
      activityCorrelationId: 'correlation:1',
      sourceCommandPlans: plans,
    });
    expect(replayed).toEqual(state);
    expect(() => recordingCoordinatorReducer(state, {
      type: 'start_requested',
      activityId: 'activity:other',
      activityCorrelationId: 'correlation:other',
      sourceCommandPlans: plans,
    })).toThrow('conflicting start intent');
  });

  it('prepares every selected source using stable command and recording identities', () => {
    const state = start();

    expect(state.phase).toBe('preparing');
    expect(state.pendingEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'prepare_source',
        sourceId: phoneSource.sourceId,
        commandId: plans[phoneSource.sourceId].prepareCommandId,
        recordingId: plans[phoneSource.sourceId].recordingId,
      }),
      expect.objectContaining({kind: 'prepare_source', sourceId: rbp1Source.sourceId}),
    ]));
  });

  it('excludes a rejected optional source and commits prepared sources', () => {
    let state = start();
    state = recordingCoordinatorReducer(state, {
      type: 'prepare_result', sourceId: appleWatchSource.sourceId,
      commandId: plans[appleWatchSource.sourceId].prepareCommandId, result: 'rejected',
      reason: 'permission_denied',
    });
    for (const sourceId of [phoneSource.sourceId, rbp1Source.sourceId]) {
      state = recordingCoordinatorReducer(state, {
        type: 'prepare_result', sourceId,
        commandId: plans[sourceId].prepareCommandId, result: 'accepted',
      });
    }

    expect(state.phase).toBe('committing');
    expect(state.sources[appleWatchSource.sourceId].lifecycle).toBe('excluded');
    expect(state.pendingEffects.filter(effect => effect.kind === 'commit_capture_start'))
      .toHaveLength(2);
  });

  it('fails before commit when a required source rejects preparation', () => {
    let state = start(true);
    state = recordingCoordinatorReducer(state, {
      type: 'prepare_result', sourceId: rbp1Source.sourceId,
      commandId: plans[rbp1Source.sourceId].prepareCommandId, result: 'rejected',
      reason: 'storage_unavailable',
    });

    expect(state.phase).toBe('failed');
    expect(state.failure).toMatchObject({sourceId: rbp1Source.sourceId, stage: 'prepare'});
    expect(state.pendingEffects.some(effect => effect.kind === 'commit_capture_start')).toBe(false);
  });

  it('compensates sources that already started when a required commit fails', () => {
    let state = start(true);
    for (const sourceId of Object.keys(plans)) {
      state = recordingCoordinatorReducer(state, {
        type: 'prepare_result', sourceId,
        commandId: plans[sourceId].prepareCommandId, result: 'accepted',
      });
    }
    state = recordingCoordinatorReducer(state, {
      type: 'start_result', sourceId: phoneSource.sourceId,
      commandId: plans[phoneSource.sourceId].startCommandId, result: 'accepted',
    });
    state = recordingCoordinatorReducer(state, {
      type: 'start_result', sourceId: rbp1Source.sourceId,
      commandId: plans[rbp1Source.sourceId].startCommandId, result: 'rejected',
      reason: 'sensor_unavailable',
    });

    expect(state.phase).toBe('stopping');
    expect(state.failure).toMatchObject({sourceId: rbp1Source.sourceId, stage: 'commit_start'});
    expect(state.pendingEffects).toContainEqual(expect.objectContaining({
      kind: 'journal_stop_intent', sourceId: phoneSource.sourceId,
      commandId: plans[phoneSource.sourceId].stopCommandId,
    }));
  });

  it('does not equate an accepted stop command with finalized evidence', () => {
    let state = start();
    for (const sourceId of Object.keys(plans)) {
      state = recordingCoordinatorReducer(state, {
        type: 'prepare_result', sourceId,
        commandId: plans[sourceId].prepareCommandId, result: 'accepted',
      });
    }
    for (const sourceId of Object.keys(plans)) {
      state = recordingCoordinatorReducer(state, {
        type: 'start_result', sourceId,
        commandId: plans[sourceId].startCommandId, result: 'accepted',
      });
    }
    state = recordingCoordinatorReducer(state, {type: 'stop_requested'});
    state = recordingCoordinatorReducer(state, {
      type: 'stop_result', sourceId: phoneSource.sourceId,
      commandId: plans[phoneSource.sourceId].stopCommandId, result: 'accepted',
    });

    expect(state.phase).toBe('stopping');
    expect(state.sources[phoneSource.sourceId].lifecycle).toBe('finalizing');

    for (const sourceId of Object.keys(plans)) {
      state = recordingCoordinatorReducer(state, {
        type: 'source_finalized', sourceId, reason: 'app_stop', atElapsedSeconds: 120,
      });
    }
    expect(state.phase).toBe('completed');
  });

  it('keeps the activity recording when an optional watch is interrupted', () => {
    let state = start();
    for (const sourceId of Object.keys(plans)) {
      state = recordingCoordinatorReducer(state, {
        type: 'prepare_result', sourceId,
        commandId: plans[sourceId].prepareCommandId, result: 'already_applied',
      });
    }
    for (const sourceId of Object.keys(plans)) {
      state = recordingCoordinatorReducer(state, {
        type: 'start_result', sourceId,
        commandId: plans[sourceId].startCommandId, result: 'already_applied',
      });
    }
    state = recordingCoordinatorReducer(state, {
      type: 'source_interrupted', sourceId: appleWatchSource.sourceId,
      reason: 'power_depleted', atElapsedSeconds: 300,
    });

    expect(state.phase).toBe('recording');
    expect(state.sources[appleWatchSource.sourceId].lifecycle).toBe('interrupted');
    expect(state.sources[phoneSource.sourceId].lifecycle).toBe('recording');
  });

  it('rejects a contradictory replay for the same command identity', () => {
    let state = start();
    const accepted = {
      type: 'prepare_result' as const,
      sourceId: phoneSource.sourceId,
      commandId: plans[phoneSource.sourceId].prepareCommandId,
      result: 'accepted' as const,
    };
    state = recordingCoordinatorReducer(state, accepted);

    expect(recordingCoordinatorReducer(state, accepted)).toEqual(state);
    expect(() => recordingCoordinatorReducer(state, {
      ...accepted,
      result: 'rejected',
      reason: 'contradictory_replay',
    })).toThrow('contradictory result for command:prepare:phone:1');
  });

  it('marks an unfinalized source interrupted after the finite control timeout', () => {
    let state = start();
    for (const sourceId of Object.keys(plans)) {
      state = recordingCoordinatorReducer(state, {
        type: 'prepare_result', sourceId,
        commandId: plans[sourceId].prepareCommandId, result: 'accepted',
      });
    }
    for (const sourceId of Object.keys(plans)) {
      state = recordingCoordinatorReducer(state, {
        type: 'start_result', sourceId,
        commandId: plans[sourceId].startCommandId, result: 'accepted',
      });
    }
    state = recordingCoordinatorReducer(state, {type: 'stop_requested'});
    state = recordingCoordinatorReducer(state, {
      type: 'source_finalization_timed_out',
      sourceId: appleWatchSource.sourceId,
      atElapsedSeconds: 125,
    });

    expect(state.phase).toBe('stopping');
    expect(state.sources[appleWatchSource.sourceId]).toMatchObject({
      lifecycle: 'interrupted',
      finalizationReason: 'control_lease_expired',
      endedAtElapsedSeconds: 125,
    });
  });
});

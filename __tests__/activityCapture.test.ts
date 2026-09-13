import {
  activityCaptureReducer,
  createInitialActivityCapture,
} from '../src/application/capture/ActivityCapture';
import {SourceDescriptor} from '../src/contracts/acquisition';

const phoneSource: SourceDescriptor = {
  sourceId: 'phone:primary',
  deviceFamily: 'iphone',
  operationalState: 'available_idle',
  sensorPlacement: 'body',
  placementProvenance: 'device_metadata',
  capabilities: {
    liveTransfer: true,
    volatileResend: false,
    standaloneCapture: true,
    storeAndForward: true,
    postSyncDeletion: false,
    relayCapture: false,
  },
  clockDomains: [
    {clockDomainId: 'phone:monotonic', clockKind: 'monotonic', timestampUnit: 'us'},
  ],
};

const rbp1Source: SourceDescriptor = {
  ...phoneSource,
  sourceId: 'rbp1:demo',
  deviceFamily: 'remus_blade',
  deviceModel: 'rbp1',
  sensorPlacement: 'paddle',
  capabilities: {
    liveTransfer: true,
    volatileResend: true,
    standaloneCapture: true,
    storeAndForward: true,
    postSyncDeletion: true,
    relayCapture: true,
    relayModes: ['source_push', 'standard_ble_pull'],
  },
  clockDomains: [
    {clockDomainId: 'rbp1:monotonic', clockKind: 'monotonic', timestampUnit: 'us'},
  ],
};

describe('activity capture reducer', () => {
  it('starts with the phone as the only required source', () => {
    const state = createInitialActivityCapture(phoneSource);

    expect(state.phase).toBe('ready');
    expect(state.sources['phone:primary']).toMatchObject({
      required: true,
      operationalState: 'available_idle',
    });
  });

  it('does not treat an available_idle RBP1 as an active recording', () => {
    let state = createInitialActivityCapture(phoneSource);
    state = activityCaptureReducer(state, {type: 'source_discovered', source: rbp1Source});

    expect(state.phase).toBe('ready');
    expect(state.sources['rbp1:demo'].operationalState).toBe('available_idle');
    expect(state.sources['rbp1:demo'].recordingId).toBeUndefined();
  });

  it('commits one coordinated activity without requiring an RBP1', () => {
    let state = createInitialActivityCapture(phoneSource);
    state = activityCaptureReducer(state, {
      type: 'capture_committed',
      activityId: 'activity:1',
      activityCorrelationId: 'correlation:1',
      recordingIdsBySource: {'phone:primary': 'recording:phone:1'},
    });

    expect(state.phase).toBe('recording');
    expect(state.activityId).toBe('activity:1');
    expect(state.sources['phone:primary']).toMatchObject({
      operationalState: 'capturing',
      recordingId: 'recording:phone:1',
    });
  });

  it('keeps the activity recording when a watch is interrupted and closes its coverage', () => {
    const watchSource: SourceDescriptor = {
      ...phoneSource,
      sourceId: 'watch:apple:1',
      deviceFamily: 'apple_watch',
      sensorPlacement: 'left_wrist',
    };
    let state = createInitialActivityCapture(phoneSource);
    state = activityCaptureReducer(state, {type: 'source_discovered', source: watchSource});
    state = activityCaptureReducer(state, {
      type: 'capture_committed',
      activityId: 'activity:1',
      activityCorrelationId: 'correlation:1',
      recordingIdsBySource: {
        'phone:primary': 'recording:phone:1',
        'watch:apple:1': 'recording:watch:1',
      },
    });
    state = activityCaptureReducer(state, {
      type: 'source_interrupted',
      sourceId: 'watch:apple:1',
      atElapsedSeconds: 462,
      reason: 'power_depleted',
    });

    expect(state.phase).toBe('recording');
    expect(state.sources['watch:apple:1']).toMatchObject({
      operationalState: 'unavailable',
      finalizationReason: 'power_depleted',
    });
    expect(state.sources['watch:apple:1'].coverageSegments).toEqual([
      {startedAtElapsedSeconds: 0, endedAtElapsedSeconds: 462},
    ]);
  });

  it('preserves interrupted sources and completes after every reachable source finalizes', () => {
    let state = createInitialActivityCapture(phoneSource);
    state = activityCaptureReducer(state, {type: 'source_discovered', source: rbp1Source});
    state = activityCaptureReducer(state, {
      type: 'capture_committed',
      activityId: 'activity:1',
      activityCorrelationId: 'correlation:1',
      recordingIdsBySource: {
        'phone:primary': 'recording:phone:1',
        'rbp1:demo': 'recording:rbp1:1',
      },
    });
    state = activityCaptureReducer(state, {
      type: 'source_interrupted',
      sourceId: 'rbp1:demo',
      atElapsedSeconds: 900,
      reason: 'power_loss',
    });
    state = activityCaptureReducer(state, {type: 'stop_requested'});
    state = activityCaptureReducer(state, {
      type: 'source_finalized',
      sourceId: 'phone:primary',
      atElapsedSeconds: 905,
      reason: 'app_stop',
    });

    expect(state.phase).toBe('completed');
    expect(state.sources['rbp1:demo'].recordingState).toBe('interrupted');
    expect(state.sources['phone:primary'].recordingState).toBe('finalized');
  });
});

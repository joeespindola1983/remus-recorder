import {
  createCaptureSimulation,
  runCaptureScenario,
} from '../src/application/simulation/CaptureSimulator';
import {
  appOnlyCaptureScenario,
  disconnectedRbp1TransferScenario,
  storagePressureTransferScenario,
  watchPowerDepletionScenario,
} from '../src/application/simulation/scenarios';
import {
  appleWatchSource,
  createDemoActivityCapture,
  phoneSource,
  rbp1Source,
} from '../src/application/capture/demoSources';
import {createInitialActivityCapture, activityCaptureReducer} from '../src/application/capture/ActivityCapture';

describe('deterministic capture simulator', () => {
  it('returns to ready while preserving readiness and clearing workout data', () => {
    const initial = createCaptureSimulation(createDemoActivityCapture());
    const recording = runCaptureScenario(initial, [{type: 'commit_capture', activityId: 'activity:reset', activityCorrelationId: 'correlation:reset', recordingIdsBySource: {'phone:primary': 'recording:phone:reset'}}, {type: 'advance_time', seconds: 30, metrics: {distanceMeters: 100}}]);
    const result = runCaptureScenario(recording, [{type: 'reset_to_ready'}]);
    expect(result.capture.phase).toBe('ready');
    expect(result.capture.metrics).toEqual({elapsedSeconds: 0});
    expect(result.capture.sources['phone:primary'].readiness).toEqual(initial.capture.sources['phone:primary'].readiness);
    expect(result.capture.sources['phone:primary'].recordingId).toBeUndefined();
  });

  it('completes an app-only activity without requiring another source', () => {
    const result = runCaptureScenario(
      createCaptureSimulation(createInitialActivityCapture(phoneSource)),
      appOnlyCaptureScenario,
    );

    expect(result.capture.phase).toBe('completed');
    expect(result.capture.sources['phone:primary']).toMatchObject({
      recordingId: 'recording:phone:app-only',
      recordingState: 'finalized',
    });
    expect(result.nowElapsedSeconds).toBe(1800);
  });

  it('preserves watch coverage while the phone and activity continue', () => {
    const result = runCaptureScenario(
      createCaptureSimulation(createDemoActivityCapture()),
      watchPowerDepletionScenario,
    );

    expect(result.capture.phase).toBe('recording');
    expect(result.capture.metrics.elapsedSeconds).toBe(900);
    expect(result.capture.sources[appleWatchSource.sourceId]).toMatchObject({
      recordingState: 'interrupted',
      finalizationReason: 'power_depleted',
    });
    expect(result.capture.sources[appleWatchSource.sourceId].coverageSegments).toEqual([
      {startedAtElapsedSeconds: 0, endedAtElapsedSeconds: 600},
    ]);
    expect(result.capture.sources[phoneSource.sourceId].recordingState).toBe('recording');
  });

  it('keeps an RBP1 recording active across transport loss and resumes transfer at the exact offset', () => {
    const disconnected = runCaptureScenario(
      createCaptureSimulation(createDemoActivityCapture()),
      disconnectedRbp1TransferScenario.slice(0, 3),
    );
    expect(disconnected.capture.sources[rbp1Source.sourceId].recordingState).toBe('recording');
    expect(disconnected.sourceTransport[rbp1Source.sourceId]).toBe('disconnected_recovering');

    const result = runCaptureScenario(
      createCaptureSimulation(createDemoActivityCapture()),
      disconnectedRbp1TransferScenario,
    );

    expect(result.capture.sources[rbp1Source.sourceId].recordingState).toBe('finalized');
    expect(result.sourceTransport[rbp1Source.sourceId]).toBe('connected');
    expect(result.artifactTransfers['artifact:rbp1:1']).toMatchObject({
      transferredByteLength: '9007199254740994',
      status: 'persisted_verified',
    });
    expect(result.events.filter(event => event.kind === 'artifact_transfer_paused')).toHaveLength(1);
  });

  it('does not verify a partially transferred artifact', () => {
    let capture = createInitialActivityCapture(rbp1Source);
    capture = activityCaptureReducer(capture, {
      type: 'capture_committed',
      activityId: 'activity:partial',
      activityCorrelationId: 'correlation:partial',
      recordingIdsBySource: {[rbp1Source.sourceId]: 'recording:rbp1:partial'},
    });
    const initial = createCaptureSimulation(capture);

    expect(() => runCaptureScenario(initial, [
      {
        type: 'artifact_discovered',
        artifactId: 'artifact:partial',
        sourceId: rbp1Source.sourceId,
        recordingId: 'recording:rbp1:partial',
        byteLength: '1000',
      },
      {
        type: 'transfer_artifact_range',
        artifactId: 'artifact:partial',
        offsetBytes: '0',
        byteLength: '999',
        contentSha256: 'a'.repeat(64),
      },
      {type: 'verify_artifact_persistence', artifactId: 'artifact:partial'},
    ])).toThrow('artifact:partial is not fully transferred');
  });

  it('accepts an exact replay idempotently but rejects a skipped transfer range', () => {
    const initial = createCaptureSimulation(createInitialActivityCapture(rbp1Source));
    const discovered = runCaptureScenario(initial, [{
      type: 'artifact_discovered',
      artifactId: 'artifact:ranges',
      sourceId: rbp1Source.sourceId,
      recordingId: 'recording:rbp1:ranges',
      byteLength: '30',
    }]);
    const firstRange = {
      type: 'transfer_artifact_range' as const,
      artifactId: 'artifact:ranges',
      offsetBytes: '0',
      byteLength: '10',
      contentSha256: 'b'.repeat(64),
    };
    const received = runCaptureScenario(discovered, [firstRange]);
    const replayed = runCaptureScenario(received, [firstRange]);

    expect(replayed).toEqual(received);
    expect(() => runCaptureScenario(received, [{
      ...firstRange,
      offsetBytes: '20',
      contentSha256: 'c'.repeat(64),
    }])).toThrow('artifact:ranges expected offset 10');
  });

  it('replays the same scenario to the same state and event log', () => {
    const first = runCaptureScenario(
      createCaptureSimulation(createDemoActivityCapture()),
      watchPowerDepletionScenario,
    );
    const second = runCaptureScenario(
      createCaptureSimulation(createDemoActivityCapture()),
      watchPowerDepletionScenario,
    );

    expect(second).toEqual(first);
  });

  it('blocks on disk pressure, evicts only regenerable data and resumes without losing offset', () => {
    const initial = createCaptureSimulation(createInitialActivityCapture(rbp1Source), {
      capacityByteLength: '1000',
      evidenceAndStagingByteLength: '800',
      regenerableByteLength: '150',
    });
    const result = runCaptureScenario(initial, storagePressureTransferScenario);

    expect(result.artifactTransfers['artifact:storage']).toMatchObject({
      transferredByteLength: '100',
      status: 'transferred',
    });
    expect(result.appStorage).toEqual({
      capacityByteLength: '1000',
      evidenceAndStagingByteLength: '900',
      regenerableByteLength: '50',
    });
    expect(result.events.some(event => event.kind === 'artifact_transfer_blocked_storage')).toBe(true);
  });

  it('treats repeated artifact discovery and persistence verification as idempotent', () => {
    const initial = createCaptureSimulation(createInitialActivityCapture(rbp1Source));
    const discovery = {
      type: 'artifact_discovered' as const,
      artifactId: 'artifact:idempotent',
      sourceId: rbp1Source.sourceId,
      recordingId: 'recording:rbp1:idempotent',
      byteLength: '10',
    };
    const discovered = runCaptureScenario(initial, [discovery]);
    expect(runCaptureScenario(discovered, [discovery])).toEqual(discovered);

    const verified = runCaptureScenario(discovered, [
      {
        type: 'transfer_artifact_range',
        artifactId: discovery.artifactId,
        offsetBytes: '0',
        byteLength: '10',
        contentSha256: 'e'.repeat(64),
      },
      {type: 'verify_artifact_persistence', artifactId: discovery.artifactId},
    ]);
    expect(runCaptureScenario(verified, [
      {type: 'verify_artifact_persistence', artifactId: discovery.artifactId},
    ])).toEqual(verified);
  });
});

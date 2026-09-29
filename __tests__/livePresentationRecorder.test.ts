import {
  LivePresentationRecorder,
} from '../src/services/presentation/LivePresentationRecorder';
import { LiveMetricPresentation } from '../src/services/recording/RecordingService';
import { formatPace } from '../src/ui/organisms/AdaptiveCaptureSurface';

describe('LivePresentationRecorder (TDD)', () => {
  let emitted: LiveMetricPresentation[];
  let recorder: LivePresentationRecorder;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1700000000000);
    emitted = [];
    recorder = new LivePresentationRecorder({
      surfaceId: 'surface:phone:active-screen',
      formatPaceFn: formatPace,
      onPresentation: p => {
        emitted.push(p);
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Pace presentation', () => {
    it('records pace below cutoff (0.79 m/s) as unavailable with below_movement_threshold', () => {
      recorder.updatePace({
        groundSpeedMetersPerSecond: 0.79,
        locationSourceTimeEpochMs: 1700000000000,
        nowEpochMs: 1700000000000,
      });

      expect(emitted).toHaveLength(1);
      const p = emitted[0];
      expect(p.metricIdentifier).toBe('paceSecondsPer500Meters');
      expect(p.surfaceId).toBe('surface:phone:active-screen');
      expect(p.availabilityState).toBe('unavailable');
      expect(p.availabilityReason).toBe('below_movement_threshold');
      expect(p.numericValue).toBeNull();
      expect(p.renderedText).toBe('—');
      expect(p.canonicalUnit).toBe('s/500m');
      expect(p.presentationPolicyVersion).toBe('1.1.0');
    });

    it('records pace at cutoff (0.80 m/s) as available with 625 s/500m and rendered text 10:25', () => {
      recorder.updatePace({
        groundSpeedMetersPerSecond: 0.80,
        locationSourceTimeEpochMs: 1700000000000,
        nowEpochMs: 1700000000000,
      });

      expect(emitted).toHaveLength(1);
      const p = emitted[0];
      expect(p.availabilityState).toBe('available');
      expect(p.availabilityReason).toBe('available');
      expect(p.numericValue).toBe(625);
      expect(p.renderedText).toBe('10:25');
    });

    it('records pace above cutoff (4.0 m/s) as available with 125 s/500m and rendered text 02:05', () => {
      recorder.updatePace({
        groundSpeedMetersPerSecond: 4.0,
        locationSourceTimeEpochMs: 1700000000000,
        nowEpochMs: 1700000000000,
      });

      expect(emitted).toHaveLength(1);
      const p = emitted[0];
      expect(p.availabilityState).toBe('available');
      expect(p.numericValue).toBe(125);
      expect(p.renderedText).toBe('02:05');
      expect(p.supportedAtEpochMilliseconds).toBe(1700000000000);
    });

    it('records missing speed as unavailable with source_unavailable', () => {
      recorder.updatePace({
        groundSpeedMetersPerSecond: undefined,
        nowEpochMs: 1700000000000,
      });

      expect(emitted).toHaveLength(1);
      const p = emitted[0];
      expect(p.availabilityState).toBe('unavailable');
      expect(p.availabilityReason).toBe('source_unavailable');
      expect(p.numericValue).toBeNull();
      expect(p.renderedText).toBe('—');
    });

    it('records stale location as unavailable with stale_location when location is older than threshold', () => {
      const now = 1700000000000;
      recorder.updatePace({
        groundSpeedMetersPerSecond: 3.5,
        locationSourceTimeEpochMs: now - 5000, // 5 seconds old (> 3500ms threshold)
        nowEpochMs: now,
      });

      expect(emitted).toHaveLength(1);
      const p = emitted[0];
      expect(p.availabilityState).toBe('unavailable');
      expect(p.availabilityReason).toBe('stale_location');
      expect(p.numericValue).toBeNull();
      expect(p.renderedText).toBe('—');
    });

    it('records poor speed accuracy as unavailable with poor_speed_accuracy', () => {
      recorder.updatePace({
        groundSpeedMetersPerSecond: 2.0,
        locationSourceTimeEpochMs: 1700000000000,
        speedAccuracyMetersPerSecond: 3.5, // accuracy error larger than speed itself
        nowEpochMs: 1700000000000,
      });

      expect(emitted).toHaveLength(1);
      const p = emitted[0];
      expect(p.availabilityState).toBe('unavailable');
      expect(p.availabilityReason).toBe('poor_speed_accuracy');
      expect(p.numericValue).toBeNull();
      expect(p.renderedText).toBe('—');
    });
  });

  describe('SPM presentation', () => {
    it('records available SPM with numericValue and rounded renderedText', () => {
      recorder.updateSpm({
        sourceId: 'blade:1',
        liveSpm: 24.2,
        availabilityState: 'available',
        availabilityReason: 'available',
        supportedAtNativeTimestamp: 123456,
        clockDomainId: 'clk:blade:1:001',
        nowEpochMs: 1700000000000,
      });

      expect(emitted).toHaveLength(1);
      const p = emitted[0];
      expect(p.metricIdentifier).toBe('strokeRateSpm');
      expect(p.availabilityState).toBe('available');
      expect(p.availabilityReason).toBe('available');
      expect(p.numericValue).toBe(24.2);
      expect(p.renderedText).toBe('24');
      expect(p.canonicalUnit).toBe('strokes/min');
      expect(p.supportedAtEpochMilliseconds).toBeUndefined();
      expect(p.supportedAtNativeTimestamp).toBe(123456);
      expect(p.clockDomainId).toBe('clk:blade:1:001');
    });

    it('records held SPM preserving last supported numericValue and supported timestamp', () => {
      // First available sample at t=0
      recorder.updateSpm({
        sourceId: 'blade:1',
        liveSpm: 26.0,
        availabilityState: 'available',
        availabilityReason: 'available',
        supportedAtNativeTimestamp: 123456,
        clockDomainId: 'clk:blade:1:001',
        nowEpochMs: 1700000000000,
      });

      // Held state at t=1500 (hold preserves original supported time t=0)
      recorder.updateSpm({
        sourceId: 'blade:1',
        liveSpm: 26.0,
        availabilityState: 'held',
        availabilityReason: 'held_last_supported_value',
        supportedAtNativeTimestamp: 123456,
        clockDomainId: 'clk:blade:1:001',
        nowEpochMs: 1700000001500,
      });

      expect(emitted).toHaveLength(2);
      const held = emitted[1];
      expect(held.availabilityState).toBe('held');
      expect(held.availabilityReason).toBe('held_last_supported_value');
      expect(held.numericValue).toBe(26.0);
      expect(held.renderedText).toBe('26');
      expect(held.supportedAtEpochMilliseconds).toBeUndefined();
      expect(held.supportedAtNativeTimestamp).toBe(123456);
      expect(held.clockDomainId).toBe('clk:blade:1:001');
      expect(held.presentedAtEpochMilliseconds).toBe(1700000001500);
    });

    it('records ambiguous periodicity SPM with null value and dash text', () => {
      recorder.updateSpm({
        sourceId: 'blade:1',
        liveSpm: 0,
        availabilityState: 'unavailable',
        availabilityReason: 'ambiguous_periodicity',
        nowEpochMs: 1700000000000,
      });

      expect(emitted).toHaveLength(1);
      const p = emitted[0];
      expect(p.availabilityState).toBe('unavailable');
      expect(p.availabilityReason).toBe('ambiguous_periodicity');
      expect(p.numericValue).toBeNull();
      expect(p.renderedText).toBe('—');
    });

    it('records confirmed stop SPM with confirmed_stop reason', () => {
      recorder.updateSpm({
        sourceId: 'blade:1',
        liveSpm: 0,
        availabilityState: 'unavailable',
        availabilityReason: 'confirmed_stop',
        nowEpochMs: 1700000000000,
      });

      expect(emitted).toHaveLength(1);
      const p = emitted[0];
      expect(p.availabilityState).toBe('unavailable');
      expect(p.availabilityReason).toBe('confirmed_stop');
      expect(p.numericValue).toBeNull();
      expect(p.renderedText).toBe('—');
    });

    it('emits telemetry_timeout when SPM updates cease for > timeoutThresholdMs', () => {
      recorder.updateSpm({
        sourceId: 'blade:1',
        liveSpm: 24,
        availabilityState: 'available',
        supportedAtNativeTimestamp: 123456,
        clockDomainId: 'clk:blade:1:001',
        nowEpochMs: 1700000000000,
      });
      expect(emitted).toHaveLength(1);

      // Advance time by 4 seconds without any new SPM
      recorder.checkHeartbeat(1700000004000);

      expect(emitted).toHaveLength(2);
      const timeout = emitted[1];
      expect(timeout.availabilityState).toBe('unavailable');
      expect(timeout.availabilityReason).toBe('telemetry_timeout');
      expect(timeout.numericValue).toBeNull();
      expect(timeout.renderedText).toBe('—');
    });

    it('resumes available SPM when new data arrives after timeout', () => {
      recorder.updateSpm({
        sourceId: 'blade:1',
        liveSpm: 24,
        availabilityState: 'available',
        nowEpochMs: 1700000000000,
      });

      // Timeout at 4s
      recorder.checkHeartbeat(1700000004000);
      expect(emitted).toHaveLength(2);

      // Resumed at 6s
      recorder.updateSpm({
        sourceId: 'blade:1',
        liveSpm: 28,
        availabilityState: 'available',
        nowEpochMs: 1700000006000,
      });

      expect(emitted).toHaveLength(3);
      const resumed = emitted[2];
      expect(resumed.availabilityState).toBe('available');
      expect(resumed.numericValue).toBe(28);
      expect(resumed.renderedText).toBe('28');
    });
  });

  describe('Deduplication and 1 Hz checkpointing', () => {
    it('deduplicates identical presentations within 1 second, but emits 1 Hz checkpoint when unchanged', () => {
      const baseTime = 1700000000000;

      // First presentation at t=0ms
      recorder.updatePace({
        groundSpeedMetersPerSecond: 4.0,
        locationSourceTimeEpochMs: baseTime,
        nowEpochMs: baseTime,
      });
      expect(emitted).toHaveLength(1);

      // Redundant update at t=200ms (identical pace) -> suppressed
      recorder.updatePace({
        groundSpeedMetersPerSecond: 4.0,
        locationSourceTimeEpochMs: baseTime + 200,
        nowEpochMs: baseTime + 200,
      });
      expect(emitted).toHaveLength(1);

      // Redundant update at t=600ms -> suppressed
      recorder.updatePace({
        groundSpeedMetersPerSecond: 4.0,
        locationSourceTimeEpochMs: baseTime + 600,
        nowEpochMs: baseTime + 600,
      });
      expect(emitted).toHaveLength(1);

      // At t=1050ms (>= 1000ms elapsed since last emit), same pace -> emits 1 Hz checkpoint
      recorder.updatePace({
        groundSpeedMetersPerSecond: 4.0,
        locationSourceTimeEpochMs: baseTime + 1050,
        nowEpochMs: baseTime + 1050,
      });
      expect(emitted).toHaveLength(2);
      expect(emitted[1].presentedAtEpochMilliseconds).toBe(baseTime + 1050);
    });

    it('emits immediately when rendered state or text changes even within 1 second', () => {
      const baseTime = 1700000000000;

      // t=0ms: pace 4.0 m/s (02:05)
      recorder.updatePace({
        groundSpeedMetersPerSecond: 4.0,
        locationSourceTimeEpochMs: baseTime,
        nowEpochMs: baseTime,
      });
      expect(emitted).toHaveLength(1);

      // t=250ms: pace drops below threshold (0.5 m/s -> '—', below_movement_threshold)
      recorder.updatePace({
        groundSpeedMetersPerSecond: 0.5,
        locationSourceTimeEpochMs: baseTime + 250,
        nowEpochMs: baseTime + 250,
      });

      expect(emitted).toHaveLength(2);
      expect(emitted[1].availabilityState).toBe('unavailable');
      expect(emitted[1].availabilityReason).toBe('below_movement_threshold');
      expect(emitted[1].renderedText).toBe('—');
    });

    it('clears presentation state and deduplication cache on reset', () => {
      recorder.updatePace({
        groundSpeedMetersPerSecond: 4.0,
        nowEpochMs: 1700000000000,
      });
      expect(emitted).toHaveLength(1);

      recorder.reset();

      // Immediately emitting identical pace produces a fresh presentation because cache was reset
      recorder.updatePace({
        groundSpeedMetersPerSecond: 4.0,
        nowEpochMs: 1700000000100,
      });
      expect(emitted).toHaveLength(2);
      expect(recorder.isSpmActive()).toBe(false);
    });
  });
});

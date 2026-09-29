import {
  BoatMotionDetector,
  BoatMotionObservation,
} from '../src/services/motion/BoatMotionDetector';

describe('BoatMotionDetector (TDD)', () => {
  let emitted: BoatMotionObservation[];
  let detector: BoatMotionDetector;

  beforeEach(() => {
    emitted = [];
    detector = new BoatMotionDetector({
      onObservation: obs => {
        emitted.push(obs);
      },
    });
  });

  describe('Quality and unknown transitions', () => {
    it('initializes in unknown state on missing speed', () => {
      detector.update({
        timestampMs: 1000,
        groundSpeedMetersPerSecond: null,
      });

      expect(emitted).toHaveLength(1);
      expect(emitted[0].value).toBe('unknown');
      expect(emitted[0].quality).toBe('unusable');
      expect(emitted[0].reason).toBe('missing_speed');
    });

    it('transitions to unknown when location is stale (> maxLocationFreshnessMs)', () => {
      // First establish stationary at t=1000ms..3500ms
      detector.update({
        timestampMs: 1000,
        groundSpeedMetersPerSecond: 0.1,
      });
      detector.update({
        timestampMs: 3100,
        groundSpeedMetersPerSecond: 0.1,
      });
      expect(emitted[emitted.length - 1].value).toBe('stationary');

      // Now stale location: freshness 4000ms (> 3500ms)
      detector.update({
        timestampMs: 7500,
        groundSpeedMetersPerSecond: 0.1,
        locationFreshnessMs: 4000,
      });

      expect(emitted[emitted.length - 1].value).toBe('unknown');
      expect(emitted[emitted.length - 1].quality).toBe('unusable');
      expect(emitted[emitted.length - 1].reason).toBe('stale_location');
    });

    it('transitions to unknown when speed accuracy is poor (> maxSpeedAccuracyMetersPerSecond)', () => {
      detector.update({
        timestampMs: 1000,
        groundSpeedMetersPerSecond: 2.0,
        speedAccuracyMetersPerSecond: 2.5, // > 1.5 m/s threshold
      });

      expect(emitted[0].value).toBe('unknown');
      expect(emitted[0].quality).toBe('degraded');
      expect(emitted[0].reason).toBe('poor_speed_accuracy');
    });
  });

  describe('GNSS jitter near zero', () => {
    it('stays stationary despite zero-speed jitter below entry threshold (0.85 m/s)', () => {
      // Establish stationary initially
      detector.update({ timestampMs: 1000, groundSpeedMetersPerSecond: 0.0 });
      detector.update({ timestampMs: 3100, groundSpeedMetersPerSecond: 0.0 });
      expect(detector.getState()).toBe('stationary');

      const countBeforeJitter = emitted.length;

      // Jitter fluctuating 0.1, 0.4, 0.7, 0.3 m/s (all < 0.85 m/s)
      detector.update({ timestampMs: 3500, groundSpeedMetersPerSecond: 0.15 });
      detector.update({ timestampMs: 3800, groundSpeedMetersPerSecond: 0.45 });
      detector.update({ timestampMs: 4000, groundSpeedMetersPerSecond: 0.72 });
      detector.update({ timestampMs: 4200, groundSpeedMetersPerSecond: 0.25 });

      expect(detector.getState()).toBe('stationary');
      // No transition emitted due to jitter
      const transitions = emitted.slice(countBeforeJitter).filter(o => o.value !== 'stationary');
      expect(transitions).toHaveLength(0);
    });
  });

  describe('Moving transition and hysteresis', () => {
    it('transitions from stationary to moving only after sustaining entry speed for >= minMovingDurationMs', () => {
      detector.update({ timestampMs: 1000, groundSpeedMetersPerSecond: 0.0 });
      detector.update({ timestampMs: 3100, groundSpeedMetersPerSecond: 0.0 });
      expect(detector.getState()).toBe('stationary');

      // Spike at t=4000ms: speed 1.5 m/s (above 0.85)
      detector.update({ timestampMs: 4000, groundSpeedMetersPerSecond: 1.5 });
      // At t=4800ms (< 1500ms elapsed since 4000ms): still stationary candidate
      detector.update({ timestampMs: 4800, groundSpeedMetersPerSecond: 1.6 });
      expect(detector.getState()).toBe('stationary');

      // At t=5600ms (1600ms >= 1500ms elapsed): transitions to moving!
      detector.update({ timestampMs: 5600, groundSpeedMetersPerSecond: 1.7 });
      expect(detector.getState()).toBe('moving');
      expect(emitted[emitted.length - 1].value).toBe('moving');
      expect(emitted[emitted.length - 1].quality).toBe('qualified');
    });

    it('cancels moving candidate if speed drops below entry threshold before minMovingDurationMs', () => {
      detector.update({ timestampMs: 1000, groundSpeedMetersPerSecond: 0.0 });
      detector.update({ timestampMs: 3100, groundSpeedMetersPerSecond: 0.0 });
      expect(detector.getState()).toBe('stationary');

      // Brief acceleration spike for 600ms
      detector.update({ timestampMs: 4000, groundSpeedMetersPerSecond: 1.2 });
      detector.update({ timestampMs: 4600, groundSpeedMetersPerSecond: 0.5 }); // drops below 0.85
      detector.update({ timestampMs: 5600, groundSpeedMetersPerSecond: 0.4 });

      expect(detector.getState()).toBe('stationary');
    });
  });

  describe('Short stop vs sustained stop', () => {
    beforeEach(() => {
      // Establish moving state
      detector.update({ timestampMs: 1000, groundSpeedMetersPerSecond: 2.0 });
      detector.update({ timestampMs: 2600, groundSpeedMetersPerSecond: 2.2 });
      expect(detector.getState()).toBe('moving');
    });

    it('short stop (< 2000ms below exit threshold) keeps moving state', () => {
      // Speed drops to 0.2 m/s at t=3000ms (stroke pause or catch delay)
      detector.update({ timestampMs: 3000, groundSpeedMetersPerSecond: 0.2 });
      detector.update({ timestampMs: 3800, groundSpeedMetersPerSecond: 0.3 }); // 800ms elapsed

      // Speed recovers at t=4200ms (1200ms < 2000ms)
      detector.update({ timestampMs: 4200, groundSpeedMetersPerSecond: 1.8 });

      expect(detector.getState()).toBe('moving');
    });

    it('sustained stop (>= 2000ms below exit threshold) transitions to stationary', () => {
      // Speed drops to 0.2 m/s at t=3000ms
      detector.update({ timestampMs: 3000, groundSpeedMetersPerSecond: 0.2 });
      detector.update({ timestampMs: 4000, groundSpeedMetersPerSecond: 0.1 });
      expect(detector.getState()).toBe('moving'); // 1000ms < 2000ms

      // At t=5100ms (2100ms >= 2000ms below 0.60 m/s)
      detector.update({ timestampMs: 5100, groundSpeedMetersPerSecond: 0.1 });

      expect(detector.getState()).toBe('stationary');
      expect(emitted[emitted.length - 1].value).toBe('stationary');
      expect(emitted[emitted.length - 1].reason).toBe('sustained_stop');
    });

    it('resumes moving after sustained stop (retomada)', () => {
      // Stop at t=3000..5100ms
      detector.update({ timestampMs: 3000, groundSpeedMetersPerSecond: 0.1 });
      detector.update({ timestampMs: 5100, groundSpeedMetersPerSecond: 0.1 });
      expect(detector.getState()).toBe('stationary');

      // Retomada: speed rises to 2.5 m/s at t=6000ms
      detector.update({ timestampMs: 6000, groundSpeedMetersPerSecond: 2.5 });
      detector.update({ timestampMs: 7600, groundSpeedMetersPerSecond: 2.8 }); // 1600ms >= 1500ms

      expect(detector.getState()).toBe('moving');
      expect(emitted[emitted.length - 1].value).toBe('moving');
    });
  });

  describe('Maneuvering (Turn detection)', () => {
    it('detects maneuvering when moving boat changes qualified course by >= 35 degrees within window', () => {
      // Moving at t=1000..2600ms, course 90 deg
      detector.update({
        timestampMs: 1000,
        groundSpeedMetersPerSecond: 2.5,
        courseDegrees: 90,
        courseAccuracyDegrees: 5.0,
      });
      detector.update({
        timestampMs: 2600,
        groundSpeedMetersPerSecond: 2.5,
        courseDegrees: 90,
        courseAccuracyDegrees: 5.0,
      });
      expect(detector.getState()).toBe('moving');

      // Sharp turn: course turns to 145 deg (55 deg change >= 35 deg) at t=3500ms
      detector.update({
        timestampMs: 3500,
        groundSpeedMetersPerSecond: 2.0,
        courseDegrees: 145,
        courseAccuracyDegrees: 6.0,
      });

      expect(detector.getState()).toBe('maneuvering');
      expect(emitted[emitted.length - 1].value).toBe('maneuvering');
      expect(emitted[emitted.length - 1].reason).toBe('maneuver_detected');
    });

    it('ignores course change when course accuracy is poor (> maxCourseAccuracyDegrees)', () => {
      detector.update({
        timestampMs: 1000,
        groundSpeedMetersPerSecond: 2.5,
        courseDegrees: 90,
        courseAccuracyDegrees: 5.0,
      });
      detector.update({
        timestampMs: 2600,
        groundSpeedMetersPerSecond: 2.5,
        courseDegrees: 90,
        courseAccuracyDegrees: 5.0,
      });

      // Wild course 180 deg but with 50 deg uncertainty (> 35 deg threshold)
      detector.update({
        timestampMs: 3500,
        groundSpeedMetersPerSecond: 2.5,
        courseDegrees: 180,
        courseAccuracyDegrees: 50.0,
      });

      expect(detector.getState()).toBe('moving');
    });

    it('returns to moving when course stabilizes after maneuver', () => {
      detector.update({
        timestampMs: 1000,
        groundSpeedMetersPerSecond: 2.5,
        courseDegrees: 90,
        courseAccuracyDegrees: 5.0,
      });
      detector.update({
        timestampMs: 2600,
        groundSpeedMetersPerSecond: 2.5,
        courseDegrees: 90,
        courseAccuracyDegrees: 5.0,
      });

      // Maneuver at t=3500ms
      detector.update({
        timestampMs: 3500,
        groundSpeedMetersPerSecond: 2.0,
        courseDegrees: 150,
        courseAccuracyDegrees: 5.0,
      });
      expect(detector.getState()).toBe('maneuvering');

      // Course stabilizes at 150 deg for > window (4000ms)
      detector.update({
        timestampMs: 8000,
        groundSpeedMetersPerSecond: 2.5,
        courseDegrees: 151,
        courseAccuracyDegrees: 5.0,
      });

      expect(detector.getState()).toBe('moving');
    });
  });

  describe('Deduplication and checkpointing', () => {
    it('deduplicates identical states within 1000ms but emits 1 Hz checkpoint when unchanged', () => {
      detector.update({ timestampMs: 1000, groundSpeedMetersPerSecond: 2.5 });
      detector.update({ timestampMs: 2600, groundSpeedMetersPerSecond: 2.5 });
      expect(detector.getState()).toBe('moving');

      const countAtMoving = emitted.length;

      // Update at t=2800ms (200ms < 1000ms) with same moving state -> suppressed
      detector.update({ timestampMs: 2800, groundSpeedMetersPerSecond: 2.6 });
      expect(emitted).toHaveLength(countAtMoving);

      // Update at t=3700ms (1100ms >= 1000ms) with same moving state -> checkpoints!
      detector.update({ timestampMs: 3700, groundSpeedMetersPerSecond: 2.6 });
      expect(emitted).toHaveLength(countAtMoving + 1);
      expect(emitted[emitted.length - 1].value).toBe('moving');
    });

    it('resets state and clears candidate timers on reset()', () => {
      detector.update({ timestampMs: 1000, groundSpeedMetersPerSecond: 2.5 });
      detector.update({ timestampMs: 2600, groundSpeedMetersPerSecond: 2.5 });
      expect(detector.getState()).toBe('moving');

      detector.reset();
      expect(detector.getState()).toBe('unknown');

      // Next update starts fresh
      detector.update({ timestampMs: 3000, groundSpeedMetersPerSecond: 0.1 });
      expect(detector.getState()).toBe('unknown');
    });
  });
});

export type BoatMotionState = 'moving' | 'stationary' | 'maneuvering' | 'unknown';
export type BoatMotionQuality = 'qualified' | 'degraded' | 'unusable';

export interface BoatMotionPolicy {
  policyVersion: string;
  maxLocationFreshnessMs: number;
  maxSpeedAccuracyMetersPerSecond: number;
  maxCourseAccuracyDegrees: number;
  movingEntrySpeedMetersPerSecond: number;
  movingExitSpeedMetersPerSecond: number;
  minMovingDurationMs: number;
  minStationaryDurationMs: number;
  maneuveringMinCourseChangeDegrees: number;
  maneuveringMaxWindowMs: number;
  maneuveringSpeedFloorMetersPerSecond: number;
}

export const DEFAULT_BOAT_MOTION_POLICY: BoatMotionPolicy = {
  policyVersion: '1.0.0',
  maxLocationFreshnessMs: 3500,
  maxSpeedAccuracyMetersPerSecond: 1.5,
  maxCourseAccuracyDegrees: 35.0,
  movingEntrySpeedMetersPerSecond: 0.85,
  movingExitSpeedMetersPerSecond: 0.60,
  minMovingDurationMs: 1500,
  minStationaryDurationMs: 2000,
  maneuveringMinCourseChangeDegrees: 35.0,
  maneuveringMaxWindowMs: 4000,
  maneuveringSpeedFloorMetersPerSecond: 0.50,
};

export interface BoatMotionEvidence {
  timestampMs: number;
  groundSpeedMetersPerSecond?: number | null;
  speedAccuracyMetersPerSecond?: number | null;
  courseDegrees?: number | null;
  courseAccuracyDegrees?: number | null;
  horizontalAccuracyMeters?: number | null;
  locationFreshnessMs?: number | null;
  sourceId?: string;
  recordingId?: string;
  nowEpochMs?: number;
}

export interface BoatMotionObservation {
  observationId: string;
  metricIdentifier: 'boatMotionState';
  value: BoatMotionState;
  quality: BoatMotionQuality;
  reason?: string;
  sourceIds: string[];
  recordingId?: string;
  observedAtEpochMilliseconds: number;
  evaluatedAtEpochMilliseconds: number;
  policyVersion: string;
}

export interface BoatMotionDetectorOptions {
  policy?: BoatMotionPolicy;
  onObservation?: (obs: BoatMotionObservation) => void | Promise<void>;
}

export class BoatMotionDetector {
  private readonly policy: BoatMotionPolicy;
  private readonly onObservation?: (obs: BoatMotionObservation) => void | Promise<void>;

  private currentState: BoatMotionState = 'unknown';
  private currentQuality: BoatMotionQuality = 'unusable';
  private currentReason?: string;

  private candidateState?: 'moving' | 'stationary';
  private candidateStartedAtMs?: number;

  private courseHistory: Array<{ timestampMs: number; courseDegrees: number }> = [];

  private lastEmittedContentKey?: string;
  private lastEmittedAtMs = 0;
  private observationSequence = 0;

  constructor(options?: BoatMotionDetectorOptions) {
    this.policy = options?.policy ?? DEFAULT_BOAT_MOTION_POLICY;
    this.onObservation = options?.onObservation;
  }

  getState(): BoatMotionState {
    return this.currentState;
  }

  getQuality(): BoatMotionQuality {
    return this.currentQuality;
  }

  getReason(): string | undefined {
    return this.currentReason;
  }

  reset(): void {
    this.currentState = 'unknown';
    this.currentQuality = 'unusable';
    this.currentReason = undefined;
    this.candidateState = undefined;
    this.candidateStartedAtMs = undefined;
    this.courseHistory = [];
    this.lastEmittedContentKey = undefined;
    this.lastEmittedAtMs = 0;
    this.observationSequence = 0;
  }

  update(evidence: BoatMotionEvidence): BoatMotionObservation {
    const now = evidence.nowEpochMs ?? Date.now();
    const timestampMs = evidence.timestampMs;

    const hasExplicitFreshness =
      evidence.locationFreshnessMs !== undefined && evidence.locationFreshnessMs !== null;
    const isStale =
      (hasExplicitFreshness && evidence.locationFreshnessMs! > this.policy.maxLocationFreshnessMs) ||
      (evidence.nowEpochMs !== undefined && evidence.nowEpochMs - timestampMs > this.policy.maxLocationFreshnessMs);

    // 1. Check quality & freshness
    if (evidence.groundSpeedMetersPerSecond === undefined || evidence.groundSpeedMetersPerSecond === null) {
      this.currentState = 'unknown';
      this.currentQuality = 'unusable';
      this.currentReason = 'missing_speed';
      this.candidateState = undefined;
      this.candidateStartedAtMs = undefined;
    } else if (isStale) {
      this.currentState = 'unknown';
      this.currentQuality = 'unusable';
      this.currentReason = 'stale_location';
      this.candidateState = undefined;
      this.candidateStartedAtMs = undefined;
    } else if (
      evidence.speedAccuracyMetersPerSecond !== undefined &&
      evidence.speedAccuracyMetersPerSecond !== null &&
      evidence.speedAccuracyMetersPerSecond > this.policy.maxSpeedAccuracyMetersPerSecond
    ) {
      this.currentState = 'unknown';
      this.currentQuality = 'degraded';
      this.currentReason = 'poor_speed_accuracy';
      this.candidateState = undefined;
      this.candidateStartedAtMs = undefined;
    } else {
      // Evidence is qualified!
      this.currentQuality = 'qualified';
      const speed = evidence.groundSpeedMetersPerSecond;

      // Update course history
      this.courseHistory = this.courseHistory.filter(
        item => timestampMs - item.timestampMs <= this.policy.maneuveringMaxWindowMs,
      );

      if (evidence.courseDegrees !== undefined && evidence.courseDegrees !== null) {
        const courseAcc = evidence.courseAccuracyDegrees;
        if (courseAcc === undefined || courseAcc === null || courseAcc <= this.policy.maxCourseAccuracyDegrees) {
          this.courseHistory.push({
            timestampMs,
            courseDegrees: evidence.courseDegrees,
          });
        }
      }

      // Check maneuvering
      let isManeuvering = false;
      if (
        speed >= this.policy.maneuveringSpeedFloorMetersPerSecond &&
        this.courseHistory.length >= 2
      ) {
        let maxDelta = 0;
        for (let i = 0; i < this.courseHistory.length; i++) {
          for (let j = i + 1; j < this.courseHistory.length; j++) {
            const diff = Math.abs(
              ((((this.courseHistory[j].courseDegrees - this.courseHistory[i].courseDegrees) % 360) + 540) % 360) - 180,
            );
            if (diff > maxDelta) maxDelta = diff;
          }
        }
        if (maxDelta >= this.policy.maneuveringMinCourseChangeDegrees) {
          isManeuvering = true;
        }
      }

      // State machine logic
      switch (this.currentState) {
        case 'unknown': {
          if (speed >= this.policy.movingEntrySpeedMetersPerSecond) {
            if (this.candidateState !== 'moving') {
              this.candidateState = 'moving';
              this.candidateStartedAtMs = timestampMs;
            }
            if (timestampMs - (this.candidateStartedAtMs ?? timestampMs) >= this.policy.minMovingDurationMs) {
              this.candidateState = undefined;
              this.candidateStartedAtMs = undefined;
              this.currentState = isManeuvering ? 'maneuvering' : 'moving';
              this.currentReason = isManeuvering ? 'maneuver_detected' : 'speed_exceeded_threshold';
            }
          } else if (speed < this.policy.movingExitSpeedMetersPerSecond) {
            if (this.candidateState !== 'stationary') {
              this.candidateState = 'stationary';
              this.candidateStartedAtMs = timestampMs;
            }
            if (timestampMs - (this.candidateStartedAtMs ?? timestampMs) >= this.policy.minStationaryDurationMs) {
              this.candidateState = undefined;
              this.candidateStartedAtMs = undefined;
              this.currentState = 'stationary';
              this.currentReason = 'sustained_stop';
            }
          } else {
            this.candidateState = undefined;
            this.candidateStartedAtMs = undefined;
          }
          break;
        }

        case 'stationary': {
          if (speed >= this.policy.movingEntrySpeedMetersPerSecond) {
            if (this.candidateState !== 'moving') {
              this.candidateState = 'moving';
              this.candidateStartedAtMs = timestampMs;
            }
            if (timestampMs - (this.candidateStartedAtMs ?? timestampMs) >= this.policy.minMovingDurationMs) {
              this.candidateState = undefined;
              this.candidateStartedAtMs = undefined;
              this.currentState = isManeuvering ? 'maneuvering' : 'moving';
              this.currentReason = isManeuvering ? 'maneuver_detected' : 'speed_exceeded_threshold';
            }
          } else {
            // Speed fluctuating below entry threshold (including jitter) resets moving candidate
            this.candidateState = undefined;
            this.candidateStartedAtMs = undefined;
          }
          break;
        }

        case 'moving': {
          if (speed < this.policy.movingExitSpeedMetersPerSecond) {
            if (this.candidateState !== 'stationary') {
              this.candidateState = 'stationary';
              this.candidateStartedAtMs = timestampMs;
            }
            if (timestampMs - (this.candidateStartedAtMs ?? timestampMs) >= this.policy.minStationaryDurationMs) {
              this.candidateState = undefined;
              this.candidateStartedAtMs = undefined;
              this.currentState = 'stationary';
              this.currentReason = 'sustained_stop';
            }
          } else {
            // Maintained speed above exit threshold
            this.candidateState = undefined;
            this.candidateStartedAtMs = undefined;
            if (isManeuvering) {
              this.currentState = 'maneuvering';
              this.currentReason = 'maneuver_detected';
            }
          }
          break;
        }

        case 'maneuvering': {
          if (speed < this.policy.movingExitSpeedMetersPerSecond) {
            if (this.candidateState !== 'stationary') {
              this.candidateState = 'stationary';
              this.candidateStartedAtMs = timestampMs;
            }
            if (timestampMs - (this.candidateStartedAtMs ?? timestampMs) >= this.policy.minStationaryDurationMs) {
              this.candidateState = undefined;
              this.candidateStartedAtMs = undefined;
              this.currentState = 'stationary';
              this.currentReason = 'sustained_stop';
            }
          } else {
            this.candidateState = undefined;
            this.candidateStartedAtMs = undefined;
            if (!isManeuvering) {
              this.currentState = 'moving';
              this.currentReason = 'course_stabilized';
            }
          }
          break;
        }
      }
    }

    const observation: BoatMotionObservation = {
      observationId: `obs:boatMotionState:${this.observationSequence++}`,
      metricIdentifier: 'boatMotionState',
      value: this.currentState,
      quality: this.currentQuality,
      reason: this.currentReason,
      sourceIds: [evidence.sourceId ?? 'phone:primary'],
      recordingId: evidence.recordingId,
      observedAtEpochMilliseconds: timestampMs,
      evaluatedAtEpochMilliseconds: now,
      policyVersion: this.policy.policyVersion,
    };

    const contentKey = `${this.currentState}|${this.currentQuality}|${this.currentReason ?? ''}`;
    const shouldEmit =
      this.lastEmittedContentKey !== contentKey ||
      timestampMs - this.lastEmittedAtMs >= 1000;

    if (shouldEmit) {
      this.lastEmittedContentKey = contentKey;
      this.lastEmittedAtMs = timestampMs;
      this.onObservation?.(observation);
    }

    return observation;
  }
}

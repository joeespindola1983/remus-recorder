export type StrokeQualityFlag =
  | 'IMU_SATURATION'
  | 'CLOCK_SYNC_LOW_CONFIDENCE'
  | 'MISSING_LEFT'
  | 'MISSING_RIGHT'
  | 'BAD_PERIOD'
  | 'OUTLIER'
  | 'GPS_UNAVAILABLE'
  | 'BOAT_AXIS_UNCALIBRATED';

export interface StrokeEvent {
  strokeIndex: number;
  previousCatchTimeUs: number;
  catchTimeUs: number;
  finishTimeUs: number;
  nextCatchTimeUs: number;
  driveDurationMs: number;
  recoveryDurationMs: number;
  cycleDurationMs: number;
  spm: number;
  squareStartTimeUs?: number;
  squareEndTimeUs?: number;
  featherStartTimeUs?: number;
  featherEndTimeUs?: number;
  catchAngleRelativeDegrees?: number;
  finishAngleRelativeDegrees?: number;
  strokeArcRelativeDegrees?: number;
  catchConfidence: number;
  finishConfidence: number;
  qualityFlags: StrokeQualityFlag[];
  isValidForTiming: boolean;
  isValidForMotionProfile: boolean;
  isValidForBoatResponse: boolean;
}

export interface PairedStroke {
  leftStroke: StrokeEvent;
  rightStroke: StrokeEvent;
  catchDeltaMs: number;
  finishDeltaMs: number;
  driveDurationDeltaMs: number;
  recoveryDurationDeltaMs: number;
  strokeDurationDeltaMs: number;
  squareTimingDeltaMs?: number;
  featherTimingDeltaMs?: number;
  confidence: number;
  timingUncertaintyMs?: number;
  isTimingQualified?: boolean;
}

const percentile = (values: number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const standardDeviation = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
};

const coefficientOfVariation = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return mean === 0 ? null : (standardDeviation(values) ?? 0) / Math.abs(mean);
};

export const pairStrokes = (
  left: StrokeEvent[],
  right: StrokeEvent[],
  maximumCatchSeparationMs = 250,
  options?: {
    clockUncertaintyMs?: number;
  },
): PairedStroke[] => {
  const result: PairedStroke[] = [];
  const usedRight = new Set<number>();
  const timingUncertaintyMs = options?.clockUncertaintyMs;
  for (const leftStroke of left) {
    let bestIndex = -1;
    let bestSeparationUs = Number.POSITIVE_INFINITY;
    right.forEach((rightStroke, index) => {
      if (usedRight.has(index)) return;
      const separation = Math.abs(leftStroke.catchTimeUs - rightStroke.catchTimeUs);
      if (separation < bestSeparationUs) {
        bestIndex = index;
        bestSeparationUs = separation;
      }
    });
    if (bestIndex < 0 || bestSeparationUs > maximumCatchSeparationMs * 1000) continue;
    usedRight.add(bestIndex);
    const rightStroke = right[bestIndex];
    const squareDelta = leftStroke.squareStartTimeUs !== undefined && rightStroke.squareStartTimeUs !== undefined
      ? (leftStroke.squareStartTimeUs - rightStroke.squareStartTimeUs) / 1000 : undefined;
    const featherDelta = leftStroke.featherStartTimeUs !== undefined && rightStroke.featherStartTimeUs !== undefined
      ? (leftStroke.featherStartTimeUs - rightStroke.featherStartTimeUs) / 1000 : undefined;
    const isTimingQualified = leftStroke.isValidForTiming && rightStroke.isValidForTiming &&
      (timingUncertaintyMs === undefined || timingUncertaintyMs <= 10);
    result.push({
      leftStroke,
      rightStroke,
      catchDeltaMs: (leftStroke.catchTimeUs - rightStroke.catchTimeUs) / 1000,
      finishDeltaMs: (leftStroke.finishTimeUs - rightStroke.finishTimeUs) / 1000,
      driveDurationDeltaMs: leftStroke.driveDurationMs - rightStroke.driveDurationMs,
      recoveryDurationDeltaMs: leftStroke.recoveryDurationMs - rightStroke.recoveryDurationMs,
      strokeDurationDeltaMs: leftStroke.cycleDurationMs - rightStroke.cycleDurationMs,
      squareTimingDeltaMs: squareDelta,
      featherTimingDeltaMs: featherDelta,
      confidence: Math.min(
        leftStroke.catchConfidence,
        leftStroke.finishConfidence,
        rightStroke.catchConfidence,
        rightStroke.finishConfidence,
      ),
      timingUncertaintyMs,
      isTimingQualified,
    });
  }
  return result;
};

export const summarizePairedStrokes = (pairs: PairedStroke[]) => {
  const catchDeltas = pairs.map(pair => pair.catchDeltaMs);
  const finishDeltas = pairs.map(pair => pair.finishDeltaMs);
  const absCatch = catchDeltas.map(Math.abs);
  const absFinish = finishDeltas.map(Math.abs);
  return {
    pairedStrokeCount: pairs.length,
    catchDeltaMedianMs: median(catchDeltas),
    medianAbsCatchDeltaMs: median(absCatch),
    p90AbsCatchDeltaMs: percentile(absCatch, 0.9),
    catchDeltaStdDev: standardDeviation(catchDeltas),
    finishDeltaMedianMs: median(finishDeltas),
    medianAbsFinishDeltaMs: median(absFinish),
    p90AbsFinishDeltaMs: percentile(absFinish, 0.9),
    finishDeltaStdDev: standardDeviation(finishDeltas),
    leftMedianDriveMs: median(pairs.map(pair => pair.leftStroke.driveDurationMs)),
    rightMedianDriveMs: median(pairs.map(pair => pair.rightStroke.driveDurationMs)),
    leftMedianRecoveryMs: median(pairs.map(pair => pair.leftStroke.recoveryDurationMs)),
    rightMedianRecoveryMs: median(pairs.map(pair => pair.rightStroke.recoveryDurationMs)),
    driveDeltaMs: median(pairs.map(pair => pair.driveDurationDeltaMs)),
    recoveryDeltaMs: median(pairs.map(pair => pair.recoveryDurationDeltaMs)),
    strokeDurationCV: coefficientOfVariation(pairs.flatMap(pair => [
      pair.leftStroke.cycleDurationMs,
      pair.rightStroke.cycleDurationMs,
    ])),
    catchTimingCV: coefficientOfVariation(absCatch),
    finishTimingCV: coefficientOfVariation(absFinish),
    squareLeadLagMs: median(pairs.flatMap(pair => pair.squareTimingDeltaMs === undefined ? [] : [pair.squareTimingDeltaMs])),
    featherLeadLagMs: median(pairs.flatMap(pair => pair.featherTimingDeltaMs === undefined ? [] : [pair.featherTimingDeltaMs])),
  };
};

export interface SemanticBladeMotionPoint {
  timestampUs: number;
  oarSweepAngularVelocity: number;
  featherSquareAngularVelocity: number;
  oarVerticalAngularVelocity: number;
}

export interface NormalizedMotionPoint extends Omit<SemanticBladeMotionPoint, 'timestampUs'> {
  strokePercent: number;
}

const interpolate = (left: SemanticBladeMotionPoint, right: SemanticBladeMotionPoint, ratio: number) => ({
  oarSweepAngularVelocity: left.oarSweepAngularVelocity + (right.oarSweepAngularVelocity - left.oarSweepAngularVelocity) * ratio,
  featherSquareAngularVelocity: left.featherSquareAngularVelocity + (right.featherSquareAngularVelocity - left.featherSquareAngularVelocity) * ratio,
  oarVerticalAngularVelocity: left.oarVerticalAngularVelocity + (right.oarVerticalAngularVelocity - left.oarVerticalAngularVelocity) * ratio,
});

export const normalizeStrokeFingerprint = (
  samples: SemanticBladeMotionPoint[],
  catchTimeUs: number,
  nextCatchTimeUs: number,
): NormalizedMotionPoint[] => {
  if (samples.length < 2 || nextCatchTimeUs <= catchTimeUs) return [];
  const ordered = [...samples].sort((a, b) => a.timestampUs - b.timestampUs);
  return Array.from({length: 101}, (_, strokePercent) => {
    const timestampUs = catchTimeUs + (nextCatchTimeUs - catchTimeUs) * strokePercent / 100;
    let rightIndex = ordered.findIndex(point => point.timestampUs >= timestampUs);
    if (rightIndex <= 0) rightIndex = 1;
    if (rightIndex < 0) rightIndex = ordered.length - 1;
    const left = ordered[rightIndex - 1];
    const right = ordered[rightIndex];
    const denominator = right.timestampUs - left.timestampUs;
    const ratio = denominator <= 0 ? 0 : Math.max(0, Math.min(1, (timestampUs - left.timestampUs) / denominator));
    return {strokePercent, ...interpolate(left, right, ratio)};
  });
};

export interface BladeSideInferenceInput {
  firstSourceId: string;
  secondSourceId: string;
  rememberedPortSourceId?: string;
  sameAssignmentScore: number;
  swappedAssignmentScore: number;
  qualifiedCycleCount: number;
}

export interface BladeSideInferenceResult {
  status: 'validated' | 'swap_suggested' | 'low_confidence' | 'anchor_required';
  portSourceId?: string;
  starboardSourceId?: string;
  confidence: number;
}

export const inferRememberedBladeSides = (input: BladeSideInferenceInput): BladeSideInferenceResult => {
  if (!input.rememberedPortSourceId) return {status: 'anchor_required', confidence: 0};
  const difference = Math.abs(input.sameAssignmentScore - input.swappedAssignmentScore);
  const confidence = Math.max(0, Math.min(1, difference));
  const rememberedIsFirst = input.rememberedPortSourceId === input.firstSourceId;
  const rememberedStarboard = rememberedIsFirst ? input.secondSourceId : input.firstSourceId;
  if (input.qualifiedCycleCount < 3 || confidence < 0.2) {
    return {
      status: 'low_confidence',
      portSourceId: input.rememberedPortSourceId,
      starboardSourceId: rememberedStarboard,
      confidence,
    };
  }
  if (input.swappedAssignmentScore > input.sameAssignmentScore) {
    return {
      status: 'swap_suggested',
      portSourceId: rememberedStarboard,
      starboardSourceId: input.rememberedPortSourceId,
      confidence,
    };
  }
  return {
    status: 'validated',
    portSourceId: input.rememberedPortSourceId,
    starboardSourceId: rememberedStarboard,
    confidence,
  };
};

export type StrokePhase = 'RECOVERY' | 'SQUARING' | 'CATCH' | 'DRIVE' | 'FINISH' | 'FEATHERING';

export interface StrokeDetectionSample extends SemanticBladeMotionPoint {
  accelerationMagnitudeG: number;
  saturated: boolean;
  clockQualified: boolean;
}

interface CandidateStroke {
  previousCatchTimeUs: number;
  catchTimeUs: number;
  finishTimeUs?: number;
  squareStartTimeUs?: number;
  squareEndTimeUs?: number;
  featherStartTimeUs?: number;
  featherEndTimeUs?: number;
  catchConfidence: number;
  finishConfidence: number;
  qualityFlags: Set<StrokeQualityFlag>;
}

export class StrokeEventDetector {
  detect(samples: StrokeDetectionSample[]): StrokeEvent[] {
    if (samples.length < 3) return [];
    const ordered = [...samples].sort((a, b) => a.timestampUs - b.timestampUs);
    let phase: StrokePhase = 'RECOVERY';
    let lastCatchUs: number | null = null;
    let candidate: CandidateStroke | null = null;
    const completed: CandidateStroke[] = [];

    for (const sample of ordered) {
      if (candidate?.qualityFlags && sample.saturated) candidate.qualityFlags.add('IMU_SATURATION');
      if (candidate?.qualityFlags && !sample.clockQualified) candidate.qualityFlags.add('CLOCK_SYNC_LOW_CONFIDENCE');
      const squareSignal = sample.featherSquareAngularVelocity > 0.55;
      const featherSignal = sample.featherSquareAngularVelocity < -0.55;
      const driveSignal = sample.oarSweepAngularVelocity > 0.75;
      const recoverySignal = sample.oarSweepAngularVelocity < 0.15;
      const catchImpulse = sample.accelerationMagnitudeG > 1.25 ||
        Math.abs(sample.oarVerticalAngularVelocity) > 0.45;

      if (phase === 'RECOVERY' && squareSignal) {
        phase = 'SQUARING';
        candidate = {
          previousCatchTimeUs: lastCatchUs ?? sample.timestampUs,
          catchTimeUs: 0,
          squareStartTimeUs: sample.timestampUs,
          catchConfidence: 0,
          finishConfidence: 0,
          qualityFlags: new Set(),
        };
      } else if (phase === 'SQUARING' && driveSignal && catchImpulse && candidate) {
        const periodUs = lastCatchUs === null ? null : sample.timestampUs - lastCatchUs;
        if (periodUs !== null && (periodUs < 600_000 || periodUs > 6_000_000)) {
          candidate.qualityFlags.add('BAD_PERIOD');
        }
        candidate.catchTimeUs = sample.timestampUs;
        candidate.squareEndTimeUs = sample.timestampUs;
        candidate.catchConfidence = Math.min(1,
          0.45 + Math.min(0.25, (sample.oarSweepAngularVelocity - 0.75) / 4) +
          (catchImpulse ? 0.2 : 0) + (squareSignal ? 0.15 : 0));
        lastCatchUs = sample.timestampUs;
        phase = 'DRIVE';
      } else if (phase === 'SQUARING' && !squareSignal && !driveSignal) {
        phase = 'RECOVERY';
        candidate = null;
      } else if (phase === 'DRIVE' && recoverySignal && featherSignal && candidate) {
        candidate.finishTimeUs = sample.timestampUs;
        candidate.featherStartTimeUs = sample.timestampUs;
        candidate.finishConfidence = Math.min(1, 0.55 + (featherSignal ? 0.2 : 0) + (recoverySignal ? 0.2 : 0));
        phase = 'FEATHERING';
      } else if (phase === 'FEATHERING' && !featherSignal && candidate?.finishTimeUs) {
        candidate.featherEndTimeUs = sample.timestampUs;
        completed.push(candidate);
        candidate = null;
        phase = 'RECOVERY';
      }
    }

    const strokes: StrokeEvent[] = [];
    for (let index = 0; index + 1 < completed.length; index += 1) {
      const current = completed[index];
      const next = completed[index + 1];
      if (!current.finishTimeUs || current.catchTimeUs === 0 || next.catchTimeUs === 0) continue;
      const cycleDurationMs = (next.catchTimeUs - current.catchTimeUs) / 1000;
      const driveDurationMs = (current.finishTimeUs - current.catchTimeUs) / 1000;
      const flags = [...current.qualityFlags];
      const cycleValid = !flags.includes('BAD_PERIOD') && cycleDurationMs > 0;
      const timingValid = cycleValid && !flags.includes('CLOCK_SYNC_LOW_CONFIDENCE');
      strokes.push({
        strokeIndex: strokes.length,
        previousCatchTimeUs: current.previousCatchTimeUs,
        catchTimeUs: current.catchTimeUs,
        finishTimeUs: current.finishTimeUs,
        nextCatchTimeUs: next.catchTimeUs,
        driveDurationMs,
        recoveryDurationMs: cycleDurationMs - driveDurationMs,
        cycleDurationMs,
        spm: cycleDurationMs > 0 ? 60_000 / cycleDurationMs : 0,
        squareStartTimeUs: current.squareStartTimeUs,
        squareEndTimeUs: current.squareEndTimeUs,
        featherStartTimeUs: current.featherStartTimeUs,
        featherEndTimeUs: current.featherEndTimeUs,
        catchConfidence: current.catchConfidence,
        finishConfidence: current.finishConfidence,
        qualityFlags: flags,
        isValidForTiming: timingValid,
        isValidForMotionProfile: cycleValid && !flags.includes('IMU_SATURATION'),
        isValidForBoatResponse: timingValid,
      });
    }
    return strokes;
  }
}

export interface FingerprintBandPoint {
  strokePercent: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
}

export const aggregateFingerprintChannel = (
  fingerprints: NormalizedMotionPoint[][],
  channel: keyof Omit<NormalizedMotionPoint, 'strokePercent'>,
): FingerprintBandPoint[] => Array.from({length: 101}, (_, strokePercent) => {
  const values = fingerprints
    .map(fingerprint => fingerprint[strokePercent]?.[channel])
    .filter((value): value is number => Number.isFinite(value));
  return {
    strokePercent,
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    median: median(values) ?? 0,
    p10: percentile(values, 0.1) ?? 0,
    p90: percentile(values, 0.9) ?? 0,
  };
});

export interface LongitudinalBoatSample {
  timestampUs: number;
  longitudinalAccelerationG: number;
}

export interface BoatResponseMetric {
  pairedCatchTimeUs: number;
  boatAccelAtCatch: number | null;
  minBoatAccelBeforeCatch: number | null;
  timeToMinAccelMs: number | null;
  timeToPositiveAccelAfterCatchMs: number | null;
  peakDriveAccel: number | null;
  timeToPeakDriveAccelMs: number | null;
  connectionDelayMs: number | null;
  experimental: true;
}

const closest = (samples: LongitudinalBoatSample[], timestampUs: number) => samples.reduce<LongitudinalBoatSample | null>(
  (best, sample) => !best || Math.abs(sample.timestampUs - timestampUs) < Math.abs(best.timestampUs - timestampUs)
    ? sample : best,
  null,
);

export const extractBoatResponse = (
  samples: LongitudinalBoatSample[],
  pairedCatchTimeUs: number,
): BoatResponseMetric => {
  const window = samples.filter(sample =>
    sample.timestampUs >= pairedCatchTimeUs - 750_000 &&
    sample.timestampUs <= pairedCatchTimeUs + 1_500_000);
  const before = window.filter(sample => sample.timestampUs <= pairedCatchTimeUs);
  const after = window.filter(sample => sample.timestampUs >= pairedCatchTimeUs);
  const atCatch = closest(window, pairedCatchTimeUs);
  const minimum = before.length
    ? before.reduce((best, sample) => sample.longitudinalAccelerationG < best.longitudinalAccelerationG ? sample : best)
    : null;
  const peak = after.length
    ? after.reduce((best, sample) => sample.longitudinalAccelerationG > best.longitudinalAccelerationG ? sample : best)
    : null;
  const positive = after.find(sample => sample.longitudinalAccelerationG > 0) ?? null;
  return {
    pairedCatchTimeUs,
    boatAccelAtCatch: atCatch?.longitudinalAccelerationG ?? null,
    minBoatAccelBeforeCatch: minimum?.longitudinalAccelerationG ?? null,
    timeToMinAccelMs: minimum ? (minimum.timestampUs - pairedCatchTimeUs) / 1000 : null,
    timeToPositiveAccelAfterCatchMs: positive ? (positive.timestampUs - pairedCatchTimeUs) / 1000 : null,
    peakDriveAccel: peak?.longitudinalAccelerationG ?? null,
    timeToPeakDriveAccelMs: peak ? (peak.timestampUs - pairedCatchTimeUs) / 1000 : null,
    connectionDelayMs: positive ? (positive.timestampUs - pairedCatchTimeUs) / 1000 : null,
    experimental: true,
  };
};

export interface PipelineDiagnostics {
  leftDetectedStrokes: number;
  rightDetectedStrokes: number;
  pairedStrokes: number;
  rejectedClockSync: number;
  rejectedConfidence: number;
  rejectedOrientation: number;
  rejectedPeriod: number;
  unpairedLeft: number;
  unpairedRight: number;
  rejectionReasons: string[];
}

export interface PipelineDiagnosticsInput {
  leftStrokes: StrokeEvent[];
  rightStrokes: StrokeEvent[];
  pairedStrokes: PairedStroke[];
  leftSampleCount?: number;
  rightSampleCount?: number;
  clockSyncQuality?: 'qualified' | 'approximate' | 'low_confidence';
  clockUncertaintyMs?: number;
  mountingQualified?: boolean;
}

export const createPipelineDiagnostics = (input: PipelineDiagnosticsInput): PipelineDiagnostics => {
  const leftCount = input.leftStrokes.length;
  const rightCount = input.rightStrokes.length;
  const pairedCount = input.pairedStrokes.length;

  let rejectedClockSync = 0;
  let rejectedConfidence = 0;
  let rejectedPeriod = 0;
  let rejectedOrientation = 0;
  const rejectionReasons: string[] = [];

  const allStrokes = [...input.leftStrokes, ...input.rightStrokes];
  for (const s of allStrokes) {
    if (s.qualityFlags.includes('CLOCK_SYNC_LOW_CONFIDENCE') || !s.isValidForTiming) {
      rejectedClockSync += 1;
    }
    if (s.qualityFlags.includes('BAD_PERIOD')) {
      rejectedPeriod += 1;
    }
    if (s.catchConfidence < 0.5 || s.finishConfidence < 0.5) {
      rejectedConfidence += 1;
    }
    if (s.qualityFlags.includes('BOAT_AXIS_UNCALIBRATED')) {
      rejectedOrientation += 1;
    }
  }

  if (input.clockSyncQuality === 'low_confidence' || (input.clockUncertaintyMs !== undefined && input.clockUncertaintyMs > 10)) {
    if (!rejectionReasons.includes('CLOCK_SYNC_LOW_CONFIDENCE')) {
      rejectionReasons.push('CLOCK_SYNC_LOW_CONFIDENCE');
    }
  }
  if (allStrokes.some(s => s.qualityFlags.includes('CLOCK_SYNC_LOW_CONFIDENCE')) && !rejectionReasons.includes('CLOCK_SYNC_LOW_CONFIDENCE')) {
    rejectionReasons.push('CLOCK_SYNC_LOW_CONFIDENCE');
  }
  if (allStrokes.some(s => s.qualityFlags.includes('BAD_PERIOD')) && !rejectionReasons.includes('BAD_PERIOD')) {
    rejectionReasons.push('BAD_PERIOD');
  }
  if (input.mountingQualified === false && !rejectionReasons.includes('MOUNTING_UNCALIBRATED')) {
    rejectionReasons.push('MOUNTING_UNCALIBRATED');
  }
  if (leftCount === 0 && (input.leftSampleCount ?? 0) > 0) {
    rejectionReasons.push('NO_LEFT_STROKES_DETECTED');
  }
  if (rightCount === 0 && (input.rightSampleCount ?? 0) > 0) {
    rejectionReasons.push('NO_RIGHT_STROKES_DETECTED');
  }

  return {
    leftDetectedStrokes: leftCount,
    rightDetectedStrokes: rightCount,
    pairedStrokes: pairedCount,
    rejectedClockSync,
    rejectedConfidence,
    rejectedOrientation,
    rejectedPeriod,
    unpairedLeft: Math.max(0, leftCount - pairedCount),
    unpairedRight: Math.max(0, rightCount - pairedCount),
    rejectionReasons,
  };
};

export interface AnalysisVersionsAndOptions {
  algorithmVersion?: string;
  calibrationVersion?: string;
  clockSyncVersion?: string;
  clockSyncQuality?: 'qualified' | 'approximate' | 'low_confidence';
  clockUncertaintyMs?: number;
  mountingQualified?: boolean;
  leftSampleCount?: number;
  rightSampleCount?: number;
}

export interface AnalysisResult {
  algorithmVersion: string;
  calibrationVersion: string;
  clockSyncVersion: string;
  sessionMetrics: ReturnType<typeof summarizePairedStrokes>;
  strokes: StrokeEvent[];
  pairedStrokes: PairedStroke[];
  pairedStrokesAll: PairedStroke[];
  pairedStrokesReliable: PairedStroke[];
  pipelineDiagnostics: PipelineDiagnostics;
  segments: Array<{segmentId: string; firstStrokeIndex: number; lastStrokeIndex: number}>;
}

export const createAnalysisResult = (
  leftStrokes: StrokeEvent[],
  rightStrokes: StrokeEvent[],
  options: AnalysisVersionsAndOptions = {},
): AnalysisResult => {
  const algorithmVersion = options.algorithmVersion ?? '1.0.0';
  const calibrationVersion = options.calibrationVersion ?? '1.0.0';
  const clockSyncVersion = options.clockSyncVersion ?? '1.0.0';

  const pairedStrokesAll = pairStrokes(leftStrokes, rightStrokes, 250, {
    clockUncertaintyMs: options.clockUncertaintyMs,
  });
  const pairedStrokesReliable = pairedStrokesAll.filter(p => p.isTimingQualified);
  const pipelineDiagnostics = createPipelineDiagnostics({
    leftStrokes,
    rightStrokes,
    pairedStrokes: pairedStrokesAll,
    leftSampleCount: options.leftSampleCount,
    rightSampleCount: options.rightSampleCount,
    clockSyncQuality: options.clockSyncQuality,
    clockUncertaintyMs: options.clockUncertaintyMs,
    mountingQualified: options.mountingQualified,
  });

  return {
    algorithmVersion,
    calibrationVersion,
    clockSyncVersion,
    sessionMetrics: summarizePairedStrokes(pairedStrokesAll),
    strokes: [...leftStrokes, ...rightStrokes],
    pairedStrokes: pairedStrokesAll,
    pairedStrokesAll,
    pairedStrokesReliable,
    pipelineDiagnostics,
    segments: [],
  };
};

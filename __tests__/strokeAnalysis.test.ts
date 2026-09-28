import {
  pairStrokes,
  summarizePairedStrokes,
  StrokeEvent,
  inferRememberedBladeSides,
  normalizeStrokeFingerprint,
  StrokeEventDetector,
} from '../src/analysis/rowing/StrokeAnalysis';

const stroke = (index: number, catchTimeUs: number, finishTimeUs: number): StrokeEvent => ({
  strokeIndex: index,
  previousCatchTimeUs: catchTimeUs - 2_000_000,
  catchTimeUs,
  finishTimeUs,
  nextCatchTimeUs: catchTimeUs + 2_000_000,
  driveDurationMs: (finishTimeUs - catchTimeUs) / 1000,
  recoveryDurationMs: (catchTimeUs + 2_000_000 - finishTimeUs) / 1000,
  cycleDurationMs: 2000,
  spm: 30,
  catchConfidence: 0.95,
  finishConfidence: 0.9,
  qualityFlags: [],
  isValidForTiming: true,
  isValidForMotionProfile: true,
  isValidForBoatResponse: false,
});

describe('rowing stroke analysis', () => {
  it('pairs independently detected strokes and keeps LEFT - RIGHT sign', () => {
    const paired = pairStrokes(
      [stroke(0, 1_020_000, 1_720_000)],
      [stroke(0, 1_000_000, 1_690_000)],
      100,
    );
    expect(paired).toHaveLength(1);
    expect(paired[0]).toMatchObject({catchDeltaMs: 20, finishDeltaMs: 30});
  });

  it('separates bilateral bias from variability', () => {
    const pairs = pairStrokes(
      [stroke(0, 1_020_000, 1_720_000), stroke(1, 3_010_000, 3_710_000)],
      [stroke(0, 1_000_000, 1_700_000), stroke(1, 3_000_000, 3_700_000)],
      100,
    );
    expect(summarizePairedStrokes(pairs)).toMatchObject({
      pairedStrokeCount: 2,
      catchDeltaMedianMs: 15,
      medianAbsCatchDeltaMs: 15,
      p90AbsCatchDeltaMs: 20,
    });
  });

  it('normalizes a stroke to 101 points without inventing absolute angles', () => {
    const points = normalizeStrokeFingerprint([
      {timestampUs: 0, oarSweepAngularVelocity: 0, featherSquareAngularVelocity: 0, oarVerticalAngularVelocity: 0},
      {timestampUs: 500_000, oarSweepAngularVelocity: 10, featherSquareAngularVelocity: 4, oarVerticalAngularVelocity: 2},
      {timestampUs: 1_000_000, oarSweepAngularVelocity: 0, featherSquareAngularVelocity: 0, oarVerticalAngularVelocity: 0},
    ], 0, 1_000_000);
    expect(points).toHaveLength(101);
    expect(points[50].oarSweepAngularVelocity).toBeCloseTo(10);
  });

  it('restores remembered sides and reports a swap when motion evidence is stronger', () => {
    expect(inferRememberedBladeSides({
      firstSourceId: 'blade:a',
      secondSourceId: 'blade:b',
      rememberedPortSourceId: 'blade:a',
      sameAssignmentScore: 0.2,
      swappedAssignmentScore: 0.9,
      qualifiedCycleCount: 5,
    })).toMatchObject({status: 'swap_suggested', confidence: 0.7});
  });

  it('does not fabricate absolute side without a remembered anchor', () => {
    expect(inferRememberedBladeSides({
      firstSourceId: 'blade:a',
      secondSourceId: 'blade:b',
      sameAssignmentScore: 0.9,
      swappedAssignmentScore: 0.1,
      qualifiedCycleCount: 5,
    }).status).toBe('anchor_required');
  });

  it('detects catch and finish from a semantic state transition instead of a single peak', () => {
    const detector = new StrokeEventDetector();
    const samples = [];
    for (let index = 0; index < 650; index += 1) {
      const phase = index % 200;
      samples.push({
        timestampUs: index * 10_000,
        oarSweepAngularVelocity: phase >= 40 && phase < 105 ? 1.8 : -0.45,
        featherSquareAngularVelocity: phase >= 25 && phase < 45 ? 1.2 : phase >= 105 && phase < 125 ? -1.1 : 0,
        oarVerticalAngularVelocity: phase >= 35 && phase < 45 ? -0.8 : 0,
        accelerationMagnitudeG: phase >= 40 && phase < 48 ? 1.6 : 1,
        saturated: false,
        clockQualified: true,
      });
    }

    const strokes = detector.detect(samples);

    expect(strokes.length).toBeGreaterThanOrEqual(2);
    expect(strokes[0].driveDurationMs).toBeGreaterThan(500);
    expect(strokes[0].catchConfidence).toBeGreaterThan(0.7);
    expect(strokes[0].qualityFlags).toEqual([]);
  });
});

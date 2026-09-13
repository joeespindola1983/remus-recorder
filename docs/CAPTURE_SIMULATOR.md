# Deterministic capture simulator

## Purpose

The simulator is a pure application-layer fake for exercising capture and
store-and-forward behavior before native device integrations exist. It uses the
same canonical `activity`, source-local `recording`, artifact-transfer and
persistence-verification boundaries as production code. It is not a durable
evidence store and does not claim that simulated data was physically captured.

## Independent state dimensions

- Activity and per-source recording lifecycle are owned by `ActivityCapture`.
- Source transport is `connected`, `disconnected` or
  `disconnected_recovering`. Transport loss does not end a capable source's
  recording.
- Artifact transfer tracks accepted byte ranges, exact offsets and range
  digests. An exact repeated range is idempotent; a gap, overlap conflict or
  changed digest is rejected.
- Persistence verification is allowed only after the complete artifact length
  has transferred.
- App storage separates evidence/staging bytes from regenerable bytes. Pressure
  blocks transfer at the current offset; only regenerable data is evicted by the
  simulator recovery action.

All artifact lengths and offsets are decimal integer strings and are evaluated
with `BigInt`. This matches the acquisition contract and avoids unsafe 64-bit
rounding in JavaScript.

## Shared scenarios

`src/application/simulation/scenarios.ts` contains deterministic fixtures for:

1. app-only capture and finalization;
2. Apple Watch power depletion while the activity and phone continue;
3. RBP1 transport loss with store-and-forward recovery, exact range resume and
   persistence verification;
4. storage pressure, regenerable-data eviction and retry from the unchanged
   offset.

The React Native demo dispatches the same `CaptureScenarioStep` contract used by
these fixtures. Future native fake hosts should translate their callbacks into
these application events rather than bypassing the reducer.

## Verification

Run `npm run verify`. The simulator tests require deterministic replay, bounded
source coverage, partial-transfer rejection, idempotent range replay, exact
offsets, storage protection and source/activity independence.

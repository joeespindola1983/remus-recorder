# Remus Recorder 2.3.0

## Recording-local telemetry diagnostics

- Decoder counters, saturation accounting and expected packet sequences now
  start at each recording boundary instead of leaking across activities.
- Native sample gaps are calculated only between consecutive sample sequences,
  keeping missing and reordered packet diagnostics separate from clock gaps.

## Live presentation evidence

- Pace and stroke-rate presentation changes are now persisted in the evidence
  package with canonical metric, numeric value or null, rendered text,
  availability, reason, source and presentation time.
- Below-threshold pace, unavailable SPM and telemetry timeout remain distinct
  from measured zero values.
- iOS and Android native evidence stores export the new
  `live-metric-presentation.ndjson` stream.

## Clock mapping

- Remus clock synchronization now fits offset and drift from multiple
  observations biased toward the lower-RTT envelope.
- A final high-latency BLE exchange no longer replaces a better supported
  mapping by itself.

## Platform versions

- Android: `versionCode 19`, `versionName "2.3.0"`.
- iOS and Watch App: `CURRENT_PROJECT_VERSION = 19`,
  `MARKETING_VERSION = 2.3.0`.

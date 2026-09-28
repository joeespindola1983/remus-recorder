# Remus Recorder 2.2.0

## Capture integrity

- Resolve a Remus Blade to the canonical `blade:<identity_hash>` source identifier
  advertised in `REMUS-BLD-XXXXXXXX`, rather than creating a second source from
  an operating-system Bluetooth identifier.
- Apply the same source resolution in TypeScript, iOS evidence persistence, and
  Android evidence persistence.
- Read and decode the versioned Device Info characteristic exposed by Remus
  firmware, including device family/model, firmware, serial number, sample rate,
  accelerometer range, and gyroscope range.
- Track transport notifications, decoded batches, decoded IMU samples, invalid
  notifications, and pending fragment groups as separate counters in the stream
  decoder. This prevents BLE notification counts from being interpreted as IMU
  sample counts by new integrations.
- Count accelerometer and gyroscope rail saturation independently for X/Y/Z,
  including the percentage of samples with any saturated axis.
- Persist per-source telemetry diagnostics, effective Device Info configuration,
  and the latest qualified clock mapping in the session manifest.
- Exchange monotonic T1/T2/T3/T4 timestamps every 10 seconds. Samples retain
  their source timestamp and receive a common-timeline timestamp only when a
  bounded mapping is available.

## Compatibility

- Existing evidence package schema `1.0.0` and legacy `sampleCounts` remain
  readable and unchanged in this release.
- Blade packets remain protocol version 1. The new accounting API and Device
  Info decoding are additive.

## Measurement safety

- BLE delivery delay remains distinct from a source sequence or timestamp gap.
- Clock mappings expose round trip, maximum error, drift estimate and quality;
  low-confidence mappings are retained but not presented as precise timing.
- Existing explicit equipment-side assignment remains authoritative until the
  mounting hypothesis has enough qualified stroke evidence to validate a side.

## Rowing analysis foundation

- Added a versioned mounting calibration from the physical hand-to-blade and
  blade-face marks into semantic sweep, feather/square and vertical axes.
- Added a multi-signal `StrokeEventDetector` state machine covering recovery,
  squaring, catch, drive, finish and feathering with confidence and quality flags.
- Added independent left/right stroke pairing with the fixed `LEFT - RIGHT`
  delta convention, bias/variability summaries and 101-point fingerprints.
- Added remembered-side validation that can suggest a swapped installation but
  never invents an absolute boat side without a persistent anchor.
- Added experimental catch-to-longitudinal-boat-response extraction. It remains
  unavailable until the Remus Computer longitudinal axis is calibrated.

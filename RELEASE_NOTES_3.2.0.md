# Remus Recorder 3.2.0

Minor release for phone-centralized 5 Hz Remus Computer GNSS evidence.

- Subscribes to and preserves the new binary GNSS stream with CRC, sequence and
  source-native timestamps.
- Exports normalized `remus-computer-location.ndjson` while retaining every
  original BLE notification in `remus-blade-live.ndjson`.
- Prefers recent, qualified Remus Computer Doppler speed for live pace and boat
  motion, with phone location as fallback.
- Uses `supportedAtNativeTimestamp` plus `clockDomainId` for Computer-supported
  presentations rather than placing ESP32 time in an Epoch field.
- Exports real hardware recording segments and clock domains in Manifest 1.1.0,
  with recording-local sample counts and no connection history leakage.
- Exposes the missing iOS `appendBoatMotionObservation` bridge method.
- Adds RBP2 GNSS record decoding for future MicroSD store-and-forward.

Application version: 3.2.0 (build 23) on iOS, watchOS, Android and Wear OS.
No APK or IPA is generated as part of this release.

# Remus Recorder 3.1.0

Release date: 2026-09-29

- Exports evidence packages with manifest schema 1.1.0 and canonical `recordings[]` entries on iOS and Android.
- Preserves source-native support timestamps with their `clockDomainId` instead of labelling ESP32 monotonic time as Unix epoch time.
- Adds bounded multi-observation clock mapping with RTT filtering, affine drift estimation, boot-aware invalidation and scheduled synchronization bursts.
- Synchronizes both directly connected Remus Blade devices and the Remus Computer BLE endpoint.
- Segments recordings when boot identity or clock continuity changes and retains the legacy `recordingIdsBySource` compatibility map.
- Improves Apple Watch durable capture, transfer recovery and deduplication.

Application version: 3.1.0 (build 21) on iOS, watchOS, Android and Wear OS.

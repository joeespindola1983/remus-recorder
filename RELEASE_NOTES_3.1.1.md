# Remus Recorder 3.1.1

- Replays every telemetry-ready Remus peripheral when the iOS event observer starts, with the Remus Computer replayed before direct Blade sources.
- Requires the legacy Computer telemetry characteristic or Blade IMU characteristic before declaring a BLE source connected.
- Keeps clock sync additive to telemetry and clears stale clock-sync characteristics after disconnects.
- Uses one shared round-robin clock-sync scheduler and queues its initial burst only once per connection.
- Adds regression coverage preventing telemetry updates from continuously restarting clock-sync bursts.

Application version: 3.1.1 (build 22) on iOS, watchOS, Android and Wear OS.

The exported Field Recording Evolution manifest schema remains version 1.1.0.

# Remus Recorder 2.2.1 (Hotfix)

## Live Parity & Motion Visualization

- **Throttled Rolling Waveform History**: Throttled history points in `LiveBladeParityCell` to ~60 ms (~16 Hz). The 24 rolling graph bars now span ~1.5 seconds (a full rowing stroke cycle) rather than 60 ms, clearly displaying the symmetrical sinusoidal sweep waves of the Port (blue) and Starboard (orange) blades without starving the React Native UI thread.
- **Direct Paddle Placement Fallback**: Added automatic association between primary and secondary Remus Blade devices when placement is set to default `"paddle"`, ensuring the parity metric operates immediately even before explicit left/right configuration.
- **Calibrated Blade Frame Integration**: Wired calibrated sweep axis transformation (`transformToBladeFrame`) directly into live parity evaluation with robust orientation sign handling.

## Analysis & Clock Resilience

- **Clock Uncertainty Tolerance in Stroke Analysis**: Configured `StrokeAnalysis.ts` and `StrokeEventDetector` so that `low_confidence` clock sync states do not invalidate stroke events, cycle durations, or motion profiles.
- **Robust Clock Sync Regression**: Added linear regression drift fitting, adaptive multi-tier sync quality (`precise` < 5 ms, `bounded` < 10 ms, `approximate` < 25 ms, `low_confidence`), and an initial high-frequency sync burst on connection.

## Telemetry & Manifest Persistence

- **Blade Roles and Calibration Diagnostics**: Persisted `sensorPlacement`, `boatSide` (`port` / `starboard`), `sourceRole` (`BLADE_PORT` / `BLADE_STARBOARD`), and mount calibration status into the session `manifest.json` under `telemetryDiagnosticsBySource`.
- **Source Recovery Qualification**: Fixed capture coordinator lifecycle to emit `source_recovered` only after receiving valid qualified telemetry rather than merely detecting Bluetooth reconnection.

## Platform Build Versions

- **Android (Mobile & Wear OS)**: `versionCode 18`, `versionName "2.2.1"`
- **iOS (App & Watch App)**: `CURRENT_PROJECT_VERSION = 18`, `MARKETING_VERSION = 2.2.1`

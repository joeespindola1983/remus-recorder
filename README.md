# Remus Recorder

Offline-first acquisition client for the Remus rowing and Va'a ecosystem. The
app collects source-attributed phone and wearable evidence while preserving
units, missing values and device clock boundaries for later analysis.

## Status

This repository is under active foundational development. Apple Watch transport,
wearable adapters, permission handling, canonical acquisition contracts and a
tested modular Recorder demo are present. The demo models source-independent
activity continuity and interrupted-source coverage. Durable recordings,
resumable artifact transfer and persistence verification are not yet implemented.

## Requirements

- Node.js 22 or newer
- npm
- Xcode and CocoaPods for iOS/watchOS work
- Android Studio and the Android SDK for Android work

## Setup

```sh
npm ci
cd ios && bundle exec pod install && cd ..
```

Run the app with `npm run ios` or `npm run android`.

## Quality checks

```sh
npm run verify
```

The command runs TypeScript checking, ESLint and the complete Jest suite.

## Remus Blade live protocol beta

Version 1.2 adds the Remus Blade v1 binary BLE protocol alongside the legacy
single-device protocol. The native Android and iOS bridges discover and keep
multiple Blade connections, negotiate an MTU of 185 bytes, reassemble
fragmented CRC-protected IMU batches and address start/stop commands to each
stable device serial. Human aliases such as `Blade 01` are persisted locally;
Bluetooth MAC addresses and platform UUIDs are transport locators only.

The current beta preserves each received native frame with its transport
device identifier, but the higher-level workout model still exposes one
aggregate `rbp1:primary` readiness source. Separate per-Blade recording/source
entities are the next data-model increment and are not claimed by this beta.

See [CONTRIBUTING.md](CONTRIBUTING.md) for TDD and GitFlow conventions and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the evidence boundaries.
The corresponding Figma pages and implementation status are indexed in
[docs/RECORDER_DESIGN_HANDOFF.md](docs/RECORDER_DESIGN_HANDOFF.md).
Deterministic device, transport, transfer and storage failure scenarios are
documented in [docs/CAPTURE_SIMULATOR.md](docs/CAPTURE_SIMULATOR.md).
Cross-source idempotent start/stop orchestration is documented in
[docs/RECORDING_COORDINATOR.md](docs/RECORDING_COORDINATOR.md).

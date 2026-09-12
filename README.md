# Remus Recorder

Offline-first acquisition client for the Remus rowing and Va'a ecosystem. The
app collects source-attributed phone and wearable evidence while preserving
units, missing values and device clock boundaries for later analysis.

## Status

This repository is under active foundational development. Apple Watch transport,
wearable adapters, permission handling, canonical sensor sample types and a
monitoring interface are present. Durable recordings and synchronization are not
yet implemented.

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
See [CONTRIBUTING.md](CONTRIBUTING.md) for TDD and GitFlow conventions and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the evidence boundaries.

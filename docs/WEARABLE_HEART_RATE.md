# Wearable heart-rate vertical slice

Status: implemented native transport, live React Native projection and iPhone persistence; physical-device validation pending

Date: 2026-09-13

## Scope

This first wearable slice captures only the canonical
`heartRateBeatsPerMinute` measurement. Apple Watch and Wear OS are athlete-worn
sources. Each observation retains its source identity and measurement time. A
missing or invalid measurement is absent; it is never emitted as zero.

During an app-controlled iOS activity, each accepted observation is now appended
to the iPhone evidence package before it is projected in React Native. The watch
still does not retain a durable independent recording or support resumable
artifact transfer, clock alignment or verified store-and-forward. Those remain
owned by the recording/evidence architecture in
[`TELEMETRY_DATA_ARCHITECTURE.md`](TELEMETRY_DATA_ARCHITECTURE.md).

## Topology and ownership

```text
Apple Watch                         Galaxy Watch / Wear OS
HealthKit workout                   Health Services exercise
        |                                      |
WatchConnectivity                         Wear Data Layer
        |                                      |
RemusWatchBridge (Swift)          RemusWearOSBridge (Kotlin)
        +------------------+-------------------+
                           |
                platform wearable adapter
                           |
                     WearableHub
                           |
                React Native capture state
                           |
              heartRateBeatsPerMinute UI
```

- watchOS owns HealthKit permission, workout lifetime and WatchConnectivity.
- Wear OS owns health permission, the foreground exercise service and Data
  Layer publication.
- Native phone bridges own platform callback delivery; the iOS bridge appends
  every accepted activity observation to `RemusEvidenceStore` and separately
  caches only the newest replaceable observation for JavaScript.
- TypeScript adapters validate positive finite BPM, map transport aliases only
  at the boundary and publish one platform-neutral `SensorSample`.
- React Native owns the bounded live read model and source-readiness UI. It does
  not access a watch sensor directly.

## Live message contract v1

The native transports carry the same logical object:

```json
{
  "protocolVersion": "1.0.0",
  "type": "HEART_RATE_OBSERVATION",
  "messageId": "<deviceId>:<sequenceNumber>",
  "deviceId": "<stable app-local device id>",
  "deviceFamily": "apple_watch | wear_os",
  "clockDomainId": "<optional source clock id>",
  "nativeTimestamp": 1789339200123,
  "sequenceNumber": "42",
  "heartRateBeatsPerMinute": 147.0
}
```

`nativeTimestamp` is the epoch-millisecond time of the source measurement in
this bridge contract, not phone receipt time. The phone bridge adds
`receivedAtEpochMilliseconds`. The two times must not be substituted for each
other. `sequenceNumber` is a decimal string so it can later grow without a
JavaScript integer-width migration. Duplicate delivery is possible; durable
ingress must deduplicate by source recording and sequence when it is added.

## Permission state machine

```text
launch
  -> permission already available -> ready
  -> no prior decision -> request immediately on the watch
       -> granted -> ready
       -> denied -> blocked guidance
  -> prior denial -> blocked guidance -> open/review system settings
```

The phone cannot grant access to a sensor owned by the watch. It can display
the reported state and send capture intent, but the system authorization sheet
must be handled on the watch.

The Android phone companion therefore does not request `BODY_SENSORS`; that
permission on the phone would neither authorize nor configure the Galaxy
Watch. Phone motion sensors remain governed by their own platform capability
checks.

### Apple Watch

The watch requests HealthKit read access for heart rate and write access for
the rowing workout when its UI opens. An active `HKWorkoutSession` provides
continuous background heart-rate updates. A received heart-rate sample proves
that live reading is available.

HealthKit deliberately does not disclose read-authorization denial to apps.
Therefore `unknown` after the authorization sheet means “authorization was
processed, but no reading has proved access yet,” not granted or denied. The UI
must say that it is waiting for access/readings and guide the athlete to review
Health settings when no readings arrive. It must not claim a denial based only
on an empty query. A denied workout-sharing authorization can be reported as
denied because HealthKit exposes that status.

### Wear OS / Samsung Galaxy Watch

The watch checks the platform heart-rate permission at launch. It requests
`BODY_SENSORS` through Wear OS 5 and `android.permission.health.READ_HEART_RATE`
on Wear OS 6/API 36 and later. The first unresolved permission is requested
immediately. A prior denial changes the primary action to **Abrir Ajustes** and
opens this watch app's system settings.

An accepted capture starts a foreground health service and a Health Services
`ExerciseClient` configured as `ROWING` with only `HEART_RATE_BPM`. The service
keeps the exercise callback alive when the watch screen is not visible. The
latest observation and permission snapshot are sent with urgent Data Layer
items to the companion phone app.

## React Native integration

`useWearables()` initializes exactly the adapter for the current phone
platform, subscribes through `NativeEventEmitter`, restores the newest cached
observation and publishes source state plus the latest valid sample. `App.tsx`
maps that data into the existing `ActivityCaptureState`:

- iOS selects the `apple_watch` source descriptor;
- Android selects the `wear_os` source descriptor;
- permission state controls whether heart rate is advertised as available;
- a valid live sample updates only `heartRateBeatsPerMinute`;
- start/stop intent is forwarded to the connected watch;
- pace, speed and distance are projected only from native iPhone location.

The simulator remains available to deterministic tests, but the production iOS
button opens the native append-only ingress before starting the watch. No
synthetic pace, distance, stroke rate or elapsed duration is injected into a
real activity.

## Build and device acceptance

Automated gates:

```sh
npm run verify
xcodebuild -project ios/RemusApp.xcodeproj -target RemusWatchApp \
  -configuration Debug -sdk watchsimulator CODE_SIGNING_ALLOWED=NO build
./android/gradlew -p android :app:compileDebugKotlin :wear:compileDebugKotlin
```

Physical Apple Watch checklist:

1. Fresh install requests Health access on first watch launch.
2. Deny access and verify the app shows review guidance without fabricating BPM.
3. Grant access, start capture, lower the wrist and verify updates reach the
   iPhone with increasing sequence numbers and source measurement times.
4. Disconnect the phone, capture readings, reconnect and verify queued
   WatchConnectivity delivery may duplicate but does not create a zero sample.
5. Start and stop from both phone and watch and verify the watch workout ends.

Physical Galaxy Watch checklist:

1. Test first request, denial, **Abrir Ajustes**, grant and return on Wear OS 5
   and Wear OS 6 permission models.
2. Start capture, turn off the display and verify the foreground exercise
   remains visible and heart rate reaches Android.
3. Disconnect/reconnect Data Layer and verify the newest observation/state is
   recovered without inventing missing samples.
4. Verify install, upgrade and reinstall of both phone and wear APKs with the
   same application identity.
5. Repeat on a Samsung physical watch; emulator synthetic data validates only
   transport/UI behavior, not optical-sensor quality.

## Known next steps

- move accepted observations from the legacy composite `SensorSample` into a
  typed native telemetry batch and append-only evidence store;
- assign the watch's distinct `recordingId` and activity correlation before
  capture start;
- add persisted sequence acknowledgements and explicit gaps;
- expose a dedicated wearable permission action/card in the phone UI;
- add native unit/instrumentation tests and CI packaging for both wearable
  artifacts;
- validate authorization and background behavior on physical watches.

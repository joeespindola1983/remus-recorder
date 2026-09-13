# Remus Recorder production app development plan

Status: proposed for product-owner review  
Date: 2026-09-12  
Scope: Capture MVP first; social, training and community surfaces integrate later

## Outcome

Build one source-agnostic capture application in React Native with substantial
native iOS/Android runtimes and the shared Remus C++ telemetry engine. The app
must work with only phone sensors, only a capable autonomous source synchronized
later, or any combination of phone, RBP1, Apple Watch, Wear OS, SpeedCoach and
future admitted devices.

RBP1 is the flagship Remus hardware product, but no domain entity, screen or use
case depends on its presence. Device capabilities select behavior; family names
select only qualified adapters and presentation labels.

## First Capture MVP

The first demo proves the architecture with deterministic simulated sources
before real hardware is connected. It is intentionally separate from the
existing social/training Figma flows, while reusing their design foundations.

### Included journeys

1. Open Capture and inspect available, unavailable and autonomous sources.
2. Choose an acquisition profile and required/optional streams.
3. Start an app-only or multi-source activity.
4. View bounded live metrics and source health without exposing high-rate data
   to React Native.
5. Continue an activity after one source disconnects or loses battery.
6. Stop and finalize each source independently.
7. Discover an autonomous recording and resume an interrupted synchronization.
8. Verify persistence, authorize exact source deletion and show the result.
9. Associate an imported recording wholly or partially with a suggested
   existing activity, create a new activity or leave it pending.
10. Review a source-coverage timeline where unavailable intervals remain visible.

### Explicitly outside the first demo

- production authentication/backend/cloud synchronization;
- final BLE/GATT firmware implementation;
- real WatchConnectivity and Wear OS Data Layer packaging;
- validated onboard RBP1 SPM;
- social feed, chat, clubs, regattas and coaching plans;
- automatic fusion or source truth ranking.

Those systems receive ports and fake implementations only when needed to prove
the Capture MVP.

## Architecture

```text
React Native UI (Atomic Design)
  screens -> organisms -> molecules -> atoms -> tokens
       |
Application use cases and presentation read models
       |
Typed native gateways (bounded commands, snapshots and job progress)
       |
+---------------- iOS / Android native runtime ----------------+
| acquisition adapters | device transports | evidence store    |
| coordinator          | sync runtime       | background life   |
+-------------------------------+-----------------------------+
                                |
                   shared Remus C++ telemetry
                   live SPM / quality / offline analysis
```

The UI never talks directly to CoreMotion, CoreLocation, HealthKit,
WatchConnectivity, SensorManager, Wear Data Layer, BLE, SQLite or C++. Native
code never owns product layout. C++ never owns platform I/O, permissions,
storage paths, Bluetooth or UI.

## Repository and package boundaries

### `remus-recorder`

Owns the React Native product, iOS/Android hosts, device transports, native
capture runtimes, mobile evidence store, contract fixtures and Capture MVP UI.

### `remus-app`

Currently owns canonical terminology, data/evidence architecture, Figma product
foundation and the existing `libs/remus-telemetry` engine. It remains the
governance source until those contracts receive an explicit standalone package.

### `remus-sensor`

Owns RBP1 firmware, hardware drivers, acquisition scheduling, BLE roles,
store-and-forward storage and device-side conformance fixtures.

### Shared C++ distribution decision

Do not copy the live estimator independently into each mobile app. Extract
`libs/remus-telemetry` into a pinned, reproducible CMake dependency or dedicated
repository/package, then make both Remus repositories consume it. Until that
gate is approved, the app may build a pinned source snapshot with an upstream
commit manifest, but no forked algorithm changes are accepted.

## React Native modular layout

```text
src/
  app/                 composition root, navigation, providers, feature flags
  domain/
    acquisition/       source, recording, stream, clock and gap concepts
    activity/          activity association and source coverage
    sync/              transfer/persistence/alignment read models
    analysis/          immutable analysis-run references and availability
  application/
    ports/              CaptureGateway, SyncGateway, AnalysisGateway, Clock
    useCases/           prepare/start/stop, continue degraded, import, sync
    coordinators/       pure orchestration over ports; no native API calls
  infrastructure/
    native/             generated TurboModule clients and boundary validation
    persistence/        UI preferences/read-model caches only
    adapters/           explicit legacy/import aliases at admission boundaries
  features/
    capture/            setup, active capture, interruption and completion
    sources/            discovery, capability details and provisioning
    sync/               pending artifacts, progress, recovery and deletion
    sessions/           coverage, quality and analysis entry points
  ui/
    foundations/        generated/verified design tokens
    atoms/              text, icon, status mark, divider, progress primitives
    molecules/          metric tile, source row, sync progress, gap badge
    organisms/          source fleet, live metrics, coverage timeline, controls
    templates/          capture setup/live/recovery/summary compositions
    screens/            navigation surfaces; no domain calculations
  testing/              builders, fake gateways, clocks and scenario fixtures
```

Imports point inward: UI/features may depend on application/domain; domain does
not depend on React, native modules or storage. Cross-feature imports go through
public feature entry points.

## Atomic Design rules for Capture MVP

- Figma variables map to generated semantic tokens; raw hex, spacing and fonts
  do not spread through screens.
- Atoms contain no acquisition vocabulary or device branching.
- Molecules combine atoms around one task and receive display-ready props.
- Organisms consume presentation read models and emit user intents only.
- Templates define stable layout and critical-control placement.
- Screens connect navigation and use cases; they do not parse telemetry.
- iOS and Android share composition but use platform typography, safe areas,
  accessibility and system behavior intentionally.
- Every component includes default, pressed, disabled, loading, error and
  selected states when applicable, plus reduced-motion behavior.

### Capture-specific component inventory

| Level | Initial components |
|---|---|
| Atom | `StatusMark`, `MetricValue`, `MetricUnit`, `SourceIcon`, `ProgressBar`, `CoverageMark` |
| Molecule | `LiveMetricTile`, `SourceStatusRow`, `StorageEstimate`, `ArtifactPartProgress`, `DataGapNotice`, `ActivityMatchCard`, `RecordingRangeControl` |
| Organism | `SourceFleetPanel`, `AcquisitionProfilePanel`, `LiveCaptureDashboard`, `SourceCoverageTimeline`, `PendingArtifactTransferQueue`, `RecordingReconciliationPanel`, `CaptureControls` |
| Template | `CaptureHomeTemplate`, `CaptureSetupTemplate`, `ActiveCaptureTemplate`, `RecoveryTemplate`, `ArtifactTransferCenterTemplate`, `RecordingAssociationTemplate`, `CaptureSummaryTemplate` |

## Capture MVP screen map

### 1. Capture Home

Shows the minimum app-only path first, connected/capable sources, autonomous
recordings waiting for transfer and storage readiness. The primary action remains
available without RBP1.

States: app-only ready, discovering, devices found, autonomous artifact found,
permissions needed, storage warning, no qualified source and error.

### 2. Capture Setup

Chooses activity intent, acquisition profile, source participation and stream
requirements. It shows requested versus effective rates and whether each source
can capture autonomously or recover a disconnection.

States: valid, capability downgrade, required source missing, low storage,
permission blocked and preparation failure.

### 3. Active Capture

Displays authoritative elapsed time, `strokeRateSpm`, ground speed, BPM and
source health/freshness. The exact metric source is available in details. Start,
stop and safety-critical controls remain stable across layout changes.

States: preparing, recording, degraded, one source interrupted, SPM collecting,
available/stale/unavailable, stopping and finalization timeout.

### 4. Recovery decision

When a source battery/storage/transport fails, explains what was preserved and
which sources remain active. Default action continues the overall activity when
safe. A returned device becomes a linked recording segment.

### 5. Transfer and verification center

Lists autonomous/recovery artifacts, transferred and verified parts, missing
chunks, storage requirements and retry state. Durable persistence verification,
clock alignment, activity association and source deletion remain separate states.

### 6. Capture summary

Shows one activity with independent source coverage lanes, gaps, interruption
reasons, clock-alignment quality and analysis availability. A watch line ends at
its last valid sample when its battery died; the phone line continues.

### 7. Recording association

Appears after importing an autonomous or recovery artifact when no exact shared
activity correlation exists. It shows source-native coverage, suggested existing
activities and why each is suggested. The athlete can associate the whole
recording, choose a bounded interval, create a new activity or decide later.

The phone-start case defaults to an included interval beginning at its qualified
start anchor, while preserving the earlier RBP1 evidence until disposition.
No suggestion is presented as a confirmed merge.

## Application contracts

### Commands

Every mutating command carries an idempotency key and expected lifecycle
revision:

- `prepareCapture`
- `commitCaptureStart`
- `requestCaptureStop`
- `continueWithoutSource`
- `admitContinuationSource`
- `discoverPendingArtifacts`
- `resumeArtifactTransfer`
- `acknowledgeVerifiedPersistence`
- `authorizeArtifactDeletion`
- `suggestRecordingActivityAssociations`
- `confirmRecordingActivityAssociation`
- `supersedeRecordingActivityAssociation`
- `runAnalysis` / `cancelAnalysis`

### Bounded snapshots

React Native receives material state changes immediately and live snapshots at
a bounded rate. It never receives an unbounded callback per IMU/GNSS sample.

- `CaptureSnapshot`: activity/source lifecycle, elapsed time and diagnostics.
- `LiveMetricSnapshot`: value, source stream, freshness, availability and
  algorithm version.
- `SyncSnapshot`: artifact/part progress, verification and deletion state.
- `StorageSnapshot`: pressure level, usable/reserved bytes and duration estimate.
- `SessionCoverageSnapshot`: per-source intervals, gaps and clock alignment.
- `RecordingAssociationSnapshot`: source-native bounds, included bounds,
  association state, candidate activities, reason codes and uncertainty.

All 64-bit times, sequences and byte counts cross the JS boundary as decimal
strings. Native boundary validators reject unknown contract versions and invalid
units before changing state.

## Native module topology

Use React Native Codegen/TurboModule specs so Swift/Kotlin implementations are
checked against one TypeScript surface. Keep the public modules small:

| Module | Responsibility |
|---|---|
| `NativeRemusCapture` | prepare/start/stop/reconcile and bounded live snapshots |
| `NativeRemusSources` | discovery, provisioning, capabilities and source health |
| `NativeRemusSync` | artifact manifests, parts/chunks, resume, verification and deletion |
| `NativeRemusAnalysis` | C++ live/offline jobs, progress, cancellation and immutable results |
| `NativeRemusEvidence` | session catalog, coverage summaries, export and retention status |

Promises return command acceptance/results; events carry replaceable snapshots
and critical transitions. Every subscription has explicit removal, bounded
buffering and background/relaunch reconciliation.

## iOS runtime

```text
RemusRecorderKit/
  Acquisition/       CoreMotion, CoreLocation and attributed sample streams
  Sources/           phone, Apple Watch, RBP1 BLE and import adapters
  Transports/        WatchConnectivity, CoreBluetooth and file admission
  Coordination/      lifecycle, idempotency, continuation and recovery
  Evidence/          catalog, immutable parts, staging and atomic promotion
  Sync/              resumable transfer and exact deletion acknowledgement
  TelemetryCpp/       Objective-C++ ownership/cancellation boundary
  Bridge/             generated React Native module implementations
```

Background workout/capture, file protection, HealthKit permissions, Core
Bluetooth restoration and WatchConnectivity reachability stay native. Swift
actors/serial executors own mutable runtime state. Objective-C++ owns opaque C++
handles; no C++ exception or borrowed pointer crosses the boundary.

## Android runtime

```text
com.remus.recorder/
  acquisition/       SensorManager/location streams with independent times
  sources/           phone, Wear OS, RBP1 BLE and import adapters
  transport/         Data Layer, Bluetooth GATT and file admission
  coordination/      lifecycle, idempotency, continuation and recovery
  evidence/          Room catalog plus immutable part/staging files
  sync/              WorkManager resumable jobs and deletion acknowledgement
  telemetrycpp/      JNI opaque-handle and batch boundary
  bridge/            generated React Native module implementations
```

A foreground service owns active capture; WorkManager owns deferrable sync and
analysis. Coroutines use explicit scopes and cancellation. Sensor callbacks are
timestamped independently and never combined into a cached “latest values” row.

## Shared C++ telemetry architecture

Retain and modularize the proven engine instead of copying the prototype live
estimator:

```text
remus-telemetry/
  contract/          typed normalized inputs, validation and version codecs
  clock/             domains, anchors, bounded piecewise mappings
  signal/            resampling, filters, quality and resource limits
  live/              incremental SPM snapshots and freshness
  analysis/          offline windows, summaries and comparisons
  provenance/        source/stream/config/algorithm lineage
  c_api/             stable allocation, cancellation and structured errors
```

Add a streaming opaque-handle C API that accepts bounded native batches and
returns bounded snapshots. Keep the existing offline JSON/C ABI for immutable
analysis jobs until a compatible stable replacement is proven. Native hosts
batch values into C++; React Native never calls the engine per sample.

C++ remains deterministic and I/O-free. It does not discover devices, open
SQLite, decide permissions, delete source artifacts or choose UI source labels.

## Source adapters and transports

Each admitted source implements the same native-facing port:

- identity/capability discovery;
- effective configuration negotiation;
- coordinated and/or autonomous lifecycle;
- ordered batches and clock-anchor observations;
- acknowledgement, gaps and diagnostics;
- pending-artifact discovery and resumable parts when supported;
- health, battery, storage and restart/boot identity.

Transports are replaceable details: WatchConnectivity, Wear Data Layer, BLE
GATT, file import and RBP1 relay all carry the same logical source evidence.
Relay preserves the original source identity and adds delivery-hop provenance.

## Evidence storage and synchronization

Follow [`SYNC_STORE_AND_RECOVERY.md`](SYNC_STORE_AND_RECOVERY.md): transactional
catalog, partial staging, immutable evidence, separate derived cache and bounded
diagnostics. Artifacts are independently synchronizable by part/stream and
chunk. Complete transfer, durable verification and clock alignment are distinct
states. Exact post-sync deletion requires artifact/recording/hash/length match.

## Legacy migration strategy

Reuse evidence, not accidental architecture.

### Reuse after qualification

- iOS/Android sensor API knowledge, background patterns and platform fixtures;
- bounded writer queues, atomic manifest ideas and export/import fixtures;
- existing C++ algorithms, clock mapping, comparison and resource-limit tests;
- Apple Watch acquisition experiments and physical install learnings;
- RBP1 bring-up, MPU-6050/GNSS drivers and current SPM experiments.

### Replace behind explicit adapters

- monolithic native telemetry modules;
- one global `SessionManager` boolean/ID;
- flat “normalized telemetry” snapshots that combine unrelated clocks;
- producer CSVs that fill missing axes with zero or repeat cached GNSS;
- direct `NativeModules` calls from feature code;
- separate Swift/Kotlin/TypeScript contract definitions without golden parity;
- duplicated live SPM implementations outside shared C++;
- hardcoded placement, source priority or device-family behavior.

Legacy recordings remain immutable and enter through producer-version adapters
with limitations. They are not rewritten to look like contract v1.

## State management and dependency policy

- Native capture snapshots are authoritative and restorable after JS reload.
- Application use cases are plain TypeScript with injected ports, clock, UUID
  and scheduler.
- Presentation stores contain only display/read-model state and pending intents.
- Remote/backend cache is introduced separately from active capture state.
- Add navigation/state/storage libraries only through a short ADR with bundle,
  maintenance, testability and New Architecture compatibility evidence.
- No global device hub singleton in feature code; the composition root owns
  scoped implementations.

## Observability, security and privacy

- Structured logs use activity, recording, source, command, transfer and
  analysis correlation IDs, with no athlete names in raw device logs.
- Metrics cover callback rate, queue depth, persisted rate, gaps, reconnect,
  battery, disk pressure, bridge latency and C++ processing latency.
- Keychain/Keystore protect provisioning credentials and artifact keys.
- BLE commands, manifests, persistence acknowledgements and deletion
  authorization are authenticated; BLE names/MAC addresses are not identity.
- Crash reports redact sensor payloads and precise location by default.

## TDD and CI matrix

| Gate | Required proof |
|---|---|
| Contract | Same golden valid/invalid fixtures in TypeScript, Swift, Kotlin, C++ and firmware where applicable |
| Domain/application | Pure state, battery, disk, gap, continuation, association and sync scenarios with fake time/IDs |
| React Native | Component behavior, accessibility, localization, reduced motion and navigation flows |
| iOS | Swift unit/integration tests, bridge codegen/build, simulator plus physical-device checklist |
| Android | JVM/native tests, Gradle build, foreground/background lifecycle and physical-device checklist |
| C++ | CTest Release and UBSan, ABI ownership/cancellation, deterministic replay and resource bounds |
| Transport | Loss, duplication, reordering, MTU fragmentation, reconnect and relay saturation simulator |
| Visual | Approved Figma frames and iOS/Android screenshot comparison at target sizes/themes |
| Hardware | RBP1/watch sustained capture, power loss, storage pressure, multi-connection and field trial |

Every behavioral change begins with a failing test in the owning layer. CI never
calls real network services for deterministic contract/unit suites.

## Delivery phases and gates

### Phase 0 — Governed contracts (current)

- canonical GNSS/IMU/source/clock terminology;
- acquisition messages, validators and golden fixtures;
- synchronization/store-and-forward state machine;
- source capability and relay contracts;
- RBP1 idle/pre-roll, autonomous/coordinated start, stop/power ordering and
  finite disconnected-control behavior;
- auditable whole/bounded recording-to-activity association.

Gate: contract tests green, dictionary/catalog parity green, no JS-unsafe 64-bit
numbers and no composite cached telemetry row.

### Phase 1 — Capture UX specification in Figma

- new `56 Canonical Screens — Recorder` page in the existing
  product-foundation file, derived from capture atoms, molecules, organisms and
  templates in their corresponding pages;
- source/state journey map and low-fidelity wireframes;
- Atomic Design component inventory and missing-token gap list;
- interruption, battery, disk, permission, offline and sync states;
- clickable app-only, multi-source, autonomous-sync and recording-association
  prototypes.

Gate: every frame names state, source coverage, action and failure destination;
components reuse one canonical source per family.

### Phase 2 — App foundation and simulated vertical slice

- folder/import boundaries and composition root;
- generated native-module specs with fake host implementations;
- deterministic source/transport/storage simulator;
- Capture Home through Summary using Figma-approved components;
- visual/accessibility tests on iOS and Android.

Gate: battery death, disconnect, resume sync and app-only capture work entirely
with fakes and the same scenario fixtures.

### Phase 3 — Evidence store and coordinator

- native transactional catalog/staging/evidence stores;
- idempotent lifecycle and relaunch recovery;
- chunk verification, disk pressure and exact deletion authorization;
- bounded native snapshots to React Native.

Gate: process kill at every transition preserves an honest recoverable state.

### Phase 4 — Phone capture and C++ live engine

- independent iOS/Android motion/GNSS streams and permissions;
- streaming C++ live API and offline analysis job wrapper;
- bounded SPM/quality snapshots and immutable provenance;
- app-only physical capture parity.

Gate: iPhone and Android fixtures preserve units/times/gaps and pass C++ parity;
no raw callback stream enters JS.

### Phase 5 — RBP1 flagship integration

- provisioning and versioned GATT protocol;
- raw IMU and separate GNSS stream batching;
- autonomous capture/store-and-forward and verified deletion;
- watch relay spike plus throughput/power qualification;
- multiple RBP1 units and continuation after restart.

Gate: connected and app-absent recordings survive loss, resume exactly and never
fabricate continuity or source identity.

### Phase 6 — Apple Watch

- correct packaging/capabilities and physical installation;
- independent clock/stream acquisition and local spool;
- phone path plus `source_push` relay to RBP1;
- start/stop, battery interruption, continuation and live SPM display.

Gate: phone continues when watch dies; charts show exact watch coverage; recovered
tail deduplicates across direct and relay paths.

### Phase 7 — Wear OS

- companion packaging, foreground workout behavior and permissions;
- same logical contract/store-and-forward suite;
- Data Layer plus RBP1 source-push relay;
- declared per-model capability differences.

Gate: Android phone/watch and supported relay paths pass the shared scenarios.

### Phase 8 — SpeedCoach and additional sources

- immutable file/provider admission and producer-version adapters;
- reported cadence, ground speed, GNSS and HR as independent streams;
- source-local and qualified aligned comparisons;
- adapter certification kit for future devices.

### Phase 9 — Production hardening

- field battery/storage/radio budgets and soak tests;
- accessibility/localization/privacy/security review;
- crash/relaunch and upgrade migration matrix;
- release channels, observability dashboards and support diagnostics;
- backend/cloud integration without changing acquisition semantics.

## GitFlow execution backlog

Each item is a small PR into `develop` with green applicable gates:

1. `feature/acquisition-contract-v1`
2. `feature/capture-mvp-figma-spec`
3. `feature/app-module-foundation`
4. `feature/capture-simulator`
5. `feature/recording-coordinator`
6. `feature/evidence-store`
7. `feature/store-and-forward`
8. `feature/recording-activity-association`
9. `feature/phone-native-capture`
10. `feature/cpp-live-bridge`
11. `feature/remus-blade-protocol`
12. `feature/remus-blade-lifecycle`
13. `feature/remus-blade-store-forward`
14. `feature/apple-watch-capture`
15. `feature/apple-watch-remus-relay`
16. `feature/wear-os-capture`
17. `feature/speedcoach-adapter`

The first code demo ends at item 4. Real device integration does not begin until
the contract, Figma specification, module boundaries and fault simulator are
accepted.

## Decisions required before implementation gates

1. Approve the seven-screen Capture MVP and its app-only, multi-source,
   autonomous-sync and association journeys.
2. Choose whether the C++ engine becomes a dedicated repository/package before
   Phase 4 or remains a pinned source dependency for the first integration.
3. Set first-device physical priorities after app-only capture: RBP1 is proposed
   before Apple Watch because it is the flagship hardware and highest transport
   risk.
4. Define evidence retention in the app/cloud; source post-sync deletion is
   already exact, but app evidence must not be deleted without product policy.
5. Set target activity-capture duration, supported phone/watch generations and minimum
   free-space/battery gates for measured budgets.

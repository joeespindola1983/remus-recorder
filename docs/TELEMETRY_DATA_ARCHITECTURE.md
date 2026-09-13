# Remus Recorder telemetry data architecture

Status: implementation blueprint

Date: 2026-09-13

Scope: receive, preserve, distribute, synchronize and analyze acquisition evidence

## 1. Purpose

This document is the implementation handoff for the Remus Recorder data plane.
It turns the canonical data model and the existing acquisition/synchronization
contracts into modules that can be developed independently with TDD.

The architecture must support any admitted combination of phone, Remus Blade
P1 (RBP1), Apple Watch, Wear OS, SpeedCoach and future sources. RBP1 is the
flagship source, but it is not required for an `activity` to exist.

This blueprint does not claim that native persistence, real BLE transfer,
store-and-forward or the streaming C++ API already exist. The implementation
checkpoint is listed in section 3.

Normative references:

- `remus-app/docs/DATA_DICTIONARY.md`;
- `remus-app/docs/DATA_MODEL_AND_FLOW.md`;
- `remus-app/docs/DATA_INGESTION_AND_ENRICHMENT.md`;
- `remus-app/docs/REMUS_BLADE_P1_PROFILE.md`;
- [`SYNC_STORE_AND_RECOVERY.md`](SYNC_STORE_AND_RECOVERY.md);
- [`DEVICE_ECOSYSTEM_PLAN.md`](DEVICE_ECOSYSTEM_PLAN.md);
- [`RECORDING_COORDINATOR.md`](RECORDING_COORDINATOR.md).

If this document conflicts with canonical terminology or evidence semantics in
`remus-app`, the canonical contract wins and this document must be corrected.

## 2. Architectural invariants

1. One `activity` has zero, one or many `recording` entities through explicit
   `recordingActivityAssociation` records.
2. Every physical or imported source owns its `recording`, `sensorStream`,
   sequence space and `clockDomain`.
3. Pairing, common start intent and delivery proximity do not synchronize
   clocks.
4. Acquisition time is preserved. Receipt time is additional transport
   evidence and never replaces it.
5. Missing, unavailable, invalid and numeric zero are different states.
6. Raw/source evidence is append-only. Normalization and analysis create
   traceable derivatives and never rewrite the original.
7. Delivery is at-least-once. Persistence is logically exactly-once by stable
   identity, sequence or byte range, and content hash.
8. Transfer completion, durable persistence verification, clock alignment and
   activity association are four independent states.
9. A source artifact may be deleted only after an exact, authenticated
   `persisted_verified` acknowledgement.
10. High-rate samples never cross the React Native bridge. JavaScript receives
    bounded snapshots, progress and critical lifecycle transitions.
11. Capture, local analysis and local finalization work offline.
12. Failure of one optional source preserves its supported prefix and does not
    silently stop the other sources.

## 3. Current implementation checkpoint

### Implemented now

- TypeScript acquisition contract v1 types and runtime validation;
- pure `RecordingCoordinator` with idempotent prepare/start/stop behavior;
- deterministic capture/failure simulator;
- source-independent activity and source coverage reducers;
- phone/watch adapter scaffolding and permission abstractions;
- Capture MVP React Native screens and adaptive active-capture UI;
- contract tests for current TypeScript behavior.

### Specified but not implemented

- durable command/effect outbox;
- shared C++ recording/evidence/sync runtime and its host I/O ports;
- SQLite catalog and filesystem evidence host implementations;
- real phone sensor ingestion into append-only batches;
- artifact hashing, atomic promotion and crash recovery;
- resumable chunk transfer and exact source deletion acknowledgement;
- real RBP1 GATT protocol and firmware conformance;
- streaming C++ API and native bridge;
- recording-to-activity reconciliation UI/runtime;
- backend custody synchronization.

No implementation may advertise a specified item as supported until its
acceptance tests pass on its owning platform.

## 4. C++-first system topology

The primary architecture is the portable C++ core. The React Native, Swift,
Kotlin and firmware layers integrate with that core; they do not independently
reimplement its contracts, state machines, evidence framing, clock rules or
analysis behavior.

```text
 Acquisition sources
 phone sensors | RBP1 BLE | watch transports | file/provider import
        |             |             |                 |
        +-------------+-------------+-----------------+
                              |
               Thin platform SourceAdapter
        OS callbacks/transport bytes + platform metadata
                              |
        +---------------- Remus C++ Core ----------------+
        | contracts/  producer codecs/  validation/      |
        | recording/  ordering/gaps/    clock/           |
        | evidence/   manifests/parts/  sync/            |
        | telemetry/  live/offline      projections/     |
        +--------------------+---------------------------+
                             |
                   injected host I/O ports
              clock | files | database | crypto | jobs
                             |
            Swift/Kotlin platform runtime
      SQLite/files | background life | secure storage
                             |
                 stable C ABI / TurboModules
                             |
                    React Native UI
```

The C++ `RecordingRuntime` is the authority for active recording state,
ordering, gaps, evidence framing, recovery decisions, synchronization state and
measurement. Host adapters execute operating-system I/O and report results back
to the core. React Native expresses user intent and renders projections.

“C++ first” does not mean that portable code pretends to be an OS. C++ does not
call CoreMotion, HealthKit, SensorManager, WatchConnectivity, Bluetooth or React
Native. It receives typed source records from thin adapters and uses injected
ports for files, catalog transactions, monotonic/wall clocks, cryptography and
background scheduling. This preserves one behavioral implementation while each
platform retains correct lifecycle and security integration.

### Target C++ package topology

```text
remus-core/
  contracts/      canonical acquisition and snapshot types; version codecs
  ingestion/      producer adapters, validation, ordering and gap detection
  recording/      coordinator, command journal and recovery reducer
  evidence/       frame codec, part writer, manifest and integrity logic
  sync/           chunk maps, transfer and deletion-authorization state
  clock/          domains, anchors and bounded piecewise mappings
  telemetry/      existing live/offline signal processing and provenance
  projection/     bounded UI/native read models
  host/           abstract database/file/crypto/clock/job ports
  c_api/          stable opaque handles, values, callbacks and errors
  testkit/        golden fixtures, fake host, fake clock and fault injection
```

The existing `remus-app/libs/remus-telemetry` is the seed for `telemetry/` and
`clock/`; it is not yet this complete package. Extraction into a dedicated,
pinned CMake dependency is the first architecture gate. Algorithm changes must
remain in the shared C++ source of truth.

## 5. Layer ownership

| Layer                            | Owns                                                                                           | Must not own                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| React Native presentation        | screens, localized labels, user intents, bounded read models                                   | raw sensor callbacks, database transactions, artifact deletion      |
| TypeScript application           | use-case facades, policy requests and presentation state                                       | a second coordinator, raw samples, filesystem paths                 |
| Swift/Kotlin host                | OS sensors/transports, permissions, background execution and implementations of host I/O ports | domain state machines, evidence codecs, clock inference, algorithms |
| Source adapters                  | OS/transport acquisition and producer-specific byte extraction                                 | canonical semantics independently redefined per platform            |
| C++ contracts/ingestion          | canonical validation, producer mapping, ordering, deduplication and gaps                       | platform discovery or permission prompts                            |
| C++ recording/evidence           | coordinator, recovery decisions, framing, manifests, hashes and durable-intent rules           | direct assumptions about platform paths or UI                       |
| C++ sync                         | chunk maps, resume, verification and exact deletion-authorization decisions                    | Bluetooth/network execution or cloud credentials                    |
| C++ clock/telemetry              | clock mappings and live/offline deterministic derivation                                       | capture APIs, storage implementations, networking                   |
| Host persistence implementations | execute core database/file transactions and durability requests                                | advancing domain state without a core command/result                |
| Backend adapter                  | authenticated upload/custody receipts, metadata projection                                     | changing acquisition identity or silently merging activities        |

## 6. Required ports

The application layer depends on these ports. Names below are implementation
names, while payload fields must use canonical identifiers.

```ts
interface SourceRegistryPort {
  observeSources(): Subscription<SourceFleetSnapshot>;
  connect(sourceId: string, commandId: string): Promise<CommandResult>;
  disconnect(sourceId: string, commandId: string): Promise<CommandResult>;
  getCapabilities(sourceId: string): Promise<SourceCapabilities>;
}

interface CaptureControlPort {
  prepareCapture(command: PrepareCaptureCommand): Promise<CommandResult>;
  commitCaptureStart(command: StartCaptureCommand): Promise<CommandResult>;
  requestCaptureStop(command: StopCaptureCommand): Promise<CommandResult>;
  observeCapture(): Subscription<CaptureSnapshot>;
  reconcileCapture(): Promise<CaptureSnapshot>;
}

interface EvidenceQueryPort {
  getActivity(activityId: string): Promise<ActivityReadModel>;
  getCoverage(activityId: string): Promise<SessionCoverageSnapshot>;
  listPendingEvidence(): Promise<PendingEvidenceItem[]>;
  getStorageStatus(): Promise<StorageSnapshot>;
}

interface ArtifactSyncPort {
  discoverPendingArtifacts(sourceId?: string): Promise<ArtifactSummary[]>;
  resumeArtifactTransfer(artifactId: string): Promise<CommandResult>;
  observeTransfers(): Subscription<SyncSnapshot>;
  acknowledgeVerifiedPersistence(artifactId: string): Promise<CommandResult>;
  authorizeArtifactDeletion(artifactId: string): Promise<CommandResult>;
}

interface RecordingAssociationPort {
  suggest(recordingId: string): Promise<AssociationCandidate[]>;
  confirm(command: ConfirmAssociationCommand): Promise<AssociationSnapshot>;
  supersede(command: SupersedeAssociationCommand): Promise<AssociationSnapshot>;
}

interface AnalysisPort {
  startLiveAnalysis(command: LiveAnalysisCommand): Promise<JobReference>;
  runOfflineAnalysis(command: OfflineAnalysisCommand): Promise<JobReference>;
  cancelAnalysis(jobId: string): Promise<void>;
  observeAnalysis(): Subscription<AnalysisSnapshot>;
}
```

Subscriptions are conceptual. The React Native implementation uses typed
TurboModule events with one replaceable latest snapshot per key and explicit
unsubscription. It never emits one JS event per sample.

## 7. C++ ingress pipeline

Every thin platform adapter submits one of five records to the C++ core:

1. `SourceStateRecord` — replaceable connection/capability/health state;
2. `RecordingLifecycleRecord` — append-only lifecycle transition;
3. `TelemetryBatchRecord` — bounded ordered samples for exactly one stream;
4. `ClockAnchorRecord` — relationship observation between two clock domains;
5. `ArtifactTransferRecord` — manifest, chunk or transfer acknowledgement.

Processing order for a telemetry batch:

```text
transport bytes
  -> transport framing/checksum
  -> producer contract validation
  -> C++ producer adapter mapping
  -> C++ canonical stream/unit/time validation
  -> C++ deduplication and gap detection
  -> C++ write plan against injected host transaction/file ports
  -> host durability result returned to C++
  -> C++ persisted contiguous-sequence acknowledgement
  -> C++ bounded live-analysis fan-out
  -> C++ bounded snapshot projected through the native bridge
```

Rejected input writes a bounded diagnostic with source, recording, stream,
contract version and reason. Sensor payloads and precise locations are not
copied into routine logs.

### Batch rules

- one batch belongs to exactly one `sensorStream`;
- samples are ordered by source sequence and native timestamp;
- decimal strings carry 64-bit times, sequence numbers and byte counts across
  JSON/JavaScript boundaries;
- duplicates with matching identity/hash are acknowledged without another
  append;
- contradictory duplicates are quarantined as integrity failures;
- a discontinuity produces a `sequenceGap`; cached samples are not inserted;
- stream reconfiguration, clock reset or mount change rotates the segment;
- GNSS observations remain at receiver cadence and are never expanded to IMU
  cadence.

## 8. Local persistence architecture

The first production implementation uses SQLite for transactional metadata and
regular files for high-rate payloads. C++ owns shared migrations, repository
semantics, query plans and evidence codecs. Swift/Kotlin supply the platform
database/file handles, protected root directory, durability operations and key
access. The logical layout and schema are identical on both platforms.

```text
Application Support / filesDir / remus-recorder/
  catalog/
    evidence.sqlite
  staging/
    <artifactId>/<partId>.partial
  evidence/
    <artifactId>/manifest.json
    <artifactId>/parts/<partId>.bin
  derived/
    <analysisRunId>/...
  diagnostics/
    bounded-*.log
```

Do not store one SQLite row per high-rate sample. SQLite stores identities,
descriptors, ranges, hashes, state machines, jobs and indexes. Bounded binary
parts store samples. The exact binary codec is a Phase 1 ADR and must have
Swift, Kotlin, C++ and firmware golden fixtures before device integration.

### Minimum catalog tables

| Table                             | Primary responsibility                                               |
| --------------------------------- | -------------------------------------------------------------------- |
| `activities`                      | local activity identity and lifecycle projection                     |
| `recordings`                      | one source-local recording/segment and its native bounds             |
| `recording_activity_associations` | append-only whole/bounded association revisions                      |
| `sources`                         | stable source/device identity without using BLE name/MAC as identity |
| `capability_snapshots`            | effective capability/configuration retained per recording            |
| `clock_domains`                   | native clock identity, tick semantics and boot association           |
| `clock_anchor_observations`       | original mapping observations and uncertainty                        |
| `clock_mappings`                  | versioned derived mappings with validity/error bounds                |
| `sensor_streams`                  | measurement, unit, shape, frame, role and expected rate              |
| `stream_parts`                    | immutable sequence/time ranges, path, length and hashes              |
| `sequence_gaps`                   | explicit unsupported ranges and reason                               |
| `artifacts`                       | manifest identity, lifecycle, integrity and custody state            |
| `artifact_parts`                  | required/optional part metadata and verification state               |
| `transfer_chunks`                 | received byte ranges/hash/retry state                                |
| `command_journal`                 | idempotent command intent, result and lifecycle revision             |
| `outbox`                          | durable effects pending dispatch/acknowledgement                     |
| `analysis_runs`                   | immutable input/config/version/status/output lineage                 |
| `diagnostics`                     | bounded attributable operational events                              |

All state changes that make bytes visible, advance a persisted cursor or emit
an acknowledgement occur in one recoverable transaction boundary. A crash may
leave extra unreferenced staging bytes, but it must never leave a catalog entry
claiming durability for missing bytes.

### Part rotation

A writer rotates a stream part by configured maximum bytes or duration and at
every clock/configuration/mount discontinuity. Rotation is:

1. stop accepting new samples into the current part;
2. flush and request platform durability;
3. calculate length and SHA-256;
4. atomically commit the part descriptor and persisted cursor;
5. open the next part;
6. acknowledge the new contiguous persisted sequence.

Exact size/duration defaults are measured configuration, not domain constants.

## 9. In-process distribution and backpressure

The C++ data plane is a bounded fan-out, not a global event bus.

```text
                         +-> durable BatchWriter (required, lossless)
SourceAdapter -> C++ core-+-> live telemetry input (bounded, may shed with reason)
                         +-> health/metric projector (latest value)
                         +-> diagnostic counters (aggregated)
```

Rules:

- persistence is the only required lossless consumer;
- no consumer may block the source callback thread;
- each stream has a bounded queue and declared overflow policy;
- required evidence overflow interrupts that stream and records a gap/failure;
- live analysis may drop intermediate work and become stale without damaging
  persisted evidence;
- UI projections coalesce by activity/source/metric key;
- backfill transfer has lower priority than current RBP1 acquisition;
- memory limits derive from capability/configuration and are measured in tests.

Do not introduce a process-wide untyped event emitter. One opaque C++
`RecordingRuntime` owns the typed queues and deterministic decisions. A Swift
actor or Kotlin coroutine scope serializes platform callbacks into that handle
and executes the host I/O plans it returns.

## 10. Capture and finalization transaction

### Coordinated start

1. Allocate `activityId`, opaque `activityCorrelationId`, source-local
   `recordingId` values and idempotent command IDs.
2. Persist activity, recordings, source snapshots and prepare intents.
3. Dispatch `prepareCapture` to selected sources.
4. Persist every result before advancing coordinator state.
5. Reject before commit if a required source cannot prepare.
6. Journal and dispatch `commitCaptureStart` to prepared sources.
7. Begin phone writer before showing recording success.
8. Record each source's actual native application boundary.
9. Compensate partial required-source failure with idempotent stop intents.

This is coordinated, not physically simultaneous.

### Stop/finalize

1. Persist one stable stop intent for every active source.
2. An accepted stop means only that the intent was journaled/applied.
3. Drain bounded buffers or record the timeout/gap.
4. Seal each source independently as `finalized` or `interrupted`.
5. Build immutable parts and artifact manifest; hash and verify locally.
6. Mark the activity stopped when all participating sources are terminal or
   have reached the explicit finite timeout.
7. Project coverage and request missing context; do not block preservation.

Navigation, React reload and screen lifecycle do not own these transitions.

## 11. Autonomous and late-arriving recordings

An autonomous source creates its own identities and immutable artifact. The app
creates an `ingestionSubmission`, transfers and verifies it, then keeps it
`unassociated` until one of the following occurs:

- exact shared activity correlation confirms an association;
- the athlete confirms a suggested existing activity;
- the athlete creates a new activity;
- the athlete defers the decision;
- an earlier association is superseded with an audit record.

Suggestion signals may include bounded time overlap, UTC anchors, route overlap,
source identity and nearby activities. They do not auto-confirm a merge.

For RBP1 active before phone start, the default suggestion may include only the
native interval from the qualified phone-start anchor. The prefix remains
immutable evidence until the athlete associates it elsewhere or rejects it
after verified import. Association never trims the artifact physically.

## 12. Store-and-forward and custody

An artifact is independently transferable by immutable part and bounded chunk.
The receiver persists its chunk map and resumes missing ranges in any order.

```text
finalized | interrupted_recovered
  -> advertised
  -> transferring <-> paused
  -> transferred_unverified
  -> persisted_verified
  -> deletion_authorized
  -> deleted | deletion_failed
```

`persisted_verified` requires:

- known supported manifest version;
- correct source, recording and artifact identities;
- every required part present;
- exact part byte lengths and SHA-256 hashes;
- exact manifest and whole-artifact hash;
- bytes durable in the named destination store;
- catalog transaction committed.

Only then may the app issue a deletion authorization bound to artifact,
recording, source, manifest hash, byte length, store identity and acknowledgement
identity. Partial transfer, matching filename, association or cloud upload does
not authorize source deletion.

Cloud custody is a second synchronization hop with its own verified receipt.
Local evidence cleanup follows a separate user-visible retention policy.

## 13. Clock alignment

Every `recording` starts `source_local`. Store clock anchors as observations,
not overwritten timestamps. A versioned aligner may produce a bounded piecewise
affine `clockMapping` with method, source and destination clock domains, validity
interval, maximum error and status (`approximate` or `qualified`).

A reset, reboot or wrap discontinuity creates a new segment/clock domain.
Charts may show independent lanes without alignment. Cross-source numerical
comparison requires a qualified mapping for the applicable interval.

## 14. C++ core boundary

The stable C ABI exposes opaque handles for three cooperating C++ runtimes:

- `remus_recording_runtime_*` — ingest source/lifecycle records, request host
  effects, apply host results, reconcile state and emit bounded projections;
- `remus_sync_runtime_*` — ingest manifests/chunks, plan missing ranges, verify
  integrity and decide whether an exact deletion authorization is legal;
- `remus_telemetry_*` — live and offline deterministic measurement.

Within telemetry, two paths are intentionally separate:

- live: opaque streaming handle receives bounded normalized batches and emits
  replaceable `LiveMetricSnapshot` values with production time, expiry,
  availability and algorithm/configuration version;
- offline: immutable `analysisRun` references exact artifacts, adapter output,
  clock mapping and effective configuration and produces immutable results.

The C++ core owns batching semantics, validation, state machines, codecs,
integrity decisions and calculation. Native code owns handle lifetime, platform
callback serialization, execution of host I/O, cancellation delivery and thread
scheduling. No pointer, exception or C++ ownership crosses the React Native
bridge.

The ABI uses caller-owned input buffers and library-owned opaque handles. Every
returned buffer has an explicit length and matching free function. Structured
errors include stable code, component and retryability without including raw
telemetry. ABI version, acquisition schema version, evidence codec version and
algorithm version advance independently.

Until the streaming API is implemented and qualified, the UI may use simulator
metrics only and must not repeatedly run the whole-session API as a live engine.

## 15. React Native delivery contract

The following bounded read models are sufficient for the product UI:

- `SourceFleetSnapshot`;
- `CaptureSnapshot`;
- `LiveMetricSnapshot`;
- `SyncSnapshot`;
- `StorageSnapshot`;
- `SessionCoverageSnapshot`;
- `RecordingAssociationSnapshot`;
- `AnalysisSnapshot`.

Every displayed metric includes canonical identifier, value/null, canonical
unit, source stream, evidence/availability state, supported time or freshness,
and producing algorithm when derived. UI formatting such as `mm:ss` for
`paceSecondsPer500Meters` never changes stored values.

Critical lifecycle events are persisted before delivery to JS. On app start or
JS reload, `reconcileCapture()` and evidence queries reconstruct the complete
current projection; replaying transient UI events is not required.

## 16. Platform mapping

### iOS

- Swift actors own registry, recording runtime, writers and synchronization;
- CoreMotion/CoreLocation/HealthKit/WatchConnectivity/CoreBluetooth adapters
  emit native ingress records;
- SQLite3 catalog plus protected application-support files implement evidence;
- `BGTaskScheduler`/platform-qualified background facilities run deferrable
  jobs; active capture uses the applicable background modes;
- Objective-C++ owns opaque C++ handles;
- TurboModules expose only the ports and snapshots in this document.

### Android

- Kotlin coroutines with explicit scopes own runtime and bounded channels;
- SensorManager/location/Wear Data Layer/Bluetooth GATT adapters emit ingress;
- Room/SQLite catalog plus internal application files implement evidence;
- a foreground service owns active capture;
- WorkManager owns deferrable transfer, verification and offline analysis;
- JNI owns opaque C++ handles;
- TurboModules expose the same logical ports and fixtures as iOS.

Platform API differences are adapter details. They cannot rename a canonical
field, change a lifecycle state or collapse unavailable into zero.

## 17. Recovery and resource behavior

### Process death or crash

On launch, recovery:

1. checks catalog integrity and schema version;
2. scans active command/outbox entries;
3. verifies referenced open/staging files;
4. truncates only unsupported trailing bytes to the last verified frame;
5. seals recoverable prefixes as interrupted when the owning source cannot
   resume;
6. resumes idempotent commands/jobs;
7. publishes reconstructed snapshots.

### Battery or source loss

The affected source closes at its last supported sample. Other sources and the
activity continue. A restarted source receives a new `bootId`, `recordingId`
and `clockDomain`, with optional `continuationOfRecordingId`.

### Disk pressure

Cleanup order is bounded diagnostics, abandoned retryable staging under an
explicit policy, regenerable derived data, then evidence already covered by a
verified external-custody receipt and retention policy. Unverified raw evidence
is never an automatic LRU victim. Exhaustion seals the recoverable prefix and
records an interruption.

## 18. Security and privacy

- provisioned identity and authenticated session establish device authority;
- BLE name, MAC address and filename are discovery hints only;
- credentials and artifact keys use Keychain/Keystore;
- manifests, acknowledgements and delete commands are authenticated;
- raw device payloads contain no athlete names or account tokens;
- logs redact sensor payloads, heart rate and precise route coordinates;
- activity association applies authorized human context after acquisition;
- research admission is a separate governed decision.

## 19. TDD test architecture

### Mandatory C++ red-green-refactor protocol

Every C++ behavior follows this sequence:

1. add one focused behavioral test that fails for the intended reason;
2. record the red command, failing assertion and exit status in the PR;
3. implement the smallest production change that satisfies that behavior;
4. run the focused test green;
5. run the complete affected C++ suite green;
6. refactor without changing the asserted contract;
7. run Release, UBSan and compatibility replay gates where applicable;
8. record commands, suite counts, platform scope and known limitations.

A compilation error caused by an invalid test is not behavioral red evidence.
A test written after the production behavior exists does not satisfy the TDD
gate. Mocks verify port interaction, but acceptance requires observable state,
bytes, hashes, diagnostics or projections at the public core boundary.

Each PR must keep increments small enough that reviewers can identify the red,
green and refactor stages. When commit history cannot retain each intermediate
red safely, the PR description must include the exact failing output captured
before implementation and point to the test that produced it.

### Golden contract suite

One fixture corpus is consumed by TypeScript, Swift, Kotlin, C++ and RBP1
firmware where applicable. It covers valid/invalid versions, units, unknown
fields, missing values, decimal 64-bit bounds, hashes and incompatible reuse of
an identity.

### Pure state suites

Table-driven tests cover lifecycle, idempotency, required/optional sources,
partial start, stop timeout, continuation, activity association, transfer,
verification, deletion and independent state dimensions.

### Persistence crash matrix

Terminate and reopen the repository before and after every file write, flush,
hash, catalog transaction, cursor advance, acknowledgement and promotion.
Assert that it never reports absent bytes as durable and never loses a verified
prefix.

### Fault transport simulator

Inject duplication, loss, reordering, corrupt chunks, latency, reconnect, MTU
changes, buffer exhaustion, battery loss and two delivery hops. Assert exact
deduplication and explicit gaps.

### Native and hardware gates

- simulator/unit build on every PR;
- physical phone background/lock/relaunch tests;
- watch install, permission, disconnect and battery scenarios;
- RBP1 sustained IMU/GNSS throughput, reset, brownout, multiple-unit and
  store-and-forward tests;
- parity fixtures for raw-to-canonical conversion and C++ outputs.

## 20. Implementation sequence for another model

Implementation is divided into two ownership tracks. The C++ core track is
owned and delivered by the Remus C++ maintainer. The application integration
track may be delegated to another model only after the corresponding C++ API,
fixtures and binary/package version have been published.

Every item is a branch from `develop`, begins with a failing test and ends with
documentation plus applicable build gates. Do not combine the core increments
into one large PR.

### Ownership boundary

| Track               | May implement                                                                                                                                          | Must not implement                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| C++ core maintainer | `remus-core`, acquisition reference contracts, ingestion, recording, evidence, sync, clocks, telemetry, projections, C ABI and cross-language fixtures | platform sensor APIs, React Native UI                                              |
| TypeScript model    | generated/verified bindings, application facades, UI use cases, projections and tests against fake/native gateways                                     | independent lifecycle, sync, clock, evidence or metric rules                       |
| Swift/Kotlin model  | thin source adapters, host I/O ports, opaque-handle ownership, TurboModules, background/platform integration                                           | alternate domain models, evidence codecs, hashes, algorithms or deletion decisions |

Swift/Kotlin may execute a host effect requested by C++, such as writing bytes,
committing SQLite, accessing secure keys or scheduling background work. The
result is returned to the core before the core advances state. Platform code
must not infer the next domain state independently.

### C++ core track — owned by the Remus C++ maintainer

Every PR in this track follows the mandatory red-green-refactor protocol in
section 19. A green build without an observed behavioral red is not sufficient.

### PR 1 — `feature/cpp-core-extraction`

- extract/publish the existing telemetry engine as the pinned `remus-core`
  CMake dependency without changing algorithm output;
- establish the package topology, symbol visibility and version manifest;
- preserve legacy engine replay byte-for-byte;
- add host, iOS compile and Android NDK compile gates.

Gate: existing C++ Release/UBSan suites and historical compatibility replay are
green; both mobile targets link a trivial opaque core handle.

### PR 2 — `feature/cpp-acquisition-contracts`

- move acquisition types/validation ownership into C++ and generate or verify
  TypeScript/Swift/Kotlin bindings from the same schemas;
- add bounded snapshot contracts and compatibility rules;
- add the evidence-part codec ADR without implementing device transport;
- test missing/zero distinction and signed 64-bit precision.

Gate: one golden fixture corpus passes byte/semantic parity in C++, TypeScript,
Swift and Kotlin; handwritten platform domain variants are removed.

### PR 3 — `feature/cpp-evidence-catalog`

- add C++ schema migrations, repositories and injected host storage ports;
- implement activities, recordings, sources, streams, clocks, gaps, command
  journal and outbox;
- implement idempotency and transaction tests with the C++ fake host and SQLite;
- provide iOS/Android host-adapter parity tests.

Gate: reopening after every committed transition reconstructs the same state.

### PR 4 — `feature/cpp-evidence-part-writer`

- implement the C++ frame codec, staging plans, bounded part writer and rotation;
- implement shared checksum/hash, atomic-promotion protocol and quarantine;
- add duplicates, gaps, corrupt tail, disk-full and crash-matrix tests.

Gate: no test can create a false durable cursor or silently bridge a gap.

### PR 5 — `feature/cpp-recording-runtime`

- port/connect `RecordingCoordinator` behavior to the C++ durable runtime while
  preserving the TypeScript reducer as a conformance oracle during migration;
- execute fake host/source adapters and persist results before acknowledgement;
- implement relaunch reconciliation and bounded capture snapshots;
- keep high-rate fakes in the C++ testkit.

Gate: kill/relaunch at every lifecycle transition remains deterministic.

### PR 6 — `feature/cpp-artifact-store-forward`

- implement manifest/part/chunk repositories and resumable maps;
- verify required parts and exact hashes;
- implement authenticated acknowledgement/deletion command models;
- run loss/reorder/duplicate/corruption simulator cases.

Gate: only exact `persisted_verified` state can authorize deletion.

### PR 7 — `feature/cpp-recording-activity-reconciliation`

- persist append-only association revisions and bounded source-native intervals;
- add deterministic suggestion evidence without auto-confirmation;
- implement new/existing/defer/supersede use cases and UI read models.

Gate: corrections never rewrite artifacts or prior associations.

### Application integration track — delegable after its C++ dependency exists

### PR 8 — `feature/phone-native-ingress`

- implement independent phone motion and GNSS stream adapters;
- persist native times, units, frames, permissions and observed quality;
- implement foreground/background ownership and resource preflight;
- prove iOS/Android parity with golden fixtures.

Gate: a physical app-only activity survives lock, navigation and process
recovery with explicit gaps.

### PR 9 — `feature/cpp-streaming-telemetry`

- add the opaque streaming C API in the shared telemetry engine;
- add Swift Objective-C++ and Kotlin JNI owners;
- feed only bounded normalized batches;
- emit expiring bounded metrics and persist immutable analysis lineage.

Gate: deterministic cross-platform parity and no sample-level JS traffic.

The streaming C API and its C++ tests belong to the C++ core track. Only the
Objective-C++/JNI handle owners and platform integration may be delegated.

### PR 10 — `feature/remus-blade-ingress`

- implement the versioned RBP1 capability/configuration/GATT adapter;
- ingest raw integer IMU and independent GNSS streams;
- implement sequence ACK, resend, backpressure and multi-unit identity;
- coordinate matching firmware contract changes in `remus-sensor`.

Gate: sustained physical throughput with loss/reconnect and explicit gaps.

### PR 11 — `feature/remus-blade-store-forward`

- ingest autonomous artifacts, resume chunks and verify custody;
- implement exact device deletion authorization;
- cover app-start-after-device, power-ordering and continuation scenarios.

Gate: app-absent evidence survives interruption and is deleted only after exact
verification.

### PR 12 onward

Implement Apple Watch, Wear OS, SpeedCoach and cloud custody through the same
ports, repository and fixture suite. A new source adds an adapter; it does not
add another storage architecture or lifecycle vocabulary.

## 21. Definition of done for the data plane MVP

The first data-plane MVP is done only when:

1. phone-only capture records independent motion and GNSS streams durably;
2. no high-rate sample crosses the React Native bridge;
3. capture survives screen navigation, JS reload and process recovery;
4. finalization produces verified immutable parts and a manifest;
5. source gaps, clocks, units, configuration and provenance remain queryable;
6. bounded snapshots drive the existing Capture UI;
7. one autonomous fixture resumes transfer and cannot be deleted early;
8. one recording can be associated wholly or partially to an activity without
   rewriting its evidence;
9. Android, iOS and shared contract suites pass;
10. the exact displayed metric can be traced to stream/analysis and original
    evidence.

## 22. Instructions for a TypeScript/Swift/Kotlin implementing model

Before each PR, the implementing model must:

1. read this document and all normative references in section 1;
2. inspect the branch and distinguish implemented code from proposals;
3. start from `develop` using the exact GitFlow branch for that PR;
4. write and execute the failing owning-layer tests first, preserving the
   behavioral red evidence;
5. keep source-specific behavior behind a typed adapter;
6. preserve canonical identifiers, units, nullability and evidence lineage;
7. avoid adding a dependency without a short ADR and compatibility rationale;
8. run `npm run verify`, native platform builds and the new owning-layer tests;
9. update this checkpoint when runtime responsibilities change;
10. stop and document a contract ambiguity instead of inventing a synonym or
    silently changing evidence semantics.

The delegated model must not implement or modify C++ behavior. Its first task
starts only after the applicable C++ package is published and must name the
exact `remus-core` version/commit it consumes. If a required C API, fixture or
host effect is missing, it writes an integration requirement and returns it to
the C++ owner instead of implementing the rule in TypeScript, Swift or Kotlin.

The first C++ implementation request is PR 1 only. The C++ package boundary must
be reviewed before persistence or a real source integration begins.

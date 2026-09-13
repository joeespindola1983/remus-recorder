# Device ecosystem development plan

Status: proposed implementation plan

Synchronization semantics, independently transferable parts, verified deletion,
disk pressure and battery/restart recovery are normative in
[`SYNC_STORE_AND_RECOVERY.md`](SYNC_STORE_AND_RECOVERY.md).

## Product boundary for the first release

Remus Recorder accepts an on-water activity from any admitted acquisition
source and associates zero, one or many source recordings. The app is the
coordinator and persistence authority while it is present, but it is not a
prerequisite for a source that declares autonomous capture and store-and-forward
capabilities. Remus Blade P1 is the flagship Remus device for equipment-local
motion, its own GNSS evidence and future qualified onboard `strokeRateSpm`;
that product role does not give it special data-model status. A watch is an
athlete-worn acquisition source and live display. Phone motion/GNSS and admitted
instruments such as SpeedCoach can also contribute independent recordings. A
capture may contain only the app, only one autonomous source, or any useful
combination.

The first release must support:

- start and stop requested from either the phone or a connected watch;
- configurable acquisition profiles negotiated per device;
- continuous transfer of available watch motion, position and heart-rate
  evidence to the phone;
- continuous transfer of RBP1 raw accelerometer, gyroscope, GNSS, clock,
  sequence, configuration and supported health diagnostics over BLE;
- append-only app persistence, live or after resumable synchronization, with
  explicit source, clock and sequence gaps;
- live `strokeRateSpm` produced by the phone and displayed by a watch with
  availability and freshness state;
- honest degraded behavior when a device is disconnected, unsupported or
  missing permission.

Phone, each watch and each Remus Blade unit produce separate `recording`
entities and native clocks. They may belong to the same `activity`, but pairing,
BLE arrival proximity or a shared start command does not imply sample-level
clock synchronization.

## Non-negotiable limitation

Without durable watch storage, complete watch delivery cannot be guaranteed
across a long disconnection, process termination or battery loss. The first
release uses a bounded in-memory retransmission buffer on watches.

RBP1 uses a bounded volatile retransmission buffer while connected and can
create a temporary local recording when it captures autonomously or must bridge
a longer disconnection. That store-and-forward recording is production evidence,
not permanent archive: it is eligible for device deletion only after the app
has verified complete, integrity-checked persistence and acknowledged the exact
artifact. The inspected firmware's current always-on fixed-name microSD CSV
remains an engineering diagnostic and does not yet implement this lifecycle.
The app records missing sequence ranges and must never fill a gap with zeroes,
repeat the last sample or claim that the current 1 Hz BLE snapshot represents
the acquired 200 Hz stream.

Autonomous capture and durable store-and-forward are explicit negotiated
capabilities, not assumptions attached to a device family. A source without
them requires the app to remain reachable and declares a gap when its volatile
buffer is exhausted. Debug logging remains a separate mode and is never
silently promoted into a production recording.

## Architectural decisions

### Lifecycle authority follows the capture mode

During connected capture the app commits the coordinated lifecycle and every
source applies idempotent commands. During autonomous capture, a capable source
creates and finalizes its own source-local recording and later presents it to
the app for ingestion. Importing that recording does not rewrite its original
times, identity or lifecycle; the app associates it to an existing or new
activity and may align it with other recordings.

A source may offer a start control without the app only when its capability
manifest declares `standaloneCapture` and a qualified store-and-forward path.
Otherwise its UI remains idle and explains that the app is required. A source
must not show a recording state that it cannot persist or later account for.

### Versioned device protocol

The source of truth will be versioned JSON schemas in `contracts/device/`.
TypeScript, Swift and Kotlin models must conform to the same fixtures. A protocol
message has an envelope containing at least:

- `protocolVersion`;
- `messageId`;
- `messageKind`;
- `deviceId` and `deviceFamily`;
- `activityId` when assigned;
- source-local `recordingId` when assigned;
- `nativeTimestamp` and clock identity;
- `sequenceNumber` for ordered source data;
- typed `payload`.

Unknown fields are preserved or ignored according to schema version rules.
Unknown message versions are rejected with a diagnostic, never guessed.

### Separate message classes

1. **Capabilities** — device model, OS/app version, supported measurements,
   allowed acquisition ranges, permissions and current availability.
2. **Configuration** — requested and effective acquisition profiles. The device
   may safely downgrade a request and must report the effective value and reason.
3. **Command intent** — idempotent start, stop and cancel requests.
4. **Command result** — accepted, rejected or already applied, carrying the
   authoritative lifecycle revision.
5. **State snapshot** — latest connection, recording, configuration and health
   state; replaceable rather than an event history.
6. **Telemetry batch** — ordered source samples with sequence range, native
   timestamps, units and optional measurements.
7. **Telemetry acknowledgement** — highest contiguous persisted sequence and
   explicit missing ranges.
8. **Live metric** — phone-derived display data such as `strokeRateSpm`, with
   status, production time, expiry and algorithm version.
9. **Diagnostic** — attributable protocol, permission, sensor, buffer and
   transport failures.

Apple WatchConnectivity and the Wear OS Data Layer are transports, not domain
contracts. BLE is likewise a transport rather than a source identity. Apple,
Wear OS and RBP1 adapters map the same envelope and lifecycle semantics without
changing measurement meaning.

### One contract, capability-specific sources

Every source implements the same application-facing adapter boundary:

- discover/connect and expose connection state;
- report identity, protocol version and capabilities;
- negotiate an effective acquisition configuration;
- apply idempotent start/stop commands;
- emit ordered telemetry batches and state snapshots;
- accept acknowledgements and expose gaps/diagnostics;
- recover or declare interruption after reconnect;
- disconnect and release resources.

Capabilities are not made uniform artificially. Watches may provide heart rate,
position and motion and may render live metrics. RBP1 provides equipment-local
raw accelerometer/gyroscope evidence, GNSS observations and supported device
diagnostics. It does not provide heart rate, weather, water speed, power, hull
motion or validated technique events.

Source selection is declared per `sensorStream`, not as one global device
winner. A profile may prefer qualified RBP1 motion as `estimator_input`, select
one GNSS stream for the live UI and retain phone, watch or SpeedCoach streams as
fallback or `reference_only`. Another profile may contain no RBP1 at all. Heart
rate can come from a watch. Every source keeps its own values, clock, quality
and provenance even when it is not selected for the live UI.

For RBP1 the fixed identities are `deviceFamily: remus_blade`,
`deviceModel: rbp1` and acquisition profile `remus_blade_rbp1_v1`. Its declared
prototype components are ESP32-C3, MPU-6050 and Realtek REB-4126 GNSS. Component
identity does not replace inspected hardware revision, firmware, antenna,
electrical interface or effective configuration. A BLE name, MAC address or
user nickname is never the durable unit identity. The provisioned
`deviceSerialNumber`, `hardwareRevision`, `firmwareVersion`, boot identity and
sensor/GNSS configuration accompany every recording.

### Existing RBP1 firmware checkpoint

The firmware source of truth is `joeespindola1983/remus-sensor`. Commit
`f97c461` currently implements ESP32-C3 + MPU-6050 + REB-4126 input, a 200 Hz
IMU loop, UART/NMEA GNSS parsing, buffered microSD CSV logging, textual BLE
commands and one-second live BLE CSV snapshots. It also computes experimental
SPM on the device.

We will preserve the working hardware bring-up while replacing its transport
and evidence boundaries incrementally. Known contract gaps include:

- BLE and CSV have no version, recording/boot identity or sample sequence;
- BLE sends only the latest one-second snapshot and has no ACK/retransmission;
- BLE labels its first timestamp in milliseconds while the legacy app contract
  calls it microseconds; SD uses microseconds;
- a single SD filename is removed on boot and again on the next start;
- converted IMU floats are stored instead of original integer readings plus
  configuration;
- cached GNSS values are repeated at IMU cadence;
- HDOP-derived heuristic accuracy is not distinguished from receiver-reported
  accuracy;
- unavailable edge SPM is encoded as zero;
- the app cannot list, hash, resume or transfer SD artifacts.

The device-computed SPM remains an experimental diagnostic/candidate. The phone
owns the live `strokeRateSpm` presented across the product unless a future
qualified source-selection contract explicitly chooses otherwise.

### Delivery semantics

Commands are idempotent and use `messageId`. Telemetry has at-least-once
delivery while it remains in a volatile device buffer; the phone deduplicates
by source recording and sequence number.

Real-time channels are used for commands and fresh display data. Replaceable
state channels carry the latest state snapshot. Telemetry is sent in bounded
batches with acknowledgements and flow control; durable transfer queues must not
be flooded with one message per sensor callback.

The RBP1 BLE transport additionally defines versioned GATT service and
characteristic identities, frame boundaries, MTU-aware fragmentation,
reassembly, checksum/integrity behavior and backpressure. A BLE notification is
not a sample clock. Disconnect and reconnect never reset ordering silently.

### Acquisition profiles

A profile declares each stream independently:

- measurement identifier and unit;
- `targetSamplingRateHertz` or source-driven cadence;
- batch interval and maximum batch size;
- required sensor frame and placement, when applicable;
- availability and permission requirements.

`samplingRateHertz` is observed quality and remains distinct from the target.
Heart rate is source-driven on platforms that do not provide a fixed sensor
cadence. The watch may publish the newest observation at the configured transfer
cadence, but must retain its actual measurement time and must not manufacture
duplicate observations.

The initial conservative defaults should be validated on physical hardware:

| Stream | Initial target | Transfer behavior |
|---|---:|---|
| motion | 25 Hz | batches every 1 second |
| position | 1 Hz | include only source-delivered updates |
| heart rate | source-driven | newest observation plus freshness |
| device health | 0.1 Hz | state snapshot or material change |
| live metrics to watch | 1 Hz | replaceable, expiry required |
| RBP1 IMU | capability/configuration driven | MTU-aware batches with flow control |
| RBP1 GNSS | receiver/configuration driven | source fixes with native fix time and quality |
| RBP1 health | material change or low cadence | state snapshot and diagnostic events |

These are configuration defaults, not universal device promises.

## Recording lifecycle

Use the canonical states `preparing`, `recording`, `stopping`, `finalized`,
`interrupted` and `failed`.

Connected coordinated capture:

```text
idle
  -> start intent
preparing
  -> phone recording persisted + required sources acknowledged
recording
  -> stop intent
stopping
  -> volatile batches drained or timeout recorded
finalized
```

An autonomous source runs the same source-recording states locally, creates its
own identities and later submits a finalized or recovered-interrupted artifact.
The app ingests and associates it without replaying a fake connected start.

A source failure may interrupt its recording without silently ending every other
source. The activity coordinator decides whether the overall capture continues.
Repeated start/stop messages return the current result and never create duplicate
recordings.

The phone creates the activity correlation before start and assigns a distinct
recording identity to each source. Every transition has a monotonically
increasing lifecycle revision so delayed messages cannot roll state backward.

Required and optional streams are chosen before a coordinated start. Autonomous
sources declare what they actually captured when later discovered. The app
exposes exactly which source entered `recording`, failed preparation, joined
late or arrived through post-capture synchronization. A second RBP1 attached to
another oar/paddle receives a distinct recording and is never merged by BLE
arrival time.

## App persistence and source synchronization

For coordinated capture, persistence begins before a start result is shown to
the user. For autonomous capture, the app first creates an ingestion record and
then stores resumable chunks before acknowledging completion. The app stores:

- activity correlation and one recording per source;
- capability and effective configuration snapshots;
- typed `sensorStream` descriptors;
- original received batches before derived normalization is discarded;
- native timestamps, receipt timestamps, clock identity and sequence numbers;
- acknowledgements, missing ranges, interruptions and diagnostics;
- final artifact hashes and integrity state.

For RBP1, original integer IMU samples are preserved before normalization:
`sequence`, `nativeTimestamp`, `accelRawX/Y/Z`, `gyroRawX/Y/Z` and
`sampleStatus`, together with full-scale ranges, sample-rate divider, filter,
FIFO/data-ready behavior and calibration revision. GNSS observations form a
separate stream with their native fix time, coordinate reference and
receiver-reported quality. The versioned adapter may then convert motion units
and expose qualified `groundSpeedMetersPerSecond`, `courseDegrees` and accuracy
fields. Raw equipment evidence is never discarded after conversion.

Writes are append-only during capture. Finalization creates an
`acquisitionArtifact`; it does not rewrite raw evidence. Navigation and React
Native lifecycle changes do not own recording state.

An autonomous source advertises an artifact manifest with recording identity,
byte length, content hash, chunking and lifecycle state. Synchronization is
resumable and idempotent. The app sends a deletion authorization only after the
complete artifact and required metadata are durable and hash-verified locally.
The source deletes exactly that acknowledged artifact, reports the result and
never interprets discovery, partial transfer or a matching filename as consent
to erase it.

## Watch live experience

The primary recording view is glanceable and shows only qualified information:

- authoritative recording state and elapsed time;
- `strokeRateSpm` from the phone, visibly collecting, available, stale or
  unavailable;
- watch heart rate with freshness;
- connection and phone-persistence health;
- watch battery;
- optionally phone-selected `paceSecondsPer500Meters`, `distanceMeters` or
  `groundSpeedMetersPerSecond` when source and freshness are explicit.

The watch never calculates a competing canonical SPM in this phase. A stale live
metric remains marked stale until expiry; zero is not an unavailable value.

## Installation and packaging gates

Device support is not complete when source code merely compiles. Each platform
must have an automated packaging gate.

For Apple:

- real watchOS application target embedded in the iOS host;
- deterministic bundle identifiers, deployment targets and version numbers;
- WatchConnectivity, HealthKit and location capabilities/usage descriptions;
- shared schemes and unsigned CI build of phone plus watch target;
- signed physical-device install checklist for fresh, upgrade and reinstall
  scenarios.

For Wear OS:

- explicit Wear application module and phone companion configuration;
- matched application identity and Data Layer capability;
- permission and foreground-workout service declarations;
- CI assembly of both APK/AAB artifacts;
- physical-device pairing, upgrade and reinstall checklist.

For Remus Blade P1:

- deterministic provisioning and stable physical-unit identity;
- firmware/protocol compatibility and capability handshake before capture;
- authenticated BLE control rather than authorization by advertised name;
- repeatable scan, pair/connect, reconnect and ownership-reset behavior;
- firmware build/version and hardware revision retained with each recording;
- bench gates for sustained throughput, MTU variation, sequence integrity,
  FIFO overflow, BLE loss, reset, brownout and battery pressure;
- GNSS time-to-first-fix, update rate, loss/reacquisition and on-water antenna
  performance gates;
- REB-4126 revision/marking, firmware, interface, antenna and enabled-output
  verification;
- explicit oar/paddle `sensorPlacement`, placement provenance and mounting
  configuration before placement-dependent analysis.

## TDD strategy

### Contract tests

Golden JSON fixtures are decoded and encoded by TypeScript, Swift and Kotlin.
Tests cover versions, units, missing values, unknown fields and invalid payloads.
RBP1 firmware/C++ fixtures cover the same envelope plus raw integer samples,
GNSS observations, sensor configuration and BLE frame fragmentation.

### State-machine tests

Table-driven tests cover start/stop from both devices, simultaneous intents,
duplicates, delayed acknowledgements, disconnects, reconnects, timeouts and
source-specific failures.

### Transport simulation

A platform-neutral simulator injects loss, duplication, reordering, latency,
buffer pressure and reconnects. The expected result is deterministic recording
state, deduplicated persistence and explicit gaps.

### Persistence tests

Tests kill and restore the coordinator between every lifecycle transition and
during batch writes. Finalized artifacts must be reproducible and incomplete
evidence must remain recoverable.

### Native integration and device tests

Bridge integration tests verify adapter wiring and lifecycle callbacks. Physical
device scenarios validate permissions, background execution, install/upgrade,
screen locking, temporary disconnect, phone/watch initiated stop and battery
pressure.

RBP1 hardware-in-the-loop scenarios additionally validate sensor identity,
configuration read-back, timestamps, sequences, scale conversion, GNSS quality,
sustained BLE throughput, reconnect behavior, multiple simultaneous units and
explicit gap reporting.

## Delivery sequence

Each item is one small feature branch and pull request based on `develop`.

1. **`feature/device-protocol-v1`** — schemas, terminology mapping, golden
   fixtures, validators and compatibility rules.
2. **`feature/recording-coordinator`** — pure state machine with idempotent
   intents and source-specific recording identities.
3. **`feature/device-transport-simulator`** — lossy/reordering transport,
   acknowledgements, bounded buffer and deterministic tests.
4. **`feature/phone-recording-store`** — append-only batches, stream
   descriptors, recovery, deduplication and gap records.
5. **`feature/apple-watch-packaging`** — correct host/watch targets,
   capabilities, schemes and install gates before product behavior.
6. **`feature/apple-watch-protocol`** — capabilities, configuration,
   bidirectional start/stop and state reconciliation through the common
   protocol.
7. **`feature/apple-watch-acquisition`** — configurable motion, position,
   heart rate and health acquisition with measured rates.
8. **`feature/remus-blade-ble-protocol`** — RBP1 capability/configuration
   handshake, GATT framing, commands, batches, acknowledgements and reconnect.
9. **`feature/remus-blade-acquisition`** — raw IMU/GNSS/configuration
   persistence, normalization boundary, diagnostics and multi-unit support.
10. **`feature/watch-live-metrics`** — expiring phone-to-watch
   `strokeRateSpm` and the minimal recording HUD.
11. **`feature/wear-os-packaging`** — companion module, install gates and
   permissions.
12. **`feature/wear-os-protocol`** — the same contract and acceptance suite
    through the Wear OS adapter.

The `remus-sensor` repository has a coordinated firmware track:

1. **`feature/protocol-v1-envelope`** — versioned identities, message kinds,
   clock/sequence semantics, explicit units and unavailable values;
2. **`feature/store-and-forward`** — autonomous source recording, immutable
   manifests, resumable chunk transfer, verified acknowledgement and exact
   post-sync deletion;
3. **`feature/batched-ble-transfer`** — MTU-aware frames, flow control,
   acknowledgements, retransmission and explicit gaps;
4. **`feature/separate-gnss-stream`** — source-timestamped fixes and quality
   without duplicating cached GNSS values into 200 Hz IMU records;
5. **`feature/opt-in-debug-sd`** — debug logging separated from production
   store-and-forward, enabled only
   through an explicit diagnostic configuration with bounded retention and no
   effect on normal recording finalization.

Do not start persistence or a second watch implementation before the protocol,
state-machine and fault simulator are green. This is the boundary that prevents
platform-specific behavior from becoming the application architecture again.

## Apple Watch milestone acceptance

The first milestone is complete when two physical Apple devices can demonstrate:

1. fresh install and successful companion installation;
2. start from phone and start from watch with the same authoritative result;
3. configured motion/position/heart-rate transfer and phone persistence;
4. temporary disconnection followed by buffered resend or an explicit gap;
5. `strokeRateSpm` displayed as collecting, available, stale and unavailable;
6. stop from either device with idempotent finalization;
7. app relaunch showing the correct recovered state and evidence summary;
8. all contract, state, fault, persistence and CI checks green.

## Remus Blade P1 milestone acceptance

The first equipment-device milestone is complete when one phone and two RBP1
units can demonstrate:

1. deterministic provisioning and identity without relying on BLE name or MAC;
2. capability/configuration negotiation and read-back for each physical unit;
3. one idempotent phone start creating two distinct source recordings;
4. sustained raw IMU and GNSS batch delivery with native timestamps and
   sequences;
5. MTU fragmentation/reassembly, duplicate delivery and acknowledgement;
6. temporary disconnect followed by volatile resend or an explicit gap;
7. independent clocks retained without arrival-time synchronization;
8. stop/finalize with source-specific health, interruption and integrity state;
9. raw integer evidence and reproducible unit conversion preserved on phone;
10. GNSS fields independently qualified and never synthesized from BLE arrival;
11. standalone capture survives app absence, resumes synchronization, verifies
    integrity and deletes only the exact artifact acknowledged as durable by the
    app; connected capture does not write a redundant full recording by default;
12. no BPM, water speed, power, hull or technique fields fabricated from RBP1
    data.

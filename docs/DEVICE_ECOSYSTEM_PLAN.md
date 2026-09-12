# Device ecosystem development plan

Status: proposed implementation plan

## Product boundary for the first release

Remus Recorder coordinates an on-water activity from the phone and receives
source evidence from zero or more watches. The phone is the persistence
authority. A watch is an acquisition source and live display; it does not keep a
durable recording in this phase.

The first release must support:

- start and stop requested from either the phone or a connected watch;
- configurable acquisition profiles negotiated per device;
- continuous transfer of available watch motion, position and heart-rate
  evidence to the phone;
- append-only phone persistence with explicit source, clock and sequence gaps;
- live `strokeRateSpm` produced by the phone and displayed by a watch with
  availability and freshness state;
- honest degraded behavior when a device is disconnected, unsupported or
  missing permission.

Phone and watch produce separate `recording` entities and native clocks. They
may belong to the same `activity`, but pairing does not imply sample-level clock
synchronization.

## Non-negotiable limitation

Without durable watch storage, complete delivery cannot be guaranteed across a
long disconnection, process termination or battery loss. The first release uses
a bounded in-memory retransmission buffer on the watch. The phone persists every
received batch and records missing sequence ranges. It must never fill a gap
with zeroes or silently claim completeness.

If later product requirements demand lossless disconnected capture, an
encrypted watch spool becomes a separate, explicit capability and protocol
revision.

## Architectural decisions

### Phone as coordinator

Only the phone commits lifecycle transitions and finalizes recordings. Both UIs
may issue user intents, but a watch start/stop button sends an intent to the
phone and waits for the authoritative result.

If a watch requests start while the phone is unavailable, the UI remains idle
and explains that the phone is required. It must not show a recording state that
cannot be persisted.

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
contracts. Their adapters map these message classes without changing meaning.

### Delivery semantics

Commands are idempotent and use `messageId`. Telemetry has at-least-once
delivery while it remains in the volatile watch buffer; the phone deduplicates
by source recording and sequence number.

Real-time channels are used for commands and fresh display data. Replaceable
state channels carry the latest state snapshot. Telemetry is sent in bounded
batches with acknowledgements and flow control; durable transfer queues must not
be flooded with one message per sensor callback.

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

These are configuration defaults, not universal device promises.

## Recording lifecycle

Use the canonical states `preparing`, `recording`, `stopping`, `finalized`,
`interrupted` and `failed`.

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

A source failure may interrupt its recording without silently ending every other
source. The activity coordinator decides whether the overall capture continues.
Repeated start/stop messages return the current result and never create duplicate
recordings.

The phone creates the activity correlation before start and assigns a distinct
recording identity to each source. Every transition has a monotonically
increasing lifecycle revision so delayed messages cannot roll state backward.

## Phone persistence

Persistence begins before a start result is shown to the user. The phone stores:

- activity correlation and one recording per source;
- capability and effective configuration snapshots;
- typed `sensorStream` descriptors;
- original received batches before derived normalization is discarded;
- native timestamps, receipt timestamps, clock identity and sequence numbers;
- acknowledgements, missing ranges, interruptions and diagnostics;
- final artifact hashes and integrity state.

Writes are append-only during capture. Finalization creates an
`acquisitionArtifact`; it does not rewrite raw evidence. Navigation and React
Native lifecycle changes do not own recording state.

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

## TDD strategy

### Contract tests

Golden JSON fixtures are decoded and encoded by TypeScript, Swift and Kotlin.
Tests cover versions, units, missing values, unknown fields and invalid payloads.

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

## Delivery sequence

Each item is one small feature branch and pull request based on `develop`.

1. **`feature/device-protocol-v1`** — schemas, terminology mapping, golden
   fixtures, validators and compatibility rules.
2. **`feature/recording-coordinator`** — pure state machine with idempotent
   intents and source-specific recording identities.
3. **`feature/device-transport-simulator`** — lossy/reordering transport,
   acknowledgements, bounded buffer and deterministic tests.
4. **`feature/apple-watch-packaging`** — correct host/watch targets,
   capabilities, schemes and install gates before product behavior.
5. **`feature/apple-watch-protocol`** — capabilities, configuration,
   bidirectional start/stop and state reconciliation through the common
   protocol.
6. **`feature/phone-recording-store`** — append-only batches, stream
   descriptors, recovery, deduplication and gap records.
7. **`feature/apple-watch-acquisition`** — configurable motion, position,
   heart rate and health acquisition with measured rates.
8. **`feature/watch-live-metrics`** — expiring phone-to-watch
   `strokeRateSpm` and the minimal recording HUD.
9. **`feature/wear-os-packaging`** — companion module, install gates and
   permissions.
10. **`feature/wear-os-protocol`** — the same contract and acceptance suite
    through the Wear OS adapter.

Do not start persistence or a second watch implementation before the protocol,
state-machine and fault simulator are green. This is the boundary that prevents
platform-specific behavior from becoming the application architecture again.

## First milestone acceptance

The first milestone is complete when two physical Apple devices can demonstrate:

1. fresh install and successful companion installation;
2. start from phone and start from watch with the same authoritative result;
3. configured motion/position/heart-rate transfer and phone persistence;
4. temporary disconnection followed by buffered resend or an explicit gap;
5. `strokeRateSpm` displayed as collecting, available, stale and unavailable;
6. stop from either device with idempotent finalization;
7. app relaunch showing the correct recovered state and evidence summary;
8. all contract, state, fault, persistence and CI checks green.

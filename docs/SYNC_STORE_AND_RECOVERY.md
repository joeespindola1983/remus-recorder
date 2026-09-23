# Synchronization, store-and-forward and recovery contract

Status: production architecture proposal

## Purpose

This contract lets phone, watch, Remus equipment, instruments and future
sources capture independently or together without changing the meaning of their
evidence. It applies to every measurement family, including GNSS position,
ground speed, course, accuracy, IMU, heart rate, reported cadence, device health
and diagnostics.

Remus Blade P1 is the flagship Remus hardware product, but the acquisition
model is source-agnostic. An activity may contain only app capture, only an
autonomous RBP1 recording transferred and associated later, only another autonomous admitted
source, or multiple concurrent sources.

## Four meanings that must remain separate

Do not use `synchronized` without naming the dimension:

1. **Transfer progress** — which immutable parts/chunks have arrived.
2. **Persistence verification** — whether all required bytes and metadata are
   durable in the app and their lengths and hashes match the manifest.
3. **Clock alignment** — whether one source clock can be mapped to another with
   a declared method, validity interval and maximum error.
4. **Activity association** — whether all or a bounded interval of a recording
   belongs to a particular activity, with an attributed decision and evidence.

An artifact can be fully persisted but remain source-local because no qualified
clock mapping exists. A clock anchor can exist while most data is not yet
transferred. Neither state implies the other.

Association also implies neither clock alignment nor deletion authorization. A
fully imported RBP1 recording may remain unassociated, and an associated prefix
may coexist with excluded pre-start or post-stop evidence in the same immutable
source artifact.

## Non-negotiable invariants

- One activity contains zero, one or many source-local `recording` entities.
- A restart, clock reset, sensor reconfiguration or mounting change starts a new
  recording segment; it never rewrites the prior segment.
- Each `sensorStream` has one measurement identifier, unit, shape, clock domain
  and physical sensor group.
- GNSS position, horizontal accuracy, altitude, vertical accuracy, reported
  ground speed, speed accuracy, course, course accuracy and heading remain
  independent streams. A good coordinate never qualifies another field.
- Missing data is a gap or absent sample, never a cached value or numeric zero
  placeholder.
- Network delivery is at-least-once. Persistence is logically exactly-once by
  immutable identity, sequence range, byte range and content hash.
- A source deletes only the exact artifact named by a verified persistence
  acknowledgement. Discovery, partial transfer, timeout, filename equality or
  activity association is not deletion authorization.
- Raw/source evidence and derived values are separate. Derived SPM never
  replaces its supporting IMU samples.

## Source capabilities

Every source advertises capabilities instead of being treated specially by
family name:

| Capability | Meaning |
|---|---|
| `liveTransfer` | Sends bounded telemetry batches during capture |
| `volatileResend` | Retains a declared recent window until acknowledged |
| `standaloneCapture` | Starts and finalizes a source-local recording without the app |
| `storeAndForward` | Persists finalized/interrupted recordings for resumable transfer |
| `postSyncDeletion` | Deletes an exact artifact after verified app acknowledgement |
| `relayCapture` | Can carry another source's unchanged envelopes/artifact parts |
| `localStorageCapacityBytes` | Usable capacity offered to Remus, not total device capacity |
| `minimumReservedBytes` | Space the source will not consume |
| `supportedMeasurements` | Measurement identifiers, rates, frames and requirements |

`standaloneCapture` requires `storeAndForward`. `postSyncDeletion` is separate
because imported providers or read-only instruments may not erase originals.
The effective capability manifest is stored with each recording.

## Relay capture through Remus hardware

RBP1 may act as a store-and-forward relay for watches and admitted standard BLE
sensors. A relayed observation retains the originating `sourceId`,
`recordingId`, `sensorStreamId`, clock, sequence and content hash. RBP1 adds a
delivery-hop record; it does not relabel watch BPM/motion as Remus measurements.

Two negotiated relay modes exist:

- `source_push`: a Remus watch app connects as BLE central to the RBP1 GATT
  server and uploads canonical batches or opaque, end-to-end-verifiable artifact
  parts;
- `standard_ble_pull`: RBP1 acts as BLE central for a sensor that actually
  advertises a qualified standard/vendor service and an adapter maps it at the
  boundary.

Apple watchOS apps cannot advertise peripheral services, so Apple Watch uses
`source_push`; RBP1 does not scan it as a GATT peripheral. Using the same
direction for Wear OS keeps the custom-watch path consistent. Non-Remus watches
and instruments are supported only when their published protocol and
permissions allow it.

The same watch batch may reach the app directly and through RBP1. Logical
deduplication uses origin recording, stream, sequence and hash; delivery hops
remain separate diagnostics. Relay storage uses a distinct artifact per origin
recording so deletion or corruption of one source cannot affect another. Relay
traffic is flow-controlled below RBP1's own required acquisition traffic and
must pass sustained IMU/GNSS, multi-connection, battery and storage-pressure
tests before enablement.

## Capture modes

### Coordinated live capture

The app creates the activity correlation and distinct source recordings before
showing a successful start. Each source emits bounded telemetry batches. The app
persists a batch transactionally, then acknowledges persisted sequences and any
explicit missing ranges. A source discards only the acknowledged volatile range.

A capable source does not write a redundant full recording while the app is
receiving within policy. It begins a persistent recovery spool only when
acknowledgements exceed the volatile window or local policy requires it.

### Autonomous capture

A capable source creates its own `recordingId`, `sourceId`, `bootId`, clock
domains and stream descriptors. It records into a journaled local spool and
finalizes an immutable artifact manifest. When the app becomes available, it
creates an `ingestionSubmission`, transfers resumably and associates the source
recording to a new or existing activity without changing original identity/time.

## RBP1 power and activity-control contract

Power, connectivity and recording are independent dimensions. Merely powering
RBP1 on enters `available_idle`; it does not create an activity or assert that
the athlete has started training. While idle, RBP1 may retain only a bounded,
volatile diagnostic/pre-roll buffer. That buffer is not a finalized autonomous
recording and is discarded by policy unless explicitly promoted before expiry.

A durable RBP1 recording starts only through one of these attributable causes:

- an idempotent app `commitCaptureStart` command;
- an explicit local hardware action;
- a user-enabled and versioned autonomous-start policy.

Motion alone cannot silently turn an idle buffer into a confirmed activity. An
automatic detector records its version, trigger time and uncertainty and may
create a recording needing review.

### Phone connects after RBP1 is already on

If RBP1 is `available_idle`, the app start command creates a new coordinated
recording at the local monotonic command boundary. Samples before that boundary
are not members of the activity and the volatile pre-roll may be discarded.

If RBP1 already has a deliberate autonomous recording, the app must not erase
its prefix. It may:

1. associate the whole recording with the new phone activity;
2. associate only the interval beginning at the phone-start anchor;
3. keep the prefix pending for a separate/new activity; or
4. reject the prefix after the artifact is durably imported and the decision is
   recorded.

The common default when the athlete explicitly declares the phone start as
authoritative is option 2. This is a logical inclusion boundary, not mutation
of source timestamps or immediate physical deletion.

### Finish and power-off ordering

| Order/event | Required RBP1 result | App/activity result |
|---|---|---|
| App finish reaches RBP1, then device powers off | Seal at the local stop-command boundary, journal and finalize the manifest, acknowledge the idempotent stop, then power off safely | Finalize after each participating source is finalized, interrupted or timed out; transfer may complete later |
| Graceful RBP1 power-off, then app finish | Flush and finalize with `user_power_off`; never wait for the phone to preserve it | Mark only RBP1 ended; phone/watch recordings and the activity continue until their own stop |
| Abrupt loss/battery, then app finish | Recover the longest verified prefix on next boot as `interrupted` with the attributable reason | Show RBP1 coverage ending at its last valid sample; finalize the activity independently |
| App finish command is not received | Continue recovery capture under the negotiated disconnect policy, then finalize on a finite control timeout or local power-off; never fabricate the missed stop instant | Finalize the app activity and keep the RBP1 tail pending for bounded association on later sync |

For app-coordinated capture, the negotiated manifest records a finite
`disconnectGracePeriodMs`. The app renews control while connected. Loss of that
control does not discard the recording evidence: RBP1 moves to persistent recovery capture
until reconnection, local stop/power-off, storage/power protection or the finite
timeout. A later stop request is idempotent. Evidence beyond the app activity's
stop remains source evidence but is excluded from that activity unless the user
confirms otherwise.

The source may acknowledge “stop accepted” only after the stop intent is
journaled. It may acknowledge “recording finalized” only after required parts
and the manifest are recoverable across reboot. Turning the device off never
means synchronized, imported or safe to delete.

### Disconnection recovery

When live delivery stops, the source first uses its volatile resend window. If
`storeAndForward` is available, unacknowledged evidence is committed to a
recovery artifact. On reconnect, live batches and historical backfill use
separate priorities so backfill cannot starve live capture. Deduplication uses
recording, stream, sequence range and content hash.

If recovery is unavailable or storage is exhausted, the source emits an
explicit `sequenceGap` as soon as communication permits.

## Recording-to-activity reconciliation

Every imported source recording begins with an independent association state:
`unassociated`, `suggested`, `confirmed`, `rejected` or `needs_review`. The
relationship is a canonical `recordingActivityAssociation`; it is append-only,
auditable and reversible.

- An exact shared opaque activity correlation can confirm the relationship.
- Time overlap, UTC anchors, route overlap, device identity and nearby phone
  activity are evidence for a suggestion only. The proposal stores reason
  codes, score inputs and uncertainty and requires confirmation.
- Matching start times alone never auto-merges activities, and duplicate
  artifact detection is separate from association.
- The user can associate the whole recording, select bounded source-native
  `includedStartTime` / `includedEndTime`, create a new activity or defer.
- Different start/end times are retained. Coverage lanes show the true source
  intervals and exclusions; clock alignment is qualified separately.
- Correcting a mistaken association supersedes the relationship without
  rewriting the recording, artifact or prior audit event.

## Independently synchronizable structure

An acquisition artifact has one immutable manifest and multiple immutable
parts. One failed GNSS part therefore does not restart a multi-hour IMU transfer.

```text
acquisitionArtifact manifest
  source/recording/build/capture metadata
  stream descriptors and clock domains
  part manifests
    recording metadata
    IMU stream part 0001..N
    GNSS position parts
    GNSS speed/course/quality parts
    heart-rate parts
    clock-anchor parts
    health/diagnostic parts
```

Each part declares:

- `artifactPartId`, kind and optional `sensorStreamId`;
- inclusive source sequence range when applicable;
- byte length and SHA-256;
- ordered bounded chunks with offsets, lengths and hashes;
- whether it is required to call the artifact complete.

The receiver persists chunk state as ranges or a bitmap, requests missing chunks
in any order and verifies each part independently. `persisted_verified` requires
the manifest and every required part to be durable and hash verified. Optional
parts retain their own result and never disappear silently.

## Store-and-forward state machine

```text
recording
  -> finalized | interrupted_recovered
  -> advertised
  -> transferring <-> paused
  -> transferred_unverified
  -> persisted_verified
  -> deletion_authorized
  -> deleted | deletion_failed
```

Failure does not erase progress. Reconnect resumes from the persisted part/chunk
map. Replayed manifests, chunks, acknowledgements and delete commands are
idempotent.

The app acknowledgement binds all of:

- protocol version and acknowledgement message identity;
- `artifactId`, `recordingId` and source identity;
- manifest hash, required byte length and artifact content hash;
- `persistenceStatus: persisted_verified`;
- durable persistence time and destination store identity;
- authenticated session/command context.

The source records a deletion tombstone with the acknowledgement identity and
result before removing the catalog entry. A replay cannot target a new artifact
that reused a filename. Artifact and recording IDs are never reused.

## App storage layout

The logical stores remain separate even if the first mobile implementation uses
one database directory:

| Store | Contents | Mutation rule |
|---|---|---|
| Catalog | Activities, recordings, descriptors, capabilities, lifecycle, transfer maps and hashes | Transactional metadata and append-only audit transitions |
| Staging | Partial chunks keyed by artifact/part/offset/hash | Resumable; removed only by explicit cancellation policy or promotion |
| Evidence | Verified immutable acquisition artifacts/stream parts | Never rewritten during normalization or analysis |
| Derived | Normalized caches, charts, SPM and analysis outputs with lineage | Regenerable and evicted before evidence |
| Diagnostics | Explicit opt-in logs with bounded retention | Never activity evidence without an admission step |

Promotion is atomic: verify part and manifest hashes, make bytes durable as the
platform supports, commit catalog status, then send `persisted_verified`. Before
that point the UI may report transfer progress, not synchronization completion.

## Disk-space policy

Every capture start performs a preflight from effective rates, sample sizes,
expected duration, safety margin and reserved space. The estimate is recorded;
it is not a promise about compression or device conditions.

| Pressure | Required behavior |
|---|---|
| Healthy | Use the negotiated profile |
| Warning | Show remaining estimate; accelerate verified sync/safe cleanup |
| Critical before start | Refuse an unsafe profile or visibly negotiate a lower one |
| Critical during capture | Preserve required streams by declared priority; record every rate/stream change and gap |
| Exhausted | Finalize the recoverable prefix as interrupted; never overwrite unacknowledged evidence |

Cleanup order is expired diagnostics, retryable failed staging, regenerable
derived data, then source artifacts already acknowledged as durable elsewhere.
Unverified raw evidence is never an automatic least-recently-used victim. App
evidence needs a separate user-visible retention/cloud policy before deletion.

## Battery loss and restart recovery

Battery/thermal thresholds are device profiles, not universal percentages.
Implementations reserve enough energy and metadata budget to checkpoint sequence
cursors and finalize the current part when low-power shutdown is predictable.

On graceful low battery:

1. emit `power_low` and estimated limitation;
2. flush the current bounded part and journal;
3. finalize the source recording with reason `power_depleted`;
4. preserve it for acknowledgement or later store-and-forward;
5. let the overall activity continue with other sources.

On abrupt loss, boot recovery scans the journal and completed immutable parts.
It exposes the longest verified prefix as `interrupted` with reason `power_loss`;
an incomplete tail becomes a declared gap/corrupt part. It never invents a stop
time after the last supported evidence.

A restarted device has a new `bootId` and `recordingId`. If the app activity is
still active, policy may re-admit it or ask the athlete to continue. The new
recording sets `continuationOfRecordingId`; clock alignment is re-established,
not inherited. Offline segments can be associated to the same activity later.

## One source fails while others continue

Source and activity lifecycles are independent. By default, loss, battery
depletion or storage exhaustion of one optional source does not stop other
recordings. A profile may declare a source required and ask whether to continue
degraded, but the recorded prefix is preserved either way.

Example: Apple Watch battery ends while iPhone continues.

- watch recording ends at its last valid sample as `interrupted`;
- acknowledged watch samples on the phone remain valid;
- recoverable unacknowledged watch data transfers after reboot;
- phone, RBP1 and other recordings continue;
- BPM/watch motion is unavailable after the last supported time, not zero;
- charts draw the watch only over its coverage and mark the later interval as
  missing/source inactive;
- comparisons use only qualified overlapping time support;
- a returning watch creates a linked continuation segment.

If the live SPM source disappears, the app switches only to another qualified,
configured estimator and records that transition. With no qualified fallback,
SPM becomes stale and then unavailable.

## Clock alignment states

Each recording begins `source_local`. Alignment observations retain both clock
values, method, bounds and uncertainty. A piecewise affine mapping becomes
`approximate` or `qualified` only with anchors, validity bounds and maximum
error. A clock reset starts a new segment.

Arrival proximity, BLE notification order, common filenames, matching start
labels or rowing phase never align sources. Charts can display source-local
series independently. Phase comparison requires a qualified mapping;
approximate mappings display their uncertainty.

## Security and privacy boundary

Manifests and deletion acknowledgements are authenticated after provisioning.
Content is encrypted at rest/in transit where platform support permits, with
keys and ownership reset specified by device profile. Radio identity and
filenames are not authorization. Raw artifacts avoid athlete names; authorized
app context associates people after ingestion.

## TDD acceptance scenarios

The shared contract suite covers at least:

1. app-only capture with independent GNSS streams;
2. autonomous RBP1 capture, interrupted transfer, resume, verification and exact
   post-sync deletion;
3. autonomous Apple Watch and Wear OS fixtures using the same logical states;
4. simultaneous RBP1, phone and watch, plus a later imported SpeedCoach CSV,
   with independent clocks/roles;
5. duplicated, reordered, missing and corrupt chunks without false completion;
6. partial acknowledgement or mismatched hash never authorizing deletion;
7. battery depletion preserving a finalized/recoverable prefix;
8. abrupt reboot producing a linked segment and new clock domain;
9. watch failure while phone continues, with correct chart coverage/gaps;
10. disk warning, critical and exhausted behavior without silent profile changes
    or eviction of unverified evidence;
11. persisted evidence with no clock mapping remaining explicitly unaligned;
12. repeated sync/delete commands remaining idempotent;
13. RBP1 powered on before phone start, with pre-roll excluded without source
    timestamp mutation or premature deletion;
14. autonomous RBP1 recording associated wholly, partially, to a new activity
    or left pending after evidence-based suggestions;
15. app-stop/device-power-off in either order, plus a lost stop command, yielding
    deterministic finalization, interruption and post-stop-tail states.

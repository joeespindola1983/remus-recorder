# Remus Recorder architecture

## Responsibility

Remus Recorder acquires, synchronizes and preserves source evidence offline. It does not
claim that paired devices share a clock, infer rowing technique from unqualified
motion, or replace unavailable measurements with zero.

The canonical domain language lives in the sibling `remus-app` repository:

- `docs/DATA_DICTIONARY.md`
- `docs/DATA_MODEL_AND_FLOW.md`
- `docs/DATA_INGESTION_AND_ENRICHMENT.md`
- `contracts/terminology/*.json`

## Intended data flow

```text
connected source -> source adapter -> canonical sensor streams
                 -> recording coordinator -> append-only app evidence

autonomous source -> local store-and-forward artifact
                  -> resumable verified sync -> append-only app evidence

app evidence -> clock alignment with uncertainty -> analysis/read models
```

Adapters may recognize producer-specific or legacy field names, but their
output uses canonical identifiers. Each phone, watch or equipment source owns
its recording and native clock. Association under one activity does not imply
sample-level synchronization.

Transfer completion, persistence verification and clock alignment are separate
states. The cross-source store-and-forward, deletion, disk-pressure and battery
recovery contract is specified in
[`SYNC_STORE_AND_RECOVERY.md`](SYNC_STORE_AND_RECOVERY.md).

## Current implementation boundary

The current code provides device adapters, a wearable hub, a native Apple Watch
bridge, native iPhone evidence recording and the first modular Recorder vertical
slice. The application reducer keeps the activity lifecycle independent from
each source lifecycle, represents `available_idle` without implying a recording,
closes source coverage on interruption and preserves an interrupted source while
other sources continue.

The React Native shell is organized as tokens, atoms, molecules, organisms and
screens. Its deterministic simulator covers app-only capture, coordinated
recording, watch power depletion, disconnected RBP1 recovery, resumable artifact
transfer, disk pressure, per-source finalization and a preserved summary. The
shared scenario-step contract remains available to component tests and previews. See
[`CAPTURE_SIMULATOR.md`](CAPTURE_SIMULATOR.md). These scenarios remain a test
reference. The production iOS path now appends phone motion/location, received
Watch heart rate and every RBP1 live BLE payload, then hashes finalized parts.
It does not yet claim resumable transfer or verified import of the complete
RBP1 200 Hz artifact. See
[`IOS_EVIDENCE_RECORDING.md`](IOS_EVIDENCE_RECORDING.md).

The pure recording coordinator now exposes idempotent prepare/start/stop effects,
required/optional source policy, partial-start compensation and explicit
finalization timeouts. See
[`RECORDING_COORDINATOR.md`](RECORDING_COORDINATOR.md). Its effect outbox is not
durable yet. The production screen currently invokes the native iOS evidence
store directly while that coordinator is prepared for the later C++ integration.

The next persistence slice is the RBP1 store-and-forward receiver and verified
promotion of its complete 200 Hz artifact. The shared C++ implementation must
eventually own the current inspectable iOS part framing without rewriting
existing evidence or routing high-rate samples through React Native.

The Apple Watch and Wear OS heart-rate live vertical slice is implemented
through native HealthKit/Health Services capture, companion transports and the
existing React Native wearable hub. Accepted Apple Watch observations are now
durable iPhone recording evidence while an app-controlled iOS activity is active.
See [`WEARABLE_HEART_RATE.md`](WEARABLE_HEART_RATE.md) for ownership, permission
semantics, wire fields, build gates and physical-device acceptance.
The complete mobile/native/C++ delivery architecture is specified in
[`PRODUCTION_APP_DEVELOPMENT_PLAN.md`](PRODUCTION_APP_DEVELOPMENT_PLAN.md).
The cross-device protocol and delivery sequence are specified in
[`DEVICE_ECOSYSTEM_PLAN.md`](DEVICE_ECOSYSTEM_PLAN.md).
The implementation-level receive/store/distribute blueprint, persistence model,
ports and TDD pull-request sequence are specified in
[`TELEMETRY_DATA_ARCHITECTURE.md`](TELEMETRY_DATA_ARCHITECTURE.md).

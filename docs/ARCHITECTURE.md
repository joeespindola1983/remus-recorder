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
bridge, initial phone sensor abstractions and the first modular Recorder vertical
slice. The application reducer keeps the activity lifecycle independent from
each source lifecycle, represents `available_idle` without implying a recording,
closes source coverage on interruption and preserves an interrupted source while
other sources continue.

The React Native shell is organized as tokens, atoms, molecules, organisms and
screens. Its deterministic simulator covers app-only capture, coordinated
recording, watch power depletion, disconnected RBP1 recovery, resumable artifact
transfer, disk pressure, per-source finalization and a preserved summary. The
shared scenario-step contract also drives the interactive demo. See
[`CAPTURE_SIMULATOR.md`](CAPTURE_SIMULATOR.md). This is an
application/UI reference implementation; it does not yet claim durable raw
recording, artifact hashing, crash recovery, resumable transfer, persistence verification or native
bridge conformance with the acquisition envelope.

The pure recording coordinator now exposes idempotent prepare/start/stop effects,
required/optional source policy, partial-start compensation and explicit
finalization timeouts. See
[`RECORDING_COORDINATOR.md`](RECORDING_COORDINATOR.md). Its effect outbox is not
durable yet and the interactive demo does not execute it through native adapters.

The next vertical slice is the append-only evidence store and its native
ingress boundary. It must consume independent canonical streams rather than the
legacy composite `SensorSample`.
The complete mobile/native/C++ delivery architecture is specified in
[`PRODUCTION_APP_DEVELOPMENT_PLAN.md`](PRODUCTION_APP_DEVELOPMENT_PLAN.md).
The cross-device protocol and delivery sequence are specified in
[`DEVICE_ECOSYSTEM_PLAN.md`](DEVICE_ECOSYSTEM_PLAN.md).

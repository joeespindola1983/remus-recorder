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
bridge, initial phone sensor abstractions and a monitoring UI. Durable recording,
stream descriptors, artifact hashing, crash recovery and synchronization remain
to be implemented.

The next vertical slice is a tested recording state machine with states
`preparing`, `recording`, `stopping`, `finalized`, `interrupted` and `failed`.
The complete mobile/native/C++ delivery architecture is specified in
[`PRODUCTION_APP_DEVELOPMENT_PLAN.md`](PRODUCTION_APP_DEVELOPMENT_PLAN.md).
The cross-device protocol and delivery sequence are specified in
[`DEVICE_ECOSYSTEM_PLAN.md`](DEVICE_ECOSYSTEM_PLAN.md).

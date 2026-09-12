# Remus Recorder architecture

## Responsibility

Remus Recorder acquires and preserves source evidence offline. It does not
claim that paired devices share a clock, infer rowing technique from unqualified
motion, or replace unavailable measurements with zero.

The canonical domain language lives in the sibling `remus-app` repository:

- `docs/DATA_DICTIONARY.md`
- `docs/DATA_MODEL_AND_FLOW.md`
- `docs/DATA_INGESTION_AND_ENRICHMENT.md`
- `contracts/terminology/*.json`

## Intended data flow

```text
native source -> source adapter -> canonical sensor samples
              -> recording coordinator -> append-only local evidence
              -> finalized acquisition artifact -> export/synchronization
```

Adapters may recognize producer-specific or legacy field names, but their
output uses canonical identifiers. Each phone, watch or equipment source owns
its recording and native clock. Association under one activity does not imply
sample-level synchronization.

## Current implementation boundary

The current code provides device adapters, a wearable hub, a native Apple Watch
bridge, initial phone sensor abstractions and a monitoring UI. Durable recording,
stream descriptors, artifact hashing, crash recovery and synchronization remain
to be implemented.

The next vertical slice is a tested recording state machine with states
`preparing`, `recording`, `stopping`, `finalized`, `interrupted` and `failed`.
The cross-device protocol and delivery sequence are specified in
[`DEVICE_ECOSYSTEM_PLAN.md`](DEVICE_ECOSYSTEM_PLAN.md).

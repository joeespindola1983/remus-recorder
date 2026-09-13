# Recording coordinator

## Responsibility

The recording coordinator owns cross-source command intent and acknowledgement
state. It does not acquire samples, write files, parse BLE, assign an autonomous
recording to an activity or claim distributed atomicity across devices.

Every selected source receives a preallocated, stable `recordingId` and stable
prepare/start/stop command identities. Replaying an identical intent or result
is idempotent. Reusing the same identity for contradictory content is rejected.

## Start protocol

1. The caller allocates the `activityId`, opaque `activityCorrelationId`, one
   source-local `recordingId` per selected source and all command IDs.
2. The coordinator emits `prepare_source` for every selected source.
3. A required-source preparation rejection fails before any start is committed.
   A rejected optional source is explicitly excluded.
4. After preparation resolves, the coordinator emits
   `commit_capture_start` for each prepared source.
5. The activity becomes recording only after all participating start results
   resolve and every required source accepted or reports `already_applied`.
6. If a required commit fails after another source may have started, the
   coordinator emits compensating, idempotent `journal_stop_intent` effects.

This is a coordinated protocol, not a simultaneous physical boundary. Each
source retains its native command-application time and clock domain.

## Stop and interruption protocol

`stop_requested` emits one stable `journal_stop_intent` per active source. An
accepted stop result means the intent was accepted; it does not mean bytes and
manifest are durable. The source remains `finalizing` until a separate
`source_finalized` event arrives.

If the finite finalization/control timeout expires, the recording becomes
`interrupted` with `control_lease_expired` at the last supported elapsed bound.
It is never promoted to `finalized`. Battery, abrupt power and storage failures
likewise close only that source; an optional-source interruption does not end
the overall activity.

## Adapter boundary

`CoordinatorEffect` is the application-facing outbox. Future iOS, Android,
watch and RBP1 adapters execute these effects and return typed results. Transport
delivery alone is not acknowledgement. The durable evidence-store slice must
journal effects before dispatch and persist results before removing them from
its outbox.

SpeedCoach and other file imports do not participate in this live command
protocol. They enter as autonomous source recordings through ingestion and
remain unassociated until exact correlation or an explicit association decision.

## Legacy evidence applied

The Swift recorder demonstrates useful serial writes, bounded queues, WAL
transactions, checkpoints and atomic manifest replacement. The new coordinator
specifically avoids legacy failure modes documented in the Remus assessment:

- a bridge success ID cannot differ from the persisted recording identity;
- a bounded wait or accepted stop cannot produce a false completed state;
- phone/watch overlap does not silently establish activity association;
- high-rate samples stay outside React Native and outside this coordinator.

The reducer is pure and deterministic. Run `npm run verify` for required-source,
optional-source, partial-commit compensation, idempotency, interruption and
finite-timeout coverage.

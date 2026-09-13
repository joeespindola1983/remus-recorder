# Recorder design handoff

The Recorder experience lives in the Remus Product Foundation file:

- [Recorder Capture MVP](https://www.figma.com/design/J9mlZzajI8meLd5KQYg4KB/Remus-%E2%80%94-Product-Foundation---Wireframes?node-id=503-3)
- page `56 Canonical Screens — Recorder`: seven primary journey screens
- page `57 Canonical Screens — Recorder States`: 21 operational-state screens
- page `58 Canonical Screens — Watch Recorder`: five watchOS and five Wear OS states

## Atomic Design inventory

The Recorder reuses the global Remus Color, Dimension, Typography and Motion
collections. New capture-specific building blocks are organized as:

- atoms: status, source and coverage marks
- molecules: source status, artifact-part progress, activity match, recording range,
  permission readiness, operational events, resource pressure and finalization
- organisms: source fleet, live dashboard, pending artifact-transfer queue, source coverage,
  recording reconciliation and capture controls
- templates: home, setup, active, recovery, transfer/verification, association and summary

## Canonical language

Figma copy, React Native state, native bridges and durable contracts follow the
Remus terminology catalogs:

- `activity` (`Atividade`) is the performed sporting occurrence. The
  `Activities` bottom tab is therefore correct when it lists completed, active
  or draft performed activities.
- `workoutSession` (`Sessão de treino`) is prescribed work from a training plan.
  It may be linked to an activity, but it is not the capture itself.
- `recording` (`Gravação`) is one uninterrupted, source-local acquisition
  segment. A phone, watch and RBP1 can create separate recordings for the same
  activity.
- `capture` (`Captura`) names the acquisition process or UI capability, not a
  second durable identity.
- `transfer`, `persistence verification`, `activity association` and
  `source deletion` are separate lifecycle dimensions. The UI must not collapse
  all of them into an unqualified `sync` state.

Labels may be localized, but code and durable payloads use the English canonical
identifiers above. New synonyms must first be admitted to the terminology catalog.

## Contract behaviors represented

- The app alone is a valid minimum capture configuration.
- RBP1 is the preferred source when present, but it is not required.
- RBP1 `available_idle` does not mean that an activity or recording started.
- An autonomous recording discovered later is reconciled explicitly.
- A watch or RBP1 interruption closes that source's coverage; the activity can continue.
- Stop intent, per-source finalization and activity completion are distinct.
- Transfer, verified persistence, activity association and source deletion are
  distinct lifecycle dimensions.
- A recording may be associated exactly, suggested, bounded, attached to a new
  activity or deferred.

## Implementation boundary

The current React Native vertical slice implements ready, recording, a simulated
watch power-depletion event, finalization and summary using a deterministic
application reducer. Transfer/verification, association and additional failure states remain
design contracts until their application services and durable storage exist.

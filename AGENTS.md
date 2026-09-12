# Remus Recorder contribution rules

These rules apply to every source file, test, native bridge, fixture, schema,
document and generated artifact in this repository.

## Domain language is a contract

Before introducing or renaming rowing, Va'a, workout, telemetry, navigation,
equipment, athlete or acquisition concepts:

1. Read `../remus-app/docs/DATA_DICTIONARY.md` and the applicable domain
   extension.
2. Reuse the canonical identifier from
   `../remus-app/contracts/terminology/`.
3. If a concept is absent or ambiguous, update the dictionary and its
   machine-readable catalog first.
4. Use English canonical identifiers in code and durable artifacts. Localized
   labels belong in the UI translation catalog.
5. Preserve unit, nullability, availability, source and meaning at native,
   TypeScript, storage and export boundaries.
6. Legacy aliases may be accepted only at an explicit adapter boundary. New
   output must use canonical identifiers.

Read `../remus-app/docs/DATA_MODEL_AND_FLOW.md` and
`../remus-app/docs/DATA_INGESTION_AND_ENRICHMENT.md` before changing capture,
recording relationships, clocks, storage, synchronization, import or export.
Phone and watch evidence must remain separate recordings with separate clocks.
Unknown or unavailable measurements must never be encoded as zero.

## TDD is the default workflow

1. Add or change a failing test that expresses the behavior or contract.
2. Implement the smallest change that makes it pass.
3. Refactor while keeping the suite green.
4. Run `npm run verify` before every commit.

Bug fixes require a regression test. Adapter changes require boundary tests for
units, missing values and legacy input aliases. Native changes require the
closest practical unit or integration coverage plus a device checklist when
hardware behavior cannot run in CI.

## GitFlow

- `main` contains release-ready history only.
- `develop` is the integration branch.
- Work branches start from `develop` and use `feature/`, `fix/`, `release/` or
  `hotfix/` prefixes.
- Features and fixes merge into `develop` through pull requests with a green
  quality workflow.
- Releases branch from `develop`, merge into both `main` and `develop`, and are
  tagged using semantic versioning.
- Hotfixes branch from `main` and merge back into both `main` and `develop`.

Do not commit generated dependencies, signing material, local Xcode state,
recorded athlete data or secrets.

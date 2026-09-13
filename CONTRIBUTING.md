# Contributing to Remus Recorder

Remus Recorder is an evidence-acquisition client. Correct terminology, units,
clock identity and preservation of original evidence are part of correctness,
not documentation polish.

## Development flow

Create work from `develop`:

```sh
git switch develop
git pull --ff-only
git switch -c feature/short-description
```

Use a red-green-refactor cycle and keep commits small. Before opening a pull
request, run:

```sh
npm ci
npm run verify
```

Pull requests target `develop`, except release and hotfix merges described in
`AGENTS.md`. Describe the user-visible behavior, tests added, affected evidence
contracts and any validation that still requires physical hardware.

## Definition of done

- The behavior is covered by a test that would fail without the change.
- TypeScript, lint and the complete Jest suite pass.
- Canonical identifiers and units match the `remus-app` terminology catalogs.
- Missing evidence stays missing; it is not synthesized as zero.
- Raw input is preserved and legacy names are confined to adapters.
- Native and TypeScript boundaries agree on field names and units.
- Documentation changes with architectural or protocol changes.

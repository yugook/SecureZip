# AGENTS.md

## Purpose
- Provide a concise guide for agents working in this repository.
- Prefer safe, incremental edits and keep generated artifacts consistent.

## Repository overview
- `src/`: Extension source code (TypeScript).
- `dist/`: Bundled extension output (generated).
- `out/`: Compiled test artifacts (generated).
- `docs/`: Architecture, testing, release, localization, SBOM guidance.
- `i18n/`, `package.nls*.json`: Localization strings.
- `scripts/`: Build/support scripts (including SBOM generation).

## Setup
- Prereqs: Node.js + npm (match local dev defaults; pin a version if you standardize one).
- Install deps: `npm install`.

## Common commands
- Type check + lint + build (dev): `npm run compile`.
- Package build (prod): `npm run package`.
- Verify packaging: `npm run package:verify`.
- Lint: `npm run lint`.
- Unit tests: `npm run test:unit`.
- Coverage: `npm run coverage:unit`.
- SBOM: `npm run sbom`.

## Development workflow
- Prefer editing `src/` and `docs/` only.
- Treat `dist/` and `out/` as generated outputs; do not hand-edit.
- Update localization entries in `package.nls.json`, `package.nls.ja.json`, and `i18n/` as needed.

## Safe changes
- Avoid touching secret-bearing files, local configs, or `.vsix` artifacts unless explicitly asked.
- Do not modify lockfiles unless the change requires it.
- For changes that alter behavior, add or update tests when feasible.

## Release references
- Follow `docs/releasing.md` for preview/stable and tagging rules.
- Run `npm run package:verify` before release prep.

## Useful references
- Contributing: `CONTRIBUTING.md`.
- Architecture: `docs/architecture.md`.
- Testing: `docs/testing.md`.
- Localization: `docs/localization.md`.
- SBOM: `docs/sbom.md`.

## TODO (project-specific)
- [ ] Define the supported Node.js version(s).
- [ ] List any directories that must never be edited.
- [ ] Document any required environment variables or secrets.
- [ ] Add a short "how to run the extension" note (F5 / debug config).

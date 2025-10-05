# SecureZip Test Fixtures

This directory contains the workspace snapshots used by the integration tests.

- `simple-project/` is the primary fixture. Its contents intentionally mirror common project state:
  - `.securezipignore` — baseline ignore rules for the export flow (e.g., re-including `dist/release.txt`).
  - `.env` — shows that secrets/environment files are excluded by default rules.
  - `node_modules/left.js` — minimal module used when `includeNodeModules` is enabled.
  - `dist/`, `src/`, `README.md` — sample artefacts referenced by the expected manifest hashes.

The expected ZIP manifests are defined directly inside `src/test/extension.test.ts` to avoid keeping separate JSON snapshots.

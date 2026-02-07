# Architecture Overview

This document outlines the major components inside SecureZip so you can quickly
find the right files when adding features or debugging.

## Entry point and commands

- `src/extension.ts` is the activation entry. It registers commands declared in
  `package.json`:
  - `securezip.export` – orchestrates the export workflow (progress UI,
    `.securezipignore` loading, archiver, git tagging/commits).
  - `securezip.addToIgnore`, `securezip.addPattern`,
    `securezip.applySuggestedPatterns` – helpers that modify ignore rules.
  - `securezip.openIgnoreFile`, `securezip.createIgnoreFile` – file utilities.
- `archiver` handles ZIP creation; `simple-git` performs auto-commit/tag
  operations.
- Feature flags come from `src/flags.ts`, mixing build-time defines
  (`__BUILD_FLAGS__` via `esbuild.js`) and runtime settings.

## Ignore and exclude handling

- `src/ignore.ts` parses `.securezipignore`, persists patterns, and exposes
  helpers used by both the export command and the tree view.
- `src/defaultExcludes.ts` + `src/autoExcludeDisplay.ts` describe the built-in
  auto-exclude set (git metadata, node_modules, etc.) and the metadata displayed
  in the preview.
- Suggested patterns and duplicates are surfaced through these modules.

## SecureZip view

- `src/view.ts` implements `SecureZipViewProvider`, a `TreeDataProvider` that
  renders sections for the guide, actions, `.securezipignore` preview, and
  recent exports.
- The preview section highlights auto excludes, re-includes, duplicates, and
  `.gitignore`-sourced patterns with tooltip/context information. Displayed
  entries are deduplicated by priority: `.securezipignore` > `.gitignore` >
  auto-excludes. Suppressed sources are listed in the tooltip (“Also excluded
  by …”), and unmatched/comment lines are omitted to reduce noise. Match counts
  for `.securezipignore` rules and `.gitignore` patterns live only in tooltips
  to keep labels minimal.
- The view listens for file system changes, git events, and command results to
  keep the tree in sync.

## Localization

- Runtime strings use `localize` from `src/nls.ts`, which loads bundles from
  `i18n/nls.bundle.<lang>.json`.
- Contribution strings in `package.json` pull from `package.nls*.json`.
- See `docs/localization.md` for instructions on adding new keys/translations.

## Build tooling

- `esbuild.js` bundles the extension into `dist/extension.js`. Production builds
  (`npm run package`) enable minification, inject build flags, and emit SBOM
  metadata by running `scripts/generate-sbom.cjs`.
- Type declarations are handled by `tsc` (no emit) during `check-types` and via
  `tsc -p . --outDir out` for the test harness.

## Tests

- Unit tests live under `src/test/` and target individual helpers (flags, ignore
  parser, preview ordering, etc.).
- Integration tests run through `@vscode/test-electron` (`npm run test`) to
  assert that the SecureZip view behaves correctly inside VS Code.
- Refer to `docs/testing.md` for the recommended workflows.

## File map

| Path | Responsibility |
| --- | --- |
| `src/extension.ts` | Activation, commands, export workflow |
| `src/view.ts` | Tree view provider / UI |
| `src/ignore.ts` | `.securezipignore` parsing and persistence |
| `src/defaultExcludes.ts` | Default ignore templates |
| `src/autoExcludeDisplay.ts` | Presentation logic for auto excludes |
| `src/flags.ts` | Feature flag resolver |
| `scripts/generate-sbom.cjs` | SBOM generation post-build |

Keeping these boundaries in mind helps maintain a clear separation between UI,
business logic (ignore/export), and tooling (build/test/release pipelines).

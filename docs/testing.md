# Testing SecureZip

This guide covers the scripts and workflows we use to verify SecureZip so local
runs match what GitHub Actions executes.

## Prerequisites

- Node.js 22.20.0 (matches VS Code’s runtime and all workflows).
- npm 10+ (bundled with Node 22 installers).
- VS Code installed locally if you plan to run the integration tests outside CI.

Install dependencies once per clone:

```bash
npm install
```

## Core scripts

| Command | Purpose |
| --- | --- |
| `npm run check-types` | `tsc --noEmit` to keep the codebase type-safe. |
| `npm run lint` | ESLint with TypeScript rules. |
| `npm run compile` | Dev bundle (type check + lint + `esbuild.js`). |
| `npm run package` | Production bundle (`node esbuild.js --production`) plus SBOM. |
| `npm run test:unit` | Mocha unit tests from `out/test/*.js`. |
| `npm run test` | VS Code integration tests via `@vscode/test-electron`. |

CI (preview/release) calls these exact commands, so reproducing them locally
avoids surprises.

## Recommended local loop

1. `npm run check-types`
2. `npm run lint`
3. `npm run test:unit`
4. `npm run compile` (or `npm run package` when validating a production build)

Run `npm run test` before pushing when you modify VS Code APIs, the tree view, or
git/export logic. This mirrors CI’s integration stage.

### Watch mode

- `npm run watch:esbuild` – incremental rebuild of `dist/extension.js`.
- `npm run watch:tsc` – `tsc --watch` for type checks.
- `npm run watch` – runs both watchers in parallel via `npm-run-all`.

These watchers are useful when iterating on `.securezipignore` logic or the view
provider UI.

## Integration tests

`npm run test` launches a headless VS Code instance. On Linux CI the command is
wrapped in `dbus-run-session -- xvfb-run -a`, but locally you can run it
directly (macOS/Windows need no wrapper).

Troubleshooting tips:

- Set `ELECTRON_ENABLE_LOGGING=1` for additional console output.
- Logs are stored under `~/.config/Code/logs` on Linux (and platform equivalents
  elsewhere). CI uploads them as the `vscode-logs` artifact when tests fail.

## Tests and sources

- Unit suites live in `src/test/` and are compiled to `out/test` via
  `npm run compile-tests`.
- `src/test/extension.test.ts` drives the integration harness.
- Feature flags, ignore parsing, and preview rendering each have dedicated tests;
  place new coverage next to the related suite.

Keeping these scripts green before opening a PR ensures releases succeed when
tags trigger the preview or stable workflows.

# Testing SecureZip

This guide covers the scripts and workflows we use to verify SecureZip.
Follow these steps before opening a pull request or kicking off a release.

## Prerequisites

- Node.js 20 (matches the GitHub Actions runners).
- NPM v10+.
- VS Code installed locally if you want to run the integration tests outside CI.

Install dependencies once:

```bash
npm install
```

## Core scripts

| Command | Purpose |
| --- | --- |
| `npm run check-types` | `tsc --noEmit` to keep the codebase type-safe. |
| `npm run lint` | ESLint with TypeScript rules. |
| `npm run compile` | Type-check, lint, and bundle via `esbuild.js` for development. |
| `npm run package` | Production bundle (`node esbuild.js --production`) with SBOM generation. |
| `npm run test:unit` | Mocha unit tests from `out/test/*.js`. |
| `npm run test` | VS Code integration tests via `@vscode/test-electron`. |

CI executes these same steps in the release and preview workflows, so reproducing
them locally avoids surprises.

## Efficient local loop

1. `npm run check-types`
2. `npm run lint`
3. `npm run test:unit`

If these pass, run `npm run compile` (or `npm run package` when validating the
production bundle). Integration tests (`npm run test`) take longer, so run them
before pushing if you touched VS Code APIs, view providers, or git/zip logic.

### Watch mode

- `npm run watch:esbuild` – Incremental rebuild of `dist/extension.js`.
- `npm run watch:tsc` – TypeScript compiler in watch mode.
- `npm run watch` – Runs both watchers in parallel via `npm-run-all`.

These watchers are useful when iterating on the view provider UI or long-running
ignore logic.

## Integration tests

`npm run test` launches a headless VS Code instance. On Linux, CI wraps it with
`dbus-run-session -- xvfb-run -a` (see `.github/workflows/release.yml`). Locally
you can run the command directly; macOS/Windows do not require extra wrappers.

Troubleshooting tips:

- Set `ELECTRON_ENABLE_LOGGING=1` to get additional console output.
- VS Code logs live under `~/.config/Code/logs` (Linux) or the OS equivalent.
- After failures in CI, check the uploaded `vscode-logs` artifacts.

## Tests and sources

- Unit tests reside in `src/test` (compiled to `out/test` before running).
- Integration harness config lives next to `src/test/extension.test.ts`.
- Feature flag, ignore, and preview behaviors each have dedicated suites—add new
  cases close to existing coverage.

Keeping tests near the code under test and running the scripts listed above
keeps SecureZip shippable and avoids regressions in automation.

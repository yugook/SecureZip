# Testing SecureZip

This guide covers the scripts and workflows we use to verify SecureZip.

## Prerequisites

- Node.js 22.20.0 (matches the GitHub Actions runners and VS Code runtime).
- npm 10+ (bundled with the Node 22.20.0 installer).
- VS Code (for running the integration tests locally).

Install dependencies:

```bash
npm install
```

## Core scripts

| Command | Purpose |
| --- | --- |
| `npm run check-types` | `tsc --noEmit` for type safety. |
| `npm run lint` | ESLint with the repo rules. |
| `npm run compile` | Dev bundle (type check + lint + esbuild). |
| `npm run package` | Production bundle + SBOM generation. |
| `npm run test:unit` | Mocha unit suites (compiled to `out/test`). |
| `npm run test` | VS Code integration tests via `@vscode/test-electron`. |

These are the same commands CI runs in `.github/workflows/preview.yml` and
`.github/workflows/release.yml`.

## Fast local loop

1. `npm run check-types`
2. `npm run lint`
3. `npm run test:unit`
4. `npm run compile` (or `npm run package` when validating the production build)

Run `npm run test` before pushing when you touch VS Code APIs, the view provider,
or git/export flows.

### Watchers

- `npm run watch:esbuild` – incremental rebuild of `dist/extension.js`.
- `npm run watch:tsc` – TypeScript in watch mode.
- `npm run watch` – runs both via `npm-run-all`.

## Integration test tips

- On Linux CI we wrap the tests with `dbus-run-session -- xvfb-run -a`; locally
  you can run `npm run test` directly on macOS/Windows.
- Set `ELECTRON_ENABLE_LOGGING=1` to surface Electron logs.
- VS Code logs are collected automatically in CI; locally they live under
  `~/.config/Code/logs` (Linux) or the platform-specific equivalent.

Keeping these checks green before opening a PR prevents regressions and ensures
the release workflows succeed when tags are created.

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
- Prereqs: Node.js 22.20.0 and npm 10+ (matches VS Code runtime/CI).
- Install VS Code locally if you plan to run integration tests.
- Install deps: `npm install`.

## Common commands
- Type check: `npm run check-types`.
- Lint: `npm run lint`.
- Type check + lint + build (dev): `npm run compile`.
- Package build (prod + SBOM): `npm run package`.
- Verify packaging: `npm run package:verify`.
- Unit tests: `npm run test:unit`.
- Coverage: `npm run coverage:unit`.
- Integration tests (headless VS Code): `npm run test`.
- SBOM: `npm run sbom`.

## Development workflow
- Prefer editing `src/`, `docs/`, `i18n/`, and `src/test/` when changing behavior.
- Use TypeScript, follow the configured ESLint rules, and add comments only when logic is non-obvious.
- Prefer localized strings via `src/nls.ts`; avoid hardcoding UI text.
- Treat `dist/` and `out/` as generated outputs; do not hand-edit them.
- Avoid committing build artifacts outside `dist/` (which is already tracked).
- Keep localization in sync:
  - Runtime strings: `src/nls.ts` + `i18n/nls.bundle.*.json`.
  - Contribution strings: `package.nls.json` + `package.nls.ja.json`.

## Safe changes
- Avoid touching secret-bearing files, local configs, or `.vsix` artifacts unless explicitly asked.
- Do not modify lockfiles unless the change requires it.
- For changes that alter behavior, add or update tests when feasible.
- Run `npm run test` when modifying VS Code APIs, the SecureZip view, or git/export logic.

## Recommended local loop
1. `npm run check-types`
2. `npm run lint`
3. `npm run test:unit`
4. `npm run compile` (or `npm run package` for production builds)
5. `npm run package:verify` before tagging/release

## Release references
- Follow `docs/releasing.md` for preview/stable and tagging rules.
- Update `CHANGELOG.md` for user-visible changes.
- Use `[skip-preview]` / `[skip-release]` in commit messages when needed.
- Run `npm run package:verify` before release prep.

## Useful references
- Contributing: `CONTRIBUTING.md`.
- Architecture: `docs/architecture.md`.
- Testing: `docs/testing.md`.
- Localization: `docs/localization.md`.
- SBOM: `docs/sbom.md`.

## TODO (project-specific)
- [ ] List any directories that must never be edited.
- [ ] Document any required environment variables or secrets.
- [ ] Add a short "how to run the extension" note (F5 / debug config).

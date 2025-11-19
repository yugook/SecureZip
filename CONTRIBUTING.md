# Contributing to SecureZip

Thanks for helping improve SecureZip! This guide explains how to set up your
environment, run checks, and follow our release procedures.

## Development workflow

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Type-check**
   ```bash
   npm run check-types
   ```
3. **Lint**
   ```bash
   npm run lint
   ```
4. **Build**
   ```bash
   npm run compile
   ```
5. **Tests**
   - Unit tests: `npm run test:unit`
   - Integration tests (headless VS Code): `npm run test`

Please keep existing tests passing. Add coverage when you fix bugs or add new
features.

## Coding guidelines

- Use TypeScript and follow the ESLint rules configured in the repo.
- Prefer localized strings (see `i18n/` bundles) instead of hardcoding text.
- Add concise comments only when logic is non-obvious.
- Avoid committing build artifacts outside the `dist/` folder that is already
  tracked.

## Release process

Before touching the `preview` or `main` branches for publishing, read
[`docs/releasing.md`](docs/releasing.md). It documents:

- How preview builds use `-pre.N` suffixes (e.g. `1.0.9-pre.1`).
- Which GitHub Actions run on each branch.
- When to use `[skip-preview]` / `[skip-release]` commit flags.
- The checklist for promoting a preview build to a stable release.

## Pull request checklist

- [ ] Update `CHANGELOG.md` for user-visible changes.
- [ ] Include/adjust tests as needed.
- [ ] Run `npm run check-types`, `npm run lint`, `npm run test:unit`.
- [ ] When relevant, mention any manual testing performed.
- [ ] For release-related work, confirm you followed `docs/releasing.md`.

If you have questions, open an issue or add a discussion thread in your PR so
we can align quickly.

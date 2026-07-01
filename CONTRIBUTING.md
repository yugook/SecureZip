# Contributing to SecureZip

Thanks for helping improve SecureZip! This guide explains how to set up your
environment, run checks, and follow our release procedures.

## Development workflow

When implementing changes from `main`, create a topic branch before editing.
Avoid committing implementation work directly to `main`.

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

## Commit and pull request conventions

- Write commit messages in Japanese and follow Google's commit message style:
  a short summary line, a blank line, then a body when extra context is needed.
- Keep the summary concise and describe what changed. Use the body to explain
  why the change was made or to note important context.
- Write pull request titles and descriptions in Japanese.
- Use `.github/pull_request_template.md` when opening a pull request.

Example commit message:

```text
ドキュメントにPR作成ルールを追加

コミットとPull Requestの記述言語を日本語に統一するため、
CONTRIBUTING.mdとAGENTS.mdに運用ルールを追記する。
```

## Release process

Before touching the `preview` or `main` branches for publishing, read
[`docs/releasing.md`](docs/releasing.md). It documents:

- Why preview builds stick to plain semver numbers (the Marketplace rejects
  prerelease suffixes).
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

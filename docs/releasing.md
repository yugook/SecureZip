# Release Process

This document explains how SecureZip ships preview and stable builds so that
contributors (humans or automation such as Codex) follow the exact same flow.

## Branches and workflows

- `preview` branch &rarr; `.github/workflows/preview.yml` builds/tests and runs
  `vsce publish --pre-release --skip-duplicate`.
- `main` branch &rarr; `.github/workflows/auto-release-on-main.yml` tags the
  commit, then reuses `.github/workflows/release.yml` to ship the stable build.
- `tag-after-release.yml` mirrors the version back to a git tag (`vX.Y.Z` or
  `vX.Y.Z-preview`), so never delete the tags manually.

The Marketplace accepts only one upload per version string. Preview builds must
never consume the number intended for the next stable release.

## Versioning rules

1. Use plain semver numbers (e.g. `1.0.9`). The VS Code Marketplace rejects
   prerelease suffixes such as `-pre.1`.
2. Every published version number is immutable. Once the preview workflow has
   shipped `1.0.9` (with `--pre-release`), that number cannot be reused for the
   stable release—bump to `1.0.10` instead.
3. The `--pre-release` flag controls whether Marketplace lists the build under
   the preview channel. Do not encode “preview vs stable” in the version string.

## Preview checklist

1. Bump `package.json` to the next unused version (`npm version 1.0.9`) and
   update `CHANGELOG.md`.
2. Commit the changes with a message such as
   `chore: release 1.0.9 preview`.
3. Push to the `preview` branch. The workflow will build, test, and run
   `vsce publish --pre-release --skip-duplicate`.
4. Inspect the Marketplace preview listing. If you need to skip publishing for a
   specific commit, add `[skip-preview]` to the commit message.

## Promoting to stable

1. Merge the preview branch into `main`.
2. Bump `package.json` to the next semver (e.g. `npm version 1.0.10`) because
   the preview already consumed `1.0.9`. Update the changelog if necessary.
3. Push to `main`. The auto-release workflow will:
   - create the `v1.0.9` tag,
   - run type checks, lint, `npm run package`, unit/integration tests,
   - publish to the Marketplace with `npx vsce publish --skip-duplicate`,
   - create a draft GitHub Release with the VSIX artifact.
4. If the release should be suppressed (e.g. doc-only change), include
   `[skip-release]` in the commit message.

## Additional notes

- `npm run package` triggers SBOM generation (`scripts/generate-sbom.cjs`);
  the resulting `dist/securezip-sbom.cdx.json` is bundled automatically.
- Codex or other automation must read this document before touching release
  branches to ensure version bumps, changelog entries, and workflow toggles are
  handled consistently.

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

1. Stable releases use plain semver (e.g. `1.0.9`).
2. Preview builds append the suffix `-pre.N`
   (e.g. `1.0.9-pre.1`, `1.0.9-pre.2`).
3. Each published version number is immutable. When the preview workflow already
   used `1.0.9-pre.1`, the next publish must bump to either `1.0.9-pre.2` or
   `1.0.9` (for the final release).
4. Never publish `1.0.9` as a preview. Doing so would block the real stable
   release because the Marketplace would treat that version as already taken.

## Preview checklist

1. Bump `package.json` to the next preview version (`npm version 1.0.9-pre.1`)
   and update `CHANGELOG.md`.
2. Commit the changes with a message such as
   `chore: release 1.0.9-pre.1`.
3. Push to the `preview` branch. The workflow will build, test, and run
   `vsce publish --pre-release --skip-duplicate`.
4. Inspect the Marketplace preview listing. If you need to skip publishing for a
   specific commit, add `[skip-preview]` to the commit message.

## Promoting to stable

1. Merge the preview branch into `main`.
2. Bump `package.json` to the stable version without the suffix
   (`npm version 1.0.9`) and update the changelog if necessary.
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

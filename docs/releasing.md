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
5. Before tagging or merging, run `npm run package:verify` locally/CI to ensure
   `engines.vscode` and dependencies (e.g., `@types/vscode`) are aligned for
   packaging.

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
5. Preflight tip: run `npm run package:verify` before tagging to catch version
   mismatches that would block vsce packaging.

## Release PR checks

Release branches should be named `release/vX.Y.Z` and opened as pull requests
to `main` before merging. The Marketplace PAT check workflow runs only for
non-draft same-repository `release/*` pull requests, including when a draft PR
is marked ready for review.

The workflow runs with `pull_request_target` so its definition comes from the
trusted target branch. The automatic PR metadata job checks out the trusted base
commit, fetches the PR head into a local git ref, and validates that:

- `package.json` changes the version from the `main` base branch and the new
  version is greater than the base version.
- The release branch version, `package.json`, `package-lock.json`,
  `CHANGELOG.md`, and `dist/securezip-sbom.cdx.json` all agree on the same
  `X.Y.Z` version.

The Marketplace PAT verification job uses the protected `marketplace-pat`
GitHub Environment. Configure that environment with required reviewers, then
store `VSCE_PAT` as an environment secret and `VSCE_PAT_EXPIRES_AT` as an
environment variable in `YYYY-MM-DD` format. The job runs only after environment
approval and validates that:

- `VSCE_PAT_EXPIRES_AT` is at least 14 days in the future.
- `VSCE_PAT` still has Marketplace publish rights for the `yugook` publisher via
  `vsce verify-pat yugook`.

The preview and stable publish workflows also use the same `marketplace-pat`
environment, so the release PR check verifies the same `VSCE_PAT` that publish
uses. The PAT verification job does not check out the PR branch or run project
scripts; it installs the pinned `@vscode/vsce` CLI separately before reading
`VSCE_PAT`. GitHub Actions cannot read the expiration date from the encrypted
`VSCE_PAT` secret, so update `VSCE_PAT_EXPIRES_AT` whenever the Marketplace PAT
is rotated. Review the release PR diff before approving the protected
environment job, because approval makes the environment secret available to that
job.

For deployment branch and tag restrictions, start with no restriction. If
restrictions are required, allow `main` for release PR verification and stable
auto-release, `preview` for preview publishing, and `v*` tags for direct stable
release workflow runs. Using only `release/*` blocks this `pull_request_target`
workflow before the environment approval step. If the repository is private,
confirm with a test PR that the current GitHub plan supports required reviewers
for protected environments.

## Additional notes

- `npm run package` triggers SBOM generation (`scripts/generate-sbom.cjs`);
  the resulting `dist/securezip-sbom.cdx.json` is bundled automatically.
- Codex or other automation must read this document before touching release
  branches to ensure version bumps, changelog entries, and workflow toggles are
  handled consistently.

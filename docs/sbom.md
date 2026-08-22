# SBOM Workflow

SecureZip now generates a CycloneDX Software Bill of Materials so the packaged extension exposes its third-party components.

## How it works

- `npm run sbom` runs the built-in `npm sbom` command in `package-lock-only` mode, omitting dev dependencies and classifying the project as an application.
- SBOM generation requires npm 10.9.0 so the committed CycloneDX output remains reproducible across Node.js 24.x environments.
- The command writes `dist/securezip-sbom.cdx.json`. Because the file lives under `dist/`, it is bundled automatically when you run `vsce package` or `npm run package`.
- `npm run package` triggers the SBOM step through the `postpackage` lifecycle hook, so every publish-ready build includes a fresh SBOM.
- Eligible Dependabot pull requests use the `Build Dependabot Generated Artifacts` and `Sync Dependabot Generated Artifacts` workflows to synchronize runtime SBOM changes. Configure a repository secret named `DEPENDABOT_ARTIFACT_SYNC_TOKEN` with a GitHub App installation token or fine-grained PAT that can write repository contents; using a token other than `GITHUB_TOKEN` allows the synchronized commit to trigger the required pull request checks.

## Usage

```bash
npm run sbom            # regenerate dist/securezip-sbom.cdx.json
npm run package         # compile production bundle and refresh the SBOM
```

The generated JSON conforms to CycloneDX 1.5 and lists runtime dependencies (`archiver`, `globby`, `simple-git`, etc.) with hashes, source URLs, and licenses derived from `package-lock.json`.

## Customization tips

- Switch to SPDX by editing `scripts/generate-sbom.cjs` and replacing `--sbom-format cyclonedx` with `--sbom-format spdx`.
- Include dev dependencies by removing the `--omit dev` flag, which can be useful if you want tooling coverage for the full repository.
- If you move the compiled output elsewhere, update the `outputFile` constant so the SBOM stays alongside the shipped artifacts.

# SBOM Workflow

SecureZip generates a CycloneDX Software Bill of Materials so the packaged extension exposes its third-party components.

## How it works

- `npm run sbom` runs the built-in `npm sbom` command in `package-lock-only` mode, omitting dev dependencies and classifying the project as an application.
- SBOM generation requires npm 10.9.0 so the CycloneDX output remains reproducible across Node.js 24.x environments.
- The command writes `dist/securezip-sbom.cdx.json`. The file is a generated build output and is not committed to Git.
- Because the file lives under `dist/`, it is bundled automatically when you run `vsce package` or `npm run package`.
- `npm run package` triggers the SBOM step through the `postpackage` lifecycle hook, so every publish-ready build includes a fresh SBOM.
- Pull request CI generates and validates the SBOM without modifying the pull request branch.
- Stable release CI generates the SBOM from the tagged source, bundles it into the VSIX, and attaches a copy to the GitHub Release as `securezip-X.Y.Z-sbom.cdx.json`.

`package.json` and `package-lock.json` are the source of truth. The SBOM is a reproducible release artifact derived from them, rather than a separately versioned source file.

## Usage

```bash
npm run sbom            # regenerate dist/securezip-sbom.cdx.json
npm run package         # compile production bundle and refresh the SBOM
```

The generated JSON conforms to CycloneDX 1.5 and lists runtime dependencies (`archiver`, `globby`, `simple-git`, etc.) with hashes, source URLs, and licenses derived from `package-lock.json`.

The CI audit gate remains independent of the SBOM. Runtime dependencies are checked with `npm audit --omit=dev --audit-level=high`, while the scheduled Security Audit workflow reports development dependency findings separately.

## Customization tips

- Switch to SPDX by editing `scripts/generate-sbom.cjs` and replacing `--sbom-format cyclonedx` with `--sbom-format spdx`.
- Include dev dependencies by removing the `--omit dev` flag, which can be useful when producing a development-tooling SBOM for investigation.
- If you move the compiled output elsewhere, update the `outputFile` constant so the SBOM stays alongside the shipped artifacts.

# SBOM Workflow

SecureZip now generates a CycloneDX Software Bill of Materials so the packaged extension exposes its third-party components.

## How it works

- `npm run sbom` runs the built-in `npm sbom` command in `package-lock-only` mode, omitting dev dependencies and classifying the project as an application.
- The command writes `dist/securezip-sbom.cdx.json`. Because the file lives under `dist/`, it is bundled automatically when you run `vsce package` or `npm run package`.
- `npm run package` triggers the SBOM step through the `postpackage` lifecycle hook, so every publish-ready build includes a fresh SBOM.

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

# SecureZip

**SecureZip** is a Visual Studio Code extension that lets you securely export your project as a clean ZIP archive.  
Unlike simple “zipper” tools, SecureZip is designed for developers who need safe and reproducible distributions.

## ✨ Features
- 📦 **Export to ZIP** – Create a ZIP of your project with one click.
- 🔄 **Auto Commit (optional)** – Automatically commit untracked changes before export.
- 🏷 **Auto Tagging** – Tag the repository with the export date for easy traceability.
- 🧹 **Secure Clean** – Exclude sensitive and unnecessary files (e.g. `.git`, `.env`, SSH keys, logs).
- 🗂 **Manifest File** – Embed an `__export_manifest.json` with commit ID, tag, and export metadata.

## 🛡 Ignore Rules
SecureZip respects the following when selecting files to include:

- `.gitignore`: Automatically respected.
- `.securezipignore`: Project-specific rules to exclude and re-include files for export.

`.securezipignore` syntax (gitignore-like subset):

- `# comment` and empty lines are ignored.
- `pattern` excludes matches.
- `!pattern` re-includes matches (overrides only `.securezipignore` excludes; it does not bypass `.gitignore`).
- `/path` is treated as workspace-root relative.
- `dir/` matches a directory (expanded to `dir/**`).

Examples:

```
# Exclude all build outputs
dist/
out/

# Exclude all env files, but allow the example
.env*
!.env.example

# Keep a specific file inside an excluded folder
!dist/manifest.json
```

## 🔧 Feature Flags
SecureZip supports lightweight feature flags with both build-time defaults and runtime overrides.

- Runtime setting (recommended for users):
  - `secureZip.flags.enableStatusBarButton` (default: true)
  - Configure via Settings UI or `settings.json`.
- Build-time defaults (for maintainers):
  - `esbuild.js` injects `__BUILD_FLAGS__` using `define`, allowing different defaults per build.
- Rollout helpers:
  - `src/flags.ts` provides utilities to compute deterministic buckets from `machineId` if gradual rollout is needed.

Example `settings.json` override:

```json
{
  "secureZip.flags.enableStatusBarButton": false
}
```

## 🚀 Use Cases
- Delivering project source code to clients without leaking secrets.
- Creating reproducible “release snapshots” of work-in-progress.
- Archiving a clean, tagged version of your repository for audit or compliance.

## 📖 Roadmap
- Support for multiple archive formats (`.tar.gz`, `.7z`)
- Custom exclude profiles (`audit`, `distribution`, etc.)
- Optional password-protected archives

---

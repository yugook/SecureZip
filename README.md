# SecureZip

**SecureZip** is a Visual Studio Code extension that lets you securely export your project as a clean ZIP archive.  
Unlike simple “zipper” tools, SecureZip is designed for developers who need safe and reproducible distributions.

## ✨ Features
- 📦 **Export to ZIP** – Create a ZIP of your project with one click.
- 🔄 **Auto Commit (optional)** – Automatically commit untracked changes before export.
- 🏷 **Auto Tagging** – Tag the repository with the export date for easy traceability.
- 🧹 **Secure Clean** – Exclude sensitive and unnecessary files (e.g. `.git`, `.env`, SSH keys, logs).
- 🗂 **Manifest File** – Embed an `__export_manifest.json` with commit ID, tag, and export metadata.

## 🚀 Use Cases
- Delivering project source code to clients without leaking secrets.
- Creating reproducible “release snapshots” of work-in-progress.
- Archiving a clean, tagged version of your repository for audit or compliance.

## 📖 Roadmap
- Support for multiple archive formats (`.tar.gz`, `.7z`)
- Custom exclude profiles (`audit`, `distribution`, etc.)
- Optional password-protected archives

---
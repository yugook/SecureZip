# Export Manifest

SecureZip can embed `__securezip_manifest.json` at the archive root when
`secureZip.manifest.mode` is set to `embedded`. The default is `off` so existing
exports retain their original contents.

## Integrity model

Each payload file is read once. SecureZip updates a SHA-256 digest and byte
count while forwarding the same stream to the ZIP writer. After all payload
streams finish, SecureZip serializes the manifest and appends it as the final
archive entry.

The manifest does not hash itself. It also cannot contain the hash of the final
ZIP because adding that value would change the ZIP. A future sidecar hash can
cover the completed archive separately.

Encrypted exports apply WinZip AES-256 to the manifest entry as well as every
payload entry. ZIP metadata, including the manifest filename, remains visible
because WinZip AES does not encrypt archive headers.

## Schema version 1

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-13T10:25:30.123Z",
  "generator": {
    "name": "SecureZip",
    "version": "1.2.0"
  },
  "archive": {
    "format": "zip",
    "mode": "plain"
  },
  "sources": [
    {
      "id": "root-1",
      "label": "SecureZip",
      "git": {
        "repository": true,
        "commit": "0123456789abcdef0123456789abcdef01234567",
        "branch": "main",
        "tag": "export-20260713-192530",
        "dirty": false,
        "untrackedCount": 0
      },
      "selection": {
        "gitignoreApplied": true,
        "includeNodeModules": false,
        "autoExcludes": [".git", ".git/**"],
        "additionalExcludes": [],
        "secureZipIgnore": {
          "excludes": ["dist/**"],
          "includes": ["dist/manifest.json"]
        }
      }
    }
  ],
  "summary": {
    "fileCount": 1,
    "totalBytes": 1234,
    "hashAlgorithm": "sha256"
  },
  "files": [
    {
      "source": "root-1",
      "path": "src/index.ts",
      "size": 1234,
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  ]
}
```

`files` is sorted by archive-relative POSIX path. `summary.fileCount` and
`summary.totalBytes` describe payload files only and exclude the manifest.

For multi-root workspace exports, every workspace folder gets a source ID in
workspace order (`root-1`, `root-2`, and so on). File paths are the exact paths
used inside the combined archive, including each top-level workspace label.

Git metadata is best-effort and informational. A non-Git folder uses
`"repository": false`; an initialized repository without a first commit omits
`commit`. File paths, sizes, and hashes are the authoritative record of the
exported payload.

## Privacy and reserved path

The manifest intentionally omits passwords, operating-system user names,
machine IDs, Git remote URLs, and absolute local paths.

`__securezip_manifest.json` is reserved while embedded manifests are enabled.
If a single-root export already contains that archive path (case-insensitive),
the export fails before writing the temporary archive. Rename or exclude the
source file, or set `secureZip.manifest.mode` to `off`.

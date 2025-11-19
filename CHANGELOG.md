# Change Log

All notable changes to the "securezip" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.9-pre.1] - 2025-11-18

- Preview release to validate the Node.js 22.20.0 toolchain; all workflows now run on the same runtime as the latest VS Code host.

## [1.0.8] - 2025-11-17

- Added the `secureZip.autoCommit.stageMode` setting to choose whether auto-commit stages tracked files only or all changes (tracked + untracked).
- The auto-commit confirmation dialog now surfaces the selected stage mode and highlights pending untracked files so you know what will (and will not) be included.

## [1.0.7] - 2025-11-03

- Preview now surfaces `.gitignore` auto excludes, including live examples of matching files and re-include warnings.
- Auto exclude defaults in the preview highlight patterns that are currently active, example matches, and those with no hits.
- Added unit coverage for auto exclude ordering and an integration test ensuring the SecureZip view groups active vs inactive defaults correctly.

## [1.0.6] - 2025-10-21

- Performance and stability improvements.

## [1.0.5] - 2025-10-07

- Added support for repacking the `.git` directory so repositories can be tidied automatically.

## [1.0.4] - 2025-10-06

- Enlarged the Marketplace icon by trimming excess padding around the SecureZip glyph.

## [1.0.3] - 2025-10-05

- Updated release workflows to run only when version tags are created and to skip preview releases when not needed.
- Switched the extension icon to a circular layout for better Marketplace visibility.

## [1.0.2] - 2025-09-28

- Refined packaging to keep the extension lightweight.

## [1.0.1] - 2025-09-28

- Fixed duplicate Cancel button in the Git uncommitted dialog.
- Added tag-only export support when committing changes.

## [1.0.0] - 2025-09-28

- First stable release with ZIP export workflow, `.securezipignore` tooling, optional auto-commit, and tagging.

## [0.0.1] - 2025-09-25

- Preview release with export workflow, `.securezipignore` support, and tree view tools.

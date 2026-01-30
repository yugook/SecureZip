# SecureZip Extension Quickstart

## What's in the folder

- `package.json` declares the extension, commands, and settings.
- `src/extension.ts` is the activation entry point for SecureZip.
- `src/view.ts` implements the SecureZip view (tree provider).
- `docs/` includes architecture, testing, localization, and release guides.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Type-check and lint:
   ```bash
   npm run check-types
   npm run lint
   ```

## Run the extension

1. In VS Code, open the workspace and press `F5` (Run Extension).
2. In the Extension Host window, open the SecureZip view from the activity bar.
3. Run **SecureZip: Export** from the command palette to exercise the workflow.

## Develop iteratively

- `npm run watch` to rebuild as you edit.
- Reload the Extension Host window (Developer: Reload Window) after changes.

## Tests

- Unit tests: `npm run test:unit`
- Integration tests: `npm run test`
- See `docs/testing.md` for the full workflow and CI parity.

## Useful references

- Architecture: `docs/architecture.md`
- Localization: `docs/localization.md`
- Release process: `docs/releasing.md`

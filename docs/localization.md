# Localization Guide

SecureZip ships with English (default) and Japanese resources. Follow this
guide when adding or updating localized strings.

## Runtime strings (`src/*.ts`)

1. Use the `localize` helper from `src/nls.ts`:
   ```ts
   const label = localize('guide.diffSinceExport', 'Diff since last export');
   ```
2. The second argument is the English fallback shown if no translation exists.
3. For additional languages, add entries to `i18n/nls.bundle.<lang>.json`
   (currently `i18n/nls.bundle.ja.json`). Keys must match the ones passed to
   `localize`.
4. Keep the JSON sorted roughly by feature area to minimize merge conflicts.

## Contribution strings (`package.json`)

VS Code contributions (commands, menus, settings) are localized via
`package.nls*.json`.

1. Add the key/value to `package.nls.json` (English). The key matches the
   placeholder used in `package.json`, e.g. `%command.export.title%`.
2. Provide translations in `package.nls.ja.json`.
3. Validate the JSON (VS Code will flag invalid JSON, or use a JSON validator).

## Testing localization

- In VS Code, change the display language (`Preferences: Configure Display
  Language`) to verify the translated strings.
- For runtime strings, ensure the developer tools console shows no warnings
  about missing localization keys. Missing translations fall back to English,
  so scan the UI manually.

## Tips

- Reuse existing keys where possible. If the English text matches an existing
  scenario, referencing the same key keeps the bundles smaller.
- Prefer descriptive keys (`preview.autoExclude.tooltip`) over ones tied to the
  raw English phrase; this keeps translations stable even if the text changes.
- When removing a feature, delete the keys from both `package.nls.json` and
  `i18n/nls.bundle.*` to prevent stale strings from lingering.

Following these steps ensures SecureZip remains friendly to both English and
Japanese users while keeping localization assets maintainable.

/**
 * Shared helpers for SecureZip's built-in exclusion patterns.
 *
 * These defaults are applied before evaluating `.securezipignore` and user settings.
 */
const AUTO_EXCLUDE_BASE_PATTERNS = Object.freeze([
    '.git',
    '.git/**',
    '.vscode',
    '.vscode/**',
    '.env',
    '.env.*',
    '**/.env',
    '**/.env.*',
    '**/*.pem',
    '**/*.key',
    '**/*.crt',
    '**/*.pfx',
] as const);

export type AutoExcludePattern = (typeof AUTO_EXCLUDE_BASE_PATTERNS)[number] | 'node_modules/**';

/**
 * Returns the list of built-in exclusion patterns, taking the current settings into account.
 */
export function resolveAutoExcludePatterns(options?: { includeNodeModules?: boolean }): AutoExcludePattern[] {
    const includeNodeModules = options?.includeNodeModules ?? false;
    const patterns = [...AUTO_EXCLUDE_BASE_PATTERNS] as AutoExcludePattern[];
    if (!includeNodeModules) {
        // Maintain historical ordering: node_modules rules follow the .git block.
        patterns.splice(2, 0, 'node_modules/**');
    }
    return patterns;
}

/**
 * Provides the base auto-exclude patterns without considering user settings.
 * The returned array is read-only; clone it before mutating.
 */
export function getBaseAutoExcludePatterns(): readonly (typeof AUTO_EXCLUDE_BASE_PATTERNS)[number][] {
    return AUTO_EXCLUDE_BASE_PATTERNS;
}

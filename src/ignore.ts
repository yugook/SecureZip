import * as fs from 'fs';
import * as path from 'path';

export type SecureZipIgnore = {
    excludes: string[];
    includes: string[]; // patterns starting with '!'
};

export type AddPatternResult = {
    added: string[];
    skipped: { pattern: string; reason: 'duplicate' | 'invalid' }[];
};

type NormalizedPattern = {
    pattern: string;
    negated: boolean;
};

const DEFAULT_FILENAME = '.securezipignore';

/**
 * Load and parse a `.securezipignore` from the workspace root.
 * Supported subset (gitignore-like):
 * - comments starting with '#'
 * - empty lines ignored
 * - leading '!' for re-include list (returned as includes)
 * - leading '/' treated as workspace-root relative (we just drop it because cwd=root)
 * - trailing '/' treated as directory -> converted to `dir/**`
 */
export async function loadSecureZipIgnore(root: string, filename = DEFAULT_FILENAME): Promise<SecureZipIgnore> {
    const file = path.join(root, filename);
    const result: SecureZipIgnore = { excludes: [], includes: [] };
    try {
        await fs.promises.access(file, fs.constants.F_OK);
    } catch {
        return result; // no file
    }

    const raw = await fs.promises.readFile(file, 'utf8');
    for (const lineRaw of raw.split(/\r?\n/)) {
        const normalized = normalizeIgnorePattern(lineRaw);
        if (!normalized) {
            continue;
        }

        if (normalized.negated) {
            result.includes.push(normalized.pattern);
        } else {
            result.excludes.push(normalized.pattern);
        }
    }
    return result;
}

export function normalizeIgnorePattern(lineRaw: string): NormalizedPattern | undefined {
    let line = lineRaw.trim();
    if (!line) {
        return undefined;
    }
    if (line.startsWith('#')) {
        return undefined;
    }

    let negated = false;
    if (line.startsWith('!')) {
        negated = true;
        line = line.slice(1).trim();
        if (!line) {
            return undefined;
        }
    }

    line = line.replace(/\\+/g, '/');

    if (line.startsWith('/')) {
        line = line.slice(1);
    }

    if (line.endsWith('/')) {
        line = line.replace(/\/+$/g, '/') + '**';
    }

    if (!line) {
        return undefined;
    }

    return { pattern: line, negated };
}

export async function addPatternsToSecureZipIgnore(
    root: string,
    patterns: string[],
    filename = DEFAULT_FILENAME,
): Promise<AddPatternResult> {
    const added: string[] = [];
    const skipped: { pattern: string; reason: 'duplicate' | 'invalid' }[] = [];
    if (patterns.length === 0) {
        return { added, skipped };
    }

    const existing = await loadSecureZipIgnore(root, filename);
    const existingExcludes = new Set(existing.excludes.map((p) => p.trim()));
    const existingIncludes = new Set(existing.includes.map((p) => p.trim()));

    const toAppend: string[] = [];

    for (const raw of patterns) {
        const trimmed = raw.trim();
        if (!trimmed) {
            skipped.push({ pattern: raw, reason: 'invalid' });
            continue;
        }

        const normalized = normalizeIgnorePattern(trimmed);
        if (!normalized) {
            skipped.push({ pattern: raw, reason: 'invalid' });
            continue;
        }

        const targetSet = normalized.negated ? existingIncludes : existingExcludes;
        if (targetSet.has(normalized.pattern)) {
            skipped.push({ pattern: trimmed, reason: 'duplicate' });
            continue;
        }

        toAppend.push(trimmed);
        targetSet.add(normalized.pattern);
        added.push(trimmed);
    }

    if (toAppend.length === 0) {
        return { added, skipped };
    }

    const file = path.join(root, filename);
    let needsLeadingNewline = false;
    try {
        const existingContent = await fs.promises.readFile(file, 'utf8');
        if (existingContent.length > 0 && !existingContent.endsWith('\n')) {
            needsLeadingNewline = true;
        }
    } catch (err: any) {
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            // File will be created by appendFile below.
        } else {
            throw err;
        }
    }

    const text = `${needsLeadingNewline ? '\n' : ''}${toAppend.join('\n')}\n`;
    await fs.promises.appendFile(file, text, { encoding: 'utf8' });

    return { added, skipped };
}

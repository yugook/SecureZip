import * as fs from 'fs';
import * as path from 'path';

export type SecureZipIgnore = {
    excludes: string[];
    includes: string[]; // patterns starting with '!'
};

/**
 * Load and parse a `.securezipignore` from the workspace root.
 * Supported subset (gitignore-like):
 * - comments starting with '#'
 * - empty lines ignored
 * - leading '!' for re-include list (returned as includes)
 * - leading '/' treated as workspace-root relative (we just drop it because cwd=root)
 * - trailing '/' treated as directory -> converted to `dir/**`
 */
export async function loadSecureZipIgnore(root: string, filename = '.securezipignore'): Promise<SecureZipIgnore> {
    const file = path.join(root, filename);
    const result: SecureZipIgnore = { excludes: [], includes: [] };
    try {
        await fs.promises.access(file, fs.constants.F_OK);
    } catch {
        return result; // no file
    }

    const raw = await fs.promises.readFile(file, 'utf8');
    for (const lineRaw of raw.split(/\r?\n/)) {
        let line = lineRaw.trim();
        if (!line) continue;
        if (line.startsWith('#')) continue;

        const isNegated = line.startsWith('!');
        if (isNegated) {
            line = line.slice(1).trim();
            if (!line) continue;
        }

        // Normalize path separators to '/'
        line = line.replace(/\\+/g, '/');

        // Root-anchored: '/foo' => 'foo' since globby's cwd is root
        if (line.startsWith('/')) {
            line = line.slice(1);
        }

        // Directory rule: 'dir/' => 'dir/**'
        if (line.endsWith('/')) {
            line = line.replace(/\/+$/g, '/') + '**';
        }

        if (!line) continue;

        if (isNegated) {
            result.includes.push(line);
        } else {
            result.excludes.push(line);
        }
    }
    return result;
}


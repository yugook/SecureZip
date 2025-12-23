export const DIRECTORY_SUFFIX = '/**';
const ABSTRACT_GLOB_RE = /[\\*?\[\]{}!]/g;
const SLASH_RE = /[\\/]+/g;

export type SensitiveRules = {
    dirNames: Set<string>;
    fileNames: Set<string>;
    filePrefixes: Set<string>;
    extensions: Set<string>;
};

export function normalizePathPattern(value: string): string {
    return value.replace(SLASH_RE, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function isAbstractPattern(value: string): boolean {
    const normalized = normalizePathPattern(value);
    const stripped = normalized.replace(ABSTRACT_GLOB_RE, '').replace(/\//g, '');
    return stripped.length === 0;
}

export function buildSensitiveRules(patterns: readonly string[]): SensitiveRules {
    const rules: SensitiveRules = {
        dirNames: new Set<string>(),
        fileNames: new Set<string>(),
        filePrefixes: new Set<string>(),
        extensions: new Set<string>(),
    };

    for (const raw of patterns) {
        const normalized = normalizePathPattern(raw);
        if (!normalized) {
            continue;
        }

        if (normalized.endsWith(DIRECTORY_SUFFIX)) {
            const dir = normalized.slice(0, -DIRECTORY_SUFFIX.length);
            if (dir && !dir.includes('/')) {
                rules.dirNames.add(dir);
            }
            continue;
        }

        if (!normalized.includes('/')) {
            if (normalized === '.git' || normalized === '.vscode') {
                rules.dirNames.add(normalized);
                rules.fileNames.add(normalized);
                continue;
            }
            if (normalized === '.env') {
                rules.fileNames.add(normalized);
                continue;
            }
            if (normalized.startsWith('.env.')) {
                rules.filePrefixes.add('.env.');
                continue;
            }
        }

        const lastSegment = normalized.split('/').pop() ?? '';
        if (lastSegment === '.env') {
            rules.fileNames.add('.env');
        } else if (lastSegment.startsWith('.env.')) {
            rules.filePrefixes.add('.env.');
        }

        const extMatch = lastSegment.match(/^\*\.([^.]+)$/i);
        if (extMatch) {
            rules.extensions.add(`.${extMatch[1].toLowerCase()}`);
        }
    }

    return rules;
}

export function isSensitiveValue(value: string, rules: SensitiveRules): boolean {
    const normalized = normalizePathPattern(value);
    if (!normalized) {
        return false;
    }

    const segments = normalized.split('/');
    for (const segment of segments) {
        if (rules.dirNames.has(segment)) {
            return true;
        }
    }

    const last = segments[segments.length - 1] ?? '';
    if (rules.fileNames.has(last)) {
        return true;
    }
    for (const prefix of rules.filePrefixes) {
        if (last.startsWith(prefix)) {
            return true;
        }
    }
    const lower = last.toLowerCase();
    for (const ext of rules.extensions) {
        if (lower.endsWith(ext)) {
            return true;
        }
    }

    return false;
}

import * as fs from 'fs';
import * as path from 'path';
// The raw entry point uses the patched dependencies from our lockfile rather than bundled copies.
import { globStream, hasMagic, Ignore, Path } from 'glob/raw';
import ignore, { Ignore as GitIgnore } from 'ignore';

export type FileGlobOptions = {
    cwd: string;
    dot?: boolean;
    absolute?: boolean;
    gitignore?: boolean;
    ignore?: string[];
    onlyFiles?: boolean;
    onlyDirectories?: boolean;
    followSymbolicLinks?: false;
    unique?: boolean;
    deep?: number;
};

const posixPath = (value: string): string => value.split(path.sep).join('/');
const samePath = (left: string, right: string): boolean => path.relative(left, right) === '';
const isNegativePattern = (pattern: string): boolean => pattern.startsWith('!') && !pattern.startsWith('!(');

function isMissing(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}

function findIgnoreRoot(cwd: string): string {
    let directory = cwd;
    while (true) {
        if (fs.existsSync(path.join(directory, '.git'))) {
            return directory;
        }
        const parent = path.dirname(directory);
        if (parent === directory) {
            return cwd;
        }
        directory = parent;
    }
}

function createGitIgnorePredicate(cwd: string): (entry: Path) => boolean {
    const root = findIgnoreRoot(cwd);
    const matchers = new Map<string, GitIgnore>();
    const directories = new Map<string, boolean>();

    const matcherFor = (directory: string): GitIgnore => {
        let matcher = matchers.get(directory);
        if (!matcher) {
            matcher = ignore();
            try {
                matcher.add(fs.readFileSync(path.join(directory, '.gitignore'), 'utf8'));
            } catch (error) {
                if (!isMissing(error)) {
                    throw error;
                }
            }
            matchers.set(directory, matcher);
        }
        return matcher;
    };

    const isIgnored = (fullPath: string, isDirectory: boolean): boolean => {
        const relative = path.relative(root, fullPath);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            return false;
        }
        if (isDirectory && directories.has(fullPath)) {
            return directories.get(fullPath)!;
        }
        const parent = path.dirname(fullPath);
        if (isIgnored(parent, true)) {
            return true;
        }
        const scopes: string[] = [];
        for (let scope = parent; ; scope = path.dirname(scope)) {
            scopes.push(scope);
            if (samePath(scope, root)) {
                break;
            }
        }
        let ignored = false;
        for (const scope of scopes.reverse()) {
            const candidate = posixPath(path.relative(scope, fullPath)) + (isDirectory ? '/' : '');
            const result = matcherFor(scope).test(candidate);
            if (result.ignored || result.unignored) {
                ignored = result.ignored;
            }
        }
        if (isDirectory) {
            directories.set(fullPath, ignored);
        }
        return ignored;
    };

    return (entry) => isIgnored(entry.fullpath(), entry.isDirectory());
}

async function expandDirectories(patterns: string[], cwd: string): Promise<string[]> {
    const expanded = await Promise.all(patterns.map(async (pattern) => {
        // Extensionless and dot-prefixed recursive names can denote files or directories.
        if (/\*\*\/[^/*?\[\]{}]+$/.test(pattern) &&
            (!path.posix.extname(pattern) || path.posix.basename(pattern).startsWith('.'))) {
            return [pattern, `${pattern}/**`];
        }
        if (!hasMagic(pattern)) {
            try {
                if ((await fs.promises.lstat(path.resolve(cwd, pattern))).isDirectory()) {
                    return `${pattern.replace(/\/$/, '')}/**`;
                }
            } catch (error) {
                // A literalized glob can exceed POSIX filename limits without denoting a directory.
                if (!isMissing(error) && (error as NodeJS.ErrnoException).code !== 'ENAMETOOLONG') {
                    throw error;
                }
            }
        }
        return pattern;
    }));
    return expanded.flat();
}

export async function* globFileStream(
    patterns: string | string[],
    options: FileGlobOptions,
): AsyncGenerator<string> {
    const cwd = path.resolve(options.cwd);
    const inputs = typeof patterns === 'string' ? [patterns] : patterns;
    const positive = await expandDirectories(inputs.filter((pattern) => !isNegativePattern(pattern)), cwd);
    if (positive.length === 0) {
        return;
    }
    const negative = await expandDirectories([
        ...(options.ignore ?? []),
        ...inputs.filter(isNegativePattern).map((pattern) => pattern.slice(1)),
    ], cwd);
    const excluded = new Ignore(negative, { dot: true, nocase: false });
    const gitIgnored = options.gitignore ? createGitIgnorePredicate(cwd) : () => false;
    const symbolicDirectories = new Map<string, boolean>();
    const hasSymbolicParent = (fullPath: string): boolean => {
        const parent = path.dirname(fullPath);
        if (samePath(parent, cwd) || parent === fullPath) {
            return false;
        }
        let symbolic = symbolicDirectories.get(parent);
        if (symbolic === undefined) {
            symbolic = fs.lstatSync(parent).isSymbolicLink() || hasSymbolicParent(parent);
            symbolicDirectories.set(parent, symbolic);
        }
        return symbolic;
    };
    const skipped = (entry: Path): boolean => !samePath(entry.fullpath(), cwd) && (
        entry.isSymbolicLink() || hasSymbolicParent(entry.fullpath()) || gitIgnored(entry)
    );
    const stream = globStream(positive, {
        cwd,
        dot: options.dot,
        nocase: false,
        follow: false,
        withFileTypes: true,
        maxDepth: options.deep,
        ignore: {
            ignored: (entry) => skipped(entry) || excluded.ignored(entry),
            childrenIgnored: (entry) => skipped(entry) || excluded.childrenIgnored(entry),
        },
    });
    try {
        for await (const entry of stream) {
            if (samePath(entry.fullpath(), cwd) || entry.isSymbolicLink()) {
                continue;
            }
            if (options.onlyDirectories ? !entry.isDirectory() : options.onlyFiles !== false && !entry.isFile()) {
                continue;
            }
            yield options.absolute ? entry.fullpath() : posixPath(path.relative(cwd, entry.fullpath()));
        }
    } finally {
        stream.destroy();
    }
}

export async function globFiles(patterns: string | string[], options: FileGlobOptions): Promise<string[]> {
    const files: string[] = [];
    for await (const file of globFileStream(patterns, options)) {
        files.push(file);
    }
    return files;
}

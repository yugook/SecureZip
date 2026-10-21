import * as fs from 'fs';
import * as path from 'path';
// The raw entry point uses the patched dependencies from our lockfile rather than bundled copies.
import { Glob, globStream, hasMagic, Ignore, FSOption } from 'glob/raw';
import ignore, { Ignore as GitIgnore } from 'ignore';
import { isPathWithin } from './pathBoundary';

export type FileGlobOptions = {
    cwd: string;
    dot?: boolean;
    absolute?: boolean;
    gitignore?: boolean;
    ignore?: string[];
    onlyFiles?: boolean;
    onlyDirectories?: boolean;
    followSymbolicLinks?: false;
    deep?: number;
    restrictToCwd?: boolean;
};

const posixPath = (value: string): string => value.split(path.sep).join('/');
const samePath = (left: string, right: string): boolean => path.relative(left, right) === '';
const isNegativePattern = (pattern: string): boolean => pattern.startsWith('!') && !pattern.startsWith('!(');

function isMissing(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}

async function findIgnoreRoot(cwd: string): Promise<string> {
    let directory = cwd;
    while (true) {
        try {
            await fs.promises.lstat(path.join(directory, '.git'));
            return directory;
        } catch (error) {
            if (!isMissing(error)) {
                throw error;
            }
        }
        const parent = path.dirname(directory);
        if (parent === directory) {
            return cwd;
        }
        directory = parent;
    }
}

async function createGitIgnorePredicate(cwd: string): Promise<(fullPath: string, isDirectory: boolean) => Promise<boolean>> {
    const root = await findIgnoreRoot(cwd);
    const matchers = new Map<string, Promise<GitIgnore>>();
    const directories = new Map<string, Promise<boolean>>();

    const matcherFor = (directory: string): Promise<GitIgnore> => {
        let matcher = matchers.get(directory);
        if (!matcher) {
            matcher = (async () => {
                const result = ignore();
                try {
                    result.add(await fs.promises.readFile(path.join(directory, '.gitignore'), 'utf8'));
                } catch (error) {
                    if (!isMissing(error)) {
                        throw error;
                    }
                }
                return result;
            })();
            matchers.set(directory, matcher);
        }
        return matcher;
    };

    const evaluate = async (fullPath: string, isDirectory: boolean): Promise<boolean> => {
        const relative = path.relative(root, fullPath);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            return false;
        }
        const parent = path.dirname(fullPath);
        if (await isIgnored(parent, true)) {
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
            const result = (await matcherFor(scope)).test(candidate);
            if (result.ignored || result.unignored) {
                ignored = result.ignored;
            }
        }
        return ignored;
    };

    const isIgnored = (fullPath: string, isDirectory: boolean): Promise<boolean> => {
        if (!isDirectory) {
            return evaluate(fullPath, false);
        }
        let result = directories.get(fullPath);
        if (!result) {
            result = evaluate(fullPath, true);
            directories.set(fullPath, result);
        }
        return result;
    };
    return isIgnored;
}

async function expandDirectories(patterns: string[], cwd: string, restrictToCwd = false): Promise<string[]> {
    const expanded = await Promise.all(patterns.map(async (pattern) => {
        if (restrictToCwd && !isPathWithin(cwd, path.resolve(cwd, pattern))) {
            return [];
        }
        // A recursive literal name can denote a file or a directory, regardless of its extension.
        if (/\*\*\/[^/*?\[\]{}]+$/.test(pattern)) {
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

function depthGroups(patterns: string[], cwd: string, deep?: number): Map<number | undefined, string[]> {
    if (deep === undefined || deep === Infinity) {
        return new Map([[undefined, patterns]]);
    }
    const groups = new Map<number, string[]>();
    // Parse brace alternatives before finding each pattern's static search base.
    for (const pattern of new Glob(patterns, { cwd, nocase: false }).patterns) {
        const parts: string[] = [];
        let part = pattern;
        while (part.isString() && part.hasMore()) {
            parts.push(String(part.pattern()));
            part = part.rest()!;
        }
        const base = path.resolve(cwd, parts.join('/'));
        const depth = deep + base.split(path.sep).length - cwd.split(path.sep).length;
        const group = groups.get(depth) ?? [];
        group.push(pattern.globString());
        groups.set(depth, group);
    }
    return groups;
}

export async function* globFileStream(
    patterns: string | string[],
    options: FileGlobOptions,
): AsyncGenerator<string> {
    const cwd = path.resolve(options.cwd);
    const inputs = typeof patterns === 'string' ? [patterns] : patterns;
    const positive = await expandDirectories(inputs.filter((pattern) => !isNegativePattern(pattern)), cwd, options.restrictToCwd);
    if (positive.length === 0) {
        return;
    }
    const negative = await expandDirectories([
        ...(options.ignore ?? []),
        ...inputs.filter(isNegativePattern).map((pattern) => pattern.slice(1)),
    ], cwd, options.restrictToCwd);
    // Excluding a matching directory also excludes its descendants, including for wildcard names.
    const excluded = new Ignore(negative.flatMap((pattern) => pattern.endsWith('/**')
        ? [pattern] : [pattern, `${pattern.replace(/\/+$/, '')}/**`]), { dot: true, nocase: false });
    const gitIgnored = options.gitignore ? await createGitIgnorePredicate(cwd) : async () => false;
    const realRoot = options.restrictToCwd ? await fs.promises.realpath(cwd) : undefined;
    const symbolicDirectories = new Map<string, Promise<boolean>>();
    const symbolicDirectory = (directory: string): Promise<boolean> => {
        if (samePath(directory, cwd) || path.dirname(directory) === directory) {
            return Promise.resolve(false);
        }
        let result = symbolicDirectories.get(directory);
        if (!result) {
            result = (async () => {
                try {
                    return (await fs.promises.lstat(directory)).isSymbolicLink() ||
                        await symbolicDirectory(path.dirname(directory));
                } catch (error) {
                    if (!isMissing(error)) {
                        throw error;
                    }
                    return false;
                }
            })();
            symbolicDirectories.set(directory, result);
        }
        return result;
    };
    const seen = new Set<string>();
    for (const [maxDepth, patternsForDepth] of depthGroups(positive, cwd, options.deep)) {
        const controller = new AbortController();
        let failed = false;
        let firstError: unknown;
        const fail = (error: unknown): void => {
            if (!failed) {
                failed = true;
                firstError = error;
                controller.abort();
            }
        };
        const readDirectory = async (directory: string): Promise<fs.Dirent[]> => {
            if (options.restrictToCwd && !isPathWithin(cwd, directory)) {
                return [];
            }
            if (await symbolicDirectory(directory) || await gitIgnored(directory, true)) {
                return [];
            }
            return fs.promises.readdir(directory, { withFileTypes: true });
        };
        // path-scurry intentionally suppresses filesystem errors; retain failures before it does so.
        const checked = async <T>(operation: () => Promise<T>): Promise<T> => {
            try {
                return await operation();
            } catch (error) {
                if (!isMissing(error)) {
                    fail(error);
                }
                throw error;
            }
        };
        const strictFs: FSOption = {
            readdir: (directory, _options, callback) => {
                void checked(() => readDirectory(directory)).then(
                    (entries) => callback(null, entries),
                    (error: NodeJS.ErrnoException) => callback(error),
                );
            },
            promises: {
                readdir: (directory) => checked(() => readDirectory(directory)),
                lstat: (file) => checked(async () => {
                    if (options.restrictToCwd && !isPathWithin(cwd, file)) {
                        throw Object.assign(new Error('Path is outside the search root'), { code: 'ENOENT' });
                    }
                    return fs.promises.lstat(file);
                }),
            },
        };
        const guard = (test: () => boolean): boolean => {
            try {
                return test();
            } catch (error) {
                fail(error);
                return true;
            }
        };
        const stream = globStream(patternsForDepth, {
            cwd, dot: options.dot, nocase: false, follow: false, withFileTypes: true,
            maxDepth, fs: strictFs, signal: controller.signal,
            ignore: {
                ignored: (entry) => guard(() => excluded.ignored(entry)),
                childrenIgnored: (entry) => guard(() => excluded.childrenIgnored(entry)),
            },
        });
        try {
            try {
                for await (const entry of stream) {
                    const fullPath = entry.fullpath();
                    if (options.restrictToCwd && !isPathWithin(cwd, fullPath)) {
                        continue;
                    }
                    if (samePath(fullPath, cwd) || entry.isSymbolicLink() || seen.has(fullPath) ||
                        await symbolicDirectory(path.dirname(fullPath)) || await gitIgnored(fullPath, entry.isDirectory())) {
                        continue;
                    }
                    if (options.onlyDirectories ? !entry.isDirectory() : options.onlyFiles !== false && !entry.isFile()) {
                        continue;
                    }
                    if (realRoot && !isPathWithin(realRoot, await fs.promises.realpath(fullPath))) {
                        continue;
                    }
                    seen.add(fullPath);
                    yield options.absolute ? fullPath : posixPath(path.relative(cwd, fullPath));
                }
            } catch (error) {
                if (!failed) {
                    throw error;
                }
            }
            if (failed) {
                throw firstError;
            }
        } finally {
            controller.abort();
            stream.destroy();
        }
    }
}

export async function globFiles(patterns: string | string[], options: FileGlobOptions): Promise<string[]> {
    const files: string[] = [];
    for await (const file of globFileStream(patterns, options)) {
        files.push(file);
    }
    return files;
}

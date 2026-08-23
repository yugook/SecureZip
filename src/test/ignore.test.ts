import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'mocha';
import { normalizeIgnorePattern, loadSecureZipIgnore, addPatternsToSecureZipIgnore } from '../ignore';
import {
    IGNORE_SOURCE_PRIORITY,
    collectEffectiveFiles,
    createEffectiveIgnorePlan,
    resolvePatternPresence,
} from '../effectiveIgnore';

describe('ignore helpers', () => {
    describe('normalizeIgnorePattern', () => {
        it('ignores blank lines and comments', () => {
            assert.strictEqual(normalizeIgnorePattern('   '), undefined);
            assert.strictEqual(normalizeIgnorePattern('# comment'), undefined);
        });

        it('normalizes directory suffix and leading slashes', () => {
            const normalized = normalizeIgnorePattern('/dist/');
            assert.deepStrictEqual(normalized, { pattern: 'dist/**', negated: false });
        });

        it('handles negated patterns', () => {
            const normalized = normalizeIgnorePattern('!important.log');
            assert.deepStrictEqual(normalized, { pattern: 'important.log', negated: true });
        });
    });

    describe('loadSecureZipIgnore & addPatternsToSecureZipIgnore', () => {
        it('returns empty pattern lists when file is missing', async () => {
            const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'securezip-ignore-test-missing-'));
            try {
                const state = await loadSecureZipIgnore(tmp);
                assert.deepStrictEqual(state, { excludes: [], includes: [] });
                await assert.rejects(fs.promises.stat(path.join(tmp, '.securezipignore')));
            } finally {
                await fs.promises.rm(tmp, { recursive: true, force: true });
            }
        });

        it('loads existing patterns and appends new ones', async () => {
            const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'securezip-ignore-test-'));
            try {
                const file = path.join(tmp, '.securezipignore');
                await fs.promises.writeFile(file, '# Initial\ndist/\n!dist/build.zip\n', 'utf8');

                const initial = await loadSecureZipIgnore(tmp);
                assert.deepStrictEqual(initial.excludes, ['dist/**']);
                assert.deepStrictEqual(initial.includes, ['dist/build.zip']);

                const result = await addPatternsToSecureZipIgnore(tmp, ['logs/', '!dist/manifest.json', 'logs/']);
                assert.deepStrictEqual(result.added, ['logs/', '!dist/manifest.json']);
                assert.strictEqual(result.skipped.length, 1);
                assert.strictEqual(result.skipped[0].pattern, 'logs/');
                assert.strictEqual(result.skipped[0].reason, 'duplicate');

                const finalState = await loadSecureZipIgnore(tmp);
                assert.deepStrictEqual(finalState.excludes.sort(), ['dist/**', 'logs/**']);
                assert.deepStrictEqual(finalState.includes.sort(), ['dist/build.zip', 'dist/manifest.json']);
            } finally {
                await fs.promises.rm(tmp, { recursive: true, force: true });
            }
        });

        it('skips invalid patterns without creating a file', async () => {
            const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'securezip-ignore-test-invalid-'));
            try {
                const result = await addPatternsToSecureZipIgnore(tmp, ['   ', '# comment', '!']);
                assert.deepStrictEqual(result.added, []);
                assert.strictEqual(result.skipped.length, 3);
                assert.ok(result.skipped.every((entry) => entry.reason === 'invalid'));
                await assert.rejects(fs.promises.stat(path.join(tmp, '.securezipignore')));
            } finally {
                await fs.promises.rm(tmp, { recursive: true, force: true });
            }
        });

        it('respects newline handling when appending to an existing file', async () => {
            const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'securezip-ignore-test-newline-'));
            try {
                const file = path.join(tmp, '.securezipignore');
                await fs.promises.writeFile(file, 'dist/\n!dist/build.zip', 'utf8');

                const result = await addPatternsToSecureZipIgnore(tmp, ['cache/']);
                assert.deepStrictEqual(result.added, ['cache/']);
                assert.deepStrictEqual(result.skipped, []);

                const contents = await fs.promises.readFile(file, 'utf8');
                assert.strictEqual(contents, 'dist/\n!dist/build.zip\ncache/\n');
            } finally {
                await fs.promises.rm(tmp, { recursive: true, force: true });
            }
        });

        it('preserves CRLF newline style when appending to an existing file', async () => {
            const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'securezip-ignore-test-crlf-'));
            try {
                const file = path.join(tmp, '.securezipignore');
                await fs.promises.writeFile(file, 'dist/\r\n!dist/build.zip\r\n', 'utf8');

                const result = await addPatternsToSecureZipIgnore(tmp, ['cache\\tmp\\']);
                assert.deepStrictEqual(result.added, ['cache\\tmp\\']);
                assert.deepStrictEqual(result.skipped, []);

                const contents = await fs.promises.readFile(file, 'utf8');
                assert.strictEqual(contents, 'dist/\r\n!dist/build.zip\r\ncache\\tmp\\\r\n');

                const state = await loadSecureZipIgnore(tmp);
                assert.deepStrictEqual(state.excludes.sort(), ['cache/tmp/**', 'dist/**']);
                assert.deepStrictEqual(state.includes, ['dist/build.zip']);
            } finally {
                await fs.promises.rm(tmp, { recursive: true, force: true });
            }
        });

        it('treats backslash directory patterns as duplicates of normalized entries', async () => {
            const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'securezip-ignore-test-backslash-'));
            try {
                const file = path.join(tmp, '.securezipignore');
                await fs.promises.writeFile(file, 'logs/\n', 'utf8');

                const result = await addPatternsToSecureZipIgnore(tmp, ['logs\\']);
                assert.deepStrictEqual(result.added, []);
                assert.deepStrictEqual(result.skipped, [{ pattern: 'logs\\', reason: 'duplicate' }]);

                const contents = await fs.promises.readFile(file, 'utf8');
                assert.strictEqual(contents, 'logs/\n');
            } finally {
                await fs.promises.rm(tmp, { recursive: true, force: true });
            }
        });
    });

    describe('effective ignore plan', () => {
        it('keeps rule sources, priorities, and snapshots in one plan', () => {
            const plan = createEffectiveIgnorePlan({
                secureZipIgnore: {
                    excludes: ['dist/**', 'dist/**'],
                    includes: ['dist/keep.txt', '.git'],
                },
                autoExcludePatterns: ['node_modules/**'],
                additionalExcludePatterns: ['coverage/**'],
                configurationIncludePatterns: ['node_modules/**'],
            });

            assert.deepStrictEqual(plan.baseIgnorePatterns, ['node_modules/**', 'coverage/**', 'dist/**']);
            assert.deepStrictEqual(plan.configurationIncludeIgnorePatterns, ['coverage/**', 'dist/**']);
            assert.deepStrictEqual(plan.secureReincludePatterns, ['dist/keep.txt', '.git', '.git/**']);
            assert.deepStrictEqual(plan.ignoreSnapshot, ['dist/**', '!dist/keep.txt', '!.git']);
            assert.strictEqual(plan.gitOverride, true);
            assert.deepStrictEqual(IGNORE_SOURCE_PRIORITY, {
                auto: 0,
                gitignore: 1,
                configuration: 2,
                securezipignore: 3,
            });
            assert.ok(
                plan.rules.some(
                    (rule) =>
                        rule.pattern === 'dist/keep.txt' &&
                        rule.action === 'include' &&
                        rule.source === 'securezipignore',
                ),
            );
        });

        it('applies securezipignore includes after gitignore and configuration includes', async () => {
            const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'securezip-effective-ignore-test-'));
            try {
                await fs.promises.mkdir(path.join(tmp, '.git'), { recursive: true });
                await fs.promises.mkdir(path.join(tmp, 'dist'), { recursive: true });
                await fs.promises.mkdir(path.join(tmp, 'node_modules'), { recursive: true });
                await fs.promises.writeFile(path.join(tmp, '.gitignore'), 'dist/\nnode_modules/\n', 'utf8');
                await fs.promises.writeFile(path.join(tmp, 'dist', 'keep.txt'), 'keep\n', 'utf8');
                await fs.promises.writeFile(path.join(tmp, 'dist', 'drop.txt'), 'drop\n', 'utf8');
                await fs.promises.writeFile(path.join(tmp, 'node_modules', 'keep.js'), 'keep\n', 'utf8');

                const plan = createEffectiveIgnorePlan({
                    secureZipIgnore: {
                        excludes: ['dist/drop.txt', 'node_modules/**'],
                        includes: ['dist/keep.txt'],
                    },
                    autoExcludePatterns: ['node_modules/**'],
                    configurationIncludePatterns: ['node_modules/**'],
                });
                const files = await collectEffectiveFiles(tmp, plan);

                assert.ok(files.includes('dist/keep.txt'), '.securezipignore should override .gitignore');
                assert.ok(!files.includes('dist/drop.txt'), 'explicit .securezipignore excludes should remain active');
                assert.ok(
                    !files.includes('node_modules/keep.js'),
                    '.securezipignore excludes should override configuration includes',
                );
            } finally {
                await fs.promises.rm(tmp, { recursive: true, force: true });
            }
        });

        it('evaluates broad re-includes and roots independently', async () => {
            const rootA = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'securezip-effective-root-a-'));
            const rootB = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'securezip-effective-root-b-'));
            try {
                for (const root of [rootA, rootB]) {
                    const secureConfig = path.join(root, 'secure-config');
                    await fs.promises.mkdir(secureConfig, { recursive: true });
                    await fs.promises.writeFile(path.join(secureConfig, 'service.pem'), 'secret\n', 'utf8');
                }

                const rawPresence = await resolvePatternPresence(rootA, ['**/*.pem']);
                const activePresence = await resolvePatternPresence(rootA, ['**/*.pem'], {
                    excludePatterns: ['secure-config/**'],
                });
                assert.strictEqual(rawPresence.exists, true);
                assert.strictEqual(activePresence.exists, false);

                const rootAPlan = createEffectiveIgnorePlan({
                    secureZipIgnore: { excludes: [], includes: ['secure-config/**'] },
                    autoExcludePatterns: ['**/*.pem'],
                });
                const rootBPlan = createEffectiveIgnorePlan({
                    secureZipIgnore: { excludes: [], includes: [] },
                    autoExcludePatterns: ['**/*.pem'],
                });
                const [rootAFiles, rootBFiles] = await Promise.all([
                    collectEffectiveFiles(rootA, rootAPlan),
                    collectEffectiveFiles(rootB, rootBPlan),
                ]);

                assert.ok(rootAFiles.includes('secure-config/service.pem'));
                assert.ok(!rootBFiles.includes('secure-config/service.pem'));
            } finally {
                await fs.promises.rm(rootA, { recursive: true, force: true });
                await fs.promises.rm(rootB, { recursive: true, force: true });
            }
        });
    });
});

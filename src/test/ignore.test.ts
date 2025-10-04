import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'mocha';
import { normalizeIgnorePattern, loadSecureZipIgnore, addPatternsToSecureZipIgnore } from '../ignore';

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
    });
});

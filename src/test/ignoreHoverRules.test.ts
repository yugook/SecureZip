import * as assert from 'assert';
import { describe, it } from 'mocha';
import { resolveAutoExcludePatterns } from '../defaultExcludes';
import {
    buildSensitiveRules,
    isAbstractPattern,
    isSensitiveValue,
    normalizePathPattern,
} from '../ignoreHoverRules';

describe('ignore hover rules', () => {
    describe('normalizePathPattern', () => {
        it('normalizes slashes and trims leading/trailing slashes', () => {
            assert.strictEqual(normalizePathPattern('\\foo\\bar\\'), 'foo/bar');
            assert.strictEqual(normalizePathPattern('/foo/bar/'), 'foo/bar');
        });
    });

    describe('isAbstractPattern', () => {
        it('returns true for patterns that are entirely abstract', () => {
            assert.strictEqual(isAbstractPattern('*'), true);
            assert.strictEqual(isAbstractPattern('**'), true);
            assert.strictEqual(isAbstractPattern('/**/'), true);
            assert.strictEqual(isAbstractPattern('*/'), true);
            assert.strictEqual(isAbstractPattern('**/*'), true);
        });

        it('returns false when a concrete segment exists', () => {
            assert.strictEqual(isAbstractPattern('src/*'), false);
            assert.strictEqual(isAbstractPattern('foo/**/bar'), false);
            assert.strictEqual(isAbstractPattern('foo/bar'), false);
        });
    });

    describe('isSensitiveValue', () => {
        it('detects sensitive values from auto excludes', () => {
            const rules = buildSensitiveRules(resolveAutoExcludePatterns({ includeNodeModules: false }));
            assert.strictEqual(isSensitiveValue('.env', rules), true);
            assert.strictEqual(isSensitiveValue('.env.local', rules), true);
            assert.strictEqual(isSensitiveValue('foo/.env', rules), true);
            assert.strictEqual(isSensitiveValue('certs/server.pem', rules), true);
            assert.strictEqual(isSensitiveValue('keys/private.key', rules), true);
            assert.strictEqual(isSensitiveValue('certs/tls.crt', rules), true);
            assert.strictEqual(isSensitiveValue('secrets/identity.pfx', rules), true);
            assert.strictEqual(isSensitiveValue('.git/config', rules), true);
            assert.strictEqual(isSensitiveValue('.vscode/settings.json', rules), true);
            assert.strictEqual(isSensitiveValue('node_modules/react/index.js', rules), true);
        });

        it('respects includeNodeModules setting', () => {
            const rules = buildSensitiveRules(resolveAutoExcludePatterns({ includeNodeModules: true }));
            assert.strictEqual(isSensitiveValue('node_modules/react/index.js', rules), false);
        });

        it('returns false for non-sensitive values', () => {
            const rules = buildSensitiveRules(resolveAutoExcludePatterns({ includeNodeModules: false }));
            assert.strictEqual(isSensitiveValue('src/index.ts', rules), false);
            assert.strictEqual(isSensitiveValue('docs/readme.md', rules), false);
        });
    });
});

import * as assert from 'assert';
import {
    EXPORT_MANIFEST_PATH,
    buildExportManifest,
    hasExportManifestPathConflict,
    normalizeExportManifestMode,
    serializeExportManifest,
    type ExportManifestSource,
} from '../exportManifest';

describe('export manifest', () => {
    const sources: ExportManifestSource[] = [
        {
            id: 'root-1',
            label: 'Project',
            git: {
                repository: true,
                commit: '0123456789abcdef',
                branch: 'main',
                dirty: false,
                untrackedCount: 0,
            },
            selection: {
                gitignoreApplied: true,
                includeNodeModules: false,
                autoExcludes: ['.git/**'],
                additionalExcludes: ['coverage/**'],
                secureZipIgnore: {
                    excludes: ['dist/**'],
                    includes: ['dist/manifest.json'],
                },
            },
        },
    ];

    it('normalizes unsupported settings to off', () => {
        assert.strictEqual(normalizeExportManifestMode('embedded'), 'embedded');
        assert.strictEqual(normalizeExportManifestMode('off'), 'off');
        assert.strictEqual(normalizeExportManifestMode('unexpected'), 'off');
        assert.strictEqual(normalizeExportManifestMode(undefined), 'off');
    });

    it('sorts payload files and calculates the summary', () => {
        const manifest = buildExportManifest({
            generatedAt: '2026-07-13T10:25:30.123Z',
            generatorVersion: '1.2.0',
            archiveMode: 'encrypted',
            sources,
            files: [
                { source: 'root-1', path: 'src\\index.ts', size: 12, sha256: 'b'.repeat(64) },
                { source: 'root-1', path: 'README.md', size: 8, sha256: 'a'.repeat(64) },
            ],
        });

        assert.strictEqual(manifest.schemaVersion, 1);
        assert.deepStrictEqual(manifest.files.map((file) => file.path), ['README.md', 'src/index.ts']);
        assert.deepStrictEqual(manifest.summary, {
            fileCount: 2,
            totalBytes: 20,
            hashAlgorithm: 'sha256',
        });
        assert.strictEqual(manifest.archive.mode, 'encrypted');
        assert.strictEqual(manifest.sources[0].git.commit, '0123456789abcdef');
    });

    it('serializes stable UTF-8 JSON with a trailing newline', () => {
        const manifest = buildExportManifest({
            generatedAt: '2026-07-13T10:25:30.123Z',
            generatorVersion: '1.2.0',
            archiveMode: 'plain',
            sources,
            files: [],
        });
        const serialized = serializeExportManifest(manifest).toString('utf8');

        assert.ok(serialized.endsWith('\n'));
        assert.deepStrictEqual(JSON.parse(serialized), manifest);
        assert.ok(!serialized.includes('C:\\Users\\'));
    });

    it('preserves multi-root source identities and archive paths', () => {
        const firstSource: ExportManifestSource = {
            ...sources[0],
            label: 'Alpha',
        };
        const secondSource: ExportManifestSource = {
            ...sources[0],
            id: 'root-2',
            label: 'Zulu',
            git: { repository: false },
        };
        const manifest = buildExportManifest({
            generatedAt: '2026-07-13T10:25:30.123Z',
            generatorVersion: '1.2.0',
            archiveMode: 'plain',
            sources: [firstSource, secondSource],
            files: [
                { source: 'root-2', path: 'Zulu/src/index.ts', size: 4, sha256: 'c'.repeat(64) },
                { source: 'root-1', path: 'Alpha/README.md', size: 6, sha256: 'd'.repeat(64) },
            ],
        });

        assert.deepStrictEqual(manifest.sources.map((source) => source.id), ['root-1', 'root-2']);
        assert.deepStrictEqual(manifest.files.map((file) => file.source), ['root-1', 'root-2']);
        assert.deepStrictEqual(
            manifest.files.map((file) => file.path),
            ['Alpha/README.md', 'Zulu/src/index.ts'],
        );
    });

    it('detects the reserved path case-insensitively', () => {
        assert.strictEqual(hasExportManifestPathConflict(['README.md']), false);
        assert.strictEqual(hasExportManifestPathConflict([EXPORT_MANIFEST_PATH]), true);
        assert.strictEqual(hasExportManifestPathConflict(['./__SECUREZIP_MANIFEST.JSON']), true);
        assert.strictEqual(hasExportManifestPathConflict(['project/__securezip_manifest.json']), false);
    });
});

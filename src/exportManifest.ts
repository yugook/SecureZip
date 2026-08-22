export const EXPORT_MANIFEST_PATH = '__securezip_manifest.json';
export const EXPORT_MANIFEST_SCHEMA_VERSION = 1;

export type ExportManifestMode = 'off' | 'embedded';
export type ExportArchiveMode = 'plain' | 'encrypted';

export type ExportManifestGit = {
    repository: boolean;
    commit?: string;
    branch?: string;
    tag?: string;
    dirty?: boolean;
    untrackedCount?: number;
};

export type ExportManifestSelection = {
    gitignoreApplied: boolean;
    includeNodeModules: boolean;
    autoExcludes: string[];
    additionalExcludes: string[];
    secureZipIgnore: {
        excludes: string[];
        includes: string[];
    };
};

export type ExportManifestSource = {
    id: string;
    label: string;
    git: ExportManifestGit;
    selection: ExportManifestSelection;
};

export type ExportManifestFile = {
    source: string;
    path: string;
    size: number;
    sha256: string;
};

export type ExportManifest = {
    schemaVersion: typeof EXPORT_MANIFEST_SCHEMA_VERSION;
    generatedAt: string;
    generator: {
        name: 'SecureZip';
        version: string;
    };
    archive: {
        format: 'zip';
        mode: ExportArchiveMode;
    };
    sources: ExportManifestSource[];
    summary: {
        fileCount: number;
        totalBytes: number;
        hashAlgorithm: 'sha256';
    };
    files: ExportManifestFile[];
};

export type BuildExportManifestInput = {
    generatedAt: string;
    generatorVersion: string;
    archiveMode: ExportArchiveMode;
    sources: ExportManifestSource[];
    files: ExportManifestFile[];
};

export function normalizeExportManifestMode(value: unknown): ExportManifestMode {
    return value === 'embedded' ? 'embedded' : 'off';
}

export function buildExportManifest(input: BuildExportManifestInput): ExportManifest {
    const files = input.files
        .map((file) => ({ ...file, path: normalizeArchivePath(file.path) }))
        .sort((a, b) => a.path.localeCompare(b.path) || a.source.localeCompare(b.source));

    return {
        schemaVersion: EXPORT_MANIFEST_SCHEMA_VERSION,
        generatedAt: input.generatedAt,
        generator: {
            name: 'SecureZip',
            version: input.generatorVersion,
        },
        archive: {
            format: 'zip',
            mode: input.archiveMode,
        },
        sources: input.sources.map(cloneSource),
        summary: {
            fileCount: files.length,
            totalBytes: files.reduce((total, file) => total + file.size, 0),
            hashAlgorithm: 'sha256',
        },
        files,
    };
}

export function serializeExportManifest(manifest: ExportManifest): Buffer {
    return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function hasExportManifestPathConflict(paths: string[]): boolean {
    const reserved = EXPORT_MANIFEST_PATH.toLocaleLowerCase('en-US');
    return paths.some((entry) => normalizeArchivePath(entry).toLocaleLowerCase('en-US') === reserved);
}

function normalizeArchivePath(value: string): string {
    return value.replace(/\\+/g, '/').replace(/^\.\//, '');
}

function cloneSource(source: ExportManifestSource): ExportManifestSource {
    return {
        id: source.id,
        label: source.label,
        git: { ...source.git },
        selection: {
            gitignoreApplied: source.selection.gitignoreApplied,
            includeNodeModules: source.selection.includeNodeModules,
            autoExcludes: [...source.selection.autoExcludes],
            additionalExcludes: [...source.selection.additionalExcludes],
            secureZipIgnore: {
                excludes: [...source.selection.secureZipIgnore.excludes],
                includes: [...source.selection.secureZipIgnore.includes],
            },
        },
    };
}

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import AdmZip from 'adm-zip';
import * as vscode from 'vscode';
const TEST_LOG_VERBOSE = process.env.SECUREZIP_TEST_LOG === '1';

function log(step: string): void {
    if (TEST_LOG_VERBOSE) {
        console.log(`[SecureZip Test] ${step}`);
    }
}

const fixturesRoot = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures');
const expectedWorkspaceRoot = process.env.SECUREZIP_TEST_ROOT ? path.resolve(process.env.SECUREZIP_TEST_ROOT) : undefined;

// Expected ZIP contents for fixtures live inline here instead of external JSON files
// to keep the tests self-contained.
const expectedManifests: Record<string, Record<string, string>> = {
    'simple-project:default': {
        '.securezipignore': 'f1bd19a508de0fcaacfd3b15757aba566ab591af9e18aa47dc31b6ee3d742df5',
        'README.md': 'e51105731653a1056f8fc9a4ca4e50614372a0e8dbceba88d027fa6374339e9c',
        'dist/release.txt': '3d51e725d6ad11f311d1dd9629ca06307a6361bddc8e76f6c93b87aadddac5bc',
        'src/index.ts': 'e1831ca6d7392f6e0b583b4477d84cfd86bc6f7801bda5461479c02a77cc7d83',
    },
    'simple-project:no-readme': {
        '.securezipignore': 'f1bd19a508de0fcaacfd3b15757aba566ab591af9e18aa47dc31b6ee3d742df5',
        'dist/release.txt': '3d51e725d6ad11f311d1dd9629ca06307a6361bddc8e76f6c93b87aadddac5bc',
        'src/index.ts': 'e1831ca6d7392f6e0b583b4477d84cfd86bc6f7801bda5461479c02a77cc7d83',
    },
    'simple-project:include-node-modules': {
        '.securezipignore': 'f1bd19a508de0fcaacfd3b15757aba566ab591af9e18aa47dc31b6ee3d742df5',
        'README.md': 'e51105731653a1056f8fc9a4ca4e50614372a0e8dbceba88d027fa6374339e9c',
        'dist/release.txt': '3d51e725d6ad11f311d1dd9629ca06307a6361bddc8e76f6c93b87aadddac5bc',
        'node_modules/left.js': 'aa705b6a00a2f7b060977aa95f8a3c244c0a7005ab14a7aafd5deedd8d3d00ee',
        'src/index.ts': 'e1831ca6d7392f6e0b583b4477d84cfd86bc6f7801bda5461479c02a77cc7d83',
    },
};

setup(async function () {
    this.timeout(15000);
    log('setup ensuring workspace folder exists');
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'VS Code did not open a workspace folder.');
    const folder = folders[0];
    await ensureWorkspaceClean(folder.uri.fsPath);
    log(`workspace root ready at ${folder.uri.fsPath}`);
});

async function stageFixture(name: string) {
    log(`staging fixture ${name}`);
    const source = path.join(fixturesRoot, name);
    const destination = getWorkspaceRoot();
    await ensureWorkspaceClean(destination);
    await fs.promises.cp(source, destination, { recursive: true });
    await hydrateFixture(name, destination);
}

async function hydrateFixture(name: string, destination: string) {
    switch (name) {
        case 'simple-project':
            await hydrateSimpleProject(destination);
            break;
        default:
            break;
    }
}

async function hydrateSimpleProject(root: string) {
    const distDir = path.join(root, 'dist');
    await fs.promises.mkdir(distDir, { recursive: true });
    const releaseFile = path.join(distDir, 'release.txt');
    const contents = 'SecureZip fixture build artifact.\n';
    await fs.promises.writeFile(releaseFile, contents, 'utf8');

    const nodeModulesDir = path.join(root, 'node_modules');
    await fs.promises.mkdir(nodeModulesDir, { recursive: true });
    const leftJs = path.join(nodeModulesDir, 'left.js');
    const leftSource = 'module.exports = (a, b) => a - b;\n';
    await fs.promises.writeFile(leftJs, leftSource, 'utf8');
}

async function loadExpectedHashes(name: string, variant?: string) {
    const key = variant ? `${name}:${variant}` : `${name}:default`;
    const manifest = expectedManifests[key];
    if (!manifest) {
        throw new Error(`Expected manifest not defined for ${key}`);
    }
    return manifest;
}

async function collectZipHashes(zipPath: string) {
    const zip = new AdmZip(zipPath);
    const files = zip
        .getEntries()
        .filter((entry) => !entry.isDirectory)
        .map((entry) => {
            const hash = createHash('sha256').update(entry.getData()).digest('hex');
            const normalizedName = entry.entryName.replace(/\\/g, '/');
            return [normalizedName, hash] as const;
        })
        .sort((a, b) => a[0].localeCompare(b[0]));
    return Object.fromEntries(files);
}

suite('SecureZip Extension', function () {
    this.beforeEach(async () => {
        await resetConfiguration();
    });
    test('exports expected contents for simple fixture project', async function () {
        this.timeout(30000);
        log('test: export simple fixture - start');
        await stageFixture('simple-project');
        const { outPath, hashes } = await exportAndCollect('securezip-export.zip');
        const expected = await loadExpectedHashes('simple-project');
        try {
            assert.deepStrictEqual(hashes, expected);
        } catch (error) {
            log(`mismatch detected. actual=${JSON.stringify(hashes, null, 2)} expected=${JSON.stringify(expected, null, 2)}`);
            throw error;
        } finally {
            await removeIfExists(outPath);
        }
        log('test: export simple fixture - completed');
    });

    test('Export cancels cleanly when save dialog returns undefined', async function () {
        this.timeout(15000);
        log('test: cancel export - start');
        const outPath = path.join(getWorkspaceRoot(), 'export.zip');
        const originalShowSaveDialog = vscode.window.showSaveDialog;
        (vscode.window as any).showSaveDialog = async () => undefined;

        try {
            await vscode.commands.executeCommand('securezip.export');
            // No file should be created
            const exists = await fs.promises
                .stat(outPath)
                .then(() => true)
                .catch(() => false);
            assert.strictEqual(exists, false, 'ZIP should not exist on cancel');
            log('test: cancel export - verified no zip created');
        } finally {
            (vscode.window as any).showSaveDialog = originalShowSaveDialog;
        }
        log('test: cancel export - completed');
    });

    test('applies additionalExcludes patterns to the export set', async function () {
        this.timeout(30000);
        await stageFixture('simple-project');

        const config = vscode.workspace.getConfiguration('secureZip');
        await config.update('additionalExcludes', ['**/*.md'], vscode.ConfigurationTarget.Workspace);

        const { outPath, hashes } = await exportAndCollect('securezip-filter.zip');
        try {
            const expected = await loadExpectedHashes('simple-project', 'no-readme');
            assert.deepStrictEqual(hashes, expected);
        } finally {
            await config.update('additionalExcludes', undefined, vscode.ConfigurationTarget.Workspace);
            await removeIfExists(outPath);
        }
    });

    test('re-includes files overridden by .securezipignore despite additional excludes', async function () {
        this.timeout(30000);
        await stageFixture('simple-project');

        const config = vscode.workspace.getConfiguration('secureZip');
        await config.update('additionalExcludes', ['dist/**'], vscode.ConfigurationTarget.Workspace);

        const { outPath, hashes } = await exportAndCollect('securezip-reinclude.zip');
        try {
            const expected = await loadExpectedHashes('simple-project');
            assert.deepStrictEqual(hashes, expected);
            assert.ok(hashes['dist/release.txt'], 'Expected dist/release.txt to be reinstated by .securezipignore');
        } finally {
            await config.update('additionalExcludes', undefined, vscode.ConfigurationTarget.Workspace);
            await removeIfExists(outPath);
        }
    });

    test('includes node_modules when includeNodeModules is enabled', async function () {
        this.timeout(30000);
        await stageFixture('simple-project');

        const config = vscode.workspace.getConfiguration('secureZip');
        await config.update('includeNodeModules', true, vscode.ConfigurationTarget.Workspace);

        const workspaceRoot = getWorkspaceRoot();
        const gitignorePath = path.join(workspaceRoot, '.gitignore');
        const gitignoreContents = 'dist/\ncoverage/\ntmp/\n';
        await fs.promises.writeFile(gitignorePath, gitignoreContents, 'utf8');

        const { outPath, hashes } = await exportAndCollect('securezip-node-modules.zip');
        try {
            const expected = await loadExpectedHashes('simple-project', 'include-node-modules');
            const expectedWithGitignore = { ...expected };
            delete expectedWithGitignore['dist/release.txt'];
            const expectedGitignoreHash = createHash('sha256').update(gitignoreContents).digest('hex');

            assert.strictEqual(
                hashes['node_modules/left.js'],
                expected['node_modules/left.js'],
                'Expected node_modules/left.js to remain included'
            );
            assert.ok(!('dist/release.txt' in hashes), 'dist/release.txt should remain excluded by .gitignore');
            assert.strictEqual(
                hashes['README.md'],
                expected['README.md'],
                'README.md should still be included'
            );
            assert.strictEqual(
                hashes['src/index.ts'],
                expected['src/index.ts'],
                'src/index.ts should still be included'
            );
            assert.strictEqual(hashes['.gitignore'], expectedGitignoreHash, '.gitignore should reflect added rules');

            assert.deepStrictEqual(
                Object.keys(hashes).sort(),
                [...Object.keys(expectedWithGitignore), '.gitignore'].sort(),
                'Export should match expected files when .gitignore excludes dist/'
            );
        } finally {
            await config.update('includeNodeModules', undefined, vscode.ConfigurationTarget.Workspace);
            await removeIfExists(outPath);
            await fs.promises.unlink(gitignorePath).catch(() => undefined);
        }
    });

    test('reports an error when no files remain after excludes', async function () {
        this.timeout(30000);
        await stageFixture('simple-project');

        const config = vscode.workspace.getConfiguration('secureZip');
        await config.update('additionalExcludes', ['**/*'], vscode.ConfigurationTarget.Workspace);

        const outPath = path.join(getWorkspaceRoot(), 'securezip-empty.zip');
        const originalShowSaveDialog = vscode.window.showSaveDialog;
        const originalShowErrorMessage = vscode.window.showErrorMessage;
        const errors: string[] = [];

        (vscode.window as unknown as { showSaveDialog: typeof vscode.window.showSaveDialog }).showSaveDialog =
            async () => vscode.Uri.file(outPath);
        (vscode.window as unknown as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage =
            (message: string, ...items: any[]) => {
                errors.push(message);
                return Promise.resolve(items[0] as any);
            };

        try {
            await vscode.commands.executeCommand('securezip.export');
        } finally {
            await config.update('additionalExcludes', undefined, vscode.ConfigurationTarget.Workspace);
            (vscode.window as unknown as { showSaveDialog: typeof vscode.window.showSaveDialog }).showSaveDialog = originalShowSaveDialog;
            (vscode.window as unknown as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage =
                originalShowErrorMessage;
            await removeIfExists(outPath);
        }

        assert.ok(errors.length > 0, 'Expected export to report an error');
        assert.match(errors[0], /No files were found to include in the archive/, 'Unexpected error message');
    });

    test('surfaces errors when ZIP archive creation fails', async function () {
        this.timeout(30000);
        await stageFixture('simple-project');

        const workspace = getWorkspaceRoot();
        const failureTarget = path.join(workspace, 'securezip-fail-dir');
        await fs.promises.mkdir(failureTarget, { recursive: true });

        const originalShowSaveDialog = vscode.window.showSaveDialog;
        const originalShowErrorMessage = vscode.window.showErrorMessage;

        const errors: string[] = [];

        (vscode.window as unknown as { showSaveDialog: typeof vscode.window.showSaveDialog }).showSaveDialog =
            async () => vscode.Uri.file(failureTarget);
        (vscode.window as unknown as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage =
            (message: string, ...items: any[]) => {
                errors.push(message);
                return Promise.resolve(items[0] as any);
            };

        try {
            await vscode.commands.executeCommand('securezip.export');
        } finally {
            (vscode.window as unknown as { showSaveDialog: typeof vscode.window.showSaveDialog }).showSaveDialog = originalShowSaveDialog;
            (vscode.window as unknown as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage =
                originalShowErrorMessage;
            await removeIfExists(failureTarget);
        }

        assert.ok(errors.length > 0, 'Expected export to report an error');
        assert.match(errors[0], /EISDIR|is a directory/, 'Unexpected error message');
    });
});

function getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'VS Code did not open a workspace folder.');
    const root = path.resolve(folders[0].uri.fsPath);
    validateWorkspaceRoot(root);
    return root;
}

async function ensureWorkspaceClean(root: string) {
    const normalizedRoot = path.resolve(root);
    validateWorkspaceRoot(normalizedRoot);
    await fs.promises.mkdir(normalizedRoot, { recursive: true });
    const entries = await fs.promises.readdir(normalizedRoot);
    await Promise.all(
        entries.map((entry) => fs.promises.rm(path.join(normalizedRoot, entry), { recursive: true, force: true }))
    );
}

async function resetConfiguration() {
    const config = vscode.workspace.getConfiguration('secureZip');
    await config.update('additionalExcludes', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('includeNodeModules', undefined, vscode.ConfigurationTarget.Workspace);
}

async function exportAndCollect(outFileName: string) {
    const outPath = path.join(getWorkspaceRoot(), outFileName);
    const originalShowSaveDialog = vscode.window.showSaveDialog;
    log('executing securezip.export with saved dialog stub');
    (vscode.window as unknown as { showSaveDialog: typeof vscode.window.showSaveDialog }).showSaveDialog =
        async () => vscode.Uri.file(outPath);

    try {
        await vscode.commands.executeCommand('securezip.export');
        log('securezip.export command resolved');
    } catch (error) {
        log(`securezip.export command threw: ${String(error)}`);
        throw error;
    } finally {
        (vscode.window as unknown as { showSaveDialog: typeof vscode.window.showSaveDialog }).showSaveDialog =
            originalShowSaveDialog;
    }

    const stat = await fs.promises.stat(outPath);
    assert.ok(stat.isFile(), 'Export did not create a file');
    const hashes = await collectZipHashes(outPath);
    return { outPath, hashes } as const;
}

async function removeIfExists(target: string) {
    try {
        const stat = await fs.promises.lstat(target);
        if (stat.isDirectory()) {
            await fs.promises.rm(target, { recursive: true, force: true });
        } else {
            await fs.promises.unlink(target);
        }
    } catch (err: any) {
        if (err?.code !== 'ENOENT') {
            throw err;
        }
    }
}

function validateWorkspaceRoot(root: string): void {
    const normalized = path.resolve(root);
    const filesystemRoot = path.parse(normalized).root;
    assert.notStrictEqual(
        normalized,
        filesystemRoot,
        `Refusing to operate on filesystem root: ${normalized}`
    );

    if (expectedWorkspaceRoot) {
        const normalizedExpected = path.resolve(expectedWorkspaceRoot);
        if (normalized === normalizedExpected) {
            return;
        }

        const expectedParent = path.dirname(normalizedExpected);
        const relativeToParent = path.relative(expectedParent, normalized);
        const isInsideParent =
            relativeToParent &&
            !relativeToParent.startsWith('..') &&
            !path.isAbsolute(relativeToParent);
        const containsSecureZipTempDir = relativeToParent
            .split(path.sep)
            .some((segment) => segment.startsWith('securezip-test-'));

        assert.ok(
            isInsideParent && containsSecureZipTempDir,
            `Workspace root mismatch. expected within ${path.join(expectedParent, 'securezip-test-*')} actual=${normalized}`
        );
    }
}

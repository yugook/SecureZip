import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import AdmZip from 'adm-zip';
import simpleGit, { SimpleGit } from 'simple-git';
import * as vscode from 'vscode';
import { SecureZipViewProvider } from '../view';
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
    'simple-project:include-git': {
        '.securezipignore': 'e93c3f4f5542c4d55ea61b0487ba3fed8504332be29def13a43770a3458d57fc',
        '.git/HEAD': '28d25bf82af4c0e2b72f50959b2beb859e3e60b9630a5e8c603dad4ddb2b6e80',
        '.git/config': 'cfe7ba1238c9a78be7535d7c63bcaf5a4d5011d46b07c9b45d3bbf7d6c312dfe',
        '.git/refs/heads/main': '3d51eb31d2eaa0c0163e0e6e240f4370d06d484c91f4db87d14778c6140c67e3',
        'README.md': 'e51105731653a1056f8fc9a4ca4e50614372a0e8dbceba88d027fa6374339e9c',
        'dist/release.txt': '3d51e725d6ad11f311d1dd9629ca06307a6361bddc8e76f6c93b87aadddac5bc',
        'src/index.ts': 'e1831ca6d7392f6e0b583b4477d84cfd86bc6f7801bda5461479c02a77cc7d83',
    },
    'simple-project:include-vscode': {
        '.securezipignore': 'ca4674c258568d38d9f76d6ed6337392b8732cc98703d534d57d5af4751e6114',
        '.vscode/tasks.json': '6ffa01856a571ef6bf49aee1fcde4923183570f3af7c3ab292880643d25286cf',
        'README.md': 'e51105731653a1056f8fc9a4ca4e50614372a0e8dbceba88d027fa6374339e9c',
        'dist/release.txt': '3d51e725d6ad11f311d1dd9629ca06307a6361bddc8e76f6c93b87aadddac5bc',
        'src/index.ts': 'e1831ca6d7392f6e0b583b4477d84cfd86bc6f7801bda5461479c02a77cc7d83',
    },
    'simple-project:include-node-modules-ignore': {
        '.securezipignore': 'ea400f435fb27dd5f9b2a962ac5e4e312091465c24cee9b7a5a024f762d23cda',
        'README.md': 'e51105731653a1056f8fc9a4ca4e50614372a0e8dbceba88d027fa6374339e9c',
        'dist/release.txt': '3d51e725d6ad11f311d1dd9629ca06307a6361bddc8e76f6c93b87aadddac5bc',
        'node_modules/left.js': 'aa705b6a00a2f7b060977aa95f8a3c244c0a7005ab14a7aafd5deedd8d3d00ee',
        'src/index.ts': 'e1831ca6d7392f6e0b583b4477d84cfd86bc6f7801bda5461479c02a77cc7d83',
    },
    'simple-project:include-env': {
        '.securezipignore': 'e95dd645adbd34659503655f5d9f252ae10da122c30514abc3843d1c0430e0d9',
        '.env': 'b736d31214ef074d8193c210df49549e82ae1db42544164185b0b9bc8702e9b0',
        '.env.local': '4fd67b7e22f2bd74aa35571c4e8fbee2005791345b64a28fafc894921a408fe3',
        'README.md': 'e51105731653a1056f8fc9a4ca4e50614372a0e8dbceba88d027fa6374339e9c',
        'dist/release.txt': '3d51e725d6ad11f311d1dd9629ca06307a6361bddc8e76f6c93b87aadddac5bc',
        'src/index.ts': 'e1831ca6d7392f6e0b583b4477d84cfd86bc6f7801bda5461479c02a77cc7d83',
    },
    'simple-project:include-pem': {
        '.securezipignore': '3f1795fa76b368d65a5426eaaeeb58f71d0cd3fa739692ea39d8fcd6083d3264',
        'README.md': 'e51105731653a1056f8fc9a4ca4e50614372a0e8dbceba88d027fa6374339e9c',
        'certs/server.pem': '19ca233348bb6b7d5a2f8e59fa679fb6395c59ae1f2f4f01170cc1b27db73714',
        'dist/release.txt': '3d51e725d6ad11f311d1dd9629ca06307a6361bddc8e76f6c93b87aadddac5bc',
        'src/index.ts': 'e1831ca6d7392f6e0b583b4477d84cfd86bc6f7801bda5461479c02a77cc7d83',
    },
    'simple-project:include-secure-config': {
        '.securezipignore': '889994736f8d38732454e4bc83f4b6bd2fa1c1a11251a89f686767cafd21a6fb',
        'README.md': 'e51105731653a1056f8fc9a4ca4e50614372a0e8dbceba88d027fa6374339e9c',
        'dist/release.txt': '3d51e725d6ad11f311d1dd9629ca06307a6361bddc8e76f6c93b87aadddac5bc',
        'secure-config/.env.production': '200a4a4e1a7c8402d3a4fbe074492b92058a71348c31ce9fbea2bf0e478ed6ad',
        'secure-config/service.pem': '37b28ea27d1b471b451612d9f000f4af30b8e202d2b6cea818b1577c492d6234',
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

    const vscodeDir = path.join(root, '.vscode');
    await fs.promises.mkdir(vscodeDir, { recursive: true });
    const tasksFile = path.join(vscodeDir, 'tasks.json');
    const tasksContents = [
        '{',
        '  "version": "2.0.0"',
        '}',
        '',
    ].join('\n');
    await fs.promises.writeFile(tasksFile, tasksContents, 'utf8');

    const gitDir = path.join(root, '.git');
    await fs.promises.mkdir(path.join(gitDir, 'refs', 'heads'), { recursive: true });
    const headContent = 'ref: refs/heads/main\n';
    const configContent = [
        '[core]',
        '\trepositoryformatversion = 0',
        '\tfilemode = true',
        '\tbare = false',
        '\tlogallrefupdates = true',
        '',
    ].join('\n');
    const refContent = '0123456789abcdef0123456789abcdef01234567\n';
    await fs.promises.writeFile(path.join(gitDir, 'HEAD'), headContent, 'utf8');
    await fs.promises.writeFile(path.join(gitDir, 'config'), configContent, 'utf8');
    await fs.promises.writeFile(path.join(gitDir, 'refs', 'heads', 'main'), refContent, 'utf8');
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

    test('allows .securezipignore to re-include the .git directory explicitly', async function () {
        this.timeout(30000);
        await stageFixture('simple-project');

        const workspaceRoot = getWorkspaceRoot();
        const secureZipIgnorePath = path.join(workspaceRoot, '.securezipignore');
        const originalIgnore = await fs.promises.readFile(secureZipIgnorePath, 'utf8');
        await fs.promises.appendFile(secureZipIgnorePath, '\n!/.git\n', 'utf8');

        const { outPath, hashes } = await exportAndCollect('securezip-include-git.zip');
        try {
            const expected = await loadExpectedHashes('simple-project', 'include-git');
            assert.deepStrictEqual(hashes, expected);
        } finally {
            await fs.promises.writeFile(secureZipIgnorePath, originalIgnore, 'utf8');
            await removeIfExists(outPath);
        }
    });

    test('allows .securezipignore to re-include auto-excluded directories such as .vscode', async function () {
        this.timeout(30000);
        await stageFixture('simple-project');

        const workspaceRoot = getWorkspaceRoot();
        const secureZipIgnorePath = path.join(workspaceRoot, '.securezipignore');
        const originalIgnore = await fs.promises.readFile(secureZipIgnorePath, 'utf8');
        await fs.promises.appendFile(secureZipIgnorePath, '\n!/.vscode/tasks.json\n', 'utf8');

        const { outPath, hashes } = await exportAndCollect('securezip-include-vscode.zip');
        try {
            const expected = await loadExpectedHashes('simple-project', 'include-vscode');
            assert.deepStrictEqual(hashes, expected);
        } finally {
            await fs.promises.writeFile(secureZipIgnorePath, originalIgnore, 'utf8');
            await removeIfExists(outPath);
        }
    });

    test('allows .securezipignore to re-include node_modules without toggling settings', async function () {
        this.timeout(30000);
        await stageFixture('simple-project');

        const workspaceRoot = getWorkspaceRoot();
        const secureZipIgnorePath = path.join(workspaceRoot, '.securezipignore');
        const originalIgnore = await fs.promises.readFile(secureZipIgnorePath, 'utf8');
        await fs.promises.appendFile(secureZipIgnorePath, '\n!node_modules/**\n', 'utf8');

        const { outPath, hashes } = await exportAndCollect('securezip-include-node-modules-ignore.zip');
        try {
            const expected = await loadExpectedHashes('simple-project', 'include-node-modules-ignore');
            assert.deepStrictEqual(hashes, expected);
        } finally {
            await fs.promises.writeFile(secureZipIgnorePath, originalIgnore, 'utf8');
            await removeIfExists(outPath);
        }
    });

    test('allows .securezipignore to re-include .env family files explicitly', async function () {
        this.timeout(30000);
        await stageFixture('simple-project');

        const workspaceRoot = getWorkspaceRoot();
        const envPath = path.join(workspaceRoot, '.env');
        const envLocalPath = path.join(workspaceRoot, '.env.local');
        await fs.promises.writeFile(envPath, 'SECRET_TOKEN=fixture\n', 'utf8');
        await fs.promises.writeFile(envLocalPath, 'LOCAL_FLAG=1\n', 'utf8');
        const secureZipIgnorePath = path.join(workspaceRoot, '.securezipignore');
        const originalIgnore = await fs.promises.readFile(secureZipIgnorePath, 'utf8');
        await fs.promises.appendFile(secureZipIgnorePath, '\n!.env\n!.env.local\n', 'utf8');

        const { outPath, hashes } = await exportAndCollect('securezip-include-env.zip');
        try {
            const expected = await loadExpectedHashes('simple-project', 'include-env');
            assert.deepStrictEqual(hashes, expected);
        } finally {
            await fs.promises.writeFile(secureZipIgnorePath, originalIgnore, 'utf8');
            await removeIfExists(outPath);
        }
    });

    test('allows .securezipignore to re-include extension-based auto excludes such as PEM files', async function () {
        this.timeout(30000);
        await stageFixture('simple-project');

        const workspaceRoot = getWorkspaceRoot();
        const certsDir = path.join(workspaceRoot, 'certs');
        await fs.promises.mkdir(certsDir, { recursive: true });
        await fs.promises.writeFile(
            path.join(certsDir, 'server.pem'),
            '-----BEGIN CERT-----\nfixture\n-----END CERT-----\n',
            'utf8',
        );
        await fs.promises.writeFile(
            path.join(certsDir, 'server.key'),
            '-----BEGIN KEY-----\nfixture\n-----END KEY-----\n',
            'utf8',
        );
        const secureZipIgnorePath = path.join(workspaceRoot, '.securezipignore');
        const originalIgnore = await fs.promises.readFile(secureZipIgnorePath, 'utf8');
        await fs.promises.appendFile(secureZipIgnorePath, '\n!certs/server.pem\n', 'utf8');

        const { outPath, hashes } = await exportAndCollect('securezip-include-pem.zip');
        try {
            const expected = await loadExpectedHashes('simple-project', 'include-pem');
            assert.deepStrictEqual(hashes, expected);
        } finally {
            await fs.promises.writeFile(secureZipIgnorePath, originalIgnore, 'utf8');
            await removeIfExists(outPath);
        }
    });

    test('SecureZip view prioritizes active auto excludes in preview', async function () {
        this.timeout(30000);
        await stageFixture('simple-project');

        const provider = new SecureZipViewProvider(createTestExtensionContext());
        try {
            const sections = await provider.getChildren();
            const previewSection = sections.find(
                (item) => (item as any).node?.kind === 'section' && (item as any).node?.section === 'preview',
            );
            assert.ok(previewSection, 'Preview section was not found');

            const previewItems = await provider.getChildren(previewSection);
            const autoItems = previewItems.filter((item) => {
                const node = (item as any).node;
                return node?.kind === 'preview' && node?.status === 'auto';
            });

            assert.ok(autoItems.length > 0, 'Expected at least one auto exclude preview item');
            const labels = autoItems.map(getTreeItemLabel);

            const required = ['.git', '.git/**', 'node_modules/**', '.vscode', '.vscode/**'];
            for (const pattern of required) {
                const index = labels.indexOf(pattern);
                assert.ok(index >= 0, `Expected to find auto pattern ${pattern}`);
            }

            const firstInactive = autoItems.findIndex(
                (item) => item.description === 'Auto exclude (no matches)',
            );

            if (firstInactive === -1) {
                for (const item of autoItems) {
                    assert.ok(
                        item.description === 'Auto exclude (active)' ||
                            item.description === 'Auto exclude (re-included)',
                        `Unexpected description ${item.description}`,
                    );
                }
            } else {
                for (const item of autoItems.slice(0, firstInactive)) {
                    assert.ok(
                        item.description === 'Auto exclude (active)' ||
                            item.description === 'Auto exclude (re-included)',
                        `Expected active or reincluded before inactive entries, got ${item.description}`,
                    );
                }
                for (const item of autoItems.slice(firstInactive)) {
                    assert.strictEqual(
                        item.description,
                        'Auto exclude (no matches)',
                        'Inactive entries should appear after active ones',
                    );
                }
            }
        } finally {
            provider.dispose();
        }
    });

    test('allows wildcard re-include to restore nested secure-config secrets', async function () {
        this.timeout(30000);
        await stageFixture('simple-project');

        const workspaceRoot = getWorkspaceRoot();
        const secureConfigDir = path.join(workspaceRoot, 'secure-config');
        await fs.promises.mkdir(secureConfigDir, { recursive: true });
        await fs.promises.writeFile(path.join(secureConfigDir, '.env.production'), 'PRODUCTION=1\n', 'utf8');
        await fs.promises.writeFile(path.join(secureConfigDir, 'service.pem'), 'secure-service\n', 'utf8');
        const secureZipIgnorePath = path.join(workspaceRoot, '.securezipignore');
        const originalIgnore = await fs.promises.readFile(secureZipIgnorePath, 'utf8');
        await fs.promises.appendFile(secureZipIgnorePath, '\n!secure-config/**\n', 'utf8');

        const { outPath, hashes } = await exportAndCollect('securezip-include-secure-config.zip');
        try {
            const expected = await loadExpectedHashes('simple-project', 'include-secure-config');
            assert.deepStrictEqual(hashes, expected);
        } finally {
            await fs.promises.writeFile(secureZipIgnorePath, originalIgnore, 'utf8');
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

    test('auto commit respects tracked stage mode setting', async function () {
        this.timeout(40000);
        await stageFixture('simple-project');

        const workspaceRoot = getWorkspaceRoot();
        const git = await initGitRepository(workspaceRoot);
        const trackedFile = path.join(workspaceRoot, 'README.md');
        await fs.promises.appendFile(trackedFile, '\ntracked change for tracked mode\n', 'utf8');
        const untrackedPath = path.join(workspaceRoot, 'auto-commit-tracked.txt');
        await fs.promises.writeFile(untrackedPath, 'tracked mode file\n', 'utf8');

        const config = vscode.workspace.getConfiguration('secureZip');
        await config.update('autoCommit.stageMode', 'tracked', vscode.ConfigurationTarget.Workspace);
        await config.update('tagPrefix', 'export-tracked', vscode.ConfigurationTarget.Workspace);

        const warningMessages: string[] = [];
        const { outPath } = await exportAndCollect('securezip-auto-commit-tracked.zip', {
            showWarningMessage: createAutoCommitWarningStub(warningMessages),
        });

        try {
            await removeIfExists(outPath);
            const status = await git.status();
            const latestCommit = await git.log({ maxCount: 1 });

            assert.ok(
                warningMessages.some((message) => message.includes('git add --update')),
                'Tracked stage mode prompt should mention git add --update'
            );
            assert.strictEqual(
                status.isClean(),
                false,
                'Tracked stage mode should leave untracked files untouched'
            );
            assert.ok(
                status.not_added.includes(path.basename(untrackedPath)),
                'Untracked file should remain unstaged when using tracked mode'
            );
            let headReadSucceeded = true;
            try {
                await readHeadFile(git, workspaceRoot, untrackedPath);
            } catch {
                headReadSucceeded = false;
            }
            assert.strictEqual(headReadSucceeded, false, 'Untracked file should not be committed when using tracked mode');
            assert.ok(
                latestCommit.latest?.message.startsWith('[SecureZip] Automated commit for export:'),
                'Latest commit should come from the auto-commit template'
            );
        } finally {
            await removeIfExists(outPath);
        }
    });

    test('auto commit stages untracked files when stage mode is all', async function () {
        this.timeout(40000);
        await stageFixture('simple-project');

        const workspaceRoot = getWorkspaceRoot();
        const git = await initGitRepository(workspaceRoot);
        const trackedFile = path.join(workspaceRoot, 'README.md');
        await fs.promises.appendFile(trackedFile, '\ntracked change for all mode\n', 'utf8');
        const untrackedPath = path.join(workspaceRoot, 'auto-commit-all.txt');
        await fs.promises.writeFile(untrackedPath, 'all mode file\n', 'utf8');

        const config = vscode.workspace.getConfiguration('secureZip');
        await config.update('autoCommit.stageMode', 'all', vscode.ConfigurationTarget.Workspace);
        await config.update('tagPrefix', 'export-all', vscode.ConfigurationTarget.Workspace);

        const warningMessages: string[] = [];
        const { outPath } = await exportAndCollect('securezip-auto-commit-all.zip', {
            showWarningMessage: createAutoCommitWarningStub(warningMessages),
        });

        try {
            await removeIfExists(outPath);
            const status = await git.status();
            const latestCommit = await git.log({ maxCount: 1 });
            const committedContents = await readHeadFile(git, workspaceRoot, untrackedPath);

            assert.ok(
                warningMessages.some((message) => message.includes('git add --all')),
                'All stage mode prompt should mention git add --all'
            );
            assert.strictEqual(
                status.isClean(),
                true,
                'All stage mode should leave the working tree clean'
            );
            assert.ok(
                !status.not_added.includes(path.basename(untrackedPath)),
                'Untracked file should be included in the auto-commit when using all mode'
            );
            assert.strictEqual(
                committedContents,
                'all mode file\n',
                'Auto-commit should capture the contents of the previously untracked file'
            );
            assert.ok(
                latestCommit.latest?.message.startsWith('[SecureZip] Automated commit for export:'),
                'Latest commit should come from the auto-commit template'
            );
        } finally {
            await removeIfExists(outPath);
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

class InMemoryMemento implements vscode.Memento {
    private store = new Map<string, unknown>();

    get<T>(key: string, defaultValue?: T): T | undefined {
        if (this.store.has(key)) {
            return this.store.get(key) as T;
        }
        return defaultValue;
    }

    async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this.store.delete(key);
        } else {
            this.store.set(key, value);
        }
    }

    keys(): readonly string[] {
        return Array.from(this.store.keys());
    }
}

function createTestExtensionContext(): vscode.ExtensionContext {
    return {
        workspaceState: new InMemoryMemento(),
        globalState: new InMemoryMemento(),
        subscriptions: [],
    } as unknown as vscode.ExtensionContext;
}

function getTreeItemLabel(item: vscode.TreeItem): string {
    const raw = item.label;
    if (typeof raw === 'string') {
        return raw;
    }
    if (raw && typeof (raw as vscode.TreeItemLabel).label === 'string') {
        return (raw as vscode.TreeItemLabel).label;
    }
    return String(raw ?? '');
}

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

async function initGitRepository(root: string): Promise<SimpleGit> {
    await removeIfExists(path.join(root, '.git'));
    const git = simpleGit({ baseDir: root });
    await git.init();
    await git.addConfig('user.email', 'securezip-tests@example.com');
    await git.addConfig('user.name', 'SecureZip Tests');
    await git.add('.');
    await git.commit('Fixture base commit');
    return git;
}

function createAutoCommitWarningStub(messages: string[]): typeof vscode.window.showWarningMessage {
    return ((message: any, ...args: any[]) => {
        const text = typeof message === 'string' ? message : String(message);
        messages.push(text);
        let startIndex = 0;
        if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
            startIndex = 1;
        }
        const choice = args.slice(startIndex).find((item) => typeof item === 'string');
        return Promise.resolve(choice as any);
    }) as typeof vscode.window.showWarningMessage;
}

function toGitPath(root: string, target: string): string {
    return path.relative(root, target).split(path.sep).join('/');
}

async function readHeadFile(git: SimpleGit, root: string, target: string): Promise<string> {
    const relative = toGitPath(root, target);
    return git.show([`HEAD:${relative}`]);
}

async function resetConfiguration() {
    const config = vscode.workspace.getConfiguration('secureZip');
    await config.update('additionalExcludes', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('includeNodeModules', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('autoCommit.stageMode', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('tagPrefix', undefined, vscode.ConfigurationTarget.Workspace);
}

interface ExportOverrides {
    showWarningMessage?: typeof vscode.window.showWarningMessage;
}

async function exportAndCollect(outFileName: string, overrides?: ExportOverrides) {
    const outPath = path.join(getWorkspaceRoot(), outFileName);
    const windowOverrides = vscode.window as unknown as {
        showSaveDialog: typeof vscode.window.showSaveDialog;
        showWarningMessage: typeof vscode.window.showWarningMessage;
    };
    const originalShowSaveDialog = windowOverrides.showSaveDialog;
    const originalShowWarningMessage = windowOverrides.showWarningMessage;
    log('executing securezip.export with saved dialog stub');
    windowOverrides.showSaveDialog = async () => vscode.Uri.file(outPath);
    if (overrides?.showWarningMessage) {
        windowOverrides.showWarningMessage = overrides.showWarningMessage;
    }

    try {
        await vscode.commands.executeCommand('securezip.export');
        log('securezip.export command resolved');
    } catch (error) {
        log(`securezip.export command threw: ${String(error)}`);
        throw error;
    } finally {
        windowOverrides.showSaveDialog = originalShowSaveDialog;
        windowOverrides.showWarningMessage = originalShowWarningMessage;
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

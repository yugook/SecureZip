import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import AdmZip from 'adm-zip';
import * as vscode from 'vscode';
function log(step: string): void {
    console.log(`[SecureZip Test] ${step}`);
}

const fixturesRoot = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures');

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
}

async function loadExpectedHashes(name: string) {
    const manifest = path.join(fixturesRoot, name, 'expected-export.json');
    const raw = await fs.promises.readFile(manifest, 'utf8');
    const entries = Object.entries(JSON.parse(raw) as Record<string, string>);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    return Object.fromEntries(entries);
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

suite('SecureZip Extension', () => {
    test('exports expected contents for simple fixture project', async function () {
        this.timeout(30000);
        log('test: export simple fixture - start');
        await stageFixture('simple-project');

        const outPath = path.join(getWorkspaceRoot(), 'securezip-export.zip');
        const originalShowSaveDialog = vscode.window.showSaveDialog;
        (vscode.window as unknown as { showSaveDialog: typeof vscode.window.showSaveDialog }).showSaveDialog =
            async () => vscode.Uri.file(outPath);

        try {
            log('executing securezip.export with saved dialog stub');
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

        const actual = await collectZipHashes(outPath);
        const expected = await loadExpectedHashes('simple-project');
        try {
            assert.deepStrictEqual(actual, expected);
        } catch (error) {
            log(`mismatch detected. actual=${JSON.stringify(actual, null, 2)} expected=${JSON.stringify(expected, null, 2)}`);
            throw error;
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
});

function getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'VS Code did not open a workspace folder.');
    return folders[0].uri.fsPath;
}

async function ensureWorkspaceClean(root: string) {
    await fs.promises.mkdir(root, { recursive: true });
    const entries = await fs.promises.readdir(root);
    await Promise.all(entries.map((entry) => fs.promises.rm(path.join(root, entry), { recursive: true, force: true })));
}

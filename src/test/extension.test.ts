import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import AdmZip = require('adm-zip');

let workspaceRoot: string;

function log(step: string): void {
    console.log(`[SecureZip Test] ${step}`);
}

const fixturesRoot = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures');

suiteSetup(async function () {
    this.timeout(30000);
    log('suiteSetup starting');
    const workspaceEnv = process.env.SECUREZIP_TEST_WORKSPACE;
    assert.ok(workspaceEnv, 'SECUREZIP_TEST_WORKSPACE env var is not set.');
    workspaceRoot = workspaceEnv!;
    await fs.promises.mkdir(workspaceRoot, { recursive: true });

    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'VS Code did not open a workspace folder.');
    const actual = path.resolve(folders[0].uri.fsPath);
    assert.strictEqual(actual, path.resolve(workspaceRoot), 'Opened workspace folder does not match expected test workspace.');
    log(`workspace folder ready at ${workspaceRoot}`);
});

suiteTeardown(async function () {
    this.timeout(15000);
    log('suiteTeardown starting');
    const existing = vscode.workspace.workspaceFolders ?? [];
    if (existing.length > 0) {
        vscode.workspace.updateWorkspaceFolders(0, existing.length);
    }
    try {
        await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
    } catch {}
});

setup(async function () {
    this.timeout(15000);
    log('setup clearing workspace root');
    if (!workspaceRoot) {
        return;
    }
    await fs.promises.mkdir(workspaceRoot, { recursive: true });
    const entries = await fs.promises.readdir(workspaceRoot);
    await Promise.all(
        entries.map((entry) => fs.promises.rm(path.join(workspaceRoot, entry), { recursive: true, force: true })),
    );
    log('workspace root cleared');
});

async function stageFixture(name: string) {
    log(`staging fixture ${name}`);
    const source = path.join(fixturesRoot, name);
    await fs.promises.cp(source, workspaceRoot, { recursive: true });
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
            const hash = crypto.createHash('sha256').update(entry.getData()).digest('hex');
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

        const outPath = path.join(workspaceRoot, 'securezip-export.zip');
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
        assert.deepStrictEqual(actual, expected);
        log('test: export simple fixture - completed');
    });

    test('Export cancels cleanly when save dialog returns undefined', async function () {
        this.timeout(15000);
        log('test: cancel export - start');
        const outPath = path.join(workspaceRoot, 'export.zip');
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

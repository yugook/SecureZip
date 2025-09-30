import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import AdmZip = require('adm-zip');

let tmpDir: string;
let workspaceRoot: string;

const fixturesRoot = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures');

suiteSetup(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'securezip-test-'));
    workspaceRoot = path.join(tmpDir, 'ws');
    await fs.promises.mkdir(workspaceRoot, { recursive: true });

    const added = vscode.workspace.updateWorkspaceFolders(0, 0, {
        uri: vscode.Uri.file(workspaceRoot),
        name: 'test-ws',
    });
    assert.ok(added, 'Failed to add test workspace folder');
});

suiteTeardown(async () => {
    const existing = vscode.workspace.workspaceFolders ?? [];
    if (existing.length > 0) {
        vscode.workspace.updateWorkspaceFolders(0, existing.length);
    }
    try {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
    } catch {}
});

setup(async () => {
    if (!workspaceRoot) {
        return;
    }
    const entries = await fs.promises.readdir(workspaceRoot);
    await Promise.all(
        entries.map((entry) => fs.promises.rm(path.join(workspaceRoot, entry), { recursive: true, force: true })),
    );
});

async function stageFixture(name: string) {
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
    test('exports expected contents for simple fixture project', async () => {
        await stageFixture('simple-project');

        const outPath = path.join(workspaceRoot, 'securezip-export.zip');
        const originalShowSaveDialog = vscode.window.showSaveDialog;
        (vscode.window as unknown as { showSaveDialog: typeof vscode.window.showSaveDialog }).showSaveDialog =
            async () => vscode.Uri.file(outPath);

        try {
            await vscode.commands.executeCommand('securezip.export');
        } finally {
            (vscode.window as unknown as { showSaveDialog: typeof vscode.window.showSaveDialog }).showSaveDialog =
                originalShowSaveDialog;
        }

        const stat = await fs.promises.stat(outPath);
        assert.ok(stat.isFile(), 'Export did not create a file');

        const actual = await collectZipHashes(outPath);
        const expected = await loadExpectedHashes('simple-project');
        assert.deepStrictEqual(actual, expected);
    });

    test('Export cancels cleanly when save dialog returns undefined', async () => {
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
        } finally {
            (vscode.window as any).showSaveDialog = originalShowSaveDialog;
        }
    });
});

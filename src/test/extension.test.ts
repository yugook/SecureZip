import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpDir: string;
let workspaceRoot: string;

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

suite('SecureZip Extension', () => {
    test('Export command creates a ZIP', async () => {
        // Arrange: create a sample file to include in ZIP
        const samplePath = path.join(workspaceRoot, 'README.txt');
        await fs.promises.writeFile(samplePath, 'hello');

        // Stub the save dialog to a deterministic path inside workspace
        const outPath = path.join(workspaceRoot, 'export.zip');
        const originalShowSaveDialog = vscode.window.showSaveDialog;
        (vscode.window as any).showSaveDialog = async () => vscode.Uri.file(outPath);

        try {
            // Act: run the export command
            await vscode.commands.executeCommand('securezip.export');

            // Assert: ZIP exists and is non-empty
            const stat = await fs.promises.stat(outPath);
            assert.ok(stat.isFile(), 'Export did not create a file');
            assert.ok(stat.size > 0, 'Export ZIP is empty');
        } finally {
            // Restore
            (vscode.window as any).showSaveDialog = originalShowSaveDialog;
        }
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

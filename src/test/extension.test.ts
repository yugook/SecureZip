import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function withTempWorkspace(run: (root: string) => Promise<void>) {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'securezip-test-'));
    const root = path.join(tmp, 'ws');
    await fs.promises.mkdir(root, { recursive: true });

    // Add workspace folder
    const ok = vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.file(root), name: 'test-ws' });
    assert.ok(ok, 'Failed to add test workspace folder');

    try {
        await run(root);
    } finally {
        // Remove workspace folder
        vscode.workspace.updateWorkspaceFolders(0, 1);
        // Best-effort cleanup
        try { await fs.promises.rm(tmp, { recursive: true, force: true }); } catch {}
    }
}

suite('SecureZip Extension', () => {
    test('Export command creates a ZIP', async () => {
        await withTempWorkspace(async (root) => {
            // Arrange: create a sample file to include in ZIP
            const samplePath = path.join(root, 'README.txt');
            await fs.promises.writeFile(samplePath, 'hello');

            // Stub the save dialog to a deterministic path inside workspace
            const outPath = path.join(root, 'export.zip');
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
    });

    test('Export cancels cleanly when save dialog returns undefined', async () => {
        await withTempWorkspace(async (root) => {
            const outPath = path.join(root, 'export.zip');
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
});

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import * as vscode from 'vscode';

const fixturesRoot = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures');

type WindowMutable = {
    showInputBox: typeof vscode.window.showInputBox;
    showSaveDialog: typeof vscode.window.showSaveDialog;
    showInformationMessage: typeof vscode.window.showInformationMessage;
    showWarningMessage: typeof vscode.window.showWarningMessage;
    showErrorMessage: typeof vscode.window.showErrorMessage;
};

function getWindow(): WindowMutable {
    return vscode.window as unknown as WindowMutable;
}

function getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'VS Code did not open a workspace folder.');
    const root = path.resolve(folders[0].uri.fsPath);
    const filesystemRoot = path.parse(root).root;
    assert.notStrictEqual(root, filesystemRoot, `Refusing to operate on filesystem root: ${root}`);
    return root;
}

async function ensureWorkspaceClean(root: string) {
    await fs.promises.mkdir(root, { recursive: true });
    const entries = await fs.promises.readdir(root);
    await Promise.all(
        entries.map((entry) => fs.promises.rm(path.join(root, entry), { recursive: true, force: true })),
    );
    await fs.promises.mkdir(path.join(root, '.vscode'), { recursive: true });
}

async function stageSimpleProject(): Promise<string> {
    const destination = getWorkspaceRoot();
    await ensureWorkspaceClean(destination);
    const source = path.join(fixturesRoot, 'simple-project');
    await fs.promises.cp(source, destination, { recursive: true });
    const distDir = path.join(destination, 'dist');
    await fs.promises.mkdir(distDir, { recursive: true });
    await fs.promises.writeFile(path.join(distDir, 'release.txt'), 'SecureZip fixture build artifact.\n', 'utf8');
    return destination;
}

async function removeIfExists(target: string) {
    try {
        const stat = await fs.promises.lstat(target);
        if (stat.isDirectory()) {
            await fs.promises.rm(target, { recursive: true, force: true });
        } else {
            await fs.promises.unlink(target);
        }
    } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
            throw err;
        }
    }
}

async function pathExists(target: string): Promise<boolean> {
    try {
        await fs.promises.access(target, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

function createInputBoxStub(values: Array<string | undefined>): typeof vscode.window.showInputBox {
    let index = 0;
    return (async () => {
        if (index >= values.length) {
            throw new Error(`Unexpected showInputBox call (#${index + 1}); only ${values.length} stubbed values provided.`);
        }
        return values[index++];
    }) as typeof vscode.window.showInputBox;
}

function inspectZip(zipPath: string): Array<{ name: string; encrypted: boolean; method: number }> {
    const zip = new AdmZip(zipPath);
    return zip
        .getEntries()
        .filter((entry) => !entry.isDirectory)
        .map((entry) => {
            const header = entry.header as unknown as { encrypted: boolean; method: number };
            return {
                name: entry.entryName.replace(/\\/g, '/'),
                encrypted: header.encrypted,
                method: header.method,
            };
        });
}

interface SnapshotState {
    showInputBox: typeof vscode.window.showInputBox;
    showSaveDialog: typeof vscode.window.showSaveDialog;
    showInformationMessage: typeof vscode.window.showInformationMessage;
    showWarningMessage: typeof vscode.window.showWarningMessage;
    showErrorMessage: typeof vscode.window.showErrorMessage;
}

function snapshotWindow(): SnapshotState {
    const win = getWindow();
    return {
        showInputBox: win.showInputBox,
        showSaveDialog: win.showSaveDialog,
        showInformationMessage: win.showInformationMessage,
        showWarningMessage: win.showWarningMessage,
        showErrorMessage: win.showErrorMessage,
    };
}

function restoreWindow(snapshot: SnapshotState): void {
    const win = getWindow();
    win.showInputBox = snapshot.showInputBox;
    win.showSaveDialog = snapshot.showSaveDialog;
    win.showInformationMessage = snapshot.showInformationMessage;
    win.showWarningMessage = snapshot.showWarningMessage;
    win.showErrorMessage = snapshot.showErrorMessage;
}

async function listPartialFiles(dir: string): Promise<string[]> {
    const entries = await fs.promises.readdir(dir);
    return entries.filter((entry) => entry.endsWith('.partial'));
}

suite('SecureZip Encrypted Export', function () {
    let snapshot: SnapshotState;
    const PASSWORD = 'sz-test-pw';

    this.beforeEach(async function () {
        this.timeout(15000);
        snapshot = snapshotWindow();
        const folders = vscode.workspace.workspaceFolders;
        assert.ok(folders && folders.length > 0, 'VS Code did not open a workspace folder.');
        await ensureWorkspaceClean(folders[0].uri.fsPath);
    });

    this.afterEach(() => {
        restoreWindow(snapshot);
    });

    test('exportEncrypted produces an AES-encrypted ZIP for a single root', async function () {
        this.timeout(30000);
        await stageSimpleProject();
        const outPath = path.join(getWorkspaceRoot(), 'securezip-encrypted-single.zip');

        const win = getWindow();
        win.showInputBox = createInputBoxStub([PASSWORD, PASSWORD]);
        win.showSaveDialog = (async () => vscode.Uri.file(outPath)) as typeof vscode.window.showSaveDialog;
        win.showInformationMessage = (async () => undefined) as typeof vscode.window.showInformationMessage;
        win.showWarningMessage = (async () => undefined) as typeof vscode.window.showWarningMessage;

        try {
            await vscode.commands.executeCommand('securezip.exportEncrypted');
            assert.ok(await pathExists(outPath), 'Encrypted ZIP should be created');
            const entries = inspectZip(outPath);
            assert.ok(entries.length > 0, 'Encrypted ZIP should contain entries');
            for (const entry of entries) {
                assert.strictEqual(entry.encrypted, true, `${entry.name} should be encrypted`);
                assert.strictEqual(entry.method, 99, `${entry.name} should use WinZip AES (method 99)`);
            }
            const partials = await listPartialFiles(path.dirname(outPath));
            assert.deepStrictEqual(partials, [], 'No .partial files should remain after success');
        } finally {
            await removeIfExists(outPath);
        }
    });

    test('exportWorkspaceEncrypted produces an AES-encrypted ZIP for the workspace', async function () {
        this.timeout(30000);
        await stageSimpleProject();
        const outPath = path.join(getWorkspaceRoot(), 'securezip-encrypted-workspace.zip');

        const win = getWindow();
        win.showInputBox = createInputBoxStub([PASSWORD, PASSWORD]);
        win.showSaveDialog = (async () => vscode.Uri.file(outPath)) as typeof vscode.window.showSaveDialog;
        win.showInformationMessage = (async () => undefined) as typeof vscode.window.showInformationMessage;
        win.showWarningMessage = (async () => undefined) as typeof vscode.window.showWarningMessage;

        try {
            await vscode.commands.executeCommand('securezip.exportWorkspaceEncrypted');
            assert.ok(await pathExists(outPath), 'Encrypted workspace ZIP should be created');
            const entries = inspectZip(outPath);
            assert.ok(entries.length > 0, 'Encrypted workspace ZIP should contain entries');
            for (const entry of entries) {
                assert.strictEqual(entry.encrypted, true, `${entry.name} should be encrypted`);
                assert.strictEqual(entry.method, 99, `${entry.name} should use WinZip AES (method 99)`);
            }
        } finally {
            await removeIfExists(outPath);
        }
    });

    test('exportEncrypted leaves no side effects when the password prompt is cancelled', async function () {
        this.timeout(15000);
        await stageSimpleProject();
        const root = getWorkspaceRoot();
        const outPath = path.join(root, 'securezip-cancel-password.zip');

        let saveDialogCalls = 0;
        const win = getWindow();
        win.showInputBox = createInputBoxStub([undefined]);
        win.showSaveDialog = (async () => {
            saveDialogCalls += 1;
            return vscode.Uri.file(outPath);
        }) as typeof vscode.window.showSaveDialog;
        win.showInformationMessage = (async () => undefined) as typeof vscode.window.showInformationMessage;

        await vscode.commands.executeCommand('securezip.exportEncrypted');

        assert.strictEqual(saveDialogCalls, 0, 'Save dialog should not appear after password cancel');
        assert.strictEqual(await pathExists(outPath), false, 'No ZIP should be created on password cancel');
        const partials = await listPartialFiles(root);
        assert.deepStrictEqual(partials, [], 'No partial files should remain on password cancel');
    });

    test('exportEncrypted leaves no side effects when the confirmation prompt is cancelled', async function () {
        this.timeout(15000);
        await stageSimpleProject();
        const root = getWorkspaceRoot();
        const outPath = path.join(root, 'securezip-cancel-confirm.zip');

        let saveDialogCalls = 0;
        const win = getWindow();
        win.showInputBox = createInputBoxStub([PASSWORD, undefined]);
        win.showSaveDialog = (async () => {
            saveDialogCalls += 1;
            return vscode.Uri.file(outPath);
        }) as typeof vscode.window.showSaveDialog;
        win.showInformationMessage = (async () => undefined) as typeof vscode.window.showInformationMessage;

        await vscode.commands.executeCommand('securezip.exportEncrypted');

        assert.strictEqual(saveDialogCalls, 0, 'Save dialog should not appear after confirm cancel');
        assert.strictEqual(await pathExists(outPath), false, 'No ZIP should be created on confirm cancel');
        const partials = await listPartialFiles(root);
        assert.deepStrictEqual(partials, [], 'No partial files should remain on confirm cancel');
    });

    test('exportEncrypted re-prompts when the confirmation password does not match', async function () {
        this.timeout(30000);
        await stageSimpleProject();
        const outPath = path.join(getWorkspaceRoot(), 'securezip-mismatch.zip');

        const errors: string[] = [];
        const win = getWindow();
        win.showInputBox = createInputBoxStub(['first-attempt', 'mismatched', PASSWORD, PASSWORD]);
        win.showSaveDialog = (async () => vscode.Uri.file(outPath)) as typeof vscode.window.showSaveDialog;
        win.showInformationMessage = (async () => undefined) as typeof vscode.window.showInformationMessage;
        win.showWarningMessage = (async () => undefined) as typeof vscode.window.showWarningMessage;
        win.showErrorMessage = ((message: unknown, ..._items: unknown[]) => {
            errors.push(typeof message === 'string' ? message : String(message ?? ''));
            return Promise.resolve(undefined);
        }) as typeof vscode.window.showErrorMessage;

        try {
            await vscode.commands.executeCommand('securezip.exportEncrypted');
            assert.ok(
                errors.some((message) => /do not match|一致しません/i.test(message)),
                `Mismatch error should be shown. Captured: ${JSON.stringify(errors)}`,
            );
            assert.ok(await pathExists(outPath), 'Encrypted ZIP should be created after recovery');
            const entries = inspectZip(outPath);
            assert.ok(entries.length > 0, 'ZIP should contain entries');
            for (const entry of entries) {
                assert.strictEqual(entry.encrypted, true);
                assert.strictEqual(entry.method, 99);
            }
        } finally {
            await removeIfExists(outPath);
        }
    });

    test('exportEncrypted suppresses concurrent invocations with a warning', async function () {
        this.timeout(30000);
        await stageSimpleProject();
        const outPath = path.join(getWorkspaceRoot(), 'securezip-concurrent.zip');

        let pendingResolve: ((value: string | undefined) => void) | undefined;
        const firstInputPromise = new Promise<string | undefined>((resolve) => {
            pendingResolve = resolve;
        });

        let inputCallCount = 0;
        const warnings: string[] = [];
        const win = getWindow();
        win.showInputBox = (async () => {
            inputCallCount += 1;
            if (inputCallCount === 1) {
                return firstInputPromise;
            }
            return undefined;
        }) as typeof vscode.window.showInputBox;
        win.showSaveDialog = (async () => vscode.Uri.file(outPath)) as typeof vscode.window.showSaveDialog;
        win.showInformationMessage = (async () => undefined) as typeof vscode.window.showInformationMessage;
        win.showWarningMessage = ((message: unknown, ..._items: unknown[]) => {
            warnings.push(typeof message === 'string' ? message : String(message ?? ''));
            return Promise.resolve(undefined);
        }) as typeof vscode.window.showWarningMessage;

        const firstRun = vscode.commands.executeCommand('securezip.exportEncrypted');
        // Allow the first run to enter the lock and start the password prompt.
        await new Promise((resolve) => setTimeout(resolve, 150));

        try {
            await vscode.commands.executeCommand('securezip.exportEncrypted');
            assert.ok(
                warnings.some((message) => /already running|実行中/i.test(message)),
                `Concurrent run should trigger an "already running" warning. Captured: ${JSON.stringify(warnings)}`,
            );
            assert.strictEqual(await pathExists(outPath), false, 'No ZIP should be produced by the suppressed run');
            assert.strictEqual(
                inputCallCount,
                1,
                'Second invocation should be rejected before its password prompt is shown',
            );
        } finally {
            pendingResolve?.(undefined);
            await firstRun;
        }
    });

    test('exportEncrypted can be invoked multiple times in one session without re-registering the format', async function () {
        this.timeout(45000);
        await stageSimpleProject();
        const root = getWorkspaceRoot();
        const firstOut = path.join(root, 'securezip-encrypted-first.zip');
        const secondOut = path.join(root, 'securezip-encrypted-second.zip');

        const win = getWindow();
        win.showInformationMessage = (async () => undefined) as typeof vscode.window.showInformationMessage;
        win.showWarningMessage = (async () => undefined) as typeof vscode.window.showWarningMessage;

        try {
            win.showInputBox = createInputBoxStub([PASSWORD, PASSWORD]);
            win.showSaveDialog = (async () => vscode.Uri.file(firstOut)) as typeof vscode.window.showSaveDialog;
            await vscode.commands.executeCommand('securezip.exportEncrypted');
            assert.ok(await pathExists(firstOut), 'First encrypted ZIP should exist');

            win.showInputBox = createInputBoxStub([PASSWORD, PASSWORD]);
            win.showSaveDialog = (async () => vscode.Uri.file(secondOut)) as typeof vscode.window.showSaveDialog;
            await vscode.commands.executeCommand('securezip.exportEncrypted');
            assert.ok(await pathExists(secondOut), 'Second encrypted ZIP should exist');

            for (const out of [firstOut, secondOut]) {
                const entries = inspectZip(out);
                assert.ok(entries.length > 0, `${out} should contain entries`);
                for (const entry of entries) {
                    assert.strictEqual(entry.encrypted, true);
                    assert.strictEqual(entry.method, 99);
                }
            }
        } finally {
            await removeIfExists(firstOut);
            await removeIfExists(secondOut);
        }
    });

    test('exportEncrypted preserves an existing ZIP and removes temp files when finalize fails', async function () {
        this.timeout(30000);
        await stageSimpleProject();
        const root = getWorkspaceRoot();
        const outPath = path.join(root, 'securezip-existing.zip');

        const existingContent = Buffer.from('original-zip-content');
        await fs.promises.writeFile(outPath, existingContent);

        const errors: string[] = [];
        const win = getWindow();
        win.showInputBox = createInputBoxStub([PASSWORD, PASSWORD]);
        win.showSaveDialog = (async () => vscode.Uri.file(outPath)) as typeof vscode.window.showSaveDialog;
        win.showInformationMessage = (async () => undefined) as typeof vscode.window.showInformationMessage;
        win.showWarningMessage = (async () => undefined) as typeof vscode.window.showWarningMessage;
        win.showErrorMessage = ((message: unknown, ..._items: unknown[]) => {
            errors.push(typeof message === 'string' ? message : String(message ?? ''));
            return Promise.resolve(undefined);
        }) as typeof vscode.window.showErrorMessage;

        const originalRename = fs.promises.rename;
        (fs.promises as unknown as { rename: typeof fs.promises.rename }).rename = (async () => {
            throw new Error('forced-rename-failure');
        }) as typeof fs.promises.rename;

        try {
            await vscode.commands.executeCommand('securezip.exportEncrypted');
        } finally {
            (fs.promises as unknown as { rename: typeof fs.promises.rename }).rename = originalRename;
        }

        try {
            assert.ok(
                errors.some((message) => /forced-rename-failure|SecureZip failed/i.test(message)),
                `Failure should surface as an error. Captured: ${JSON.stringify(errors)}`,
            );
            const preserved = await fs.promises.readFile(outPath);
            assert.deepStrictEqual(preserved, existingContent, 'Existing ZIP must be preserved on failure');
            const partials = await listPartialFiles(root);
            assert.deepStrictEqual(partials, [], 'Temp partial files must be cleaned up on failure');
        } finally {
            await removeIfExists(outPath);
        }
    });

    test('exportEncrypted leaves no temp files in the output directory after success', async function () {
        this.timeout(30000);
        await stageSimpleProject();
        const root = getWorkspaceRoot();
        const outPath = path.join(root, 'securezip-temp-cleanup.zip');

        const win = getWindow();
        win.showInputBox = createInputBoxStub([PASSWORD, PASSWORD]);
        win.showSaveDialog = (async () => vscode.Uri.file(outPath)) as typeof vscode.window.showSaveDialog;
        win.showInformationMessage = (async () => undefined) as typeof vscode.window.showInformationMessage;
        win.showWarningMessage = (async () => undefined) as typeof vscode.window.showWarningMessage;

        try {
            await vscode.commands.executeCommand('securezip.exportEncrypted');
            assert.ok(await pathExists(outPath), 'Encrypted ZIP should exist after success');
            const partials = await listPartialFiles(root);
            assert.deepStrictEqual(partials, [], 'No .partial files should remain in output directory');
        } finally {
            await removeIfExists(outPath);
        }
    });
});

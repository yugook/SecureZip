// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import simpleGit, { SimpleGit } from 'simple-git';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    console.log('[SecureZip] activated.');

    const disposable = vscode.commands.registerCommand('securezip.export', async () => {
        try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'SecureZip', cancellable: false }, async (progress) => {
                progress.report({ message: '準備中…' });
                await exportProject(progress);
            });
        } catch (err: any) {
            console.error('[SecureZip] export failed', err);
            vscode.window.showErrorMessage(`SecureZip 失敗: ${err?.message ?? err}`);
        }
    });

    context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}

async function exportProject(progress: vscode.Progress<{ message?: string }>) {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
        throw new Error('ワークスペースが開かれていません');
    }
    const root = ws.uri.fsPath;

    const cfg = vscode.workspace.getConfiguration('secureZip');
    const tagPrefix = (cfg.get<string>('tagPrefix') || 'export').trim();
    const commitTemplate = cfg.get<string>('commitMessageTemplate') || '[SecureZip] エクスポート用の自動コミット: ${date} ${time} (ブランチ: ${branch}, タグ: ${tag})';
    const additionalExcludes = cfg.get<string[]>('additionalExcludes') || [];
    const includeNodeModules = !!cfg.get<boolean>('includeNodeModules');

    const now = new Date();
    const fmt = formatDate(now);
    const tag = `${tagPrefix}-${fmt.compact}`; // e.g., export-20250102-153012

    // Git 処理
    const git: SimpleGit = simpleGit({ baseDir: root });
    let branch = 'unknown';
    try {
        const isRepo = await git.checkIsRepo();
        if (isRepo) {
            const status = await git.status();
            branch = status.current || branch;
            if (!status.isClean()) {
                progress.report({ message: 'Git: 変更をコミット中…' });
                await git.add(['-A']);
                const commitMessage = renderTemplate(commitTemplate, {
                    date: fmt.date,
                    time: fmt.time,
                    datetime: fmt.datetime,
                    branch,
                    tag,
                });
                try {
                    await git.commit(commitMessage);
                } catch (e) {
                    console.warn('[SecureZip] commit failed, continue without auto-commit', e);
                    vscode.window.showWarningMessage('自動コミットに失敗しました（署名設定などを確認）。コミットなしで続行します。');
                }
            }

            // タグ作成（常に試みる）
            progress.report({ message: 'Git: タグを作成中…' });
            try {
                await git.addAnnotatedTag(tag, `SecureZip エクスポート: ${fmt.datetime}`);
            } catch (e) {
                console.warn('[SecureZip] tag failed, continue without tag', e);
                vscode.window.showWarningMessage('タグ作成に失敗しました。タグなしで続行します。');
            }
        }
    } catch (e) {
        console.warn('[SecureZip] Git unavailable or failed, continue without Git ops', e);
    }

    // 保存先ダイアログ
    const defaultName = `${path.basename(root)}-${fmt.compact}.zip`;
    const targetUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(root, defaultName)),
        filters: { 'ZIP Archive': ['zip'] },
        saveLabel: 'エクスポート'
    });
    if (!targetUri) {
        return; // ユーザーキャンセル
    }

    // 収集するファイル
    progress.report({ message: 'ファイルを収集中…' });
    const { globby } = await import('globby');
    const ignoreDefaults = [
        '.git',
        '.git/**',
        includeNodeModules ? '' : 'node_modules/**',
        '.env',
        '.env.*',
        '**/*.pem',
        '**/*.key',
        '**/*.crt',
        '**/*.pfx',
    ].filter(Boolean) as string[];

    const patterns = ['**/*', '**/.*'];
    const files = await globby(patterns, {
        cwd: root,
        dot: true,
        gitignore: true,
        ignore: [...ignoreDefaults, ...additionalExcludes],
        onlyFiles: true,
        followSymbolicLinks: false,
        absolute: true,
    });

    if (files.length === 0) {
        throw new Error('アーカイブ対象のファイルが見つかりません');
    }

    // ZIP作成
    progress.report({ message: 'ZIP を作成中…' });
    await createZip(root, files, targetUri.fsPath);

    vscode.window.showInformationMessage(`SecureZip 完了: ${path.basename(targetUri.fsPath)}`);
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
    return tpl.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

function formatDate(d: Date) {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const HH = pad(d.getHours());
    const MM = pad(d.getMinutes());
    const SS = pad(d.getSeconds());
    return {
        date: `${yyyy}-${mm}-${dd}`,
        time: `${HH}:${MM}:${SS}`,
        datetime: `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`,
        compact: `${yyyy}${mm}${dd}-${HH}${MM}${SS}`
    };
}

async function createZip(root: string, files: string[], outFile: string) {
    await fs.promises.mkdir(path.dirname(outFile), { recursive: true });

    const output = fs.createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    const closed = new Promise<void>((resolve, reject) => {
        output.on('close', () => resolve());
        output.on('error', reject);
        archive.on('warning', (err: Error) => {
            // Non-blocking warnings
            console.warn('[SecureZip] archiver warning:', err);
        });
        archive.on('error', (err: Error) => reject(err));
    });

    archive.pipe(output);

    for (const abs of files) {
        const rel = path.relative(root, abs);
        archive.file(abs, { name: rel });
    }

    await archive.finalize();
    await closed;
}

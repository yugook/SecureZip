// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import simpleGit, { SimpleGit } from 'simple-git';
import { resolveFlags } from './flags';
import { AddPatternResult, addPatternsToSecureZipIgnore, loadSecureZipIgnore } from './ignore';
import { SecureZipViewProvider, ensureSecureZipIgnoreFile } from './view';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
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

    const addToIgnore = vscode.commands.registerCommand('securezip.addToIgnore', async (target?: vscode.Uri) => {
        try {
            await handleAddToIgnore(target);
        } catch (err: any) {
            console.error('[SecureZip] addToIgnore failed', err);
            vscode.window.showErrorMessage(`.securezipignore への追加に失敗しました: ${err?.message ?? err}`);
        }
    });

    const addPattern = vscode.commands.registerCommand('securezip.addPattern', async (pattern: string, root?: string) => {
        try {
            if (typeof pattern !== 'string') {
                vscode.window.showWarningMessage('パターンを解決できませんでした');
                return;
            }
            const result = await applyIgnorePatterns([pattern], root);
            if (result) {
                showAddResult(result);
            }
        } catch (err: any) {
            console.error('[SecureZip] addPattern failed', err);
            vscode.window.showErrorMessage(`パターン追加に失敗しました: ${err?.message ?? err}`);
        }
    });

    const applySuggested = vscode.commands.registerCommand('securezip.applySuggestedPatterns', async (patterns?: unknown, root?: unknown) => {
        try {
            const list = Array.isArray(patterns)
                ? patterns.map((p) => (typeof p === 'string' ? p.trim() : '')).filter((p) => p.length > 0)
                : [];
            if (list.length === 0) {
                vscode.window.showInformationMessage('追加できる推奨パターンはありません');
                return;
            }
            const result = await applyIgnorePatterns(list, typeof root === 'string' ? root : undefined);
            if (result) {
                showAddResult(result);
            }
        } catch (err: any) {
            console.error('[SecureZip] applySuggestedPatterns failed', err);
            vscode.window.showErrorMessage(`推奨パターンの追加に失敗しました: ${err?.message ?? err}`);
        }
    });

    const openIgnore = vscode.commands.registerCommand('securezip.openIgnoreFile', async (target?: vscode.Uri) => {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) {
            vscode.window.showErrorMessage('ワークスペースが開かれていません');
            return;
        }
        const root = ws.uri.fsPath;
        try {
            await ensureSecureZipIgnoreFile(root);
            const documentUri = target?.fsPath
                ? target
                : vscode.Uri.file(path.join(root, '.securezipignore'));
            const doc = await vscode.workspace.openTextDocument(documentUri);
            await vscode.window.showTextDocument(doc, { preview: false });
            treeProvider?.refresh();
        } catch (err: any) {
            console.error('[SecureZip] openIgnoreFile failed', err);
            vscode.window.showErrorMessage(`.securezipignore を開けませんでした: ${err?.message ?? err}`);
        }
    });

    const createIgnore = vscode.commands.registerCommand('securezip.createIgnoreFile', async (rootOverride?: unknown) => {
        const resolvedRoot = typeof rootOverride === 'string' ? rootOverride : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!resolvedRoot) {
            vscode.window.showErrorMessage('ワークスペースが開かれていません');
            return;
        }

        const targetFile = path.join(resolvedRoot, '.securezipignore');
        let existed = false;
        try {
            await fs.promises.access(targetFile, fs.constants.F_OK);
            existed = true;
        } catch {
            existed = false;
        }

        try {
            await ensureSecureZipIgnoreFile(resolvedRoot);
            treeProvider?.refresh();
            if (existed) {
                vscode.window.showInformationMessage('.securezipignore は既に存在しています');
            } else {
                vscode.window.showInformationMessage('.securezipignore を作成しました');
            }
        } catch (err: any) {
            console.error('[SecureZip] createIgnoreFile failed', err);
            vscode.window.showErrorMessage(`.securezipignore の作成に失敗しました: ${err?.message ?? err}`);
        }
    });

    const showPreview = vscode.commands.registerCommand('securezip.showPreview', () => {
        if (!treeProvider) {
            return;
        }
        treeProvider.revealSection('preview');
    });

    // Feature flags (build-time + settings), then gate the status bar button
    const cfg = vscode.workspace.getConfiguration('secureZip');
    const settingsFlags = {
        enableStatusBarButton: cfg.get<boolean>('flags.enableStatusBarButton') ?? undefined,
    };
    // @ts-expect-error injected by esbuild define
    const buildFlags = typeof __BUILD_FLAGS__ !== 'undefined' ? __BUILD_FLAGS__ : undefined;
    const flags = resolveFlags({ build: buildFlags, settings: settingsFlags, machineId: vscode.env.machineId });

    // Status Bar button (bottom). Click to run export.
    if (flags.enableStatusBarButton) {
        const statusBar = vscode.window.createStatusBarItem('securezip.status', vscode.StatusBarAlignment.Right, 100);
        statusBar.text = '$(package) SecureZip';
        statusBar.tooltip = 'プロジェクトをZIPとしてエクスポート';
        statusBar.command = 'securezip.export';
        statusBar.show();
        context.subscriptions.push(statusBar);
    }

    treeProvider = new SecureZipViewProvider(context);
    const treeView = vscode.window.createTreeView('securezip.view', { treeDataProvider: treeProvider });
    treeProvider.attachTreeView(treeView);

    context.subscriptions.push(
        disposable,
        addToIgnore,
        addPattern,
        applySuggested,
        openIgnore,
        createIgnore,
        showPreview,
        treeProvider,
        treeView,
    );
}

// This method is called when your extension is deactivated
export function deactivate() {}

let extensionContext: vscode.ExtensionContext | undefined;
let treeProvider: SecureZipViewProvider | undefined;

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

            const hasPendingChanges = !status.isClean();
            let shouldAutoCommit = false;
            let allowTagging = !hasPendingChanges;

            if (hasPendingChanges) {
                const AUTO_COMMIT_OPTION = '自動コミットして続行';
                const SKIP_GIT_OPTION = 'Git操作をスキップ';
                const CANCEL_OPTION = 'キャンセル';
                const choice = await vscode.window.showWarningMessage(
                    'Git に未コミットの変更があります。自動コミットを実行しますか？',
                    { modal: true },
                    AUTO_COMMIT_OPTION,
                    SKIP_GIT_OPTION,
                    CANCEL_OPTION,
                );

                if (!choice || choice === CANCEL_OPTION) {
                    vscode.window.showInformationMessage('SecureZip をキャンセルしました。');
                    return;
                }

                if (choice === AUTO_COMMIT_OPTION) {
                    shouldAutoCommit = true;
                }
            }

            if (shouldAutoCommit) {
                progress.report({ message: 'Git: 自動コミットを準備中…' });
                try {
                    await git.add(['--update']);
                    const stagedDiff = await git.diff(['--cached']);
                    if (!stagedDiff.trim()) {
                        vscode.window.showWarningMessage('自動コミット対象の変更が見つかりませんでした。既存ファイルの変更のみがコミット対象です。');
                    } else {
                        const commitMessage = renderTemplate(commitTemplate, {
                            date: fmt.date,
                            time: fmt.time,
                            datetime: fmt.datetime,
                            branch,
                            tag,
                        });
                        await git.commit(commitMessage);
                        allowTagging = true;
                    }
                } catch (e) {
                    console.warn('[SecureZip] commit failed, continue without auto-commit', e);
                    vscode.window.showWarningMessage('自動コミットに失敗しました（署名設定などを確認）。コミットなしで続行します。');
                }
            }

            if (allowTagging) {
                progress.report({ message: 'Git: タグを作成中…' });
                try {
                    await git.addAnnotatedTag(tag, `SecureZip エクスポート: ${fmt.datetime}`);
                } catch (e) {
                    console.warn('[SecureZip] tag failed, continue without tag', e);
                    vscode.window.showWarningMessage('タグ作成に失敗しました。タグなしで続行します。');
                }
            } else {
                console.log('[SecureZip] skip tagging because working tree remains dirty');
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

    void treeProvider?.recordLastExport(ignoreDefaults);

    // Load .securezipignore (root-level). Negated patterns are treated as re-includes after base filtering.
    const szIgnore = await loadSecureZipIgnore(root);

    const patterns = ['**/*', '**/.*'];
    const baseIgnore = [...ignoreDefaults, ...additionalExcludes, ...szIgnore.excludes];
    const files = await globby(patterns, {
        cwd: root,
        dot: true,
        gitignore: true,
        ignore: baseIgnore,
        onlyFiles: true,
        followSymbolicLinks: false,
        absolute: true,
    });

    // Re-include patterns from .securezipignore (does not override .gitignore or hard ignores like .git/**)
    let finalFiles = files;
    if (szIgnore.includes.length > 0) {
        const reincluded = await globby(szIgnore.includes, {
            cwd: root,
            dot: true,
            gitignore: true,
            // Keep hard ignores; do NOT apply .securezipignore excludes here
            ignore: ignoreDefaults,
            onlyFiles: true,
            followSymbolicLinks: false,
            absolute: true,
        });
        const set = new Set<string>(files);
        for (const f of reincluded) {
            set.add(f);
        }
        finalFiles = Array.from(set.values());
    }

    if (files.length === 0) {
        throw new Error('アーカイブ対象のファイルが見つかりません');
    }

    // ZIP作成
    progress.report({ message: 'ZIP を作成中…' });
    await createZip(root, finalFiles, targetUri.fsPath);

    vscode.window.showInformationMessage(`SecureZip 完了: ${path.basename(targetUri.fsPath)}`);
}

async function handleAddToIgnore(target?: vscode.Uri) {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
        vscode.window.showErrorMessage('ワークスペースが開かれていません');
        return;
    }

    let resource = target;
    if (!resource) {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: true,
            canSelectMany: false,
            title: '.securezipignore に追加するリソースを選択',
            openLabel: '追加',
        });
        if (!picked || picked.length === 0) {
            return;
        }
        resource = picked[0];
    }

    if (resource.scheme !== 'file') {
        vscode.window.showWarningMessage('ファイルシステム上の項目のみ追加できます');
        return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(resource);
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('ワークスペース外の項目は追加できません');
        return;
    }

    const stat = await fs.promises.stat(resource.fsPath);
    const relativeRaw = vscode.workspace.asRelativePath(resource, false);
    if (!relativeRaw) {
        vscode.window.showWarningMessage('相対パスを解決できませんでした');
        return;
    }

    const relative = relativeRaw.replace(/\\+/g, '/');
    if (!relative || relative.startsWith('..')) {
        vscode.window.showWarningMessage('ワークスペース配下のリソースを選択してください');
        return;
    }

    const suggestions = new Map<string, vscode.QuickPickItem & { pattern: string }>();
    const baseLabel = stat.isDirectory() ? `${relative.replace(/\/+$/g, '')}` : relative;

    if (stat.isDirectory()) {
        suggestions.set(`${baseLabel}/`, {
            label: `${baseLabel}/`,
            description: 'ディレクトリ全体を除外',
            pattern: `${baseLabel}/`,
        });
        suggestions.set(`${baseLabel}/**`, {
            label: `${baseLabel}/**`,
            description: 'ディレクトリ以下を再帰的に除外',
            pattern: `${baseLabel}/**`,
        });
    } else {
        suggestions.set(baseLabel, {
            label: baseLabel,
            description: 'ファイルを除外',
            pattern: baseLabel,
        });
    }

    const segments = baseLabel.split('/');
    if (segments.some((seg) => seg.startsWith('.'))) {
        suggestions.set('**/.*', {
            label: '**/.*',
            description: '隠しファイル全体を除外',
            pattern: '**/.*',
        });
    }

    const pickItems: (vscode.QuickPickItem & { pattern?: string; custom?: boolean })[] = Array.from(suggestions.values());
    pickItems.push({
        label: 'パターンを手動で入力…',
        description: '.securezipignore に追加するパターンを入力します',
        alwaysShow: true,
        custom: true,
    });

    const selected = await vscode.window.showQuickPick(pickItems, {
        placeHolder: `${relative} を .securezipignore に追加`,
    });

    if (!selected) {
        return;
    }

    let patternValue = selected.pattern;
    if (selected.custom) {
        const firstSuggestion = suggestions.values().next().value;
        patternValue = await vscode.window.showInputBox({
            prompt: '.securezipignore に書き込むパターンを入力してください',
            value: firstSuggestion?.pattern ?? baseLabel,
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'パターンを入力してください';
                }
                return undefined;
            },
        });
    }

    const pattern = patternValue?.trim();
    if (!pattern) {
        return;
    }

    const result = await applyIgnorePatterns([pattern], workspaceFolder.uri.fsPath);
    if (result) {
        showAddResult(result);
    }
}

async function applyIgnorePatterns(patterns: string[], rootOverride?: string): Promise<AddPatternResult | undefined> {
    let targetRoot = rootOverride;
    if (!targetRoot) {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) {
            vscode.window.showErrorMessage('ワークスペースが開かれていません');
            return undefined;
        }
        targetRoot = ws.uri.fsPath;
    }

    const result = await addPatternsToSecureZipIgnore(targetRoot, patterns);
    if (result.added.length > 0) {
        treeProvider?.refresh();
    }
    return result;
}

function showAddResult(result: AddPatternResult) {
    if (result.added.length === 1) {
        vscode.window.showInformationMessage(`${result.added[0]} を .securezipignore に追加しました`);
    } else if (result.added.length > 1) {
        vscode.window.showInformationMessage(`${result.added.length} 件のパターンを .securezipignore に追加しました`);
    }

    const duplicates = result.skipped.filter((s) => s.reason === 'duplicate');
    if (duplicates.length > 0) {
        const list = duplicates.map((d) => d.pattern).join(', ');
        vscode.window.showWarningMessage(`${list} は既に登録されています`);
    }

    const invalids = result.skipped.filter((s) => s.reason === 'invalid');
    if (invalids.length > 0) {
        const list = invalids.map((d) => d.pattern).join(', ');
        vscode.window.showWarningMessage(`${list} は無効なパターンです`);
    }
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

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import simpleGit, { SimpleGit } from 'simple-git';
import { resolveAutoExcludePatterns } from './defaultExcludes';
import { resolveFlags } from './flags';
import { AddPatternResult, addPatternsToSecureZipIgnore, loadSecureZipIgnore } from './ignore';
import { SecureZipViewProvider, ensureSecureZipIgnoreFile } from './view';
import { localize } from './nls';

function toErrorMessage(err: unknown): string {
    if (err instanceof Error && err.message) {
        return err.message;
    }
    return String(err);
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    console.log('[SecureZip] activated.');

    const disposable = vscode.commands.registerCommand('securezip.export', async () => {
        try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'SecureZip', cancellable: false }, async (progress) => {
                progress.report({ message: localize('progress.preparing', 'Preparing...') });
                await exportProject(progress);
            });
        } catch (err: unknown) {
            console.error('[SecureZip] export failed', err);
            vscode.window.showErrorMessage(localize('error.exportFailed', 'SecureZip failed: {0}', toErrorMessage(err)));
        }
    });

    const addToIgnore = vscode.commands.registerCommand('securezip.addToIgnore', async (target?: vscode.Uri) => {
        try {
            await handleAddToIgnore(target);
        } catch (err: unknown) {
            console.error('[SecureZip] addToIgnore failed', err);
            vscode.window.showErrorMessage(localize('error.addToIgnoreFailed', 'Failed to add item to .securezipignore: {0}', toErrorMessage(err)));
        }
    });

    const addPattern = vscode.commands.registerCommand('securezip.addPattern', async (pattern: string, root?: string) => {
        try {
            if (typeof pattern !== 'string') {
                vscode.window.showWarningMessage(localize('warning.patternNotResolved', 'Could not resolve the pattern.'));
                return;
            }
            const result = await applyIgnorePatterns([pattern], root);
            if (result) {
                showAddResult(result);
            }
        } catch (err: unknown) {
            console.error('[SecureZip] addPattern failed', err);
            vscode.window.showErrorMessage(localize('error.addPatternFailed', 'Failed to add pattern: {0}', toErrorMessage(err)));
        }
    });

    const applySuggested = vscode.commands.registerCommand('securezip.applySuggestedPatterns', async (patterns?: unknown, root?: unknown) => {
        try {
            const list = Array.isArray(patterns)
                ? patterns.map((p) => (typeof p === 'string' ? p.trim() : '')).filter((p) => p.length > 0)
                : [];
            if (list.length === 0) {
                vscode.window.showInformationMessage(localize('info.noSuggestedPatterns', 'There are no suggested patterns to add.'));
                return;
            }
            const result = await applyIgnorePatterns(list, typeof root === 'string' ? root : undefined);
            if (result) {
                showAddResult(result);
            }
        } catch (err: unknown) {
            console.error('[SecureZip] applySuggestedPatterns failed', err);
            vscode.window.showErrorMessage(localize('error.addSuggestedPatternsFailed', 'Failed to add suggested patterns: {0}', toErrorMessage(err)));
        }
    });

    const openIgnore = vscode.commands.registerCommand('securezip.openIgnoreFile', async (target?: vscode.Uri) => {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) {
            vscode.window.showErrorMessage(localize('error.workspaceMissing', 'No workspace folder is open.'));
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
        } catch (err: unknown) {
            console.error('[SecureZip] openIgnoreFile failed', err);
            vscode.window.showErrorMessage(localize('error.openIgnoreFailed', 'Failed to open .securezipignore: {0}', toErrorMessage(err)));
        }
    });

    const createIgnore = vscode.commands.registerCommand('securezip.createIgnoreFile', async (rootOverride?: unknown) => {
        const resolvedRoot = typeof rootOverride === 'string' ? rootOverride : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!resolvedRoot) {
            vscode.window.showErrorMessage(localize('error.workspaceMissing', 'No workspace folder is open.'));
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
                vscode.window.showInformationMessage(localize('info.ignoreAlreadyExists', '.securezipignore already exists.'));
            } else {
                vscode.window.showInformationMessage(localize('info.ignoreCreated', '.securezipignore has been created.'));
            }
        } catch (err: unknown) {
            console.error('[SecureZip] createIgnoreFile failed', err);
            vscode.window.showErrorMessage(localize('error.createIgnoreFailed', 'Failed to create .securezipignore: {0}', toErrorMessage(err)));
        }
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
        statusBar.tooltip = localize('statusBar.tooltip', 'Export the project as a ZIP archive');
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
        throw new Error(localize('error.workspaceMissing', 'No workspace folder is open.'));
    }
    const root = ws.uri.fsPath;

    const cfg = vscode.workspace.getConfiguration('secureZip');
    const tagPrefix = (cfg.get<string>('tagPrefix') || 'export').trim();
    const commitTemplate = cfg.get<string>('commitMessageTemplate') || '[SecureZip] Automated commit for export: ${date} ${time} (Branch: ${branch}, Tag: ${tag})';
    const additionalExcludes = cfg.get<string[]>('additionalExcludes') || [];
    const includeNodeModules = !!cfg.get<boolean>('includeNodeModules');

    const now = new Date();
    const fmt = formatDate(now);
    const tag = `${tagPrefix}-${fmt.compact}`; // e.g., export-20250102-153012

    // Git operations
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
                const AUTO_COMMIT_OPTION = localize('git.autoCommitOption', 'Commit changes automatically and continue');
                const TAG_ONLY_OPTION = localize('git.tagOnlyOption', 'Create tag only (use latest commit)');
                const SKIP_GIT_OPTION = localize('git.skipOption', 'Proceed without Git actions');
                const choice = await vscode.window.showWarningMessage(
                    localize('git.uncommittedWarning', 'Uncommitted changes detected. Do you want to create an automatic commit before exporting?'),
                    { modal: true },
                    AUTO_COMMIT_OPTION,
                    TAG_ONLY_OPTION,
                    SKIP_GIT_OPTION,
                );

                if (!choice) {
                    vscode.window.showInformationMessage(localize('info.exportCancelled', 'SecureZip export was cancelled.'));
                    return;
                }

                if (choice === AUTO_COMMIT_OPTION) {
                    shouldAutoCommit = true;
                } else if (choice === TAG_ONLY_OPTION) {
                    const CONFIRM_TAG_ONLY_OPTION = localize('git.tagOnlyConfirmContinue', 'Create tag');
                    const confirmTagOnly = await vscode.window.showWarningMessage(
                        localize('git.tagOnlyConfirm', 'The tag will point to the latest commit and will not include uncommitted changes. Continue?'),
                        { modal: true },
                        CONFIRM_TAG_ONLY_OPTION,
                    );

                    if (confirmTagOnly !== CONFIRM_TAG_ONLY_OPTION) {
                        vscode.window.showInformationMessage(localize('info.exportCancelled', 'SecureZip export was cancelled.'));
                        return;
                    }

                    allowTagging = true;
                }
            }

            if (shouldAutoCommit) {
                progress.report({ message: localize('progress.gitPreparingCommit', 'Git: preparing automatic commit...') });
                try {
                    await git.add(['--update']);
                    const stagedDiff = await git.diff(['--cached']);
                    if (!stagedDiff.trim()) {
                        vscode.window.showWarningMessage(localize('warning.noChangesToCommit', 'No staged changes were found. Only modifications to tracked files can be committed automatically.'));
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
                    vscode.window.showWarningMessage(localize('warning.commitFailed', 'Automatic commit failed (check Git signing or configuration). Continuing without committing.'));
                }
            }

            if (allowTagging) {
                progress.report({ message: localize('progress.gitTagging', 'Git: creating export tag...') });
                try {
                    await git.addAnnotatedTag(tag, localize('git.tagAnnotation', 'SecureZip export: {0}', fmt.datetime));
                } catch (e) {
                    console.warn('[SecureZip] tag failed, continue without tag', e);
                    vscode.window.showWarningMessage(localize('warning.tagFailed', 'Failed to create tag. Continuing without tagging.'));
                }
            } else {
                console.log('[SecureZip] skip tagging because working tree remains dirty');
            }
        }
    } catch (e) {
        console.warn('[SecureZip] Git unavailable or failed, continue without Git ops', e);
    }

    // Save target selection
    const defaultName = `${path.basename(root)}-${fmt.compact}.zip`;
    const targetUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(root, defaultName)),
        filters: { 'ZIP Archive': ['zip'] },
        saveLabel: localize('saveDialog.label', 'Export')
    });
    if (!targetUri) {
        return; // user cancelled
    }

    // Files to include
    progress.report({ message: localize('progress.collectingFiles', 'Collecting files...') });
    const { globby } = await import('globby');
    const ignoreDefaults = resolveAutoExcludePatterns({ includeNodeModules });

    // Load .securezipignore (root-level). Negated patterns are treated as re-includes after base filtering.
    const szIgnore = await loadSecureZipIgnore(root);
    const ignoreSnapshot = [
        ...szIgnore.excludes,
        ...szIgnore.includes.map((pattern) => `!${pattern}`),
    ];
    void treeProvider?.recordLastExport(ignoreSnapshot);
    const includePatternSet = new Set(szIgnore.includes);
    const hasGitRootInclude = includePatternSet.has('.git');
    if (hasGitRootInclude) {
        includePatternSet.add('.git/**');
    }
    const gitOverride = Array.from(includePatternSet).some(
        (pattern) => pattern === '.git' || pattern === '.git/**' || pattern.startsWith('.git/'),
    );
    const reincludePatterns = Array.from(includePatternSet);
    if (gitOverride) {
        void vscode.window.showWarningMessage(
            localize(
                'warning.gitIncluded',
                'Warning: The .git directory will be included in the export. Double-check before sharing.',
            ),
        );
    }

    const patterns = ['**/*', '**/.*'];
    const baseIgnore = [...ignoreDefaults, ...additionalExcludes, ...szIgnore.excludes];
    const baseFiles = await globby(patterns, {
        cwd: root,
        dot: true,
        gitignore: true,
        ignore: baseIgnore,
        onlyFiles: true,
        followSymbolicLinks: false,
        absolute: true,
    });

    const fileSet = new Set<string>(baseFiles);
    let hasFiles = baseFiles.length > 0;

    if (includeNodeModules) {
        const nodeModuleFiles = await globby(['node_modules/**'], {
            cwd: root,
            dot: true,
            gitignore: false,
            ignore: baseIgnore,
            onlyFiles: true,
            followSymbolicLinks: false,
            absolute: true,
        });
        for (const file of nodeModuleFiles) {
            fileSet.add(file);
        }
        if (!hasFiles && nodeModuleFiles.length > 0) {
            hasFiles = true;
        }
    }

    if (!hasFiles) {
        throw new Error(localize('error.noFilesToArchive', 'No files were found to include in the archive.'));
    }

    // Re-include patterns from .securezipignore (does not override .gitignore or hard ignores like .git/**)
    if (reincludePatterns.length > 0) {
        const reinclusionIgnore = gitOverride
            ? ignoreDefaults.filter((pattern) => pattern !== '.git' && pattern !== '.git/**')
            : ignoreDefaults;
        const reincluded = await globby(reincludePatterns, {
            cwd: root,
            dot: true,
            gitignore: true,
            // Keep hard ignores; do NOT apply .securezipignore excludes here
            ignore: reinclusionIgnore,
            onlyFiles: true,
            followSymbolicLinks: false,
            absolute: true,
        });
        for (const file of reincluded) {
            fileSet.add(file);
        }
    }

    const finalFiles = Array.from(fileSet.values());

    // Create ZIP
    progress.report({ message: localize('progress.creatingZip', 'Creating ZIP archive...') });
    await createZip(root, finalFiles, targetUri.fsPath);

    vscode.window.showInformationMessage(localize('info.exportCompleted', 'SecureZip completed: {0}', path.basename(targetUri.fsPath)));
}

async function handleAddToIgnore(target?: vscode.Uri) {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
        vscode.window.showErrorMessage(localize('error.workspaceMissing', 'No workspace folder is open.'));
        return;
    }

    let resource = target;
    if (!resource) {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: true,
            canSelectMany: false,
            title: localize('dialog.addToIgnore.title', 'Select a resource to add to .securezipignore'),
            openLabel: localize('dialog.addToIgnore.openLabel', 'Add'),
        });
        if (!picked || picked.length === 0) {
            return;
        }
        resource = picked[0];
    }

    if (resource.scheme !== 'file') {
        vscode.window.showWarningMessage(localize('warning.fileSchemeOnly', 'Only file system resources can be added.'));
        return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(resource);
    if (!workspaceFolder) {
        vscode.window.showWarningMessage(localize('warning.outsideWorkspace', 'Resources outside the workspace cannot be added.'));
        return;
    }

    const stat = await fs.promises.stat(resource.fsPath);
    const relativeRaw = vscode.workspace.asRelativePath(resource, false);
    if (!relativeRaw) {
        vscode.window.showWarningMessage(localize('warning.relativePathMissing', 'Could not resolve a relative path.'));
        return;
    }

    const relative = relativeRaw.replace(/\\+/g, '/');
    if (!relative || relative.startsWith('..')) {
        vscode.window.showWarningMessage(localize('warning.outsideWorkspaceRelative', 'Select a resource located inside the workspace.'));
        return;
    }

    const suggestions = new Map<string, vscode.QuickPickItem & { pattern: string }>();
    const baseLabel = stat.isDirectory() ? `${relative.replace(/\/+$/g, '')}` : relative;

    if (stat.isDirectory()) {
        suggestions.set(`${baseLabel}/`, {
            label: `${baseLabel}/`,
            description: localize('quickPick.excludeDirectory', 'Exclude directory'),
            pattern: `${baseLabel}/`,
        });
        suggestions.set(`${baseLabel}/**`, {
            label: `${baseLabel}/**`,
            description: localize('quickPick.excludeDirectoryRecursive', 'Exclude directory recursively'),
            pattern: `${baseLabel}/**`,
        });
    } else {
        suggestions.set(baseLabel, {
            label: baseLabel,
            description: localize('quickPick.excludeFile', 'Exclude file'),
            pattern: baseLabel,
        });
    }

    const segments = baseLabel.split('/');
    if (segments.some((seg) => seg.startsWith('.'))) {
        suggestions.set('**/.*', {
            label: '**/.*',
            description: localize('quickPick.excludeHidden', 'Exclude hidden files'),
            pattern: '**/.*',
        });
    }

    const pickItems: (vscode.QuickPickItem & { pattern?: string; custom?: boolean })[] = Array.from(suggestions.values());
    pickItems.push({
        label: localize('quickPick.enterPattern', 'Enter pattern manually...'),
        description: localize('quickPick.enterPattern.description', 'Provide a custom pattern to append to .securezipignore'),
        alwaysShow: true,
        custom: true,
    });

    const selected = await vscode.window.showQuickPick(pickItems, {
        placeHolder: localize('quickPick.placeholder', 'Add {0} to .securezipignore', relative),
    });

    if (!selected) {
        return;
    }

    let patternValue = selected.pattern;
    if (selected.custom) {
        const firstSuggestion = suggestions.values().next().value;
        patternValue = await vscode.window.showInputBox({
            prompt: localize('input.enterPattern', 'Enter the pattern to write to .securezipignore'),
            value: firstSuggestion?.pattern ?? baseLabel,
            validateInput: (value) => {
                if (!value.trim()) {
                    return localize('validation.patternRequired', 'Enter a pattern.');
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
            vscode.window.showErrorMessage(localize('error.workspaceMissing', 'No workspace folder is open.'));
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
        vscode.window.showInformationMessage(localize('info.patternAddedSingle', 'Added {0} to .securezipignore.', result.added[0]));
    } else if (result.added.length > 1) {
        vscode.window.showInformationMessage(localize('info.patternAddedMultiple', 'Added {0} patterns to .securezipignore.', result.added.length.toString()));
    }

    const duplicates = result.skipped.filter((s) => s.reason === 'duplicate');
    if (duplicates.length > 0) {
        const list = duplicates.map((d) => d.pattern).join(', ');
        vscode.window.showWarningMessage(localize('warning.patternAlreadyExists', 'Already present in .securezipignore: {0}.', list));
    }

    const invalids = result.skipped.filter((s) => s.reason === 'invalid');
    if (invalids.length > 0) {
        const list = invalids.map((d) => d.pattern).join(', ');
        vscode.window.showWarningMessage(localize('warning.patternInvalid', 'Invalid patterns: {0}.', list));
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

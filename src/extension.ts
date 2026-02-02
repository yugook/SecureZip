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
import { registerIgnoreLanguageFeatures } from './ignoreLanguage';
import { SecureZipViewProvider, ensureSecureZipIgnoreFile } from './view';
import { localize } from './nls';
import {
    TargetGroup,
    getDisplayName,
    getWorkspaceRootLabel,
    listWorkspaceFolders,
    resolveDefaultTarget,
    watchGitChanges,
} from './targeting';

type AutoCommitStageMode = 'tracked' | 'all';
type TaggingMode = 'ask' | 'always' | 'never';
type ExportMode = 'default' | 'workspace';

type ExportCommandArgs = {
    root?: string;
    mode?: ExportMode;
};

type ExportTarget =
    | { kind: 'single'; root: string; label: string }
    | { kind: 'workspace'; roots: WorkspaceTarget[]; label: string };

type WorkspaceTarget = {
    root: string;
    label: string;
};

type ZipEntry = {
    absPath: string;
    archivePath: string;
};

interface TagPlan {
    tagName?: string;
    shouldCreate: boolean;
}

function normalizeTaggingMode(value?: string): TaggingMode {
    if (value === 'always' || value === 'never') {
        return value;
    }
    return 'ask';
}

function suggestTagName(base: string, existing: Set<string>): string {
    let counter = 1;
    let candidate = `${base}-${counter}`;
    while (existing.has(candidate)) {
        counter += 1;
        candidate = `${base}-${counter}`;
    }
    return candidate;
}

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

    const disposable = vscode.commands.registerCommand('securezip.export', async (args?: unknown) => {
        try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'SecureZip', cancellable: false }, async (progress) => {
                progress.report({ message: localize('progress.preparing', 'Preparing...') });
                await exportProject(progress, normalizeExportCommandArgs(args));
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

    const openIgnore = vscode.commands.registerCommand('securezip.openIgnoreFile', async (target?: unknown) => {
        const targetUri = target instanceof vscode.Uri && target.scheme === 'file' ? target : undefined;
        const overrideRoot = targetUri
            ? (path.basename(targetUri.fsPath) === '.securezipignore' ? path.dirname(targetUri.fsPath) : targetUri.fsPath)
            : normalizeRootOverride(target);
        const root = overrideRoot ?? await resolveRootForCommand();
        if (!root) {
            const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
            if (!hasWorkspace) {
                vscode.window.showErrorMessage(localize('error.workspaceMissing', 'No workspace folder is open.'));
            }
            return;
        }
        try {
            await ensureSecureZipIgnoreFile(root);
            const documentUri = targetUri ?? vscode.Uri.file(path.join(root, '.securezipignore'));
            const doc = await vscode.workspace.openTextDocument(documentUri);
            await vscode.window.showTextDocument(doc, { preview: false });
            treeProvider?.refresh();
        } catch (err: unknown) {
            console.error('[SecureZip] openIgnoreFile failed', err);
            vscode.window.showErrorMessage(localize('error.openIgnoreFailed', 'Failed to open .securezipignore: {0}', toErrorMessage(err)));
        }
    });

    const createIgnore = vscode.commands.registerCommand('securezip.createIgnoreFile', async (rootOverride?: unknown) => {
        const resolvedRoot = normalizeRootOverride(rootOverride) ?? await resolveRootForCommand();
        if (!resolvedRoot) {
            const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
            if (!hasWorkspace) {
                vscode.window.showErrorMessage(localize('error.workspaceMissing', 'No workspace folder is open.'));
            }
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

    registerIgnoreLanguageFeatures(context);

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
        statusBar.tooltip = localize('statusBar.tooltip', 'Export the project as a ZIP archive');
        statusBar.command = 'securezip.export';
        statusBar.show();
        context.subscriptions.push(statusBar);

        const updateStatusBar = async () => {
            const label = await getStatusBarTargetLabel();
            statusBar.text = `$(package) SecureZip - ${label}`;
        };

        void updateStatusBar();
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                void updateStatusBar();
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                void updateStatusBar();
            }),
        );
        void watchGitChanges(() => {
            void updateStatusBar();
        }).then((disposable) => {
            if (disposable) {
                context.subscriptions.push(disposable);
            }
        });
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

async function exportProject(
    progress: vscode.Progress<{ message?: string }>,
    args?: ExportCommandArgs,
) {
    const exportMode = args?.mode ?? await promptExportMode(args?.root);
    if (!exportMode) {
        return;
    }

    if (exportMode === 'workspace') {
        await exportWorkspaceZip(progress);
        return;
    }

    const target = await resolveSingleTarget(args?.root);
    if (!target) {
        return;
    }
    if (target.kind === 'workspace') {
        await exportWorkspaceZip(progress);
        return;
    }

    await exportSingleRoot(target.root, target.label, progress);
}

function normalizeExportCommandArgs(args: unknown): ExportCommandArgs | undefined {
    if (!args) {
        return undefined;
    }
    if (typeof args === 'string') {
        return { root: args };
    }
    if (args instanceof vscode.Uri) {
        return { root: args.fsPath };
    }
    if (typeof args === 'object') {
        const input = args as { root?: unknown; mode?: unknown };
        const root = input.root instanceof vscode.Uri
            ? input.root.fsPath
            : typeof input.root === 'string'
                ? input.root
                : undefined;
        const mode = input.mode === 'default' || input.mode === 'workspace' ? input.mode : undefined;
        return { root, mode };
    }
    return undefined;
}

async function promptExportMode(preferredRoot?: string): Promise<ExportMode | undefined> {
    type ExportModePick = vscode.QuickPickItem & { value: ExportMode };
    const defaultLabel = localize('export.mode.default', 'VS Code default');
    const workspaceLabel = localize('export.mode.workspace', 'Workspace (all folders)');
    const defaultDescription = preferredRoot
        ? localize('export.mode.default.description', 'Use {0}', getDisplayName(preferredRoot))
        : localize('export.mode.default.description.auto', 'Follow VS Code selection');
    const workspaceDescription = localize('export.mode.workspace.description', 'Combine all workspace folders into one ZIP');

    const selection = await vscode.window.showQuickPick<ExportModePick>(
        [
            { label: defaultLabel, description: defaultDescription, value: 'default' },
            { label: workspaceLabel, description: workspaceDescription, value: 'workspace' },
        ],
        {
            placeHolder: localize('export.mode.prompt', 'Choose export target'),
        },
    );
    return selection?.value;
}

async function resolveSingleTarget(preferredRoot?: string): Promise<ExportTarget | undefined> {
    if (preferredRoot) {
        return { kind: 'single', root: preferredRoot, label: getDisplayName(preferredRoot) };
    }

    const resolved = await resolveDefaultTarget();
    if (resolved.kind === 'repo' || resolved.kind === 'folder') {
        return { kind: 'single', root: resolved.root, label: resolved.label };
    }

    if (resolved.kind === 'ambiguous') {
        return promptForRepositoryChoice(resolved.candidates);
    }

    vscode.window.showErrorMessage(localize('error.workspaceMissing', 'No workspace folder is open.'));
    return undefined;
}

async function promptForRepositoryChoice(candidates: TargetGroup[]): Promise<ExportTarget | undefined> {
    if (candidates.length === 0) {
        return undefined;
    }

    type RepoPick = vscode.QuickPickItem & { value: 'workspace' | 'root'; root?: string };
    const picks: RepoPick[] = [];
    const workspaceTargets = buildWorkspaceTargets();
    if (workspaceTargets.length > 0) {
        picks.push({
            label: localize('export.selectRepository.workspace', 'Workspace ZIP'),
            description: localize('export.selectRepository.workspace.description', 'Export all workspace folders'),
            value: 'workspace',
        });
    }

    for (const candidate of candidates) {
        picks.push({
            label: candidate.label,
            description: candidate.root,
            value: 'root',
            root: candidate.root,
        });
    }

    const selection = await vscode.window.showQuickPick(picks, {
        placeHolder: localize('export.selectRepository.prompt', 'Select a repository to export'),
    });
    if (!selection) {
        return undefined;
    }
    if (selection.value === 'workspace') {
        return {
            kind: 'workspace',
            roots: workspaceTargets,
            label: getWorkspaceRootLabel(),
        };
    }
    if (!selection.root) {
        return undefined;
    }
    return { kind: 'single', root: selection.root, label: getDisplayName(selection.root) };
}

function buildWorkspaceTargets(): WorkspaceTarget[] {
    const folders = listWorkspaceFolders();
    const counts = new Map<string, number>();
    for (const folder of folders) {
        counts.set(folder.label, (counts.get(folder.label) ?? 0) + 1);
    }
    const used = new Map<string, number>();
    return folders.map((folder) => {
        const total = counts.get(folder.label) ?? 0;
        if (total <= 1) {
            return { root: folder.root, label: folder.label };
        }
        const index = (used.get(folder.label) ?? 0) + 1;
        used.set(folder.label, index);
        const suffix = index === 1 ? '' : `-${index}`;
        return { root: folder.root, label: `${folder.label}${suffix}` };
    });
}

async function exportSingleRoot(
    root: string,
    label: string,
    progress: vscode.Progress<{ message?: string }>,
) {
    const cfg = vscode.workspace.getConfiguration('secureZip', vscode.Uri.file(root));
    const tagPrefix = (cfg.get<string>('tagPrefix') || 'export').trim();
    const taggingMode = normalizeTaggingMode(cfg.get<string>('tagging.mode'));
    const commitTemplate = cfg.get<string>('commitMessageTemplate')
        || '[SecureZip] Automated commit for export: ${date} ${time} (Branch: ${branch}, Tag: ${tag})';
    const additionalExcludes = cfg.get<string[]>('additionalExcludes') || [];
    const includeNodeModules = !!cfg.get<boolean>('includeNodeModules');
    const stageModeSetting = cfg.get<AutoCommitStageMode>('autoCommit.stageMode');
    const autoCommitStageMode: AutoCommitStageMode = stageModeSetting === 'all' ? 'all' : 'tracked';

    const now = new Date();
    const fmt = formatDate(now);
    const defaultTag = `${tagPrefix}-${fmt.compact}`; // e.g., export-20250102-153012
    const emptyTagPlan: TagPlan = { tagName: undefined, shouldCreate: false };
    let tagPlan: TagPlan | null = taggingMode === 'never' ? emptyTagPlan : null;

    // Git operations (single-root only)
    const git: SimpleGit = simpleGit({ baseDir: root });
    let branch = 'unknown';
    try {
        const isRepo = await git.checkIsRepo();
        if (isRepo) {
            const promptForTagSelection = async (): Promise<string | undefined> => {
                type TaggingPick = vscode.QuickPickItem & { value: 'default' | 'custom' | 'skip' };
                const TAG_OPTION_DEFAULT = localize('git.taggingOption.default', 'Create default tag');
                const TAG_OPTION_CUSTOM = localize('git.taggingOption.custom', 'Create custom tag');
                const TAG_OPTION_SKIP = localize('git.taggingOption.skip', 'Skip tagging');
                const selection = await vscode.window.showQuickPick<TaggingPick>(
                    [
                        {
                            label: TAG_OPTION_DEFAULT,
                            description: localize('git.taggingOption.defaultDescription', 'Use {0}', defaultTag),
                            value: 'default',
                        },
                        {
                            label: TAG_OPTION_CUSTOM,
                            description: localize('git.taggingOption.customDescription', 'Enter a tag name'),
                            value: 'custom',
                        },
                        {
                            label: TAG_OPTION_SKIP,
                            description: localize('git.taggingOption.skipDescription', 'Continue without tagging'),
                            value: 'skip',
                        },
                    ],
                    {
                        placeHolder: localize('git.taggingPrompt', 'Choose how to tag this export'),
                    },
                );
                if (!selection || selection.value === 'skip') {
                    return undefined;
                }
                if (selection.value === 'custom') {
                    const customTag = await vscode.window.showInputBox({
                        prompt: localize('git.taggingInputPrompt', 'Enter a tag name for this export'),
                        placeHolder: localize('git.taggingInputPlaceholder', 'e.g. {0}', defaultTag),
                        value: defaultTag,
                        validateInput: (value) => {
                            if (!value || !value.trim()) {
                                return localize('validation.tagRequired', 'Tag name is required.');
                            }
                            return undefined;
                        },
                    });
                    if (!customTag || !customTag.trim()) {
                        return undefined;
                    }
                    return customTag.trim();
                }
                return defaultTag;
            };

            const resolveTagConflict = async (desiredTag: string): Promise<TagPlan> => {
                try {
                    const tags = await git.tags();
                    const existing = new Set(tags.all);
                    if (existing.has(desiredTag)) {
                        const suggestedTag = suggestTagName(desiredTag, existing);
                        const USE_EXISTING_OPTION = localize('git.tagConflict.useExisting', 'Use existing tag');
                        const CREATE_NEW_OPTION = localize('git.tagConflict.createNew', 'Create new tag ({0})', suggestedTag);
                        const SKIP_OPTION = localize('git.tagConflict.skip', 'Skip tagging');
                        const conflictChoice = await vscode.window.showWarningMessage(
                            localize('git.tagConflictMessage', 'Tag "{0}" already exists. What would you like to do?', desiredTag),
                            { modal: true },
                            USE_EXISTING_OPTION,
                            CREATE_NEW_OPTION,
                            SKIP_OPTION,
                        );
                        if (conflictChoice === USE_EXISTING_OPTION) {
                            return { tagName: desiredTag, shouldCreate: false };
                        }
                        if (conflictChoice === CREATE_NEW_OPTION) {
                            return { tagName: suggestedTag, shouldCreate: true };
                        }
                        return emptyTagPlan;
                    }
                } catch (e) {
                    console.warn('[SecureZip] tag lookup failed, proceed without conflict check', e);
                }
                return { tagName: desiredTag, shouldCreate: true };
            };

            const resolveTagPlan = async (): Promise<TagPlan> => {
                if (taggingMode === 'never') {
                    return emptyTagPlan;
                }

                let desiredTag: string | undefined = defaultTag;

                if (taggingMode === 'ask') {
                    desiredTag = await promptForTagSelection();
                }

                if (!desiredTag) {
                    return emptyTagPlan;
                }

                return resolveTagConflict(desiredTag);
            };

            const getTagPlan = async (): Promise<TagPlan> => {
                if (tagPlan) {
                    return tagPlan;
                }
                tagPlan = await resolveTagPlan();
                return tagPlan;
            };

            const status = await git.status();
            branch = status.current || branch;

            const hasPendingChanges = !status.isClean();
            let shouldAutoCommit = false;
            let allowTagging = !hasPendingChanges;

            if (hasPendingChanges) {
                const AUTO_COMMIT_OPTION = localize('git.autoCommitOption', 'Commit changes automatically and continue');
                const TAG_ONLY_OPTION = localize('git.tagOnlyOption', 'Create tag only (use latest commit)');
                const SKIP_GIT_OPTION = localize('git.skipOption', 'Proceed without Git actions');
                const baseWarning = localize('git.uncommittedWarning', 'Uncommitted changes detected. Do you want to create an automatic commit before exporting?');
                const detailLines: string[] = [];
                const stageModeLine = autoCommitStageMode === 'all'
                    ? localize('git.autoCommitDetail.modeAll', 'Auto Commit will stage tracked and untracked changes (git add --all).')
                    : localize('git.autoCommitDetail.modeTracked', 'Auto Commit currently stages tracked files only (git add --update).');
                detailLines.push(stageModeLine);
                const untrackedCount = Array.isArray(status.not_added) ? status.not_added.length : 0;
                if (autoCommitStageMode === 'tracked' && untrackedCount > 0) {
                    detailLines.push(localize('git.autoCommitDetail.untracked', '{0} untracked file(s) detected. They will not be included unless you change the Auto Commit stage mode or stage them manually.', untrackedCount));
                }
                const detailBlock = detailLines.length > 0
                    ? `${localize('git.autoCommitDetail.heading', 'Auto Commit details:')}\n- ${detailLines.join('\n- ')}`
                    : '';
                const warningMessage = detailBlock ? `${baseWarning}\n\n${detailBlock}` : baseWarning;
                const options = taggingMode === 'never'
                    ? [AUTO_COMMIT_OPTION, SKIP_GIT_OPTION]
                    : [AUTO_COMMIT_OPTION, TAG_ONLY_OPTION, SKIP_GIT_OPTION];
                const choice = await vscode.window.showWarningMessage(
                    warningMessage,
                    { modal: true },
                    ...options,
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
                    const stageArgs = autoCommitStageMode === 'all' ? ['--all'] : ['--update'];
                    await git.add(stageArgs);
                    const stagedDiff = await git.diff(['--cached']);
                    if (!stagedDiff.trim()) {
                        const noChangesMessage = autoCommitStageMode === 'all'
                            ? localize('warning.noChangesToCommit.all', 'No staged changes were found. There may be nothing left to commit.')
                            : localize('warning.noChangesToCommit', 'No staged changes were found. Only modifications to tracked files are staged automatically (change the Auto Commit stage mode setting to include untracked files).');
                        vscode.window.showWarningMessage(noChangesMessage);
                    } else {
                        const resolvedTagPlan = await getTagPlan();
                        const commitMessage = renderTemplate(commitTemplate, {
                            date: fmt.date,
                            time: fmt.time,
                            datetime: fmt.datetime,
                            branch,
                            tag: resolvedTagPlan.tagName ?? 'none',
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
                const resolvedTagPlan = await getTagPlan();
                if (resolvedTagPlan.tagName && resolvedTagPlan.shouldCreate) {
                    progress.report({ message: localize('progress.gitTagging', 'Git: creating export tag...') });
                    try {
                        await git.addAnnotatedTag(resolvedTagPlan.tagName, localize('git.tagAnnotation', 'SecureZip export: {0}', fmt.datetime));
                    } catch (e) {
                        console.warn('[SecureZip] tag failed, continue without tag', e);
                        vscode.window.showWarningMessage(localize('warning.tagFailed', 'Failed to create tag. Continuing without tagging.'));
                    }
                }
            } else {
                console.log('[SecureZip] skip tagging because working tree remains dirty');
            }
        }
    } catch (e) {
        console.warn('[SecureZip] Git unavailable or failed, continue without Git ops', e);
    }

    const defaultName = `${label}-${fmt.compact}.zip`;
    const targetUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(root, defaultName)),
        filters: { 'ZIP Archive': ['zip'] },
        saveLabel: localize('saveDialog.label', 'Export'),
    });
    if (!targetUri) {
        return;
    }

    progress.report({ message: localize('progress.collectingFiles', 'Collecting files...') });
    const collection = await collectFilesForRoot(root, { additionalExcludes, includeNodeModules });
    void treeProvider?.recordLastExport(root, collection.ignoreSnapshot);

    if (collection.gitOverride) {
        void vscode.window.showWarningMessage(
            localize(
                'warning.gitIncluded',
                'Warning: The .git directory will be included in the export. Double-check before sharing.',
            ),
        );
    }

    if (collection.files.length === 0) {
        throw new Error(localize('error.noFilesToArchive', 'No files were found to include in the archive.'));
    }

    const entries = collection.files.map((file) => ({
        absPath: file,
        archivePath: toArchivePath(path.relative(root, file)),
    }));

    progress.report({ message: localize('progress.creatingZip', 'Creating ZIP archive...') });
    await createZipEntries(entries, targetUri.fsPath);

    vscode.window.showInformationMessage(localize('info.exportCompleted', 'SecureZip completed: {0}', path.basename(targetUri.fsPath)));
}

async function exportWorkspaceZip(progress: vscode.Progress<{ message?: string }>) {
    const targets = buildWorkspaceTargets();
    if (targets.length === 0) {
        throw new Error(localize('error.workspaceMissing', 'No workspace folder is open.'));
    }

    const now = new Date();
    const fmt = formatDate(now);
    const workspaceLabel = getWorkspaceRootLabel();
    const defaultName = `${workspaceLabel}-${fmt.compact}.zip`;
    const targetRoot = targets[0].root;
    const targetUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(targetRoot, defaultName)),
        filters: { 'ZIP Archive': ['zip'] },
        saveLabel: localize('saveDialog.label', 'Export'),
    });
    if (!targetUri) {
        return;
    }

    progress.report({ message: localize('progress.collectingFiles', 'Collecting files...') });
    const entries: ZipEntry[] = [];

    for (const target of targets) {
        const cfg = vscode.workspace.getConfiguration('secureZip', vscode.Uri.file(target.root));
        const additionalExcludes = cfg.get<string[]>('additionalExcludes') || [];
        const includeNodeModules = !!cfg.get<boolean>('includeNodeModules');
        const collection = await collectFilesForRoot(target.root, { additionalExcludes, includeNodeModules });
        void treeProvider?.recordLastExport(target.root, collection.ignoreSnapshot);

        if (collection.gitOverride) {
            void vscode.window.showWarningMessage(
                localize(
                    'warning.gitIncluded',
                    'Warning: The .git directory will be included in the export. Double-check before sharing.',
                ),
            );
        }

        for (const file of collection.files) {
            const rel = toArchivePath(path.relative(target.root, file));
            const archivePath = toArchivePath(path.posix.join(target.label, rel));
            entries.push({ absPath: file, archivePath });
        }
    }

    if (entries.length === 0) {
        throw new Error(localize('error.noFilesToArchive', 'No files were found to include in the archive.'));
    }

    progress.report({ message: localize('progress.creatingZip', 'Creating ZIP archive...') });
    await createZipEntries(entries, targetUri.fsPath);

    vscode.window.showInformationMessage(localize('info.exportCompleted', 'SecureZip completed: {0}', path.basename(targetUri.fsPath)));
}

async function collectFilesForRoot(
    root: string,
    options: { additionalExcludes: string[]; includeNodeModules: boolean },
): Promise<{ files: string[]; ignoreSnapshot: string[]; gitOverride: boolean }> {
    const { globby } = await import('globby');
    const ignoreDefaults = resolveAutoExcludePatterns({ includeNodeModules: options.includeNodeModules });
    const szIgnore = await loadSecureZipIgnore(root);
    const ignoreSnapshot = [
        ...szIgnore.excludes,
        ...szIgnore.includes.map((pattern) => `!${pattern}`),
    ];

    const includePatternSet = new Set(szIgnore.includes);
    if (includePatternSet.has('.git')) {
        includePatternSet.add('.git/**');
    }
    const reincludePatterns = Array.from(includePatternSet);
    const gitOverride = reincludePatterns.some(
        (pattern) => pattern === '.git' || pattern === '.git/**' || pattern.startsWith('.git/'),
    );

    const patterns = ['**/*', '**/.*'];
    const baseIgnore = [...ignoreDefaults, ...options.additionalExcludes, ...szIgnore.excludes];
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

    if (options.includeNodeModules) {
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
    }

    if (reincludePatterns.length > 0) {
        const reincluded = await globby(reincludePatterns, {
            cwd: root,
            dot: true,
            gitignore: true,
            ignore: [],
            onlyFiles: true,
            followSymbolicLinks: false,
            absolute: true,
        });
        for (const file of reincluded) {
            fileSet.add(file);
        }
    }

    return { files: Array.from(fileSet.values()), ignoreSnapshot, gitOverride };
}

function toArchivePath(relative: string): string {
    return relative.replace(/\\+/g, '/');
}

async function getStatusBarTargetLabel(): Promise<string> {
    const resolved = await resolveDefaultTarget();
    if (resolved.kind === 'repo' || resolved.kind === 'folder') {
        return localize('statusBar.target.default', 'Auto: {0}', resolved.label);
    }
    if (resolved.kind === 'ambiguous') {
        return localize('statusBar.target.ambiguous', 'Select target');
    }
    return localize('statusBar.target.none', 'No workspace');
}

function normalizeRootOverride(value: unknown): string | undefined {
    if (!value) {
        return undefined;
    }
    if (typeof value === 'string') {
        return value;
    }
    if (value instanceof vscode.Uri) {
        return value.fsPath;
    }
    if (typeof value === 'object') {
        const input = value as { root?: unknown };
        if (typeof input.root === 'string') {
            return input.root;
        }
        if (input.root instanceof vscode.Uri) {
            return input.root.fsPath;
        }
    }
    return undefined;
}

async function resolveRootForCommand(): Promise<string | undefined> {
    const resolved = await resolveDefaultTarget();
    if (resolved.kind === 'repo' || resolved.kind === 'folder') {
        return resolved.root;
    }
    if (resolved.kind === 'ambiguous') {
        return promptForRootSelection(resolved.candidates);
    }
    return undefined;
}

async function promptForRootSelection(candidates: TargetGroup[]): Promise<string | undefined> {
    if (candidates.length === 0) {
        return undefined;
    }
    type RootPick = vscode.QuickPickItem & { root: string };
    const picks: RootPick[] = candidates.map((candidate) => ({
        label: candidate.label,
        description: candidate.root,
        root: candidate.root,
    }));
    const selection = await vscode.window.showQuickPick(picks, {
        placeHolder: localize('prompt.selectTargetRoot', 'Select a target folder'),
    });
    return selection?.root;
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
        targetRoot = await resolveRootForCommand();
        if (!targetRoot) {
            const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
            if (!hasWorkspace) {
                vscode.window.showErrorMessage(localize('error.workspaceMissing', 'No workspace folder is open.'));
            }
            return undefined;
        }
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

async function createZipEntries(entries: ZipEntry[], outFile: string) {
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

    for (const entry of entries) {
        archive.file(entry.absPath, { name: entry.archivePath });
    }

    await archive.finalize();
    await closed;
}

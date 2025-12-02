import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import simpleGit from 'simple-git';
import { loadSecureZipIgnore, normalizeIgnorePattern } from './ignore';
import { resolveAutoExcludePatterns } from './defaultExcludes';
import { localize } from './nls';
import {
    classifyAutoExcludePatterns,
    type AutoExcludePatternInfo,
    type AutoExcludePresence,
} from './autoExcludeDisplay';

type SectionId = 'guide' | 'actions' | 'preview' | 'recentExports';

const SECTION_DEFS: Record<SectionId, { label: string; icon: string }> = {
    guide: { label: localize('section.guide', 'Status & Guidance'), icon: 'lightbulb' },
    actions: { label: localize('section.actions', 'Actions'), icon: 'rocket' },
    preview: { label: localize('section.preview', '.securezipignore Preview'), icon: 'list-unordered' },
    recentExports: { label: localize('section.recentExports', 'Recent Exports'), icon: 'history' },
};

type LastExportSnapshot = {
    timestamp: number;
    patterns: string[];
};

type PreviewStatus = 'exclude' | 'include' | 'comment' | 'duplicate' | 'auto' | 'git';

type TreeNode =
    | { kind: 'section'; section: SectionId; description?: string }
    | { kind: 'message'; label: string; tooltip?: string }
    | { kind: 'suggestion'; label: string; pattern: string; detail?: string; alreadyExists: boolean; root?: string }
    | { kind: 'preview'; label: string; status: PreviewStatus; tooltip?: string; description?: string }
    | { kind: 'action'; label: string; command: vscode.Command; description?: string; icon?: string; tooltip?: string };

class SecureZipTreeItem extends vscode.TreeItem {
    readonly node: TreeNode;

    constructor(node: TreeNode) {
        let label: string;
        let collapsibleState: vscode.TreeItemCollapsibleState;

        switch (node.kind) {
            case 'section': {
                const meta = SECTION_DEFS[node.section];
                label = meta.label;
                collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                break;
            }
            case 'message':
            case 'suggestion':
            case 'preview':
            case 'action': {
                label = node.label;
                collapsibleState = vscode.TreeItemCollapsibleState.None;
                break;
            }
            default: {
                label = 'Unknown';
                collapsibleState = vscode.TreeItemCollapsibleState.None;
            }
        }

        super(label, collapsibleState);
        this.node = node;

        switch (node.kind) {
            case 'section': {
                const meta = SECTION_DEFS[node.section];
                this.iconPath = new vscode.ThemeIcon(meta.icon);
                if (node.description) {
                    this.description = node.description;
                }
                this.contextValue = `securezip.section.${node.section}`;
                break;
            }
            case 'message': {
                this.tooltip = node.tooltip;
                this.contextValue = 'securezip.message';
                break;
            }
            case 'suggestion': {
                this.tooltip = node.detail;
                this.contextValue = node.alreadyExists ? 'securezip.suggestion.disabled' : 'securezip.suggestion';
                this.iconPath = new vscode.ThemeIcon(node.alreadyExists ? 'pass-filled' : 'add');
                this.description = node.alreadyExists
                    ? localize('suggestion.description.added', 'Added')
                    : localize('suggestion.description.add', 'Add');
                if (!node.alreadyExists) {
                    this.command = {
                        command: 'securezip.addPattern',
                        title: localize('command.addPattern.tooltip', 'Add to .securezipignore'),
                        arguments: node.root ? [node.pattern, node.root] : [node.pattern],
                    };
                }
                break;
            }
            case 'preview': {
                this.tooltip = node.tooltip;
                this.description = node.description;
                this.contextValue = 'securezip.preview';
                if (node.status === 'exclude') {
                    this.iconPath = new vscode.ThemeIcon('diff-removed');
                } else if (node.status === 'include') {
                    this.iconPath = new vscode.ThemeIcon('diff-added');
                } else if (node.status === 'git') {
                    this.iconPath = new vscode.ThemeIcon('circle-slash');
                } else if (node.status === 'auto') {
                    this.iconPath = new vscode.ThemeIcon('shield');
                } else if (node.status === 'duplicate') {
                    this.iconPath = new vscode.ThemeIcon('warning');
                } else {
                    this.iconPath = new vscode.ThemeIcon('comment');
                }
                break;
            }
            case 'action': {
                this.command = node.command;
                this.description = node.description;
                this.tooltip = node.tooltip;
                this.iconPath = new vscode.ThemeIcon(node.icon ?? 'go-to-file');
                this.contextValue = 'securezip.action';
                break;
            }
            default: {
                this.contextValue = 'securezip.unknown';
            }
        }
    }
}

type IgnoreContext = {
    exists: boolean;
    rawLines: string[];
    excludes: Set<string>;
    includes: Set<string>;
};

type ArtifactCandidate = {
    pattern: string;
    description: string;
    path?: string;
    glob?: string;
    type: 'file' | 'dir' | 'glob';
};

const ARTIFACT_CANDIDATES: ArtifactCandidate[] = [
    { pattern: 'node_modules/', description: localize('artifact.nodeModules', 'Node.js dependencies'), path: 'node_modules', type: 'dir' },
    { pattern: 'dist/', description: localize('artifact.dist', 'Build output'), path: 'dist', type: 'dir' },
    { pattern: 'out/', description: localize('artifact.out', 'Build output'), path: 'out', type: 'dir' },
    { pattern: 'build/', description: localize('artifact.build', 'Build output'), path: 'build', type: 'dir' },
    { pattern: 'coverage/', description: localize('artifact.coverage', 'Test coverage reports'), path: 'coverage', type: 'dir' },
    { pattern: 'logs/', description: localize('artifact.logs', 'Log directory'), path: 'logs', type: 'dir' },
    { pattern: 'tmp/', description: localize('artifact.tmp', 'Temporary files'), path: 'tmp', type: 'dir' },
    { pattern: '.env', description: localize('artifact.env', 'Environment variable file'), path: '.env', type: 'file' },
    { pattern: '.env.*', description: localize('artifact.envGlob', 'Environment variable files'), glob: '.env.*', type: 'glob' },
    { pattern: 'coverage-final.json', description: localize('artifact.coverageFinal', 'NYC coverage report'), path: 'coverage-final.json', type: 'file' },
    { pattern: '**/*.log', description: localize('artifact.logsGlob', 'Log files'), glob: '**/*.log', type: 'glob' },
    { pattern: '**/*.pem', description: localize('artifact.pem', 'Certificates or private keys'), glob: '**/*.pem', type: 'glob' },
    { pattern: '**/*.key', description: localize('artifact.key', 'Private keys'), glob: '**/*.key', type: 'glob' },
];

const WATCH_PATTERN = '**/.securezipignore';

const LAST_EXPORT_STATE_KEY = 'securezip.lastExport';

const GIT_IGNORE_PREVIEW_LIMIT = 5;
const GIT_CHECK_IGNORE_PATH_LIMIT = 200;

export class SecureZipViewProvider implements vscode.TreeDataProvider<SecureZipTreeItem>, vscode.Disposable {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    private readonly disposables: vscode.Disposable[] = [];
    private ignoreCache: { root: string; context: IgnoreContext } | undefined;
    private treeView: vscode.TreeView<SecureZipTreeItem> | undefined;
    private readonly rootItems = new Map<SectionId, SecureZipTreeItem>();

    constructor(private readonly context: vscode.ExtensionContext) {
        const watcher = vscode.workspace.createFileSystemWatcher(WATCH_PATTERN);
        watcher.onDidChange(() => this.refresh());
        watcher.onDidCreate(() => this.refresh());
        watcher.onDidDelete(() => this.refresh());
        this.disposables.push(watcher);

        this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()));
    }

    dispose() {
        this.ignoreCache = undefined;
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.onDidChangeTreeDataEmitter.dispose();
        this.rootItems.clear();
    }

    refresh() {
        this.ignoreCache = undefined;
        this.rootItems.clear();
        this.onDidChangeTreeDataEmitter.fire();
    }

    attachTreeView(view: vscode.TreeView<SecureZipTreeItem>) {
        this.treeView = view;
    }

    revealSection(section: SectionId) {
        const item = this.rootItems.get(section);
        if (!item || !this.treeView) {
            return;
        }
        void this.treeView.reveal(item, { expand: true, focus: true });
    }

    async recordLastExport(patterns: string[]) {
        const sanitized = Array.from(new Set(patterns.map((p) => p.trim()).filter(Boolean)));
        await this.context.workspaceState.update(LAST_EXPORT_STATE_KEY, {
            timestamp: Date.now(),
            patterns: sanitized,
        } satisfies LastExportSnapshot);
        this.refresh();
    }

    getTreeItem(element: SecureZipTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SecureZipTreeItem): Promise<SecureZipTreeItem[]> {
        const workspaceFolder = this.primaryWorkspaceFolder;
        if (!workspaceFolder) {
            return [
                new SecureZipTreeItem({
                    kind: 'message',
                    label: localize('view.noWorkspace', 'No workspace folder is open.'),
                }),
            ];
        }

        if (!element) {
            const sections: SectionId[] = ['guide', 'actions', 'preview', 'recentExports'];
            const items = sections.map((section) => {
                const node: TreeNode = { kind: 'section', section };
                const item = new SecureZipTreeItem(node);
                this.rootItems.set(section, item);
                return item;
            });
            return items;
        }

        if (element.node.kind !== 'section') {
            return [];
        }

        switch (element.node.section) {
            case 'guide':
                return this.buildGuideItems(workspaceFolder);
            case 'actions':
                return this.buildActionItems(workspaceFolder);
            case 'preview':
                return this.buildPreviewItems(workspaceFolder);
            case 'recentExports':
                return this.buildRecentExportItems(workspaceFolder);
            default:
                return [];
        }
    }

    private get primaryWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.workspaceFolders?.[0];
    }

    private formatTimestamp(timestamp: number): string {
        const d = new Date(timestamp);
        const pad = (value: number) => value.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    private async ensureIgnoreContext(root: string): Promise<IgnoreContext> {
        if (this.ignoreCache && this.ignoreCache.root === root) {
            return this.ignoreCache.context;
        }

        const filename = path.join(root, '.securezipignore');
        let raw = '';
        let exists = false;
        try {
            raw = await fs.promises.readFile(filename, 'utf8');
            exists = true;
        } catch (err: any) {
            if (err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err;
            }
        }

        const parsed = await loadSecureZipIgnore(root);
        const context: IgnoreContext = {
            exists,
            rawLines: raw.length > 0 ? raw.split(/\r?\n/) : [],
            excludes: new Set(parsed.excludes.map((p) => p.trim())),
            includes: new Set(parsed.includes.map((p) => p.trim())),
        };

        this.ignoreCache = { root, context };
        return context;
    }

    private async buildGuideItems(workspaceFolder: vscode.WorkspaceFolder): Promise<SecureZipTreeItem[]> {
        const root = workspaceFolder.uri.fsPath;
        const context = await this.ensureIgnoreContext(root);
        const snapshot = this.context.workspaceState.get<LastExportSnapshot>(LAST_EXPORT_STATE_KEY);
        const items: SecureZipTreeItem[] = [];
        let pendingTasks = 0;
        let warningCount = 0;

        if (!context.exists) {
            pendingTasks += 1;
            items.push(
                new SecureZipTreeItem({
                    kind: 'action',
                    label: localize('guide.missingIgnore', '.securezipignore not found'),
                    description: localize('guide.missingIgnore.action', 'Create now'),
                    icon: 'new-file',
                    command: {
                        command: 'securezip.createIgnoreFile',
                        title: localize('guide.missingIgnore.commandTitle', 'Create .securezipignore'),
                        arguments: [root],
                    },
                }),
            );
        }

        if (this.hasGitOverride(context)) {
            warningCount += 1;
            items.push(
                new SecureZipTreeItem({
                    kind: 'message',
                    label: localize('guide.gitOverrideWarning', 'Warning: .git override active'),
                    tooltip: localize('guide.gitOverrideWarning.tooltip', 'The .git directory will be included in exports. Review repository history before sharing.'),
                }),
            );
        }

        const suggestions = await this.collectArtifactSuggestions(root, context);
        if (suggestions.length > 0) {
            pendingTasks += 1;
            const patterns = suggestions.map((candidate) => candidate.pattern);
            items.push(
                new SecureZipTreeItem({
                    kind: 'action',
                    label: localize('guide.pendingSuggestions', '{0} recommended patterns are not excluded', suggestions.length.toString()),
                    description: localize('guide.pendingSuggestions.action', 'Exclude all'),
                    icon: 'lightbulb-autofix',
                    tooltip: localize('guide.pendingSuggestions.tooltip', 'Add all recommended patterns to .securezipignore'),
                    command: {
                        command: 'securezip.applySuggestedPatterns',
                        title: localize('guide.pendingSuggestions.commandTitle', 'Add recommended patterns to .securezipignore'),
                        arguments: [patterns, root],
                    },
                }),
            );

            for (const candidate of suggestions) {
                items.push(
                    new SecureZipTreeItem({
                        kind: 'suggestion',
                        label: candidate.pattern,
                        pattern: candidate.pattern,
                        detail: candidate.description,
                        alreadyExists: false,
                        root,
                    }),
                );
            }
        }

        if (snapshot) {
            const diffCount = this.countIgnoreDiffSinceSnapshot(context, snapshot);
            if (diffCount > 0) {
                pendingTasks += 1;
                items.push(
                    new SecureZipTreeItem({
                        kind: 'message',
                        label: localize('guide.diffSinceExport', '{0} changes since the last export', diffCount.toString()),
                        tooltip: localize('guide.diffSinceExport.tooltip', 'Review the changes in the preview section of the SecureZip view.'),
                    }),
                );
            }
        }

        if (items.length === 0) {
            items.push(
                new SecureZipTreeItem({
                    kind: 'message',
                    label: localize('guide.nothingPending', 'No follow-up actions required'),
                }),
            );
        }

        const guideSection = this.rootItems.get('guide');
        if (guideSection) {
            if (warningCount > 0) {
                const total = pendingTasks + warningCount;
                guideSection.description = total > 1
                    ? localize('guide.summary.warningCount', 'Warning · {0} items', total.toString())
                    : localize('guide.summary.warning', 'Warning');
            } else {
                guideSection.description = pendingTasks > 0
                    ? localize('guide.summary.pending', '{0} tasks', pendingTasks.toString())
                    : localize('guide.summary.ok', 'All clear');
            }
        }

        return items;
    }

    private async buildRecentExportItems(workspaceFolder: vscode.WorkspaceFolder): Promise<SecureZipTreeItem[]> {
        const snapshot = this.context.workspaceState.get<LastExportSnapshot>(LAST_EXPORT_STATE_KEY);
        if (!snapshot) {
            const recentSection = this.rootItems.get('recentExports');
            if (recentSection) {
                recentSection.description = localize('recent.none', 'No history');
            }
            return [
                new SecureZipTreeItem({
                    kind: 'message',
                    label: localize('recent.noneMessage', 'No export history yet'),
                }),
            ];
        }

        const description = this.formatTimestamp(snapshot.timestamp);
        const recentSection = this.rootItems.get('recentExports');
        if (recentSection) {
            recentSection.description = description;
        }
        return [
            new SecureZipTreeItem({
                kind: 'message',
                label: localize('recent.latest', 'Latest export: {0}', description),
                tooltip: snapshot.patterns.length > 0 ? snapshot.patterns.join('\n') : undefined,
            }),
        ];
    }

    private async collectArtifactSuggestions(root: string, context: IgnoreContext): Promise<ArtifactCandidate[]> {
        const suggestions: ArtifactCandidate[] = [];
        for (const candidate of ARTIFACT_CANDIDATES) {
            const exists = await this.candidateExists(root, candidate);
            if (!exists) {
                continue;
            }

            const normalized = normalizeIgnorePattern(candidate.pattern);
            if (!normalized) {
                continue;
            }

            const targetSet = normalized.negated ? context.includes : context.excludes;
            const alreadyExists = targetSet.has(normalized.pattern);
            if (alreadyExists) {
                continue;
            }

            suggestions.push(candidate);
        }
        return suggestions;
    }

    private countIgnoreDiffSinceSnapshot(context: IgnoreContext, snapshot: LastExportSnapshot): number {
        const snapshotKeys = new Set<string>();
        for (const pattern of snapshot.patterns) {
            const info = normalizeIgnorePattern(pattern);
            if (!info) {
                continue;
            }
            const key = `${info.negated ? '!' : ''}${info.pattern}`;
            snapshotKeys.add(key);
        }

        const currentKeys = new Set<string>();
        for (const line of context.rawLines) {
            const info = normalizeIgnorePattern(line);
            if (!info) {
                continue;
            }
            const key = `${info.negated ? '!' : ''}${info.pattern}`;
            currentKeys.add(key);
        }

        let diffCount = 0;
        for (const key of currentKeys) {
            if (!snapshotKeys.has(key)) {
                diffCount += 1;
            }
        }
        for (const key of snapshotKeys) {
            if (!currentKeys.has(key)) {
                diffCount += 1;
            }
        }

        return diffCount;
    }

    private hasGitOverride(context: IgnoreContext): boolean {
        for (const pattern of context.includes) {
            if (pattern === '.git' || pattern === '.git/**' || pattern.startsWith('.git/')) {
                return true;
            }
        }
        return false;
    }

    private async buildPreviewItems(workspaceFolder: vscode.WorkspaceFolder): Promise<SecureZipTreeItem[]> {
        const root = workspaceFolder.uri.fsPath;
        const context = await this.ensureIgnoreContext(root);
        const previewSection = this.rootItems.get('preview');
        const autoResult = await this.buildAutoExcludePreviewItems(workspaceFolder, context);
        const autoItems = autoResult.items;
        const gitItems = await this.buildGitIgnorePreviewItems(workspaceFolder);
        let hiddenIgnoreCount = 0;
        let visibleIgnoreCount = 0;

        const presenceCache = new Map<string, Promise<AutoExcludePresence>>();
        const hasGlobPattern = (pattern: string): boolean => /[\\*?[\]{]/.test(pattern);
        const normalizeRelativePattern = (pattern: string): string => {
            const trimmed = pattern.startsWith('/') ? pattern.slice(1) : pattern;
            return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
        };

        const resolvePresence = (pattern: string): Promise<AutoExcludePresence> => {
            const cached = presenceCache.get(pattern);
            if (cached) {
                return cached;
            }

            const promise = (async () => {
                const relative = normalizeRelativePattern(pattern);
                const DIRECTORY_SUFFIX = '/**';

                const statTarget = relative.endsWith(DIRECTORY_SUFFIX)
                    ? relative.slice(0, -DIRECTORY_SUFFIX.length)
                    : relative;

                if (!hasGlobPattern(relative) || (!hasGlobPattern(statTarget) && relative.endsWith(DIRECTORY_SUFFIX))) {
                    try {
                        const full = path.join(root, statTarget);
                        const stats = await fs.promises.stat(full);
                        const label = stats.isDirectory() ? `${statTarget}/` : statTarget;
                        return { exists: true, examples: [label], hasMore: false };
                    } catch {
                        // Fall back to glob search in case the pattern uses ignore semantics beyond stat.
                    }
                }

                try {
                    const { globbyStream } = await import('globby');
                    const examples: string[] = [];
                    let hasMore = false;
                    const SAMPLE_LIMIT = 3;
                    for await (const entry of globbyStream(relative || '.', {
                        cwd: root,
                        dot: true,
                        gitignore: false,
                        followSymbolicLinks: false,
                        unique: true,
                    })) {
                        const value = typeof entry === 'string' ? entry : String((entry as { path?: string }).path ?? '');
                        if (!value) {
                            continue;
                        }
                        if (examples.length < SAMPLE_LIMIT) {
                            examples.push(value);
                        } else {
                            hasMore = true;
                            break;
                        }
                    }
                    const exists = examples.length > 0 || hasMore;
                    return { exists, examples, hasMore };
                } catch {
                    return { exists: false, examples: [], hasMore: false };
                }
            })();

            presenceCache.set(pattern, promise);
            return promise;
        };

        if (!context.exists) {
            if (previewSection) {
                const totalVisible = autoItems.length + gitItems.length;
                const totalHidden = autoResult.hiddenCount;
                previewSection.description = totalHidden > 0
                    ? localize('preview.summary.visibleHidden', '{0} shown · {1} hidden', totalVisible.toString(), totalHidden.toString())
                    : localize('preview.status.notCreated', 'Not created');
            }
            const items: SecureZipTreeItem[] = [];
            const totalHidden = autoResult.hiddenCount;
            if (totalHidden > 0) {
                items.push(
                    new SecureZipTreeItem({
                        kind: 'message',
                        label: localize('preview.hiddenRules', '{0} unmatched rules hidden', totalHidden.toString()),
                        tooltip: localize(
                            'preview.hiddenRules.tooltip',
                            'Rules with no matching files are hidden. Create matching files or adjust patterns to show them.',
                        ),
                    }),
                );
            }
            items.push(
                new SecureZipTreeItem({
                    kind: 'message',
                    label: localize('preview.message.notCreated', 'The .securezipignore file has not been created yet.'),
                }),
                ...autoItems,
                ...gitItems,
            );
            return items;
        }

        const occurrences = new Map<string, number>();
        const seen = new Map<string, number>();
        const items: SecureZipTreeItem[] = [...autoItems, ...gitItems];

        for (const line of context.rawLines) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            const info = normalizeIgnorePattern(line);
            if (!info) {
                continue;
            }

            const presence = await resolvePresence(info.pattern);
            if (!presence.exists) {
                hiddenIgnoreCount += 1;
                continue;
            }

            const key = `${info.negated ? '!' : ''}${info.pattern}`;
            const seenCount = seen.get(key) ?? 0;
            const duplicateCount = (occurrences.get(key) ?? 0) + 1;
            occurrences.set(key, duplicateCount);
            seen.set(key, seenCount + 1);
            visibleIgnoreCount += 1;

            const hasReinclude = !info.negated && context.includes.has(info.pattern);

            let description = info.negated
                ? localize('preview.reinclude', 'Re-include')
                : hasReinclude
                    ? localize('preview.excludeWithInclude', 'Exclude (re-include present)')
                    : localize('preview.exclude', 'Exclude');
            let tooltip = info.negated ? `!${info.pattern}` : info.pattern;
            let status: PreviewStatus = info.negated ? 'include' : 'exclude';

            if (duplicateCount > 1 && seenCount > 0) {
                status = 'duplicate';
                description = localize('preview.duplicate', 'Duplicate');
            }

            items.push(
                new SecureZipTreeItem({
                    kind: 'preview',
                    label: line,
                    status,
                    tooltip,
                    description,
                }),
            );
        }

        const totalVisible = visibleIgnoreCount + autoResult.visibleCount + gitItems.length;
        const totalHidden = hiddenIgnoreCount + autoResult.hiddenCount;

        if (previewSection) {
            previewSection.description = totalHidden > 0
                ? localize('preview.summary.visibleHidden', '{0} shown · {1} hidden', totalVisible.toString(), totalHidden.toString())
                : localize('preview.summary.visible', '{0} shown', totalVisible.toString());
        }

        if (totalHidden > 0) {
            items.unshift(
                new SecureZipTreeItem({
                    kind: 'message',
                    label: localize('preview.hiddenRules', '{0} unmatched rules hidden', totalHidden.toString()),
                    tooltip: localize(
                        'preview.hiddenRules.tooltip',
                        'Rules with no matching files are hidden. Create matching files or adjust patterns to show them.',
                    ),
                }),
            );
        }

        return items.length > 0
            ? items
            : [
                  new SecureZipTreeItem({
                      kind: 'message',
                      label: localize('preview.message.empty', '.securezipignore is empty'),
                  }),
              ];
    }

    private async buildAutoExcludePreviewItems(
        workspaceFolder: vscode.WorkspaceFolder,
        context: IgnoreContext,
    ): Promise<{ items: SecureZipTreeItem[]; hiddenCount: number; visibleCount: number }> {
        const root = workspaceFolder.uri.fsPath;
        const cfg = vscode.workspace.getConfiguration('secureZip', workspaceFolder.uri);
        const includeNodeModules = !!cfg.get<boolean>('includeNodeModules');
        const autoPatterns = resolveAutoExcludePatterns({ includeNodeModules });
        if (autoPatterns.length === 0) {
            return { items: [], hiddenCount: 0, visibleCount: 0 };
        }

        const includePatterns = context.includes;

        const SAMPLE_LIMIT = 3;
        const presenceCache = new Map<string, Promise<AutoExcludePresence>>();
        let rootDirEntriesPromise: Promise<string[]> | undefined;

        const getRootDirEntries = async (): Promise<string[]> => {
            if (!rootDirEntriesPromise) {
                rootDirEntriesPromise = fs.promises.readdir(root).catch(() => []);
            }
            return rootDirEntriesPromise;
        };

        const checkPath = async (relative: string): Promise<AutoExcludePresence> => {
            try {
                const full = path.join(root, relative);
                const stats = await fs.promises.stat(full);
                const label = stats.isDirectory() ? `${relative}/` : relative;
                return { exists: true, examples: [label], hasMore: false };
            } catch {
                return { exists: false, examples: [], hasMore: false };
            }
        };

        const checkRootEnvVariants = async (): Promise<AutoExcludePresence> => {
            const entries = await getRootDirEntries();
            const matches = entries.filter((name) => name.startsWith('.env.') && name.length > '.env.'.length);
            if (matches.length === 0) {
                return { exists: false, examples: [], hasMore: false };
            }
            const examples = matches.slice(0, SAMPLE_LIMIT);
            return { exists: true, examples, hasMore: matches.length > SAMPLE_LIMIT };
        };

        const checkGlob = async (
            pattern: string,
            options?: { onlyFiles?: boolean },
        ): Promise<AutoExcludePresence> => {
            try {
                const { globbyStream } = await import('globby');
                const streamOptions: { [key: string]: unknown } = {
                    cwd: root,
                    dot: true,
                    gitignore: false,
                    followSymbolicLinks: false,
                    unique: true,
                };
                if (typeof options?.onlyFiles === 'boolean') {
                    streamOptions.onlyFiles = options.onlyFiles;
                }
                const examples: string[] = [];
                let hasMore = false;
                for await (const entry of globbyStream(pattern, streamOptions)) {
                    const value = typeof entry === 'string' ? entry : String((entry as { path?: string }).path ?? '');
                    if (!value) {
                        continue;
                    }
                    if (examples.length < SAMPLE_LIMIT) {
                        examples.push(value);
                    } else {
                        hasMore = true;
                        break;
                    }
                }
                const exists = examples.length > 0 || hasMore;
                return { exists, examples, hasMore };
            } catch {
                return { exists: false, examples: [], hasMore: false };
            }
        };

        const resolvePresence = (pattern: string): Promise<AutoExcludePresence> => {
            const cached = presenceCache.get(pattern);
            if (cached) {
                return cached;
            }
            const promise = (async () => {
                if (pattern === '.git' || pattern === '.git/**') {
                    return checkPath('.git');
                }
                if (pattern === '.vscode' || pattern === '.vscode/**') {
                    return checkPath('.vscode');
                }
                if (pattern === 'node_modules/**') {
                    return checkPath('node_modules');
                }
                if (pattern === '.env') {
                    return checkPath('.env');
                }
                if (pattern === '.env.*') {
                    return checkRootEnvVariants();
                }
                if (pattern === '**/.env' || pattern === '**/.env.*') {
                    return checkGlob(pattern, { onlyFiles: true });
                }
                if (
                    pattern === '**/*.pem' ||
                    pattern === '**/*.key' ||
                    pattern === '**/*.crt' ||
                    pattern === '**/*.pfx'
                ) {
                    return checkGlob(pattern, { onlyFiles: true });
                }
                return checkGlob(pattern);
            })();
            presenceCache.set(pattern, promise);
            return promise;
        };

        const patternInfos: AutoExcludePatternInfo[] = [];

        for (const pattern of autoPatterns) {
            const normalized = normalizeIgnorePattern(pattern);
            const baseKey = normalized?.pattern ?? pattern;
            const candidateKeys = new Set<string>([baseKey]);
            if (baseKey.endsWith('/**')) {
                candidateKeys.add(baseKey.slice(0, -3));
            } else if (!baseKey.includes('*')) {
                candidateKeys.add(`${baseKey}/**`);
            }
            if (baseKey.startsWith('**/')) {
                candidateKeys.add(baseKey.slice(3));
            }
            const reincluded =
                Array.from(candidateKeys).some((key) => includePatterns.has(key)) ||
                isAutoExcludePatternReincluded(baseKey, includePatterns);
            const presence = await resolvePresence(pattern);
            patternInfos.push({ pattern, reincluded, presence });
        }

        const orderedInfos = classifyAutoExcludePatterns(patternInfos);

        const items: SecureZipTreeItem[] = [];
        let hiddenCount = 0;
        let visibleCount = 0;

        for (const info of orderedInfos) {
            const { pattern, reincluded, presence } = info;
            if (!presence.exists) {
                hiddenCount += 1;
                continue;
            }
            visibleCount += 1;
            let description: string;
            if (reincluded) {
                description = localize('preview.autoExclude.reincluded', 'Auto exclude: re-included');
            } else if (presence.exists) {
                description = localize('preview.autoExclude.active', 'Auto exclude: active');
            } else {
                description = localize('preview.autoExclude.inactive', 'Auto exclude: no matches');
            }

            let tooltip = reincluded
                ? localize(
                      'preview.autoExclude.reincluded.tooltip',
                      'A matching !pattern in .securezipignore re-includes this path.',
                  )
                : localize(
                      'preview.autoExclude.tooltip',
                      'SecureZip excludes this automatically before .securezipignore runs.',
                  );

            if (presence.exists) {
                if (presence.examples.length > 0) {
                    const exampleList = presence.examples.map((example) => `• ${example}`).join('\n');
                    tooltip += `\n\n${localize(
                        'preview.autoExclude.tooltip.matches',
                        'Detected examples:\n{0}',
                        exampleList,
                    )}`;
                } else {
                    tooltip += `\n\n${localize(
                        'preview.autoExclude.tooltip.matches.noExample',
                        'Matching paths detected.',
                    )}`;
                }
                if (presence.hasMore) {
                    tooltip += `\n${localize(
                        'preview.autoExclude.tooltip.matches.more',
                        'Additional matches are not listed.',
                    )}`;
                }
            } else {
                tooltip += `\n\n${localize(
                    'preview.autoExclude.tooltip.none',
                    'No matching paths detected yet.',
                )}`;
            }

            items.push(
                new SecureZipTreeItem({
                    kind: 'preview',
                    label: pattern,
                    status: 'auto',
                    tooltip,
                    description,
                }),
            );
        }

        return { items, hiddenCount, visibleCount };
    }

    private async buildGitIgnorePreviewItems(workspaceFolder: vscode.WorkspaceFolder): Promise<SecureZipTreeItem[]> {
        const root = workspaceFolder.uri.fsPath;
        const git = simpleGit(root);

        let isRepo = false;
        try {
            isRepo = await git.checkIsRepo();
        } catch {
            return [];
        }
        if (!isRepo) {
            return [];
        }

        let statusRaw = '';
        try {
            statusRaw = await git.raw(['status', '--ignored', '-s']);
        } catch {
            return [];
        }

        const ignoredPathSet = new Set<string>();
        const statusLines = statusRaw.split(/\r?\n/);
        for (const line of statusLines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('!!')) {
                continue;
            }
            const match = /^!!\s*(.+)$/.exec(trimmed);
            if (!match) {
                continue;
            }
            const candidate = match[1].trim();
            if (candidate) {
                ignoredPathSet.add(candidate);
            }
        }

        if (ignoredPathSet.size === 0) {
            return [];
        }

        const ignoredPaths = Array.from(ignoredPathSet);
        const truncatedByPathLimit = ignoredPaths.length > GIT_CHECK_IGNORE_PATH_LIMIT;
        const checkArgs = ['check-ignore', '-v', ...ignoredPaths.slice(0, GIT_CHECK_IGNORE_PATH_LIMIT)];

        let checkOutput = '';
        try {
            checkOutput = await git.raw(checkArgs);
        } catch (err: any) {
            const fallback =
                (typeof err?.stdout === 'string' && err.stdout) ||
                (typeof err?.git?.stdout === 'string' && err.git.stdout);
            if (fallback) {
                checkOutput = fallback;
            } else {
                return [];
            }
        }

        if (!checkOutput.trim()) {
            return [];
        }

        type GitPatternEntry = {
            pattern: string;
            sourceFile: string;
            lineNumber: string;
            count: number;
            examples: string[];
        };

        const patternMap = new Map<string, GitPatternEntry>();

        for (const raw of checkOutput.split(/\r?\n/)) {
            if (!raw) {
                continue;
            }
            const tabIndex = raw.indexOf('\t');
            if (tabIndex === -1) {
                continue;
            }
            const meta = raw.slice(0, tabIndex);
            const target = raw.slice(tabIndex + 1);
            if (!meta || !target) {
                continue;
            }
            const metaParts = meta.split(':');
            if (metaParts.length < 3) {
                continue;
            }
            const sourceFile = metaParts[0];
            const lineNumber = metaParts[1];
            const pattern = metaParts.slice(2).join(':');
            const key = `${sourceFile}:${lineNumber}:${pattern}`;
            let entry = patternMap.get(key);
            if (!entry) {
                entry = {
                    pattern,
                    sourceFile,
                    lineNumber,
                    count: 0,
                    examples: [],
                };
                patternMap.set(key, entry);
            }
            entry.count += 1;
            if (entry.examples.length < 3) {
                entry.examples.push(target);
            }
        }

        if (patternMap.size === 0) {
            return [];
        }

        const entries = Array.from(patternMap.values()).sort(
            (a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern),
        );
        const totalPatterns = entries.length;
        const totalMatches = entries.reduce((sum, entry) => sum + entry.count, 0);
        const displayEntries = entries.slice(0, GIT_IGNORE_PREVIEW_LIMIT);
        const remainingPatterns = totalPatterns - displayEntries.length;

        const headerTooltip = truncatedByPathLimit
            ? localize(
                  'preview.gitIgnore.header.tooltip.truncated',
                  'Showing up to {0} .gitignore patterns currently hiding {1} paths (truncated).',
                  displayEntries.length.toString(),
                  totalMatches.toString(),
              )
            : localize(
                  'preview.gitIgnore.header.tooltip',
                  'Showing up to {0} .gitignore patterns currently hiding {1} paths.',
                  displayEntries.length.toString(),
                  totalMatches.toString(),
              );

        const items: SecureZipTreeItem[] = [
            new SecureZipTreeItem({
                kind: 'message',
                label: localize('preview.gitIgnore.header', '.gitignore auto excludes ({0})', totalPatterns.toString()),
                tooltip: headerTooltip,
            }),
        ];

        for (const entry of displayEntries) {
            const examplesLabel = entry.examples.length > 0 ? entry.examples.join(', ') : '—';
            items.push(
                new SecureZipTreeItem({
                    kind: 'preview',
                    label: entry.pattern,
                    status: 'git',
                    description: localize(
                        'preview.gitIgnore.description',
                        '.gitignore auto exclude ({0})',
                        entry.count.toString(),
                    ),
                    tooltip: localize(
                        'preview.gitIgnore.tooltip',
                        'Source: {0}:{1}\nExample: {2}',
                        entry.sourceFile,
                        entry.lineNumber,
                        examplesLabel,
                    ),
                }),
            );
        }

        if (remainingPatterns > 0) {
            items.push(
                new SecureZipTreeItem({
                    kind: 'message',
                    label: localize(
                        'preview.gitIgnore.more',
                        '+{0} more patterns hidden',
                        remainingPatterns.toString(),
                    ),
                }),
            );
        }

        return items;
    }

    private async buildActionItems(workspaceFolder: vscode.WorkspaceFolder): Promise<SecureZipTreeItem[]> {
        const root = workspaceFolder.uri.fsPath;
        const openIgnoreCommand: vscode.Command = {
            command: 'securezip.openIgnoreFile',
            title: localize('actions.openIgnore.title', 'Open .securezipignore'),
            arguments: [vscode.Uri.file(path.join(root, '.securezipignore'))],
        };

        const items: SecureZipTreeItem[] = [
            new SecureZipTreeItem({
                kind: 'action',
                label: localize('actions.export.label', 'Export'),
                description: localize('actions.export.description', 'Create ZIP archive'),
                icon: 'package',
                command: {
                    command: 'securezip.export',
                    title: 'SecureZip: Export Project',
                },
            }),
            new SecureZipTreeItem({
                kind: 'action',
                label: localize('actions.openIgnore.label', 'Open .securezipignore'),
                command: openIgnoreCommand,
                description: localize('actions.openIgnore.description', 'Edit the file in the editor'),
            }),
        ];

        return items;
    }

    private async candidateExists(root: string, candidate: ArtifactCandidate): Promise<boolean> {
        if (candidate.path) {
            const target = path.join(root, candidate.path);
            try {
                const stats = await fs.promises.stat(target);
                if (candidate.type === 'dir') {
                    return stats.isDirectory();
                }
                return stats.isFile();
            } catch {
                return false;
            }
        }

        if (candidate.glob) {
            const { globby } = await import('globby');
            const matches = await globby(candidate.glob, {
                cwd: root,
                dot: true,
                onlyFiles: candidate.type !== 'dir',
                onlyDirectories: candidate.type === 'dir',
                followSymbolicLinks: false,
                gitignore: false,
                deep: 2,
            });
            return matches.length > 0;
        }

        return false;
    }
}

function isAutoExcludePatternReincluded(pattern: string, includes: Set<string>): boolean {
    const autoExtensionMatch = pattern.startsWith('**/*.') ? pattern.slice(4) : undefined;

    for (const include of includes) {
        if (!include) {
            continue;
        }

        if (include === pattern) {
            return true;
        }

        if (pattern.endsWith('/**')) {
            const base = pattern.slice(0, -3);
            if (include === base || include.startsWith(`${base}/`) || include.startsWith(`${base}.`)) {
                return true;
            }
        }

        if (!pattern.includes('*')) {
            if (include === pattern || include.startsWith(`${pattern}/`) || include.startsWith(`${pattern}.`)) {
                return true;
            }
        }

        if (include.endsWith('/**')) {
            const includeBase = include.slice(0, -3);
            if (
                includeBase.length > 0 &&
                (pattern === includeBase || pattern.startsWith(`${includeBase}/`) || pattern.startsWith(`${includeBase}.`))
            ) {
                return true;
            }
        }

        if (pattern === '.env' || pattern === '**/.env') {
            if (
                include === '.env' ||
                include === '**/.env' ||
                include.endsWith('/.env') ||
                include.startsWith('.env')
            ) {
                return true;
            }
        }

        if (pattern === '.env.*' || pattern === '**/.env.*') {
            if (
                include === '.env' ||
                include === '.env.*' ||
                include === '**/.env.*' ||
                include.startsWith('.env.') ||
                include.includes('/.env.')
            ) {
                return true;
            }
        }

        if (pattern.startsWith('**/.env.') && include.includes('/.env.')) {
            return true;
        }

        if (autoExtensionMatch) {
            if (include === `**/*${autoExtensionMatch}` || include.endsWith(autoExtensionMatch)) {
                return true;
            }
        }
    }

    return false;
}

// Default template that hides the ignore file from exported archives.
const DEFAULT_IGNORE_TEMPLATE = '# Example: exclude this file itself by default\n.securezipignore\n';

export async function ensureSecureZipIgnoreFile(root: string): Promise<void> {
    const file = path.join(root, '.securezipignore');
    try {
        await fs.promises.access(file, fs.constants.F_OK);
    } catch (err: any) {
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            await fs.promises.writeFile(file, DEFAULT_IGNORE_TEMPLATE, { encoding: 'utf8' });
        } else {
            throw err;
        }
    }
}

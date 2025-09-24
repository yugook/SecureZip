import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { loadSecureZipIgnore, normalizeIgnorePattern } from './ignore';

type SectionId = 'lastExport' | 'workspaceSuggestions' | 'preview' | 'actions';

const SECTION_DEFS: Record<SectionId, { label: string; icon: string }> = {
    lastExport: { label: '直近の除外候補', icon: 'history' },
    workspaceSuggestions: { label: 'ワークスペースの推奨', icon: 'lightbulb' },
    preview: { label: '.securezipignore プレビュー', icon: 'list-unordered' },
    actions: { label: '操作', icon: 'gear' },
};

type LastExportSnapshot = {
    timestamp: number;
    patterns: string[];
};

type PreviewStatus = 'exclude' | 'include' | 'comment' | 'duplicate';

type TreeNode =
    | { kind: 'section'; section: SectionId; description?: string }
    | { kind: 'message'; label: string; tooltip?: string }
    | { kind: 'suggestion'; label: string; pattern: string; detail?: string; alreadyExists: boolean; root?: string }
    | { kind: 'preview'; label: string; status: PreviewStatus; tooltip?: string; description?: string }
    | { kind: 'action'; label: string; command: vscode.Command; description?: string };

class SecureZipTreeItem extends vscode.TreeItem {
    constructor(public readonly node: TreeNode) {
        switch (node.kind) {
            case 'section': {
                const meta = SECTION_DEFS[node.section];
                super(meta.label, vscode.TreeItemCollapsibleState.Collapsed);
                this.iconPath = new vscode.ThemeIcon(meta.icon);
                if (node.description) {
                    this.description = node.description;
                }
                this.contextValue = `securezip.section.${node.section}`;
                break;
            }
            case 'message': {
                super(node.label, vscode.TreeItemCollapsibleState.None);
                this.tooltip = node.tooltip;
                this.contextValue = 'securezip.message';
                break;
            }
            case 'suggestion': {
                super(node.label, vscode.TreeItemCollapsibleState.None);
                this.tooltip = node.detail;
                this.contextValue = node.alreadyExists ? 'securezip.suggestion.disabled' : 'securezip.suggestion';
                this.iconPath = new vscode.ThemeIcon(node.alreadyExists ? 'pass-filled' : 'add');
                this.description = node.alreadyExists ? '追加済み' : '追加';
                if (!node.alreadyExists) {
                    this.command = {
                        command: 'securezip.addPattern',
                        title: '.securezipignore に追加',
                        arguments: node.root ? [node.pattern, node.root] : [node.pattern],
                    };
                }
                break;
            }
            case 'preview': {
                super(node.label, vscode.TreeItemCollapsibleState.None);
                this.tooltip = node.tooltip;
                this.description = node.description;
                this.contextValue = 'securezip.preview';
                if (node.status === 'exclude') {
                    this.iconPath = new vscode.ThemeIcon('diff-removed');
                } else if (node.status === 'include') {
                    this.iconPath = new vscode.ThemeIcon('diff-added');
                } else if (node.status === 'duplicate') {
                    this.iconPath = new vscode.ThemeIcon('warning');
                } else {
                    this.iconPath = new vscode.ThemeIcon('comment');
                }
                break;
            }
            case 'action': {
                super(node.label, vscode.TreeItemCollapsibleState.None);
                this.command = node.command;
                this.description = node.description;
                this.iconPath = new vscode.ThemeIcon('go-to-file');
                this.contextValue = 'securezip.action';
                break;
            }
            default: {
                super('Unknown', vscode.TreeItemCollapsibleState.None);
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
    { pattern: 'node_modules/', description: 'Node.js 依存モジュール', path: 'node_modules', type: 'dir' },
    { pattern: 'dist/', description: 'ビルド成果物', path: 'dist', type: 'dir' },
    { pattern: 'out/', description: 'ビルド成果物', path: 'out', type: 'dir' },
    { pattern: 'build/', description: 'ビルド成果物', path: 'build', type: 'dir' },
    { pattern: 'coverage/', description: 'テストカバレッジ', path: 'coverage', type: 'dir' },
    { pattern: 'logs/', description: 'ログディレクトリ', path: 'logs', type: 'dir' },
    { pattern: 'tmp/', description: '一時ファイル', path: 'tmp', type: 'dir' },
    { pattern: '.env', description: '環境変数ファイル', path: '.env', type: 'file' },
    { pattern: '.env.*', description: '環境変数ファイル群', glob: '.env.*', type: 'glob' },
    { pattern: 'coverage-final.json', description: 'NYC カバレッジレポート', path: 'coverage-final.json', type: 'file' },
    { pattern: '**/*.log', description: 'ログファイル', glob: '**/*.log', type: 'glob' },
    { pattern: '**/*.pem', description: '証明書/秘密鍵', glob: '**/*.pem', type: 'glob' },
    { pattern: '**/*.key', description: '秘密鍵', glob: '**/*.key', type: 'glob' },
];

const WATCH_PATTERN = '**/.securezipignore';

const LAST_EXPORT_STATE_KEY = 'securezip.lastExport';

export class SecureZipViewProvider implements vscode.TreeDataProvider<SecureZipTreeItem>, vscode.Disposable {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    private readonly disposables: vscode.Disposable[] = [];
    private ignoreCache: { root: string; context: IgnoreContext } | undefined;

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
    }

    refresh() {
        this.ignoreCache = undefined;
        this.onDidChangeTreeDataEmitter.fire();
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
                    label: 'ワークスペースが開かれていません',
                }),
            ];
        }

        if (!element) {
            const snapshot = this.context.workspaceState.get<LastExportSnapshot>(LAST_EXPORT_STATE_KEY);
            const description = snapshot?.timestamp ? this.formatTimestamp(snapshot.timestamp) : undefined;
            return [
                new SecureZipTreeItem({ kind: 'section', section: 'lastExport', description }),
                new SecureZipTreeItem({ kind: 'section', section: 'workspaceSuggestions' }),
                new SecureZipTreeItem({ kind: 'section', section: 'preview' }),
                new SecureZipTreeItem({ kind: 'section', section: 'actions' }),
            ];
        }

        if (element.node.kind !== 'section') {
            return [];
        }

        switch (element.node.section) {
            case 'lastExport':
                return this.buildLastExportItems(workspaceFolder);
            case 'workspaceSuggestions':
                return this.buildWorkspaceSuggestionItems(workspaceFolder);
            case 'preview':
                return this.buildPreviewItems(workspaceFolder);
            case 'actions':
                return this.buildActionItems(workspaceFolder);
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

    private async buildLastExportItems(workspaceFolder: vscode.WorkspaceFolder): Promise<SecureZipTreeItem[]> {
        const snapshot = this.context.workspaceState.get<LastExportSnapshot>(LAST_EXPORT_STATE_KEY);
        if (!snapshot || snapshot.patterns.length === 0) {
            return [
                new SecureZipTreeItem({
                    kind: 'message',
                    label: 'まだエクスポート履歴がありません',
                }),
            ];
        }

        const context = await this.ensureIgnoreContext(workspaceFolder.uri.fsPath);
        const items: SecureZipTreeItem[] = [];

        for (const pattern of snapshot.patterns) {
            const info = normalizeIgnorePattern(pattern);
            if (!info) {
                continue;
            }
            const targetSet = info.negated ? context.includes : context.excludes;
            const alreadyExists = targetSet.has(info.pattern);
            const detail = info.negated ? `再包含: ${info.pattern}` : `除外: ${info.pattern}`;
            items.push(
                new SecureZipTreeItem({
                    kind: 'suggestion',
                    label: pattern,
                    pattern,
                    detail,
                    alreadyExists,
                    root: workspaceFolder.uri.fsPath,
                }),
            );
        }

        return items.length > 0
            ? items
            : [
                  new SecureZipTreeItem({
                      kind: 'message',
                      label: '候補が見つかりませんでした',
                  }),
              ];
    }

    private async buildWorkspaceSuggestionItems(workspaceFolder: vscode.WorkspaceFolder): Promise<SecureZipTreeItem[]> {
        const root = workspaceFolder.uri.fsPath;
        const context = await this.ensureIgnoreContext(root);
        const results: SecureZipTreeItem[] = [];

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

            results.push(
                new SecureZipTreeItem({
                    kind: 'suggestion',
                    label: candidate.pattern,
                    pattern: candidate.pattern,
                    detail: candidate.description,
                    alreadyExists,
                    root: root,
                }),
            );
        }

        if (results.length === 0) {
            return [
                new SecureZipTreeItem({
                    kind: 'message',
                    label: '新しい推奨パターンはありません',
                }),
            ];
        }

        return results;
    }

    private async buildPreviewItems(workspaceFolder: vscode.WorkspaceFolder): Promise<SecureZipTreeItem[]> {
        const context = await this.ensureIgnoreContext(workspaceFolder.uri.fsPath);
        if (!context.exists) {
            return [
                new SecureZipTreeItem({
                    kind: 'message',
                    label: '.securezipignore はまだ作成されていません',
                }),
            ];
        }

        const occurrences = new Map<string, number>();
        for (const line of context.rawLines) {
            const info = normalizeIgnorePattern(line);
            if (!info) {
                continue;
            }
            const key = `${info.negated ? '!' : ''}${info.pattern}`;
            occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
        }

        const seen = new Map<string, number>();
        const items: SecureZipTreeItem[] = [];

        for (const line of context.rawLines) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            const info = normalizeIgnorePattern(line);
            if (!info) {
                items.push(
                    new SecureZipTreeItem({
                        kind: 'preview',
                        label: line,
                        status: 'comment',
                        description: 'コメント/無視',
                    }),
                );
                continue;
            }

            const key = `${info.negated ? '!' : ''}${info.pattern}`;
            const duplicateCount = occurrences.get(key) ?? 0;
            const seenCount = seen.get(key) ?? 0;
            seen.set(key, seenCount + 1);

            const hasReinclude = !info.negated && context.includes.has(info.pattern);

            let description = info.negated ? '再包含' : hasReinclude ? '除外 (再包含あり)' : '除外';
            let tooltip = info.negated ? `!${info.pattern}` : info.pattern;
            let status: PreviewStatus = info.negated ? 'include' : 'exclude';

            if (duplicateCount > 1 && seenCount > 0) {
                status = 'duplicate';
                description = '重複';
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

        return items.length > 0
            ? items
            : [
                  new SecureZipTreeItem({
                      kind: 'message',
                      label: '.securezipignore は空です',
                  }),
              ];
    }

    private async buildActionItems(workspaceFolder: vscode.WorkspaceFolder): Promise<SecureZipTreeItem[]> {
        const root = workspaceFolder.uri.fsPath;
        const command: vscode.Command = {
            command: 'securezip.openIgnoreFile',
            title: '.securezipignore を開く',
            arguments: [vscode.Uri.file(path.join(root, '.securezipignore'))],
        };

        return [
            new SecureZipTreeItem({
                kind: 'action',
                label: '.securezipignore を開く',
                command,
                description: 'エディタで直接編集',
            }),
        ];
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

export async function ensureSecureZipIgnoreFile(root: string): Promise<void> {
    const file = path.join(root, '.securezipignore');
    try {
        await fs.promises.access(file, fs.constants.F_OK);
    } catch (err: any) {
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            await fs.promises.writeFile(file, '', { encoding: 'utf8' });
        } else {
            throw err;
        }
    }
}

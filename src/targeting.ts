import * as path from 'path';
import * as vscode from 'vscode';

type GitExtension = {
    getAPI(version: 1): GitAPI;
};

type GitAPI = {
    repositories: GitRepository[];
    getRepository?: (uri: vscode.Uri) => GitRepository | null;
    onDidChangeState?: vscode.Event<void>;
    onDidChangeRepositories?: vscode.Event<void>;
};

type GitRepository = {
    rootUri: vscode.Uri;
    ui?: { selected?: boolean };
};

export type TargetGroup = {
    id: string;
    root: string;
    label: string;
    kind: 'repo' | 'folder';
    selected?: boolean;
};

export type ResolvedTarget =
    | { kind: 'repo' | 'folder'; root: string; label: string }
    | { kind: 'ambiguous'; candidates: TargetGroup[]; reason: 'multiple-selected' | 'multiple-repos' | 'multiple-folders' }
    | { kind: 'empty' };

export async function getGitApi(): Promise<GitAPI | undefined> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
        return undefined;
    }
    try {
        const gitExtension = extension.isActive ? extension.exports : await extension.activate();
        if (!gitExtension) {
            return undefined;
        }
        return gitExtension.getAPI(1);
    } catch {
        return undefined;
    }
}

export async function listGitRepositories(): Promise<TargetGroup[]> {
    const git = await getGitApi();
    if (!git) {
        return [];
    }
    return git.repositories.map((repo) => {
        const root = repo.rootUri.fsPath;
        return {
            id: root,
            root,
            label: getDisplayName(root),
            kind: 'repo',
            selected: !!repo.ui?.selected,
        };
    });
}

export function listWorkspaceFolders(): TargetGroup[] {
    const folders = vscode.workspace.workspaceFolders ?? [];
    return folders.map((folder) => {
        const root = folder.uri.fsPath;
        return {
            id: root,
            root,
            label: folder.name,
            kind: 'folder',
        };
    });
}

export async function resolveDefaultTarget(): Promise<ResolvedTarget> {
    const gitRepos = await listGitRepositories();
    if (gitRepos.length > 0) {
        const selected = gitRepos.filter((repo) => repo.selected);
        if (selected.length === 1) {
            return { kind: 'repo', root: selected[0].root, label: selected[0].label };
        }
        if (selected.length > 1) {
            return { kind: 'ambiguous', candidates: selected, reason: 'multiple-selected' };
        }

        const activeRepo = await resolveRepoFromActiveEditor();
        if (activeRepo) {
            return { kind: 'repo', root: activeRepo.root, label: activeRepo.label };
        }

        if (gitRepos.length === 1) {
            return { kind: 'repo', root: gitRepos[0].root, label: gitRepos[0].label };
        }
        return { kind: 'ambiguous', candidates: gitRepos, reason: 'multiple-repos' };
    }

    const activeFolder = resolveFolderFromActiveEditor();
    if (activeFolder) {
        return { kind: 'folder', root: activeFolder.root, label: activeFolder.label };
    }

    const folders = listWorkspaceFolders();
    if (folders.length > 0) {
        return { kind: 'folder', root: folders[0].root, label: folders[0].label };
    }

    return { kind: 'empty' };
}

export function getDisplayName(root: string): string {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
    if (folder && folder.uri.fsPath === root) {
        return folder.name;
    }
    return path.basename(root);
}

export function getWorkspaceRootLabel(): string {
    return vscode.workspace.name ?? 'workspace';
}

export async function watchGitChanges(onChange: () => void): Promise<vscode.Disposable | undefined> {
    const git = await getGitApi();
    if (!git) {
        return undefined;
    }
    const disposables: vscode.Disposable[] = [];
    if (git.onDidChangeState) {
        disposables.push(git.onDidChangeState(onChange));
    }
    if (git.onDidChangeRepositories) {
        disposables.push(git.onDidChangeRepositories(onChange));
    }
    if (disposables.length === 0) {
        return undefined;
    }
    return new vscode.Disposable(() => {
        for (const disposable of disposables) {
            disposable.dispose();
        }
    });
}

async function resolveRepoFromActiveEditor(): Promise<TargetGroup | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return undefined;
    }
    const git = await getGitApi();
    if (!git || !git.getRepository) {
        return undefined;
    }
    const repo = git.getRepository(editor.document.uri);
    if (!repo) {
        return undefined;
    }
    const root = repo.rootUri.fsPath;
    return { id: root, root, label: getDisplayName(root), kind: 'repo' };
}

function resolveFolderFromActiveEditor(): TargetGroup | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return undefined;
    }
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!folder) {
        return undefined;
    }
    return { id: folder.uri.fsPath, root: folder.uri.fsPath, label: folder.name, kind: 'folder' };
}

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { normalizeIgnorePattern } from './ignore';
import { localize } from './nls';

const DOCUMENT_SELECTOR: vscode.DocumentSelector = { scheme: 'file', pattern: '**/.securezipignore' };
const MAX_FILE_PREVIEW_LINES = 10;
const MAX_GLOB_SAMPLES = 3;
const DIRECTORY_SUFFIX = '/**';
const HAS_GLOB_RE = /[\\*?[\]{]/;

type PatternInfo = {
    range: vscode.Range;
    pattern: string;
    negated: boolean;
    display: string;
};

type StatTarget = {
    relative: string;
    statTarget: string;
    canStat: boolean;
};

export function registerIgnoreLanguageFeatures(context: vscode.ExtensionContext): void {
    const hoverProvider = new SecureZipIgnoreHoverProvider();
    const definitionProvider = new SecureZipIgnoreDefinitionProvider();

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(DOCUMENT_SELECTOR, hoverProvider),
        vscode.languages.registerDefinitionProvider(DOCUMENT_SELECTOR, definitionProvider),
    );
}

class SecureZipIgnoreHoverProvider implements vscode.HoverProvider {
    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.Hover | undefined> {
        const info = getPatternInfo(document, position);
        if (!info) {
            return;
        }

        const root = getWorkspaceRoot(document.uri);
        if (!root) {
            return;
        }

        const markdown = await buildHoverMarkdown(info, root, token);
        if (!markdown || token.isCancellationRequested) {
            return;
        }

        return new vscode.Hover(markdown, info.range);
    }
}

class SecureZipIgnoreDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.Definition | undefined> {
        const info = getPatternInfo(document, position);
        if (!info) {
            return;
        }

        const root = getWorkspaceRoot(document.uri);
        if (!root) {
            return;
        }

        const target = await resolveDefinitionTarget(info.pattern, root, token);
        if (!target || token.isCancellationRequested) {
            return;
        }

        if (target.kind === 'file') {
            return new vscode.Location(target.uri, new vscode.Position(0, 0));
        }

        await vscode.commands.executeCommand('revealInExplorer', target.uri);
        return;
    }
}

function getWorkspaceRoot(uri: vscode.Uri): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder?.uri.fsPath;
}

function getPatternInfo(document: vscode.TextDocument, position: vscode.Position): PatternInfo | undefined {
    const line = document.lineAt(position.line);
    const trimmed = line.text.trim();
    if (!trimmed || trimmed.startsWith('#')) {
        return;
    }
    if (position.character < line.firstNonWhitespaceCharacterIndex) {
        return;
    }

    const normalized = normalizeIgnorePattern(line.text);
    if (!normalized) {
        return;
    }

    const display = normalized.negated ? `!${normalized.pattern}` : normalized.pattern;
    return { range: line.range, pattern: normalized.pattern, negated: normalized.negated, display };
}

function resolveStatTarget(pattern: string): StatTarget {
    const relative = pattern.startsWith('/') ? pattern.slice(1) : pattern;
    const statTarget = relative.endsWith(DIRECTORY_SUFFIX)
        ? relative.slice(0, -DIRECTORY_SUFFIX.length)
        : relative;
    const canStat = !hasGlobPattern(relative) || (!hasGlobPattern(statTarget) && relative.endsWith(DIRECTORY_SUFFIX));
    return { relative, statTarget, canStat };
}

function hasGlobPattern(value: string): boolean {
    return HAS_GLOB_RE.test(value);
}

async function resolveDefinitionTarget(
    pattern: string,
    root: string,
    token: vscode.CancellationToken,
): Promise<{ kind: 'file' | 'directory'; uri: vscode.Uri } | undefined> {
    const { statTarget, canStat } = resolveStatTarget(pattern);
    if (!canStat || !statTarget) {
        return;
    }

    const fullPath = path.join(root, statTarget);
    try {
        const stats = await fs.promises.stat(fullPath);
        if (token.isCancellationRequested) {
            return;
        }
        if (stats.isDirectory()) {
            return { kind: 'directory', uri: vscode.Uri.file(fullPath) };
        }
        return { kind: 'file', uri: vscode.Uri.file(fullPath) };
    } catch {
        return;
    }
}

async function buildHoverMarkdown(
    info: PatternInfo,
    root: string,
    token: vscode.CancellationToken,
): Promise<vscode.MarkdownString | undefined> {
    const markdown = new vscode.MarkdownString();
    const { relative, statTarget, canStat } = resolveStatTarget(info.pattern);

    if (info.negated) {
        markdown.appendMarkdown(`_${localize('ignore.hover.reinclude', 'Re-include pattern')}_\n\n`);
    }

    if (canStat && statTarget) {
        const fullPath = path.join(root, statTarget);
        try {
            const stats = await fs.promises.stat(fullPath);
            if (token.isCancellationRequested) {
                return;
            }

            if (stats.isDirectory()) {
                return await buildDirectoryHover(markdown, statTarget, fullPath, token);
            }

            return await buildFileHover(markdown, statTarget, fullPath, token);
        } catch {
            // Fall back to glob search if direct stat failed.
        }
    }

    return await buildGlobHover(markdown, info.display, relative || info.pattern, root, token);
}

async function buildFileHover(
    markdown: vscode.MarkdownString,
    displayPath: string,
    fullPath: string,
    token: vscode.CancellationToken,
): Promise<vscode.MarkdownString> {
    markdown.appendMarkdown(`**${localize('ignore.hover.file.title', 'File')}** \`${displayPath}\``);

    try {
        const content = await fs.promises.readFile(fullPath, 'utf8');
        if (token.isCancellationRequested) {
            return markdown;
        }

        if (content.includes('\u0000')) {
            markdown.appendMarkdown(`\n\n${localize('ignore.hover.file.binary', 'Binary file (preview unavailable).')}`);
            return markdown;
        }

        const lines = content.split(/\r?\n/);
        const preview = lines.slice(0, MAX_FILE_PREVIEW_LINES);
        markdown.appendCodeblock(preview.join('\n'), 'text');

        if (lines.length > MAX_FILE_PREVIEW_LINES) {
            markdown.appendMarkdown(
                `\n\n${localize('ignore.hover.file.truncated', 'Showing first {0} lines.', MAX_FILE_PREVIEW_LINES.toString())}`,
            );
        }
    } catch {
        markdown.appendMarkdown(`\n\n${localize('ignore.hover.file.readError', 'Unable to read file contents.')}`);
    }

    return markdown;
}

async function buildDirectoryHover(
    markdown: vscode.MarkdownString,
    displayPath: string,
    fullPath: string,
    token: vscode.CancellationToken,
): Promise<vscode.MarkdownString> {
    const normalized = displayPath.endsWith('/') ? displayPath : `${displayPath}/`;
    markdown.appendMarkdown(`**${localize('ignore.hover.directory.title', 'Directory')}** \`${normalized}\``);

    try {
        const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
        if (token.isCancellationRequested) {
            return markdown;
        }

        let folderCount = 0;
        let fileCount = 0;
        for (const entry of entries) {
            if (entry.isDirectory()) {
                folderCount += 1;
            } else {
                fileCount += 1;
            }
        }

        markdown.appendMarkdown(
            `\n\n${localize('ignore.hover.directory.summary', '{0} files, {1} folders', fileCount.toString(), folderCount.toString())}`,
        );
    } catch {
        markdown.appendMarkdown(`\n\n${localize('ignore.hover.directory.readError', 'Unable to read directory contents.')}`);
    }

    return markdown;
}

async function buildGlobHover(
    markdown: vscode.MarkdownString,
    displayPattern: string,
    globPattern: string,
    root: string,
    token: vscode.CancellationToken,
): Promise<vscode.MarkdownString> {
    markdown.appendMarkdown(`**${localize('ignore.hover.glob.title', 'Matches')}** \`${displayPattern}\``);

    try {
        const { globbyStream } = await import('globby');
        const samples: string[] = [];
        let hasMore = false;

        for await (const entry of globbyStream(globPattern || '.', {
            cwd: root,
            dot: true,
            gitignore: false,
            followSymbolicLinks: false,
            unique: true,
        })) {
            if (token.isCancellationRequested) {
                return markdown;
            }

            const value = typeof entry === 'string' ? entry : String((entry as { path?: string }).path ?? '');
            if (!value) {
                continue;
            }
            if (samples.length < MAX_GLOB_SAMPLES) {
                samples.push(value);
            } else {
                hasMore = true;
                break;
            }
        }

        if (samples.length === 0) {
            markdown.appendMarkdown(`\n\n${localize('ignore.hover.glob.none', 'No matches found.')}`);
            return markdown;
        }

        const sampleText = samples.map((sample) => `\`${sample}\``).join(', ');
        markdown.appendMarkdown(`\n\n${localize('ignore.hover.glob.examples', 'Examples: {0}', sampleText)}`);
        if (hasMore) {
            markdown.appendMarkdown(`\n\n${localize('ignore.hover.glob.more', 'More matches exist.')}`);
        }
    } catch {
        markdown.appendMarkdown(`\n\n${localize('ignore.hover.glob.none', 'No matches found.')}`);
    }

    return markdown;
}

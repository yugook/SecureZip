import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

type Bundle = Record<string, string>;

const bundleCache = new Map<string, Bundle | null>();

function getLanguageCandidates(language: string | undefined): string[] {
    if (!language) {
        return [];
    }
    const lc = language.toLowerCase();
    const segments = lc.split('-');
    const candidates: string[] = [];
    for (let i = segments.length; i >= 1; i--) {
        candidates.push(segments.slice(0, i).join('-'));
    }
    return candidates;
}

function loadBundle(language: string): Bundle | null {
    if (bundleCache.has(language)) {
        return bundleCache.get(language) ?? null;
    }

    const filePath = path.join(__dirname, '..', 'i18n', `nls.bundle.${language}.json`);
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as Bundle;
        bundleCache.set(language, parsed);
        return parsed;
    } catch {
        bundleCache.set(language, null);
        return null;
    }
}

function format(message: string, args: unknown[]): string {
    if (!args.length) {
        return message;
    }
    return message.replace(/\{(\d+)\}/g, (match, index) => {
        const i = Number(index);
        if (Number.isNaN(i) || i < 0 || i >= args.length) {
            return match;
        }
        const value = args[i];
        return value === undefined || value === null ? '' : String(value);
    });
}

export function localize(key: string, defaultValue: string, ...args: unknown[]): string {
    const language = vscode.env.language;
    const candidates = getLanguageCandidates(language);

    for (const candidate of candidates) {
        const bundle = loadBundle(candidate);
        if (bundle && Object.prototype.hasOwnProperty.call(bundle, key)) {
            return format(bundle[key], args);
        }
    }

    return format(defaultValue ?? key, args);
}

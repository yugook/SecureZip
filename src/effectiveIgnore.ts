import type { SecureZipIgnore } from './ignore';

export type IgnoreRuleSource = 'auto' | 'gitignore' | 'configuration' | 'securezipignore';
export type IgnoreRuleAction = 'exclude' | 'include';

export const IGNORE_SOURCE_PRIORITY: Readonly<Record<IgnoreRuleSource, number>> = Object.freeze({
    auto: 0,
    gitignore: 1,
    configuration: 2,
    securezipignore: 3,
});

export type EffectiveIgnoreRule = {
    pattern: string;
    action: IgnoreRuleAction;
    source: Exclude<IgnoreRuleSource, 'gitignore'>;
    priority: number;
};

export type EffectiveIgnorePlan = {
    rules: readonly EffectiveIgnoreRule[];
    autoExcludePatterns: readonly string[];
    additionalExcludePatterns: readonly string[];
    configurationIncludePatterns: readonly string[];
    secureExcludePatterns: readonly string[];
    secureIncludePatterns: readonly string[];
    secureReincludePatterns: readonly string[];
    baseIgnorePatterns: readonly string[];
    configurationIncludeIgnorePatterns: readonly string[];
    ignoreSnapshot: readonly string[];
    gitOverride: boolean;
};

export type PatternPresence = {
    exists: boolean;
    examples: string[];
    hasMore: boolean;
};

type CreateEffectiveIgnorePlanOptions = {
    secureZipIgnore: SecureZipIgnore;
    autoExcludePatterns: readonly string[];
    additionalExcludePatterns?: readonly string[];
    configurationIncludePatterns?: readonly string[];
};

type CollectOptions = {
    absolute?: boolean;
};

type ResolvePatternPresenceOptions = {
    excludePatterns?: readonly string[];
    onlyFiles?: boolean;
    sampleLimit?: number;
};

function uniquePatterns(patterns: readonly string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const raw of patterns) {
        const pattern = raw.trim();
        if (!pattern || seen.has(pattern)) {
            continue;
        }
        seen.add(pattern);
        result.push(pattern);
    }
    return result;
}

function createRules(
    patterns: readonly string[],
    action: IgnoreRuleAction,
    source: Exclude<IgnoreRuleSource, 'gitignore'>,
): EffectiveIgnoreRule[] {
    return patterns.map((pattern) => ({
        pattern,
        action,
        source,
        priority: IGNORE_SOURCE_PRIORITY[source],
    }));
}

export function createEffectiveIgnorePlan(options: CreateEffectiveIgnorePlanOptions): EffectiveIgnorePlan {
    const autoExcludePatterns = uniquePatterns(options.autoExcludePatterns);
    const additionalExcludePatterns = uniquePatterns(options.additionalExcludePatterns ?? []);
    const configurationIncludePatterns = uniquePatterns(options.configurationIncludePatterns ?? []);
    const secureExcludePatterns = uniquePatterns(options.secureZipIgnore.excludes);
    const secureIncludePatterns = uniquePatterns(options.secureZipIgnore.includes);
    const secureReincludePatterns = uniquePatterns([
        ...secureIncludePatterns,
        ...(secureIncludePatterns.includes('.git') ? ['.git/**'] : []),
    ]);

    const rules = [
        ...createRules(autoExcludePatterns, 'exclude', 'auto'),
        ...createRules(additionalExcludePatterns, 'exclude', 'configuration'),
        ...createRules(configurationIncludePatterns, 'include', 'configuration'),
        ...createRules(secureExcludePatterns, 'exclude', 'securezipignore'),
        ...createRules(secureIncludePatterns, 'include', 'securezipignore'),
    ];

    const gitOverride = secureIncludePatterns.some(
        (pattern) => pattern === '.git' || pattern === '.git/**' || pattern.startsWith('.git/'),
    );

    return {
        rules,
        autoExcludePatterns,
        additionalExcludePatterns,
        configurationIncludePatterns,
        secureExcludePatterns,
        secureIncludePatterns,
        secureReincludePatterns,
        baseIgnorePatterns: uniquePatterns([
            ...autoExcludePatterns,
            ...additionalExcludePatterns,
            ...secureExcludePatterns,
        ]),
        configurationIncludeIgnorePatterns: uniquePatterns([
            ...additionalExcludePatterns,
            ...secureExcludePatterns,
        ]),
        ignoreSnapshot: [
            ...secureExcludePatterns,
            ...secureIncludePatterns.map((pattern) => `!${pattern}`),
        ],
        gitOverride,
    };
}

async function collectPatterns(
    root: string,
    patterns: readonly string[],
    options: { absolute: boolean; ignorePatterns: readonly string[]; gitignore: boolean },
): Promise<string[]> {
    if (patterns.length === 0) {
        return [];
    }

    const { globby } = await import('globby');
    return globby(patterns, {
        cwd: root,
        dot: true,
        gitignore: options.gitignore,
        ignore: [...options.ignorePatterns],
        onlyFiles: true,
        followSymbolicLinks: false,
        absolute: options.absolute,
    });
}

export async function collectIncludeOverrides(
    root: string,
    plan: EffectiveIgnorePlan,
    options: CollectOptions = {},
): Promise<string[]> {
    const absolute = options.absolute ?? false;
    const configured = await collectPatterns(root, plan.configurationIncludePatterns, {
        absolute,
        ignorePatterns: plan.configurationIncludeIgnorePatterns,
        gitignore: false,
    });
    const secure = await collectPatterns(root, plan.secureReincludePatterns, {
        absolute,
        ignorePatterns: [],
        gitignore: false,
    });
    return Array.from(new Set([...configured, ...secure]));
}

export async function collectEffectiveFiles(
    root: string,
    plan: EffectiveIgnorePlan,
    options: CollectOptions = {},
): Promise<string[]> {
    const absolute = options.absolute ?? false;
    const baseFiles = await collectPatterns(root, ['**/*', '**/.*'], {
        absolute,
        ignorePatterns: plan.baseIgnorePatterns,
        gitignore: true,
    });
    const overrides = await collectIncludeOverrides(root, plan, { absolute });
    return Array.from(new Set([...baseFiles, ...overrides]));
}

export async function resolvePatternPresence(
    root: string,
    patterns: readonly string[],
    options: ResolvePatternPresenceOptions = {},
): Promise<PatternPresence> {
    const positivePatterns = uniquePatterns(patterns);
    if (positivePatterns.length === 0) {
        return { exists: false, examples: [], hasMore: false };
    }

    const excluded = uniquePatterns(options.excludePatterns ?? []).map((pattern) => `!${pattern}`);
    const sampleLimit = Math.max(1, options.sampleLimit ?? 3);

    try {
        const { globbyStream } = await import('globby');
        const examples: string[] = [];
        let hasMore = false;
        for await (const entry of globbyStream([...positivePatterns, ...excluded], {
            cwd: root,
            dot: true,
            gitignore: false,
            onlyFiles: options.onlyFiles ?? true,
            followSymbolicLinks: false,
            unique: true,
            expandNegationOnlyPatterns: false,
        })) {
            const value = typeof entry === 'string' ? entry : String((entry as { path?: string }).path ?? '');
            if (!value) {
                continue;
            }
            if (examples.length < sampleLimit) {
                examples.push(value);
            } else {
                hasMore = true;
                break;
            }
        }
        return { exists: examples.length > 0 || hasMore, examples, hasMore };
    } catch {
        return { exists: false, examples: [], hasMore: false };
    }
}

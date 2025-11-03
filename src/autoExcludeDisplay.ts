export type AutoExcludePresence = {
    exists: boolean;
    examples: string[];
    hasMore: boolean;
};

export type AutoExcludePatternInfo = {
    pattern: string;
    reincluded: boolean;
    presence: AutoExcludePresence;
};

export type AutoExcludeDisplayState = 'reincluded' | 'active' | 'inactive';

export type AutoExcludeDisplayInfo = AutoExcludePatternInfo & {
    displayState: AutoExcludeDisplayState;
};

/**
 * Classifies and orders SecureZip auto-exclude patterns for display.
 * Reincluded entries are surfaced first, followed by active matches, then inactive defaults.
 */
export function classifyAutoExcludePatterns(patternInfos: AutoExcludePatternInfo[]): AutoExcludeDisplayInfo[] {
    return patternInfos
        .map<AutoExcludeDisplayInfo & { index: number }>((info, index) => {
            const displayState: AutoExcludeDisplayState = info.reincluded
                ? 'reincluded'
                : info.presence.exists
                    ? 'active'
                    : 'inactive';
            return { ...info, displayState, index };
        })
        .sort((a, b) => {
            const rank = (entry: AutoExcludeDisplayInfo): number => {
                if (entry.presence.exists) {
                    return entry.displayState === 'reincluded' ? 0 : 1;
                }
                if (entry.displayState === 'reincluded') {
                    return 2;
                }
                return 3;
            };
            const diff = rank(a) - rank(b);
            if (diff !== 0) {
                return diff;
            }
            return a.index - b.index;
        })
        .map(({ index, ...entry }) => entry);
}

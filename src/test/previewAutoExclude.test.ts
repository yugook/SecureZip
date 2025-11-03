import * as assert from 'assert';
import {
    classifyAutoExcludePatterns,
    type AutoExcludePatternInfo,
    type AutoExcludeDisplayState,
} from '../autoExcludeDisplay';

function buildInfo(
    pattern: string,
    state: { reincluded?: boolean; exists?: boolean; examples?: string[]; hasMore?: boolean },
): AutoExcludePatternInfo {
    return {
        pattern,
        reincluded: state.reincluded ?? false,
        presence: {
            exists: state.exists ?? false,
            examples: state.examples ?? [],
            hasMore: state.hasMore ?? false,
        },
    };
}

describe('classifyAutoExcludePatterns', () => {
    it('orders entries by existence and reincluded state', () => {
        const input: AutoExcludePatternInfo[] = [
            buildInfo('.env', { exists: true }),
            buildInfo('.git', { reincluded: true, exists: false }),
            buildInfo('.vscode/**', { reincluded: true, exists: true }),
            buildInfo('node_modules/**', { exists: false }),
        ];

        const result = classifyAutoExcludePatterns(input);
        assert.deepStrictEqual(
            result.map((entry) => entry.pattern),
            ['.vscode/**', '.env', '.git', 'node_modules/**'],
        );
    });

    it('preserves relative order within the same priority group', () => {
        const input: AutoExcludePatternInfo[] = [
            buildInfo('pattern-1', { exists: true }),
            buildInfo('pattern-2', { exists: true }),
            buildInfo('pattern-3', { exists: true }),
        ];

        const result = classifyAutoExcludePatterns(input);
        assert.deepStrictEqual(
            result.map((entry) => entry.pattern),
            ['pattern-1', 'pattern-2', 'pattern-3'],
        );
    });

    it('assigns display states based on reinclusion and presence', () => {
        const input: AutoExcludePatternInfo[] = [
            buildInfo('reincluded-present', { reincluded: true, exists: true }),
            buildInfo('reincluded-absent', { reincluded: true, exists: false }),
            buildInfo('active', { exists: true }),
            buildInfo('inactive', { exists: false }),
        ];

        const result = classifyAutoExcludePatterns(input);
        const states = new Map<string, AutoExcludeDisplayState>();
        for (const entry of result) {
            states.set(entry.pattern, entry.displayState);
        }

        assert.deepStrictEqual(states.get('reincluded-present'), 'reincluded');
        assert.deepStrictEqual(states.get('reincluded-absent'), 'reincluded');
        assert.deepStrictEqual(states.get('active'), 'active');
        assert.deepStrictEqual(states.get('inactive'), 'inactive');
    });
});

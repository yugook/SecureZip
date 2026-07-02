import * as assert from 'assert';
import { describe, it } from 'mocha';

interface Candidate {
    body: string;
    commitSha?: string;
    groupKey?: string;
    source: string;
    submittedAt?: number;
}

interface Blocker {
    level: string;
    line: string;
    source: string;
}

const gate = require('../../scripts/ai-review-gate.cjs') as {
    collectBlockers(candidates: Candidate[]): Blocker[];
    resolvePullRequestNumber(payload: unknown): number | null;
    selectLatestCurrentCandidate(candidates: Candidate[], headSha: string): Candidate | null;
    selectLatestNonCurrentCandidate(candidates: Candidate[], headSha: string, latestCurrentCandidate?: Candidate | null): Candidate | null;
};

describe('ai-review-gate', () => {
    describe('resolvePullRequestNumber', () => {
        it('resolves PR numbers from trusted workflow_run relays', () => {
            assert.strictEqual(gate.resolvePullRequestNumber({
                workflow_run: {
                    pull_requests: [
                        {
                            number: 264,
                        },
                    ],
                },
            }), 264);
        });
    });

    describe('collectBlockers', () => {
        it('parses shield-style Codex priority badges', () => {
            const blockers = gate.collectBlockers([
                {
                    body: '**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-red)</sub></sub> Parse badge priorities',
                    source: 'review comment 1',
                },
            ]);

            assert.deepStrictEqual(blockers.map((blocker) => blocker.level), ['P1']);
        });

        it('keeps parsing bracketed priority prefixes', () => {
            const blockers = gate.collectBlockers([
                {
                    body: '- **[P0]** Prevent publishing with stale credentials',
                    source: 'review 1',
                },
            ]);

            assert.deepStrictEqual(blockers.map((blocker) => blocker.level), ['P0']);
        });
    });

    describe('selectLatestCurrentCandidate', () => {
        it('ignores stale blockers when a newer current-head Codex result is clean', () => {
            const headSha = 'be9a3f42a6abcd';
            const latest = gate.selectLatestCurrentCandidate([
                {
                    body: '![P1 Badge](https://example.test/p1.svg) Old blocker',
                    commitSha: headSha,
                    groupKey: 'review:1',
                    source: 'review 1',
                    submittedAt: 1000,
                },
                {
                    body: 'Latest-head Codex review found and no P0/P1 findings were detected.',
                    commitSha: headSha,
                    groupKey: 'issue-comment:2',
                    source: 'issue comment 2',
                    submittedAt: 2000,
                },
            ], headSha);

            assert.strictEqual(latest?.source, 'issue comment 2');
            assert.deepStrictEqual(gate.collectBlockers(latest ? [latest] : []), []);
        });

        it('groups a submitted review with its inline review comments', () => {
            const headSha = 'be9a3f42a6abcd';
            const latest = gate.selectLatestCurrentCandidate([
                {
                    body: 'Reviewed commit: be9a3f42a6',
                    commitSha: headSha,
                    groupKey: 'review:10',
                    source: 'review 10',
                    submittedAt: 1000,
                },
                {
                    body: '![P1 Badge](https://example.test/p1.svg) Inline finding',
                    commitSha: headSha,
                    groupKey: 'review:10',
                    source: 'review comment 11',
                    submittedAt: 1001,
                },
            ], headSha);

            const blockers = gate.collectBlockers(latest ? [latest] : []);

            assert.strictEqual(latest?.source, 'review 10, review comment 11');
            assert.deepStrictEqual(blockers.map((blocker) => blocker.level), ['P1']);
        });
    });

    describe('selectLatestNonCurrentCandidate', () => {
        it('keeps a newer untied Codex finding from being hidden by an older clean current review', () => {
            const headSha = 'be9a3f42a6abcd';
            const current = gate.selectLatestCurrentCandidate([
                {
                    body: 'Reviewed commit: be9a3f42a6',
                    commitSha: headSha,
                    groupKey: 'review:1',
                    source: 'review 1',
                    submittedAt: 1000,
                },
            ], headSha);

            const latestNonCurrent = gate.selectLatestNonCurrentCandidate([
                current!,
                {
                    body: '![P1 Badge](https://example.test/p1.svg) Untied finding',
                    groupKey: 'issue-comment:2',
                    source: 'issue comment 2',
                    submittedAt: 2000,
                },
            ], headSha, current);

            assert.strictEqual(latestNonCurrent?.source, 'issue comment 2');
            assert.deepStrictEqual(gate.collectBlockers(latestNonCurrent ? [latestNonCurrent] : []), [
                {
                    level: 'P1',
                    line: '![P1 Badge](https://example.test/p1.svg) Untied finding',
                    source: 'issue comment 2',
                },
            ]);
        });
    });
});

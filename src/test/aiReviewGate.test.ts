import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
    extractReviewedCommit(body?: string): string | null;
    issueCommentToCandidate(comment: { body: string; id: number; created_at: string }): Candidate | null;
    readRelayPullRequestNumber(options?: { required?: boolean }): number | null;
    resolvePullRequestNumber(payload: unknown): number | null;
    selectLatestCurrentCandidate(candidates: Candidate[], headSha: string): Candidate | null;
    selectLatestNonCurrentCandidate(candidates: Candidate[], headSha: string, latestCurrentCandidate?: Candidate | null): Candidate | null;
};

describe('ai-review-gate', () => {
    describe('review comment parsing', () => {
        it('recognizes plain and emphasized English and Japanese commit labels', () => {
            for (const body of [
                'Reviewed commit: `be9a3f42a6`',
                '**Reviewed commit:** `be9a3f42a6`',
                '**Reviewed commit**: `be9a3f42a6`',
                '__Reviewed commit:__ `be9a3f42a6`',
                '**レビュー済みコミット：** `be9a3f42a6`',
            ]) {
                assert.strictEqual(gate.extractReviewedCommit(body), 'be9a3f42a6', body);
            }
        });

        it('ties a bold commit label to the current head without accepting another head', () => {
            const candidate = gate.issueCommentToCandidate({
                id: 1,
                body: 'No major issues.\n\n**Reviewed commit:** `be9a3f42a6`',
                created_at: '2026-10-19T13:00:00Z',
            });
            assert.ok(candidate);
            assert.ok(gate.selectLatestCurrentCandidate([candidate], 'be9a3f42a6abcd'));
            assert.strictEqual(gate.selectLatestCurrentCandidate([candidate], 'c25a71f7a231ca'), null);
        });

        it('ignores progress summaries without hiding unbound priority findings', () => {
            const summary = gate.issueCommentToCandidate({
                id: 2,
                body: '<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 {"code_review":{"commit_sha":"be9a3f42a6abcd","status":"running"}} -->',
                created_at: '2026-10-19T13:01:00Z',
            });
            assert.strictEqual(summary, null);
            const finding = gate.issueCommentToCandidate({
                id: 3,
                body: '![P1 Badge](https://example.test/p1.svg) Untied finding',
                created_at: '2026-10-19T13:02:00Z',
            });
            assert.ok(finding);
            assert.deepStrictEqual(gate.collectBlockers([finding]).map((blocker) => blocker.level), ['P1']);
            const summaryFinding = gate.issueCommentToCandidate({
                id: 4,
                body: '<!-- codex-pull-request-review-summary -->\n![P0 Badge](https://example.test/p0.svg) Explicit blocker',
                created_at: '2026-10-19T13:03:00Z',
            });
            assert.ok(summaryFinding);
            assert.deepStrictEqual(gate.collectBlockers([summaryFinding]).map((blocker) => blocker.level), ['P0']);
        });

        it('accepts a completed clean summary only for its reported commit', () => {
            const headSha = '684a1d9ecddd3f163e593dc79c3513f03e7dd331';
            const candidate = gate.issueCommentToCandidate(summaryComment({
                status: 'completed', commit_sha: headSha,
                has_any_findings: false, has_unresolved_findings: false,
            }));
            assert.ok(candidate);
            assert.ok(gate.selectLatestCurrentCandidate([candidate], headSha));
            assert.strictEqual(gate.selectLatestCurrentCandidate([candidate], 'c25a71f7a231ca633de9bcd1ba15d4503f08ad1f'), null);
        });

        it('does not approve running, failed, ambiguous or malformed summaries', () => {
            const clean = {
                status: 'completed', commit_sha: '684a1d9ecddd3f163e593dc79c3513f03e7dd331',
                has_any_findings: false, has_unresolved_findings: false,
            };
            for (const review of [
                { ...clean, status: 'running' },
                { ...clean, status: 'failed' },
                { ...clean, has_any_findings: true },
                { ...clean, has_unresolved_findings: true },
                { ...clean, has_any_findings: null },
                { ...clean, commit_sha: '684a1d9' },
                null,
            ]) {
                assert.strictEqual(gate.issueCommentToCandidate(summaryComment(review)), null);
            }
            assert.strictEqual(gate.issueCommentToCandidate(summaryComment(clean, { has_any_findings: true })), null);
            const malformed = summaryComment(clean);
            malformed.body = malformed.body.replace('"code_review":', 'invalid-json:');
            assert.strictEqual(gate.issueCommentToCandidate(malformed), null);
        });
    });

    describe('resolvePullRequestNumber', () => {
        it('falls back to workflow_run PR associations when no relay artifact is configured', () => {
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

        it('prefers the downloaded relay artifact over workflow_run PR associations', () => {
            withRelayEvent({ pr_number: 123 }, () => {
                assert.strictEqual(gate.resolvePullRequestNumber({
                    workflow_run: {
                        pull_requests: [
                            {
                                number: 999,
                            },
                        ],
                    },
                }), 123);
            });
        });

        it('requires a valid relay artifact when one is configured for workflow_run events', () => {
            withRelayEventPath(path.join(os.tmpdir(), 'missing-ai-review-gate-event.json'), () => {
                assert.throws(() => gate.resolvePullRequestNumber({
                    workflow_run: {
                        pull_requests: [
                            {
                                number: 999,
                            },
                        ],
                    },
                }), /Relay event artifact was not found/);
            });
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

function summaryComment(review: unknown, security: unknown = null): { body: string; id: number; created_at: string } {
    return {
        id: 5,
        body: '<!-- codex-pull-request-review-summary -->\n' +
            `<!-- codex-review-state:v1 ${JSON.stringify({ code_review: review, security_review: security })} -->`,
        created_at: '2026-10-19T13:04:00Z',
    };
}

function withRelayEvent(event: unknown, run: () => void): void {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'securezip-ai-review-gate-'));
    const eventPath = path.join(directory, 'event.json');

    try {
        fs.writeFileSync(eventPath, JSON.stringify(event));
        withRelayEventPath(eventPath, run);
    } finally {
        fs.rmSync(directory, { force: true, recursive: true });
    }
}

function withRelayEventPath(eventPath: string, run: () => void): void {
    const previous = process.env.AI_REVIEW_RELAY_EVENT_PATH;

    try {
        process.env.AI_REVIEW_RELAY_EVENT_PATH = eventPath;
        run();
    } finally {
        if (previous === undefined) {
            delete process.env.AI_REVIEW_RELAY_EVENT_PATH;
        } else {
            process.env.AI_REVIEW_RELAY_EVENT_PATH = previous;
        }
    }
}

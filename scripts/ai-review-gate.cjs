#!/usr/bin/env node

/**
 * Gates PRs on the latest Codex review result.
 *
 * This script is intentionally dependency-free because it runs from a trusted
 * base checkout in pull_request_target.
 */

const fs = require('node:fs');

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;
const targetBranch = process.env.AI_REVIEW_TARGET_BRANCH || 'main';
const overrideLabel = process.env.AI_REVIEW_OVERRIDE_LABEL || 'ai-review-override';
const botLogins = new Set(
  (process.env.AI_REVIEW_BOT_LOGINS || 'chatgpt-codex-connector[bot]')
    .split(',')
    .map((login) => login.trim())
    .filter(Boolean),
);

if (!token) {
  fail('GITHUB_TOKEN is required.');
}

if (!repository || !repository.includes('/')) {
  fail('GITHUB_REPOSITORY must be set to owner/repo.');
}

if (!eventPath) {
  fail('GITHUB_EVENT_PATH is required.');
}

const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
const prNumber = resolvePullRequestNumber(event);

if (!prNumber) {
  success('No pull request was found for this event; skipping AI Review Gate.');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});

async function main() {
  const [pr, issue, reviews, issueComments, reviewComments] = await Promise.all([
    github(`/pulls/${prNumber}`),
    github(`/issues/${prNumber}`),
    githubPages(`/pulls/${prNumber}/reviews`),
    githubPages(`/issues/${prNumber}/comments`),
    githubPages(`/pulls/${prNumber}/comments`),
  ]);

  if (pr.base.ref !== targetBranch) {
    success(`PR #${prNumber} targets ${pr.base.ref}, not ${targetBranch}; skipping AI Review Gate.`);
  }

  if (pr.draft) {
    success(`PR #${prNumber} is a draft; skipping AI Review Gate until it is ready for review.`);
  }

  const headSha = pr.head.sha;
  const labels = new Set((issue.labels || []).map((label) => label.name));
  const hasOverride = labels.has(overrideLabel);
  const humanApprovedHead = hasHumanApprovalForHead(reviews, headSha);
  const activeBotReviewIds = new Set(
    reviews
      .filter(isBotAuthored)
      .filter((review) => review.state !== 'DISMISSED')
      .map((review) => review.id),
  );
  const candidates = [
    ...reviews.filter(isBotAuthored).filter((review) => review.state !== 'DISMISSED').map(reviewToCandidate),
    ...issueComments.filter(isBotAuthored).map(issueCommentToCandidate),
    ...reviewComments
      .filter(isBotAuthored)
      .filter((comment) => activeBotReviewIds.has(comment.pull_request_review_id))
      .map(reviewCommentToCandidate),
  ].filter((candidate) => candidate.body || candidate.commitSha);

  const currentCandidates = candidates.filter((candidate) => matchesCommit(headSha, candidate.commitSha));
  const blockers = collectBlockers(currentCandidates);

  if (blockers.some((blocker) => blocker.level === 'P0')) {
    writeSummary(pr, headSha, 'failed', [
      'P0 finding found in the latest AI review.',
      ...formatBlockers(blockers),
    ]);
    fail('AI Review Gate failed because the latest Codex review contains a P0 finding.');
  }

  if (blockers.some((blocker) => blocker.level === 'P1')) {
    if (hasOverride && humanApprovedHead) {
      writeSummary(pr, headSha, 'overridden', [
        `P1 finding found, but ${overrideLabel} is set and a human approved the current head.`,
        ...formatBlockers(blockers),
      ]);
      success(`AI Review Gate overridden for P1 findings with ${overrideLabel}.`);
    }

    writeSummary(pr, headSha, 'failed', [
      'P1 finding found in the latest AI review.',
      `Add ${overrideLabel} and obtain a human approval on the current head only if this is an intentional override.`,
      ...formatBlockers(blockers),
    ]);
    fail('AI Review Gate failed because the latest Codex review contains a P1 finding.');
  }

  if (currentCandidates.length > 0) {
    writeSummary(pr, headSha, 'passed', ['Latest-head Codex review found and no P0/P1 findings were detected.']);
    success('AI Review Gate passed.');
  }

  const latestCandidate = candidates.sort((a, b) => b.submittedAt - a.submittedAt)[0];
  const reason = latestCandidate
    ? `Latest Codex review/comment is for ${latestCandidate.commitSha || 'an unknown commit'}, not ${headSha}.`
    : 'No Codex review/comment was found for this PR.';

  if (hasOverride && humanApprovedHead) {
    writeSummary(pr, headSha, 'overridden', [
      reason,
      `${overrideLabel} is set and a human approved the current head.`,
    ]);
    success(`AI Review Gate overridden with ${overrideLabel}.`);
  }

  writeSummary(pr, headSha, 'failed', [
    reason,
    `Wait for Codex to review the current head, or add ${overrideLabel} with a human approval if Codex is unavailable.`,
  ]);
  fail('AI Review Gate failed because no current-head Codex review was found.');
}

function resolvePullRequestNumber(payload) {
  if (payload.pull_request?.number) {
    return payload.pull_request.number;
  }
  if (payload.issue?.pull_request && payload.issue.number) {
    return payload.issue.number;
  }
  if (payload.inputs?.pr_number) {
    return Number(payload.inputs.pr_number);
  }
  return null;
}

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'securezip-ai-review-gate',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed (${response.status}) for ${path}: ${body}`);
  }

  return response.json();
}

async function githubPages(path) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const pageItems = await github(`${path}?per_page=100&page=${page}`);
    items.push(...pageItems);
    if (pageItems.length < 100) {
      return items;
    }
  }
}

function isBotAuthored(item) {
  return botLogins.has(item.user?.login);
}

function isHumanAuthored(item) {
  return item.user?.login && !item.user.login.endsWith('[bot]');
}

function reviewToCandidate(review) {
  return {
    body: review.body || '',
    commitSha: extractReviewedCommit(review.body) || review.commit_id,
    source: `review ${review.id}`,
    submittedAt: parseTimestamp(review.submitted_at || review.submittedAt),
  };
}

function issueCommentToCandidate(comment) {
  return {
    body: comment.body || '',
    commitSha: extractReviewedCommit(comment.body),
    source: `issue comment ${comment.id}`,
    submittedAt: parseTimestamp(comment.updated_at || comment.created_at),
  };
}

function reviewCommentToCandidate(comment) {
  return {
    body: comment.body || '',
    commitSha: extractReviewedCommit(comment.body) || comment.commit_id,
    source: `review comment ${comment.id}`,
    submittedAt: parseTimestamp(comment.updated_at || comment.created_at),
  };
}

function extractReviewedCommit(body) {
  if (!body) {
    return null;
  }

  const match = body.match(/(?:reviewed commit|レビュー済みコミット)\s*[:：]\s*`?([0-9a-f]{7,40})`?/i);
  return match?.[1]?.toLowerCase() || null;
}

function parseTimestamp(value) {
  return Date.parse(value) || 0;
}

function matchesCommit(headSha, candidateSha) {
  if (!candidateSha) {
    return false;
  }

  const head = headSha.toLowerCase();
  const candidate = candidateSha.toLowerCase();
  return head === candidate || head.startsWith(candidate) || candidate.startsWith(head);
}

function hasHumanApprovalForHead(reviews, headSha) {
  const latestByReviewer = new Map();

  for (const review of reviews) {
    if (!isHumanAuthored(review) || !matchesCommit(headSha, review.commit_id)) {
      continue;
    }

    const submittedAt = parseTimestamp(review.submitted_at || review.submittedAt);
    const login = review.user.login;
    const previous = latestByReviewer.get(login);

    if (!previous || submittedAt >= previous.submittedAt) {
      latestByReviewer.set(login, {
        state: review.state,
        submittedAt,
      });
    }
  }

  return Array.from(latestByReviewer.values()).some((review) => review.state === 'APPROVED');
}

function collectBlockers(candidates) {
  const blockers = [];
  const priorityPattern = /^\s*(?:[-*]\s*)?(?:\*\*)?\[?P([01])\]?(?:\*\*)?[\s:.)-]/i;

  for (const candidate of candidates) {
    const lines = candidate.body.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(priorityPattern);
      if (match) {
        blockers.push({
          level: `P${match[1]}`,
          line: line.trim(),
          source: candidate.source,
        });
      }
    }
  }

  return blockers;
}

function formatBlockers(blockers) {
  return blockers.map((blocker) => `${blocker.level} in ${blocker.source}: ${blocker.line}`);
}

function writeSummary(pr, headSha, status, details) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  const lines = [
    '# AI Review Gate',
    '',
    `- PR: #${pr.number}`,
    `- Head: \`${headSha}\``,
    `- Status: ${status}`,
    `- Codex bot logins: ${Array.from(botLogins).join(', ')}`,
    `- Override label: \`${overrideLabel}\``,
    '',
    '## Details',
    '',
    ...details.map((detail) => `- ${detail}`),
    '',
  ];

  fs.appendFileSync(summaryPath, `${lines.join('\n')}\n`);
}

function success(message) {
  console.log(message);
  process.exit(0);
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

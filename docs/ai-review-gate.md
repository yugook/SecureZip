# AI Review Gate

This document describes the first-stage AI Review Gate rollout for pull requests
targeting `main`.

## Current rollout policy

The workflow `.github/workflows/ai-review-gate.yml` is added as a normal check,
but it is not required by branch protection yet. Observe it for one to two weeks
before making it required on `main`.

During the observation period, watch for:

- Codex comment format changes.
- False P0/P1 matches.
- Stale reviews after a force-push or synchronized PR branch.
- Inline review comments that should rerun the gate through the listener relay.
- Dismissed reviews and whether their inline comments are ignored correctly.
- Cases where Codex is unavailable and the override path is needed.

## Gate rules

The gate checks only the latest Codex review result tied to the current PR head
SHA. Older Codex results for the same head are ignored when a newer result is
available. A submitted Codex review and its inline review comments are treated
as one result.

The gate fails when:

- The latest-head Codex review contains a `P0` finding.
- The latest-head Codex review contains a `P1` finding and no approved override
  is present.
- A newer Codex review or comment cannot be tied to the current PR head SHA.
- No Codex review or comment can be tied to the current PR head SHA.

The gate passes when:

- A Codex review or comment tied to the current PR head SHA exists and contains
  no `P0` or `P1` findings.
- `ai-review-override` is present and at least one human reviewer has an
  effective latest review state of approved on the current PR head, except for
  `P0` findings.

Draft pull requests are skipped.

Dismissed Codex reviews and their inline review comments are ignored.

## Override policy

Use the `ai-review-override` label only when Codex is unavailable, stale, or a
`P1` finding has been reviewed and intentionally accepted.

Before applying the label:

1. Confirm the PR has a human approval on the current head SHA.
2. Leave a PR comment explaining why the override is acceptable.
3. Do not override `P0` findings.

Removing the label restores normal AI Review Gate behavior on the next workflow
run.

## Status reporting

The workflow also writes the `AI Review Gate Status` commit status directly to
the PR head SHA. This keeps top-level PR comment updates and review events from
leaving the previous gate result in place when GitHub runs those events on a
non-PR SHA.

Skipped draft and non-`main` pull requests do not publish a commit status.

## Branch protection rollout

After the observation period:

1. Confirm the gate has low false-positive noise.
2. Confirm override handling is understood by maintainers.
3. Add `AI Review Gate Status` to the required status checks for `main`.
4. Keep the `ai-review-override` label available as the service-outage escape
   hatch.

Do not require `AI Review Gate / gate` or `AI Review Gate Listener / capture`.
The former can run on non-PR workflow SHAs, and the latter is only a
low-privilege relay for review and inline-comment events.

The writer workflow uses `pull_request_target` and `workflow_run`, then checks
out the trusted base branch. Review and inline-comment events are captured by
`.github/workflows/ai-review-gate-listener.yml`, which uploads only the PR
number as an artifact. The writer workflow downloads that artifact, reads PR
metadata through the GitHub API, and does not check out or execute PR branch
code.

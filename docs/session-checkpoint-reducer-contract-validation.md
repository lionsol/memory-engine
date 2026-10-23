# Reducer manifest contract and field-level diagnostic verification

Status: implemented and offline-tested; not committed or deployed.
Prepared: 2026-10-23, Asia/Shanghai.

- Base: `2a682589128c2f48b1e2ad7b9c8f21b34c18c76a`.
- Worktree: `/home/lionsol/.devspace/worktrees/memory-engine-a1348ccd`.
- Only one product file changed: `lib/checkpoint/long-session-summary.js`.
- Existing worktrees/main workspace, installed code and dependencies are untouched.
- No executor, card, runtime, cron, provider, DB or service operation was performed.

## Evidence boundary

The preceding run
`manual:7b40cc54-3c66-4183-a0f7-453e3e9cec00:1792718390548:1`
completed all five maps and the reducer request. All map structures/references
passed; the 2,572-unit reducer output was within its 4,000-unit cap and passed
basic structure validation, but failed reducer_coverage_or_structure before
reference validation/publication. The old report did not retain the returned
date/coverage arrays, so it cannot identify which field mismatched.

This change does not reconstruct that response or assert a specific historical
missing ID. It makes future errors diagnosable and clarifies the existing output
contract. It does not remove coverage checks to force a successful result.

## Resulting behavior

- The reducer prompt explicitly supplies the required target_date and exact
  segment/entry arrays. The entry array includes both the long entry and every
  other entry. Segment references cover the long source; entry_id references
  are for OTHER entries only. No metadata is silently supplied after the call
  to repair an invalid provider response.
- Strict date equality, ID type/membership/uniqueness, full reference coverage
  and exact evidence ranges remain enforced. Set order remains irrelevant.
  Existing duplicate-reference handling is unchanged; manifest duplicates fail.
- Distinct reasons identify target date, segment-set, entry-set, structure and
  reference failures. All date/set differences are collected before the first
  primary reason is returned. Invalid JSON and invalid root types are distinct.
- Diagnostics contain only trusted expected IDs, fixed field/type/status names,
  a date-shaped returned value and numeric counts. Arbitrary returned IDs,
  raw references, source text, summaries and error bodies are not copied.
  Unknown counts remain null. Display lists are capped at 16 and flag truncation;
  complete collections still determine pass/fail. A prefilled diagnostic is
  an output sink, never authority to bypass response validation.
- The reducer instruction is 752 UTF-16 units inside its existing 800 cap.
  Explicit arrays consume the unchanged 1,000 metadata / 6,200 input budgets.
  Large contexts still fail closed. No source/request/output/call/attempt/
  deadline/retention budget is raised, and no validation retry is added.
- References remain not_checked after a manifest failure. Completed calls are
  not reported as a valid day until structure, manifest, references and
  publication all pass. semantic_accuracy remains not_verified.

## Verification

A synthetic wrong-date response first failed the new regression on the
unchanged base with the generic reducer_coverage_or_structure reason. After
the correction it returns reducer_target_date and the safe mismatching date.
This is a controlled failure case, not a replay of the unsaved real response.

The initial focused set passed 83/83. The final ten-file regression set passed
**160/160**, zero failures, cancellations or skips, stderr empty:

```bash
cd /home/lionsol/.devspace/worktrees/memory-engine-a1348ccd
MEMORY_ENGINE_TEST_DEPENDENCIES=/home/lionsol/.openclaw/extensions/memory-engine \
/home/lionsol/.local/node24/bin/node \
  --require ./test/checkpoint-dependency-loader.cjs --test \
  test/checkpoint-long-session-summary.test.js \
  test/checkpoint-reducer-contract.test.js \
  test/checkpoint-summary-transport.test.js \
  test/checkpoint-summary-output-budget.test.js \
  test/checkpoint-publication-failures.test.js \
  test/checkpoint-llm.test.js \
  test/checkpoint-episode-writer.test.js \
  test/checkpoint-runtime.test.js \
  test/checkpoint-markers.test.js \
  test/session-flush-reconciliation.test.js
```

Direct validator cases cover missing/extra/duplicate/type-invalid IDs, missing
long versus other entry, multiple simultaneous differences, privacy, null
counts, display truncation with full checking, reference range/coverage errors
and forged diagnostic state. The actual six-call JS/HTTPS/episode path covers
these failures plus invalid JSON/object roots and confirms prior output remains.
The fake main confirms the correct explicit manifest, complete publication,
separate vector backlog and a complete parseable Business status log within
the 30,000-byte fixture boundary. Its inputs are 22,932 long-source units plus
three entries of 366, 356 and 360 units. Existing 347/600/601 boundaries,
fallback/deadline/cancellation, source/episode version, cleanup and Unicode tests
remain active.

All data is synthetic and files temporary; HTTPS and flush/Core/Engine/Lance/
conflict operations are fake. This does not verify real model compliance,
factual quality, runtime log sizes for all inputs or whole-day ingestion.
Diagnostic truncation is not validation truncation. Cooperative-publication
race limitations remain unchanged. CodeGraph was unavailable; direct source
and actual-path tests were used.

## Commit handoff

DevSpace permits Git inspection, not Git-write operations; no new SHA is claimed.
Run in a Git-write-capable WSL/Codex CLI to commit these five task files locally.
This does not deploy, push, change cron or call a provider.

```bash
(
set -eu
WT=/home/lionsol/.devspace/worktrees/memory-engine-a1348ccd
test "$(git -C "$WT" rev-parse HEAD)" = 2a682589128c2f48b1e2ad7b9c8f21b34c18c76a
git -C "$WT" diff --cached --quiet
git -C "$WT" diff --check
git -C "$WT" add -- \
  lib/checkpoint/long-session-summary.js \
  test/checkpoint-long-session-summary.test.js \
  test/checkpoint-reducer-contract.test.js \
  docs/session-checkpoint-long-session-summary.md \
  docs/session-checkpoint-reducer-contract-validation.md
git -C "$WT" diff --cached --check
git -C "$WT" diff --cached --stat
git -C "$WT" commit -m "fix(checkpoint): make reducer coverage contract and failures explicit"
git -C "$WT" rev-parse HEAD
git -C "$WT" status --short
)
```

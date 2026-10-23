# Remove the redundant map evidence-text sublimit

Status: implemented and offline-tested, not committed or deployed.
Prepared: 2026-10-23, Asia/Shanghai.

- Product base: `5446b52991986b30f39a45e5aa9317e1a0ef944e`.
- New worktree: `/home/lionsol/.devspace/worktrees/memory-engine-f6b7aab8`.
- Main workspace changes and earlier frozen worktrees were not modified.
- No runtime/service/scheduler/checkpoint/index/provider operation was performed.
- No dependency, executor, Stage Card or production file was modified.

## Confirmed failure and correction

The 5446b52 historical run associated
`manual:7b40cc54-3c66-4183-a0f7-453e3e9cec00:1792716309750:1`
with a terminal task error. Core coverage passed 4/4. Its first provider request
returned 347 UTF-16 units, within the 600-unit serialized map-output cap, but
`map_text_budget` rejected the evidence text because of the added 160-unit
sublimit. The exact evidence text and its length were not persisted.
Reference and semantic validation did not complete. The run did not publish
a new summary.

The 160-unit sublimit was an unnecessary extra restriction introduced in
5446b52. This follow-up removes its constant, validator and prompt instruction.
It does not enlarge the 600-unit total JSON response budget, and does not
truncate or discard returned evidence to force it under the limit.

Still required: exactly one evidence item; nonempty, well-formed Unicode;
only allowed keys; matching source hash/segment ID and complete range;
all other daily inputs; successful reducer validation and guarded publication.
JSON escaping and metadata consume the same total response budget as text.
Provider attempts, token caps, HTTP envelope limits, deadlines, cancellation,
retention, round budgets and failure diagnostics are unchanged.

The production change is limited to:
- `lib/checkpoint/bounded-summary-provider.js`: remove the unused sublimit.
- `lib/checkpoint/long-session-summary.js`: remove the validator and synchronize
  the prompt with the authoritative total-output cap.

## Verification

A new positive regression was run against the unchanged 5446b52 product before
the correction. The actual JS main/HTTPS decoder path failed with
`map_text_budget`, one request, 347-unit output and no publication.
It then passed after the correction. This is a synthetic size/structure fixture,
not a replay of the unsaved real provider response.

Focused three-file tests passed **46/46**. The final nine-file regression set
passed **119/119**, with zero failures, cancellations or skips and empty stderr:

```bash
cd /home/lionsol/.devspace/worktrees/memory-engine-f6b7aab8
MEMORY_ENGINE_TEST_DEPENDENCIES=/home/lionsol/.openclaw/extensions/memory-engine \
/home/lionsol/.local/node24/bin/node \
  --require ./test/checkpoint-dependency-loader.cjs --test \
  test/checkpoint-long-session-summary.test.js \
  test/checkpoint-summary-transport.test.js \
  test/checkpoint-summary-output-budget.test.js \
  test/checkpoint-publication-failures.test.js \
  test/checkpoint-llm.test.js \
  test/checkpoint-episode-writer.test.js \
  test/checkpoint-runtime.test.js \
  test/checkpoint-markers.test.js \
  test/session-flush-reconciliation.test.js
```

The regression uses actual JS reader/budget/main, adapter, HTTP decoder and
publication with synthetic data, temporary directories and fake HTTPS.
The full-main success has a 22,932-unit source plus three same-day entries
of 366, 356 and 360 units. Each map is exactly 347 serialized UTF-16 units,
with evidence text >160. Other entries reach the reducer; original clipping
and vector backlog remain separate from summary completion.

Additional actual HTTP/summary tests accept valid 347- and 600-unit map JSON,
including Unicode split across network bytes. Valid JSON of 601 units is
rejected on the first request with content output_budget; no fallback occurs
and the old episode remains unchanged. Wrong references, extra keys/evidence,
invalid Unicode, source/episode changes, missing coverage, cleanup failure,
timeouts/cancellation and aggregate fallback-budget tests remain active.

A fake compliant provider does not prove future real-provider compliance or
semantic quality. Range/reference validity remains mechanical association;
semantic_accuracy remains not_verified. The existing cooperative-lock race
limitations are unchanged. A 600-unit response can still omit relevant details.

CodeGraph tools were unavailable; direct source inspection and actual JS-path
tests were used. Historical ops records and the spent run authorization remain
unchanged. No runtime retry is authorized by this source repair.

## Commit handoff

The DevSpace tool exposes no Git-write operation; no new commit SHA is claimed.
In the original WSL or Codex CLI, this command stages only six task files and
creates a local commit. It does not push, deploy, change cron or call a provider.

```bash
(
set -eu
WT=/home/lionsol/.devspace/worktrees/memory-engine-f6b7aab8
test "$(git -C "$WT" rev-parse HEAD)" = 5446b52991986b30f39a45e5aa9317e1a0ef944e
git -C "$WT" diff --cached --quiet
git -C "$WT" diff --check
git -C "$WT" add -- \
  lib/checkpoint/bounded-summary-provider.js \
  lib/checkpoint/long-session-summary.js \
  test/checkpoint-long-session-summary.test.js \
  docs/session-checkpoint-long-session-summary.md \
  docs/session-checkpoint-map-output-contract-validation.md \
  docs/session-checkpoint-map-text-sublimit-removal-validation.md
git -C "$WT" diff --cached --check
git -C "$WT" diff --cached --stat
git -C "$WT" commit -m "fix(checkpoint): use total map output budget without text sublimit"
git -C "$WT" rev-parse HEAD
git -C "$WT" status --short
)
```

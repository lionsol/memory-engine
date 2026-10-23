# Map output contract and bounded-response diagnostics

> Historical record for the 5446b52 implementation. Its 160-unit evidence-text
> sublimit caused a later real-run rejection inside the 600-unit total cap.
> The follow-up removes that sublimit; see
> [text-sublimit correction](session-checkpoint-map-text-sublimit-removal-validation.md)
> for the current behavior and verification.

Status: implemented and tested in an isolated worktree; not committed or deployed.

- Product base: `93aa1e077787fa3774f16e18be97edc925322444`.
- Worktree: `/home/lionsol/.devspace/worktrees/memory-engine-f2a56802`.
- Main workspace changes, frozen 93aa1e0 worktree, installed code, executor,
  cards, cron and existing runtime data were not modified.
- No real checkpoint/indexing/provider/service/scheduler operation was run.
- No dependency installation, lockfile change or budget increase.

## Evidence and problem

The readiness-r2 execution associated Run ID
`manual:7b40cc54-3c66-4183-a0f7-453e3e9cec00:1792682844134:1`
with a terminal task error. Core coverage was 4/4. The complete 22,932-character
source entered five planned segments, but the first map attempt failed with
`output_budget`. The persisted report did not retain the diagnostic subtype
or measured response sizes. It cannot establish whether content or the
response envelope exceeded its cap. No original provider body was reconstructed
or read for this change.

This repair addresses the known diagnostic loss and makes the map output
contract smaller and more explicit. It does not claim to have reconstructed
the missing response or proven a successful future provider run.

## Product changes

1. Map output remains <=600 UTF-16 units including JSON escaping. It now requires
   exactly one evidence item, no extra fields and nonempty, well-formed text
   <=160 units. The segment ID/hash and complete start/end are copied from
   request metadata. The 160-unit text limit is a new conservative restriction
   within the existing envelope; it leaves room for metadata and serialization.
   It is not a semantic coverage/quality guarantee.
2. The HTTP decoder distinguishes `content`, `response_envelope`,
   `provider_tokens` and `content_type`, preserving only safe numeric counts
   and recognized finish reasons. Local output caps and provider token caps
   are reported as different units. A bounded response ending with
   `finish_reason=length` fails even if short and valid-looking.
3. The adapter retains these diagnostics in the round ledger. Unknown counts
   stay absent, not zero; unrecognized metadata/error bodies do not escape.
   The configured output limit remains authoritative. An output-budget error
   still terminates without retry/fallback. Attempt/reservation accounting and
   abort/deadline handling remain in the shared bounded adapter.
4. A map request/structure/reference failure now marks that segment failed and
   records `failure_stage`. Later unattempted segments remain pending.
   Reducer/publication failures are separately staged. Publication protection
   is unchanged.

All original source, segment, overlap, prompt, call/attempt, input, output,
retention and time limits remain. No budget is increased. Other daily entries
still enter the reducer. Evidence ranges now denote the complete supplied
segment and mechanically bind it to a request; they do not prove all its facts
were retained or that the output is accurate.

## Verification

Initial focused set: 43/43 passed. After diagnostic-authority and zero-content
checks, the final nine-file regression set passed **117/117**, zero failed,
cancelled or skipped; stderr empty. This is 17 additional tests over the
93aa1e0 eight-file 100-test baseline.

```bash
cd /home/lionsol/.devspace/worktrees/memory-engine-f2a56802
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

Tests use actual JS reader/budget/main, summary adapter, HTTP decoder and episode
writer with synthetic data and fake HTTPS. The mixed-input success fixture has
a complete 22,932-unit source and three other entries of 366, 356 and 360 units.
Five maps plus one reducer complete and publish, while original clipping and
vector backlog remain separately reported. Unicode output is decoded bytewise.
The fake-backed main replaces flush/Core/Engine/Lance/conflict operations.

Failure tests separately exercise a 601-unit content response, oversized decoded
envelope, provider token truncation, non-text/zero content, unrecognized
diagnostics, extra evidence/keys, too-long text, wrong source range and malformed
Unicode. They confirm no fallback on output exhaustion, correct failed-map
status and preservation of the existing episode. Prior failure/missing-input,
cancellation, fallback accounting, source/episode concurrent change, cleanup and
Unicode regressions remain in the suite.

CodeGraph tools were unavailable, so direct source inspection and actual JS
path tests were used. Fake provider compliance does not validate real model
behavior, semantic accuracy, upstream conversation completeness or runtime
health. The short map may omit details. Existing cooperative-lock and external
writer race limitations are unchanged.

## Commit handoff

No new commit SHA is asserted. The DevSpace shell supports tests and Git
inspection, not Git mutation; no alternative metadata-writing path was used.
The following command is for a Git-write-capable WSL terminal or Codex CLI.
It stages only these eight task files, commits locally and does not deploy,
push, modify cron or call a provider.

```bash
(
set -eu
WT=/home/lionsol/.devspace/worktrees/memory-engine-f2a56802
test "$(git -C "$WT" rev-parse HEAD)" = 93aa1e077787fa3774f16e18be97edc925322444
git -C "$WT" diff --cached --quiet
git -C "$WT" diff --check
git -C "$WT" add -- \
  lib/checkpoint/bounded-summary-provider.js \
  lib/checkpoint/llm.js \
  lib/checkpoint/long-session-summary.js \
  test/checkpoint-long-session-summary.test.js \
  test/checkpoint-summary-http-fixture.cjs \
  test/checkpoint-summary-output-budget.test.js \
  docs/session-checkpoint-long-session-summary.md \
  docs/session-checkpoint-map-output-contract-validation.md
git -C "$WT" diff --cached --check
git -C "$WT" diff --cached --stat
git -C "$WT" commit -m "fix(checkpoint): bound map evidence and preserve output diagnostics"
git -C "$WT" rev-parse HEAD
git -C "$WT" status --short
)
```

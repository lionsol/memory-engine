# P4 Timestamp Pollution Summary

## Scope

- Branch: `fix/timestamp-pollution-audit`
- Mode: read-only audit only
- No memory mutation
- No DB writes
- No cleanup or backfill
- No recall behavior change
- No quality score formula change beyond diagnostic reporting
- No Console integration

## Current Count

- `timestamp_pollution_total = 164`
- `default scope count = 57`
- `all scope count = 164`
- `lifecycle-owned count = 57`
- `core-owned count = 9`
- `generated_or_diagnostic count = 98`
- `legacy_or_manual count = 0`
- `unknown count = 0`

Interpretation:

- The current live issue is not confined to historical diagnostic-only material.
- The majority is outside default quality scope under `dreaming`, but `57` lifecycle-owned entries still affect the default score population.

## Breakdown

### Owner

- `memory_engine_generated_or_diagnostic = 98`
- `memory_engine_lifecycle = 57`
- `openclaw_core = 9`

### Family

- `dreaming = 98`
- `smart_add = 56`
- `daily_memory = 9`
- `episode = 1`

### Category

- `null = 107`
- `raw_log = 53`
- `episodic = 3`
- `preference = 1`

### Dominant Paths

- `memory/dreaming/* = 98`
- `memory/smart-add/* = 56`
- `memory/YYYY-MM-DD-HHMM.md = 9`
- `memory/episodes/2026-05-31.md = 1`

## Historical vs Current Pipeline

- `created_before_raw_log_fix = 159`
- `unknown_fix_window = 5`
- `created_after_raw_log_fix = 0`

Interpretation:

- There is no evidence in this snapshot that the current post-fix pipeline is still generating new timestamp-polluted entries.
- The population is overwhelmingly historical residue.
- The remaining `5` ambiguous-window rows should be treated as "uncertain timing" rather than proof of a live regression.

## Retrieval / Injection Impact

- `retrieved_count_total = 156`
- `injected_count_total = 4`
- `entries_ever_retrieved = 9`
- `entries_ever_injected = 3`

Interpretation:

- Timestamp pollution is not purely dormant debt.
- Some polluted chunks have already participated in recall and injection, so cleanup should remain deferred until source attribution and risk segmentation are tighter.

## Likely Source Ranking

- `generated_artifact = 89`
- `smart_add_writer = 31`
- `checkpoint_input = 19`
- `raw_log_parser = 8`
- `healthcheck_note = 7`
- `session_event_formatter = 5`
- `autoRecall_trace = 4`
- `unknown = 1`

Interpretation:

- The largest bucket is `dreaming` generated material.
- The default-scope impact is mostly lifecycle-owned `smart_add` residue carrying raw timestamps, log lines, or copied operational text.
- Core daily session files contribute a small but notable false-positive-review bucket.

## Top Examples

### Lifecycle-owned / default-scope examples

- `memory/smart-add/2026-05-09.md`
  - category: `raw_log`
  - matched pattern: `spaced_datetime`
  - matched text: `2026-05-09 16:21:33`
  - preview: `[2026-05-09 16:21:33][ERROR] Failed to load model ...`
  - likely source: `session_event_formatter`
  - retrieved/injected: `0 / 0`
  - current reading: looks like historical raw operational output stored into smart-add content

- `memory/smart-add/2026-05-30.md`
  - category: `episodic`
  - matched pattern: `iso_utc_datetime`
  - matched text: `2026-05-30T19:30:03.691Z`
  - preview: `knowledge-graph-memory... <!-- smart-add-fingerprint: ... --> ## 2026-05-30_episodic_nightly_...`
  - likely source: `smart_add_writer`
  - retrieved/injected: `56 / 1`
  - current reading: historical smart-add content containing timestamp-bearing normalized note text, with real recall usage

- `memory/episodes/2026-05-31.md`
  - category: `episodic`
  - matched pattern: `iso_utc_datetime`
  - matched text: `2026-06-01T08:50:00.000Z`
  - likely source: `unknown`
  - retrieved/injected: `10 / 2`
  - current reading: highest-risk lifecycle-owned sample because it is both default-scope and recall-visible

### Core-owned false-positive-review examples

- `memory/2026-05-10-2037.md`
  - family: `daily_memory`
  - matched text: `2026-05-10 20:37:27`
  - preview: `# Session: 2026-05-10 20:37:27 GMT+8 ...`
  - likely source: `raw_log_parser`
  - recommended action: `false_positive_rule_review`
  - current reading: this looks like structured session heading content, not necessarily harmful pollution

- `memory/2026-05-18-1249.md`
  - family: `daily_memory`
  - matched text: `2026-05-18 12:49:27`
  - preview: `# Session: 2026-05-18 12:49:27 GMT+8 ...`
  - likely source: `raw_log_parser`
  - recommended action: `false_positive_rule_review`

## Recent-After-Fix Examples

- None in the post-fix bucket.

Interpretation:

- The audit did not find any timestamp-polluted entries created after the current post-fix boundary.
- That weakens the case for an urgent live pipeline regression fix in P4A itself.

## Main Conclusions

1. `timestamp_pollution = 164` is real in the broad indexed set, but it is mostly historical residue rather than proven current generation.
2. The dominant source family is `dreaming`, which is ownership-wise diagnostic/generated and should be interpreted separately from lifecycle-owned quality debt.
3. Default-score impact still exists because `57` lifecycle-owned entries are timestamp-polluted, mostly under `memory/smart-add/*`.
4. A small core-owned bucket under `memory/YYYY-MM-DD-HHMM.md` looks like plausible detector false positives on session headings rather than harmful injected operational noise.
5. Retrieval impact is limited but non-zero, so broad cleanup should remain deferred.

## Whether Source Fix Is Needed Now

- Immediate historical cleanup is not justified yet.
- A source fix may still be needed for the lifecycle-owned `smart_add` path if those entries came from older checkpoint/session formatting behavior that can still be reintroduced, but P4A does not show evidence of active new creation after the current fix boundary.
- The detector itself likely needs review for core daily session headings, because those examples resemble structured metadata rather than contamination.

## Why Historical Cleanup Is Deferred

- This task is audit-only.
- Some polluted entries were retrieved or injected, so deleting or rewriting them now would be behavior-affecting.
- The current population mixes:
  - generated diagnostic artifacts
  - historical smart-add residue
  - possible core-note false positives
- That mix needs a narrower P4B decision before any cleanup action is safe.

## Recommended P4B

- Confirm whether lifecycle-owned `smart_add` timestamp pollution can still be produced by the current checkpoint/session summarization path under a controlled fixture.
- Review whether `daily_memory` session-heading matches should be excluded from timestamp-pollution flagging or downgraded to diagnostic-only.
- Isolate the single `episode` / `unknown` lifecycle-owned sample for manual provenance tracing.
- Keep historical cleanup deferred until the detector false-positive boundary and lifecycle-owned source path are both clearer.

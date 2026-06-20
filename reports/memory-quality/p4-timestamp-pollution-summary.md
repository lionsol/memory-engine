# P4 Timestamp Pollution Summary

## Scope

- Branch: `fix/timestamp-pollution-audit`
- P4B mode: provenance verification, detector refinement, and fixture-level regression coverage only
- No DB writes
- No memory cleanup
- No backfill
- No recall behavior change
- No Console change

## Before / After

P4A live baseline before detector refinement:

- `all scope timestamp_pollution = 164`
- `default scope timestamp_pollution = 57`
- `generated_or_diagnostic = 98`
- `lifecycle = 57`
- `core = 9`
- `family: dreaming=98, smart_add=56, daily_memory=9, episode=1`
- `retrieved_count_total = 156`
- `injected_count_total = 4`
- `entries_ever_retrieved = 9`
- `entries_ever_injected = 3`

P4B live result after detector refinement:

- `all scope timestamp_pollution = 154`
- `default scope timestamp_pollution = 56`
- `generated_or_diagnostic = 98`
- `lifecycle = 56`
- `core = 0`
- `family: dreaming=98, smart_add=56`
- `retrieved_count_total = 146`
- `injected_count_total = 2`
- `entries_ever_retrieved = 8`
- `entries_ever_injected = 2`

Delta:

- `all scope`: `164 -> 154` (`-10`)
- `default scope`: `57 -> 56` (`-1`)
- `core-owned`: `9 -> 0`
- `episode`: `1 -> 0`

Interpretation:

- The removed `10` were detector false positives, not cleaned data.
- The reduction is fully explained by:
  - `daily_memory session-heading false positives = 9`
  - `episode structured generated footer false positive = 1`

## Episode Provenance

Target sample:

- `path = memory/episodes/2026-05-31.md`
- previous matched timestamp = `2026-06-01T08:50:00.000Z`
- previous retrieval/injection = `10 / 2`

Resolved provenance:

- The matched timestamp came from the footer line:
  - `_Generated at 2026-06-01T08:50:00.000Z — 基于 6/1 复盘补录_`
- This is structured checkpoint-style episode metadata, not a raw-log line.
- The file also contains prose indicating retrospective补录 rather than copied event trace.
- Current checkpoint episode writer and marker writers intentionally emit:
  - `generatedAt: ...`
  - `_Generated at ..._`
- Therefore this sample is best explained as historical checkpoint/LLM-produced episode metadata, not raw-log summarizer pollution and not runtime recall trace.

Conclusion:

- Episode provenance is resolved enough for P4B.
- It should no longer count as default timestamp pollution.

## Detector Refinement

P4B changed the detector from "any timestamp match" to "timestamp match plus context classification".

Now distinguished explicitly:

1. `raw_log_operational_residue`
   - still penalized
   - examples:
     - `[2026-05-09 16:21:33][ERROR] Failed to load model ...`
     - `[04:22:56] ASST: ...`

2. `embedded_log_timestamp`
   - still penalized
   - examples:
     - ISO timestamps embedded in lifecycle-owned smart-add content
     - operational summaries carrying copied timestamped payloads

3. `normal_session_heading`
   - not penalized
   - example:
     - `# Session: 2026-05-10 20:37:27 GMT+8`

4. `structured_generated_metadata`
   - not penalized
   - examples:
     - `generatedAt: 2026-06-18T01:23:45.000Z`
     - `_Generated at 2026-06-18T01:23:45.000Z_`

5. `normal_markdown_date_heading`
   - not penalized
   - example:
     - `## 2026-06-08 会议纪要`

Important boundary:

- This refinement does not make lifecycle smart-add timestamps universally acceptable.
- Embedded ISO timestamps inside smart-add content still count when they are part of copied operational or synthetic note payloads rather than isolated structural metadata.

## Current Live Breakdown

After refinement:

- owner:
  - `memory_engine_generated_or_diagnostic = 98`
  - `memory_engine_lifecycle = 56`
- family:
  - `dreaming = 98`
  - `smart_add = 56`
- category:
  - `null = 98`
  - `raw_log = 53`
  - `episodic = 2`
  - `preference = 1`
- likely source:
  - `generated_artifact = 89`
  - `smart_add_writer = 31`
  - `checkpoint_input = 19`
  - `healthcheck_note = 6`
  - `session_event_formatter = 5`
  - `autoRecall_trace = 4`

## Historical Split

After refinement:

- `created_before_raw_log_fix = 149`
- `unknown_fix_window = 5`
- `created_after_raw_log_fix = 0`

Conclusion:

- There is still no evidence that the post-fix pipeline is actively creating new timestamp-polluted entries.
- P4B strengthens the P4A conclusion that the live population is historical residue plus detector false positives, not a proven current regression.

## Retrieval / Injection Impact

After refinement:

- `retrieved_count_total = 146`
- `injected_count_total = 2`
- `entries_ever_retrieved = 8`
- `entries_ever_injected = 2`

Interpretation:

- The false-positive refinement removed one recall-visible episode sample.
- The remaining polluted set still has real recall/injection usage, so historical cleanup remains unsafe to do blindly.

## Fixture-Level Regression Coverage

Added coverage proves:

- normal session headings are not treated as default timestamp pollution
- checkpoint episode writer output with structured `generatedAt` metadata is not treated as default timestamp pollution
- clean smart-add writer output remains clean
- smart-add content carrying operational timestamp residue still triggers timestamp pollution
- lifecycle quality evaluation still flags genuine raw-log style timestamp payloads

## Why Historical Cleanup Remains Deferred

- This task did not mutate content or DB state.
- The remaining `154` records are still a mixed population:
  - generated dreaming artifacts
  - lifecycle smart-add historical residue
  - a small number of recall-visible polluted lifecycle entries
- Cleanup still needs a separate decision with provenance-by-source and usage risk in hand.

## Recommended P4B Outcome

- Keep the detector refinement.
- Treat the `daily_memory` session-heading bucket as resolved false positive noise for timestamp quality scoring.
- Treat the single episode sample as resolved structured metadata rather than raw-log pollution.
- Do not do broad source fixes or cleanup yet.
- If there is a P4C, focus only on the remaining lifecycle-owned `smart_add` historical residue and the small recall-visible subset.

# P2 Ownership Scope Summary

## Scope

- Branch: `fix/chunks-without-confidence-audit`
- Purpose: P2 ownership-aware quality scope audit, closure verification, and stale index follow-up record
- No lifecycle behavior changes
- No recall filtering changes
- No index sync changes
- No runtime changes
- No confidence backfill
- No category backfill

## Key Conclusions

- `lifecycle-owned missing confidence = 0`
- `default scope missing confidence = 1`
- `all indexed missing confidence = 1504`
- `non-lifecycle recall warning = 16 retrieved / 1 injected`
- `memory/daily.md` source file was deleted as a stray miswritten workspace artifact
- natural core index prune did not occur in this run
- `sync-memory-index.js` no longer hard-fails on a missing local `openclaw` package
- current environment still does not naturally prune the stale `memory/daily.md` core index row

## Residual Stale Default-Scope Record

- `chunk_id`: `9e31c92ffb496582dbb40c2d16c19fdd9e8c6d098484f7fcd1a5810b2c929f7f`
- `path`: `memory/daily.md`
- `source_type`: `memory`
- `created_at`: `2026-06-15T14:35:56.921Z`
- `content_preview`: `## 2026-06-08 01:00 硅基流动健康检查 ✅ LLM — OK ✅ Embedding — OK（dim=2560） ✅ Vision — OK`
- `reason`: `unknown memory paths are suspicious and should stay in default quality scope until classified explicitly`
- `expected_confidence`: `true`
- `default_quality_score_scope`: `true`
- These values are from the quality classifier's current treatment of unknown indexed memory paths. The source file has since been deleted, so this is now a stale index residue rather than a live unknown source.

P2D status:

- source file `/home/lionsol/.openclaw/workspace/memory/daily.md` has been deleted
- core DB still contains stale index rows for `memory/daily.md`
- `core.chunks` count for that path: `1`
- `core.files` count for that path: `1`

## Score Scope Verification

- Before ownership-aware default scope, the effective scoring population matched the broader indexed-memory set now exposed by `--scope all`.
- Before / broad scope:
  - `total_evaluated = 4582`
  - `average_score = 80.07`
  - `chunks_without_confidence = 1504`
- After ownership-aware default scope:
  - `total_evaluated = 3079`
  - `average_score = 89.92`
  - `chunks_without_confidence = 1`

Conclusion:

- `default quality score` now uses only candidates with `default_quality_score_scope = true`.
- Evidence:
  - default scope owner distribution: `memory_engine_lifecycle = 3078`, `unknown = 1`
  - default scope missing-confidence count is `1`, and `lifecycle-owned missing confidence` is `0`
  - broad `--scope all` still reports the full `1504` diagnostic set

P2D expected-vs-actual:

- expected after delete + successful natural prune:
  - `default scope missing confidence = 0`
  - `all indexed missing confidence = 1503`
- actual in this environment:
  - `default scope missing confidence = 1`
  - `all indexed missing confidence = 1504`

Reason:

- the source file is gone, but the current core index still retains a stale `memory/daily.md` row

If score had remained `80.07`, that would have meant non-default-scope candidates were still contributing to default scoring. That is not what the live run shows.

## Owner Breakdown For 1504

- `memory_engine_generated_or_diagnostic = 1338`
- `openclaw_core = 159`
- `memory_engine_legacy_or_manual = 5`
- `raw_or_legacy = 1`
- `unknown = 1`
- `memory_engine_lifecycle = 0`

Grouped by requested closure buckets:

- `lifecycle-owned = 0`
- `core-owned = 159`
- `generated/diagnostic = 1338`
- `legacy/manual = 6`
- `unknown = 1`

## Recall Warnings

- `non_lifecycle_retrieved_count = 16`
- `non_lifecycle_injected_count = 1`

Observed warning sources include:

- `memory/dreaming/light/*` under owner `memory_engine_generated_or_diagnostic`
- `memory/YYYY-MM-DD*.md` under owner `openclaw_core`

Interpretation:

- Some non-lifecycle-owned indexed memory remains retrieval-visible to memory-engine recall.
- This is diagnostic signal, not evidence that those chunks should be confidence-backfilled automatically.

## Why No Backfill Was Done

- The audit establishes that the `1504` missing-confidence rows are not a lifecycle-owned confidence failure.
- `memory_engine_lifecycle` contributes `0` missing-confidence chunks in the broad indexed set.
- The dominant missing-confidence owners are:
  - generated/diagnostic `dreaming`
  - core-owned daily/curated memory
  - small legacy/manual residue
- Backfilling these rows would convert an ownership/scope distinction into a data mutation without a product decision.
- The task explicitly required audit and closure verification only, with no behavior repair.

## P2D Delete / Prune Verification

- `memory/daily.md` was confirmed as a `114` byte workspace file under `/home/lionsol/.openclaw/workspace/memory/`
- it is not part of this repository and is not git-tracked here
- repository search found no script or plugin references to that path
- it was deleted directly from the workspace as a safe historical miswrite

Existing natural-prune attempt:

- command: `node bin/sync-memory-index.js --force`
- result: failed before executing sync
- error: `Cannot find package 'openclaw' imported from /home/lionsol/.openclaw/workspace/plugins/memory-engine/memory-manager-runtime.js`

Interpretation:

- no manual DB repair was applied
- no manual `DELETE core.files/core.chunks`
- no confidence backfill
- no category backfill
- the residual `unknown=1` is now best explained as stale core index state, not a live source file

## P2E Sync CLI Dependency / Stale Prune Audit

What changed:

- `memory-manager-runtime.js` now normalizes the missing-harness dependency into a clear runtime error instead of surfacing the raw package-import exception.
- `bin/sync-memory-index.js` now falls back to the sanctioned `openclaw memory index --agent main --force` path when the local `openclaw/plugin-sdk` runtime package is unavailable.
- no direct SQL delete was added
- no core write guard was weakened
- no new `memory/daily.md` classifier was introduced

Verification:

- `node bin/sync-memory-index.js --force` now runs and returns JSON instead of crashing at import/manager resolution time.
- observed output:
  - `manager_error = openclaw runtime package unavailable; sync-memory-index requires the OpenClaw harness runtime or the openclaw plugin SDK package`
  - `sync_result.delegated = true`
  - `sync_result.via = openclaw memory index`
- direct manual check of the sanctioned path:
  - command: `openclaw memory index --agent main --force --verbose`
  - observed terminal output included: `Memory search disabled.`

Stale core index status:

- before delegated sync:
  - `core.files WHERE path='memory/daily.md' = 1`
  - `core.chunks WHERE path='memory/daily.md' = 1`
- after delegated sync:
  - `core.files WHERE path='memory/daily.md' = 1`
  - `core.chunks WHERE path='memory/daily.md' = 1`

Conclusion:

- the original CLI dependency problem was real: the wrapper path was coupled to a harness-only Node package
- the wrapper is now decoupled enough to use the sanctioned OpenClaw CLI path when that package is absent
- stale prune still did not happen in this environment
- the blocking reason is no longer the raw missing-package exception
- the remaining backlog is that the available OpenClaw index path is effectively no-op here because `Memory search disabled.`

Root cause of `Memory search disabled.`:

- main agent config has `memorySearch.enabled: false`
- this was intentionally disabled on 2026-06-13 to avoid duplicate memory-context injection between OpenClaw core memory search and memory-engine recall
- OpenClaw core currently uses this same flag to gate `MemoryIndexManager` initialization
- therefore disabling runtime memory search also disables index maintenance/prune
- this prevents deleted memory files such as `memory/daily.md` from being naturally pruned from `core.files` / `core.chunks`

Interpretation:

- this is an OpenClaw core configuration-semantics issue
- runtime recall/search and index maintenance are currently coupled under one flag
- memory-engine should not patch around this by direct DB deletion or path-specific classifier rules

## Safety Verification

- `quality-scope.js` is only referenced from:
  - `lib/quality/collect-quality-candidates.js`
  - `lib/quality/path-family.js`
  - `lib/quality/chunks-without-confidence-audit.js`
  - tests
- It is not imported by recall, index sync, session checkpoint runtime, or other runtime behavior paths.

## Final P2 Position

- P1 orphan-confidence cleanup remains valid and is unaffected by the P2 ownership-scope change.
- The remaining `1504` issue is now split correctly into diagnostic ownership buckets.
- The default quality score now reflects lifecycle-owned quality expectations instead of penalizing broad indexed memory that memory-engine does not own.
- After deleting the only live unknown source file, `default scope` is still not zero solely because the stale core index row remains.
- The sync wrapper issue is fixed, but current OpenClaw runtime state still leaves index prune as external backlog:
  - `default scope missing confidence = 1`
  - `lifecycle-owned missing confidence = 0`
  - `all indexed missing confidence = 1504`

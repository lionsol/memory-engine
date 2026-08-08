# AutoRecall Bounded Candidate Provenance Observability Stage Card — 2026-08-08
> Status: `FROZEN` — implementation requires separate Sol authorization
>
> Repository HEAD before this card: `c365f49b246e8e4a73c2bf3d346501fb4ff5340e`
>
> This card authorizes no coding, deployment, or data mutation.

## Decision
Can memory-engine persist minimal bounded candidate provenance so a future natural AutoRecall failure can distinguish:
~~~text
candidate absent from applicable channels
vs
candidate surfaced by a channel but lost in fusion/preselection
~~~
without changing retrieval behavior or configuration?

## Evidence basis
The authorized seven-turn H6 first-loss audit closed `PASS_WITH_FINDINGS / MIXED_OR_INSUFFICIENT_EVIDENCE`:
- FTS did not preserve the established answer-bearing chunks.
- No common query-formation defect was proven.
- Vector/recent telemetry stored counts but not candidate IDs.
- Historical evidence cannot separate channel/index loss from fusion/preselection loss.
Do not replay those historical turns to fill the gap.

## User value
Future natural failures should be diagnosable from their original trace instead of synthetic replay, index reconstruction, or retrieval-policy guessing.

## In scope
1. Add bounded content-free per-channel candidate ID provenance to the existing `hybridSearch()` debug object.
2. Persist it, plus sanitized existing fusion pre/post IDs, through the AutoRecall debug metadata projector.
3. Add focused tests for boundedness, privacy, and retrieval-behavior invariance.

## Intended production surface
Only:
- `lib/recall/hybrid-search.js`;
- `lib/recall/auto-recall-debug-metadata.js`.
Tests may update directly relevant retrieval/debug/privacy suites.
If implementation requires channel collectors, fusion logic, query shaping, gate logic, config, DB schema, or another product subsystem, stop for scope review.

## Provenance contract
Per active channel persist a structure equivalent to:
~~~text
channel_candidate_provenance = {
  <channel>: {
    count,
    captured_count,
    truncated,
    ids: [short_id_in_channel_order]
  }
}
~~~
Rules:
- IDs use the existing 16-character bounded memory ID convention.
- Array order preserves existing channel candidate order.
- Hard internal limit is `32` IDs per channel.
- `count` is the actual channel array size.
- `captured_count` is the number of persisted IDs.
- `truncated=true` when `count > captured_count`.
- The limit is internal and creates no new config option.

Persist sanitized existing fusion provenance as:
~~~text
fusion_candidate_provenance = {
  pre_rerank_ids: [...],
  post_rerank_ids: [...]
}
~~~
Both fusion lists remain bounded to the existing top-eight debug window. Existing debug fields remain backward compatible; do not rename or remove them.

## Privacy contract
Persistent provenance must contain no:
- memory text/body or `preview`;
- path/file name;
- prompt/query/focused-query text;
- exact fragments;
- arbitrary candidate metadata.
Only bounded IDs, counts, truncation state, and channel/fusion grouping are required.

## Behavior invariants
Do not change:
- candidate generation/filtering;
- query/focused-query formation;
- FTS/vector/recent/KG behavior;
- channel ordering or fusion inputs/scoring;
- result IDs/order/scores;
- `topK`, thresholds, weights, Card/gate policy, or projection length;
- AutoRecall enablement/allowlists/rollout.
Observability must be derived from existing channel/fusion results and never feed back into retrieval.

## Non-goals
Do not:
- fix or replay the historical H6 turns;
- run live retrieval, a canary, or a synthetic retrieval probe;
- add a DB table, event type, config object, CLI, state machine, or OpenSpec change;
- change capture, indexing, backfill, checkpoint, smart-add, or episode behavior;
- install/reload/restart OpenClaw or mutate runtime/config/DB/session/memory;
- resume Candidate-Builder/timeout work;
- commit, tag, or push without separate authorization.

## Verification
Targeted tests must prove:
- per-channel capture is complete at or below 32 and explicitly truncated above 32;
- fusion ID lists are bounded to eight;
- persistent telemetry contains no content/path/query leakage;
- existing retrieval result IDs/order/scores remain unchanged.
Run the full Node test suite after targeted tests because shared retrieval debug plumbing is touched. No runtime installation is required for source-level PASS.

## Pass criteria
1. Provenance is additive, bounded, ID-only, and privacy-safe.
2. Targeted tests plus full Node suite pass with retrieval behavior unchanged.
3. Changes remain within the intended source surface and tests, with no runtime/config/data mutation.

## Stop conditions
Stop if:
- instrumentation changes any result, score, ordering, or gate decision;
- content-bearing fields are needed for persistence;
- channel/fusion policy or another product subsystem must change;
- a new config/schema/event type is proposed;
- live/synthetic retrieval is proposed to prove this source-only contract;
- an unrelated subsystem enters scope.

## Allowed mutations
During separately authorized implementation:
- the two intended production source files;
- directly relevant tests/snapshots.
No runtime, config, DB, session, memory, service, historical evidence, tag, or push mutation is authorized.

## Stage outcomes
Use exactly one:
~~~text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
~~~

## Authorization boundary
Implementation authorization must bind the exact committed Stage Card, repository HEAD, and finite execution count under `docs/decisions/project-authorization-policy.md`.
Codex must implement/test only this stage, report the result and one smallest next decision, then stop. It may not deploy runtime, create/commit a successor Stage Card, or begin retrieval tuning under the same authorization.

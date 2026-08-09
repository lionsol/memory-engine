# AutoRecall R3 Natural-Sample First-Loss Attribution Stage Card — 2026-08-09

> Status: `FROZEN` — not committed and authorizes no execution
>
> Repository HEAD at freeze: `51aa4579bf252a46d8a378eca14ca4b369534317`
>
> Commit authorization and execution authorization remain separate. Any later execution must bind the exact committed/frozen card, exact repository HEAD, exact scope, and finite execution count; default `MAX_EXECUTIONS=1`.

## Decision

For the already completed R3 genuine natural-use duty-schedule turn, where is the earliest evidenced loss boundary for the independently established answer-bearing memory candidate?

Choose exactly one attribution if preserved evidence is sufficient:

~~~text
CHANNEL_OR_INDEX_COLLECTION_LOSS
FUSION_OR_PRESELECTION_LOSS
LATER_SELECTION_OR_GATING_LOSS
ANSWER_BEARING_CANDIDATE_NOT_LOST
~~~

If preserved evidence cannot support exactly one attribution without a live rerun or mutation, the stage outcome is `INSUFFICIENT_EVIDENCE`.

The four allowed attributions intentionally do not include a query-formation category. Before assigning `CHANNEL_OR_INDEX_COLLECTION_LOSS`, preserved R3 query/focused-query evidence must be adequate for the answer-bearing concept. If query formation is itself materially deficient or remains a plausible unresolved earlier cause, close `INSUFFICIENT_EVIDENCE` rather than misclassifying it as channel/index loss.

## Why this sample is eligible

This card does not create new test traffic and does not reopen the dedicated canary chain.

The current roadmap says to wait for **or select** a naturally occurring AutoRecall success/failure with independent answer-bearing evidence. The existing R3 turn is already documented as genuine natural-use runtime traffic:

- the user question was read from `/dev/tty`;
- it was a genuine task-relevant question about when the August duty schedule was created;
- it was not harness/control text, an H6 replay, a synthetic probe, or an instruction to invoke memory tools;
- R3 persisted bounded per-channel and fusion provenance for that exact turn.

Independent answer-bearing evidence now exists outside the R3 retrieval result:

- `/home/lionsol/.openclaw/workspace/memory/smart-add/2026-07-31.md` records `8月值班表已生成` and names `duty-schedule-august-2026.md`;
- `/home/lionsol/.openclaw/workspace/duty-schedule-august-2026.md` has filesystem birth time `2026-07-31 09:35:46 +0800` and modification time `2026-07-31 09:37:22 +0800` as observed during pre-draft bounded read-only inspection.

These sources establish the answer independently from whatever AutoRecall retrieved on R3. Execution must still prove the exact managed/indexed candidate identity and its point-in-time relationship to the R3 event before assigning a loss boundary.

## Fixed historical sample

Use only the already completed R3 sample:

~~~text
agentId=main
sessionId=ce1e425c-10f0-4393-8d76-75ec390dd58f
sessionKey=agent:main:explicit:provenance-canary-ce1e425c-10f0-4393-8d76-75ec390dd58f
R3 baseline event=190
~~~

Preserved event chain:

~~~text
191 recall_started
192 hybrid_search_observation
193 auto_recall_debug
194 memory_candidate_retrieved
195 recall_completed
~~~

The committed R3 report records for event `193`:

~~~text
skipped=false
candidate_count=1
injected_count=0
vector provenance count=4
vector provenance captured_count=4
vector provenance truncated=false
fusion pre_rerank_ids length=4
fusion post_rerank_ids length=4
~~~

No other turn may enter this stage.

## User value

R3 proved that candidate provenance is observable on genuine natural-use traffic. This stage uses that observability for its intended purpose: determine the earliest loss boundary before considering any retrieval-policy change.

A result is useful even if it shows that retrieval did not lose the answer-bearing candidate. The project should not tune a channel, fusion, ranking, or gate merely because provenance now exists.

## In scope

Only three things are in scope:

1. establish the exact answer-bearing managed/chunk candidate identity for the July 31 August-duty-schedule evidence using immutable/read-only evidence;
2. compare that identity against the preserved R3 per-channel, fusion, final-selection, and injection/gate evidence for events `191`–`195`;
3. assign exactly one earliest-loss attribution, or close `INSUFFICIENT_EVIDENCE`, and identify at most one smallest next product decision without implementing it.

## Non-goals

Do not:

- submit a new OpenClaw turn, replay the R3 question, run H6, or create another dedicated canary;
- run a live or synthetic retrieval query to reconstruct what R3 "would" return now;
- enable AutoRecall or change OpenClaw configuration;
- change query shaping, focused-query behavior, FTS/vector/recent/KG collection, fusion/ranking, category weights, `topK`, confidence thresholds, Card/gate policy, projection behavior, or provenance limits;
- change capture, indexing, checkpoint, smart-add, episode, raw-log, extraction, backfill, reinforcement, or lifecycle behavior;
- rebuild, refresh, compact, repair, or mutate Core DB, Engine DB, LanceDB, FTS, KG, session state, memory files, or runtime installation;
- treat current retrieval results as evidence of R3 historical behavior;
- reopen Candidate-Builder publication/timeout diagnosis;
- create a source fix, OpenSpec change, rollout plan, or broad AutoRecall enablement;
- commit, tag, push, or execute a successor stage without separate owner authorization.

## Evidence hierarchy

Use the minimum sufficient preserved evidence, in this order:

1. the R3 final report and preserved R3 events `191`–`195`;
2. the fixed dedicated session's preserved read-only history only as needed to establish the exact natural question; event `191` independently establishes `focused_query_used=false`, so no alternate focused query may be invented;
3. the independent July 31 answer-bearing sources identified above;
4. immutable/read-only Core/Engine candidate/chunk/provenance mappings needed to resolve the answer-bearing candidate ID and prove it predates R3;
5. persisted R3 `channel_candidate_provenance`, `fusion_candidate_provenance`, final candidate metadata, and gate/injection metadata;
6. source at the exact R3 implementation only when required to interpret the meaning of an already persisted boundary field.

Do not substitute current live retrieval output for preserved R3 evidence.

## Candidate identity requirement

Before assigning any loss boundary, execution must identify at least one candidate/chunk that independently bears the answer that the August duty schedule was created on 2026-07-31 and must establish, without mutation, that the candidate existed before the R3 turn.

Prefer an exact persisted candidate/chunk ID mapping. R3 provenance stores bounded IDs as the first 16 characters of the candidate ID, not as a reversible hash. Compare a bounded ID to a full ID only by proving a unique read-only full-ID prefix match within the relevant preserved candidate/chunk evidence domain. If more than one plausible full ID shares the same 16-character prefix, identity is ambiguous and must not be inferred from text similarity alone.

If no defensible and unique answer-bearing candidate identity can be established, close `INSUFFICIENT_EVIDENCE`.

## Preserved boundary semantics

For this R3 implementation, use these historical semantics when interpreting persisted evidence:

- channel provenance records candidates collected by each applicable retrieval channel before fusion;
- fusion `pre_rerank_ids` records the bounded IDs from the RRF-ordered fused set before final-score reranking;
- fusion `post_rerank_ids` records the bounded IDs from the final-score-ordered fused set after reranking;
- `hybridSearch(..., { topK: 1 })` returns the first final-score-ranked result as the final retrieval result;
- `memory_candidate_retrieved` records that final retrieval result before the AutoRecall injection gate;
- `gate_decisions` / rejected-candidate metadata describe the later injection decision for final retrieval results;
- `memory_injected` exists only for candidates that pass the gate and are actually formatted into AutoRecall prompt context.

Therefore event `194 memory_candidate_retrieved` is evidence of final retrieval selection, not evidence of prompt injection. Likewise `injected_count=0` proves no AutoRecall candidate entered prompt context but does not by itself locate the earlier loss boundary.

R3 also persisted a legacy `post_rerank_count=0` / empty `post_rerank_topK` view while the new fusion provenance records four `post_rerank_ids` and event `194` records one final result. Exact R3 source shows this is an interpretation mismatch: hybrid search populates `post_rerank_top`, while the lifecycle's legacy count reads `post_rerank_topK`. For this stage, do not treat the legacy zero count as evidence that no post-rerank candidate existed. Use the bounded fusion provenance and event `194` for candidate-boundary presence. This observation is evidence interpretation only and does not authorize a telemetry/source fix.

## Attribution rules

### `CHANNEL_OR_INDEX_COLLECTION_LOSS`

Use only when all of the following are established: the answer-bearing candidate existed before R3; preserved query/focused-query formation was adequate for the answer-bearing concept; and preserved R3 evidence shows the candidate was not surfaced by any applicable candidate channel, or point-in-time evidence directly establishes an index/channel availability failure before fusion.

Do not claim an index defect merely because an answer-bearing workspace file existed. The managed/indexed candidate relationship must be evidenced.

### `FUSION_OR_PRESELECTION_LOSS`

Use when preserved R3 evidence proves the answer-bearing candidate was surfaced by at least one channel but did not survive the applicable fusion/preselection/rerank boundary into the final selected candidate set.

The exact earliest sub-boundary may be reported as a finding when supported, but no retrieval fix is authorized.

### `LATER_SELECTION_OR_GATING_LOSS`

Use when the answer-bearing candidate survived the channel and fusion/preselection boundaries but was subsequently excluded before prompt injection by final selection, eligibility, projection, Card, or gate behavior.

Because the R3 report records `injected_count=0`, execution must inspect the preserved later-boundary evidence rather than assume the reason from that count alone.

### `ANSWER_BEARING_CANDIDATE_NOT_LOST`

Use when preserved evidence proves the answer-bearing candidate survived the relevant retrieval, selection, and injection boundary such that AutoRecall made it available to the model. In that case the observed task outcome must not be blamed on retrieval loss.

Do not use this result merely because the answer existed elsewhere in the workspace.

## Required result record

The final report must contain at minimum:

- fixed R3 session/trace/event identity;
- exact natural question or a privacy-safe unambiguous description if the full text is unnecessary;
- independent answer-bearing evidence and why it predates R3;
- full answer-bearing candidate/chunk identity plus the bounded provenance ID used for comparison;
- per-channel presence/absence for that candidate;
- pre-rerank and post-rerank presence/absence;
- final selected-candidate presence/absence;
- gate/injection status relevant to that candidate;
- earliest-loss attribution;
- one concise limitation statement;
- at most one smallest next product decision, explicitly not implemented.

## Pass criteria

1. The answer-bearing candidate identity and pre-R3 existence are established from independent, read-only evidence.
2. Preserved R3 provenance and later-boundary evidence support exactly one of the four allowed attributions without live retrieval or data/runtime mutation.
3. Product source, retrieval policy, runtime configuration, indexes, DB contents, sessions, and memory remain unchanged.

If criterion 1 or 2 cannot be satisfied, use `INSUFFICIENT_EVIDENCE`. If a stop condition is hit, use `STOPPED`.

## Stop conditions

Stop if:

- a new prompt, live retrieval, synthetic probe, or index rebuild is proposed to fill missing historical evidence;
- answer-bearing candidate identity is ambiguous and resolving it would require mutation or current-result substitution;
- point-in-time evidence is missing and a present-day retrieval is proposed as a proxy;
- query adequacy cannot be established from the preserved natural question plus R3 query/focused-query metadata and an executor proposes to fold that uncertainty into channel/index loss;
- another natural sample, H6 turn, Candidate-Builder issue, embedding/provider timeout, or unrelated subsystem enters scope;
- a retrieval/gate/source fix is proposed before attribution closes;
- any runtime/config/data mutation becomes necessary.

## Allowed mutations

Before separate commit authorization: this draft Markdown Stage Card only.

During a separately authorized execution: no product/runtime/data mutation. The executor may create only bounded disposable analysis output and the bounded final report `reports/auto-recall-r3-natural-sample-first-loss-attribution/final-report.md` required to preserve the attribution evidence.

No source file, OpenClaw config, DB, index, session, memory file, install artifact, Gateway state, tag, or branch mutation is allowed.

## Stage outcomes

Use exactly one:

~~~text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
~~~

A `PASS` means the attribution question was answered; it does not mean the retrieval behavior was correct and does not authorize a fix.

## Authorization boundary

This frozen Stage Card authorizes nothing.

Freeze authorization has been granted only for this documentation state. Obtain separate owner authorization before committing it. Any execution after commit must be separately authorized by Sol and bind:

- exact committed Stage Card path and SHA256;
- exact Stage Card commit;
- exact repository HEAD being authorized;
- the fixed R3 session/event scope above;
- `MAX_EXECUTIONS=1` unless Sol explicitly sets another finite count.

Any change to the card, HEAD, scope, or consumed execution count invalidates the prior execution packet.

# H6 Retrieval First-Loss-Boundary Attribution Stage Card — 2026-08-08

> Status: `FROZEN` — execution requires separate Sol authorization
>
> Repository HEAD before this card: `42d6fa87d8501d4ba23e7bb207682c83aba236f4`
>
> This card authorizes no execution. A committed/frozen card still requires separate Sol execution authorization.

## Decision

For the seven H6 turns already proven to be `RETRIEVAL_SELECTION_GAP`, what is the earliest evidenced retrieval loss boundary?

Choose exactly one aggregate attribution:

~~~text
QUERY_FORMATION_GAP
CHANNEL_OR_INDEX_AVAILABILITY_GAP
FUSION_OR_PRESELECTION_GAP
MIXED_OR_INSUFFICIENT_EVIDENCE
~~~

The seven in-scope turns are:

- First H6 T2;
- Retry T1;
- Retry T2;
- Retry T4;
- Retry T5;
- Retry T6;
- Retry T8.

First H6 T1 is excluded because historical retrieval already surfaced the correct `AutoRecall=false` fact and the loss occurred at the gate. Retry T3 is excluded because the incident-specific answer remained unproven.

## User value

The previous answerability audit established that answer-bearing memory existed for these seven turns. The next product question is therefore not whether to capture more memory, but where the retrieval pipeline first failed to preserve an answer-bearing candidate.

No tuning or fix should be designed until that first loss boundary is established.

## In scope

1. Reconstruct the preserved historical retrieval path for each of the seven turns from query formation through final candidate selection.
2. Identify the earliest directly evidenced loss boundary for each turn.
3. Produce one aggregate attribution and one smallest next product decision without implementing it.

## Non-goals

Do not:

- run a new H6, live retrieval, memory tool query, natural-use canary, or synthetic retrieval probe;
- change query shaping, FTS/vector/recent behavior, fusion, ranking, `topK`, thresholds, category weights, Card/gate rules, or projection length;
- change capture, checkpoint, smart-add, episode, raw-log, extraction, indexing, or backfill behavior;
- rebuild, refresh, mutate, or benchmark an index as a substitute for historical evidence;
- treat current retrieval results as proof of historical behavior;
- modify Candidate-Builder, timeout policy, runtime, config, services, DBs, sessions, memory, or historical evidence;
- create an OpenSpec change or source fix;
- commit, tag, or push without separate authorization.

## Attribution rules

### `QUERY_FORMATION_GAP`

Use only when preserved evidence proves that answer-bearing content was available to the historical retrieval corpus, but the historical query/focused-query/term-selection boundary omitted or materially distorted the terms needed for the answer before candidate channels ran.

### `CHANNEL_OR_INDEX_AVAILABILITY_GAP`

Use when query formation was adequate, but preserved evidence shows the answer-bearing item was not available to or not surfaced by the applicable historical candidate channels. This includes index freshness/availability when point-in-time evidence supports it.

Do not distinguish channel-generation from index-freshness unless preserved evidence supports that finer split.

### `FUSION_OR_PRESELECTION_GAP`

Use only when preserved evidence proves an answer-bearing candidate was surfaced by at least one historical channel but was lost during fusion, ranking, deduplication, preselection, or final `topK` selection before the injection gate.

### `MIXED_OR_INSUFFICIENT_EVIDENCE`

Use when the seven turns have materially different first loss boundaries, or preserved evidence cannot reliably locate the earliest boundary for enough turns to support one aggregate attribution.

Do not force a common boundary for roadmap convenience.

## Minimum evidence hierarchy

Use only what is needed, in this order:

1. preserved H6 and H6-retry observation/evidence roots;
2. the completed low-coverage audit report and the completed answerability bounded execution evidence;
3. historical debug metadata such as `fts_query_final`, focused-query state, triggered channels, candidate source tags, counts, scores, and selected IDs;
4. point-in-time Core source/chunk provenance using immutable/read-only access only when needed;
5. Git history/source at the relevant historical retrieval implementation only to explain a boundary already evidenced by runtime records.

Repository docs may explain behavior but cannot replace runtime evidence for what happened in a historical turn.

## Per-turn result

For each of the seven turns report at minimum:

- turn ID/timestamp and natural question;
- answer-bearing memory source already established by the prior audit;
- historical query/focused-query evidence;
- historical channels triggered and relevant per-channel evidence available;
- whether the answer-bearing item was point-in-time index/channel available: `true|false|unproven`;
- whether an answer-bearing candidate was proven surfaced before fusion/preselection: `true|false|unproven`;
- historical final selected candidate/source;
- earliest loss attribution;
- concise evidence basis and limitation.

## Aggregate result

Report counts by per-turn attribution and choose exactly one aggregate attribution from the four allowed values.

A majority alone is insufficient if the minority shows a materially earlier or different loss mechanism that prevents a defensible common boundary.

## Pass criteria

1. All seven turns are audited from preserved historical evidence without live/synthetic retrieval or index mutation.
2. Each turn receives a defensible earliest-loss attribution or explicit `MIXED_OR_INSUFFICIENT_EVIDENCE`, and the aggregate follows directly from those records.
3. Product/runtime/data remain unchanged and exactly one next product decision is identified but not implemented.

If criterion 1 or 2 cannot be satisfied, the stage outcome is `INSUFFICIENT_EVIDENCE` unless a stop condition requires `STOPPED`.

## Stop conditions

Stop if:

- historical channel/query evidence is missing and a live rerun is proposed to fill it;
- proving index availability would require mutation, rebuild, backfill, or timestamp rewriting;
- T1 gate behavior or T3 incident-causality expands back into scope;
- a source/policy fix is proposed before attribution is complete;
- Candidate-Builder/timeout work re-enters scope;
- a second unrelated subsystem enters scope.

## Allowed mutations

Before separate execution authorization: this Markdown Stage Card and current governance/status documentation only.

During separately authorized execution: bounded disposable analysis files and an explicitly requested redacted report only. No product/runtime/data mutation.

## Stage outcomes

GPT must use exactly one:

~~~text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
~~~

## Authorization boundary

Execution authorization must bind the exact committed Stage Card, repository HEAD, and finite execution count under `docs/decisions/project-authorization-policy.md`.

Codex must report and stop after the authorized audit. It may not create, commit, or execute a successor Stage Card.

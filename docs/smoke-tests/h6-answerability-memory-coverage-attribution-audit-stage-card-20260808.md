# H6 Answerability / Memory-Coverage Attribution Audit Stage Card — 2026-08-08

> Status: `FROZEN` — execution requires separate Sol authorization
>
> Product-source baseline: `97454ee70f47f8fd4421806f4a10100b78e27186`
>
> This card authorizes no execution. A committed/frozen card still requires separate Sol execution authorization.

## Decision

For the nine historical H6 natural questions rejected by `relaxed_source_low_coverage_no_exact`, was answer-bearing memory present in the authoritative corpus at the historical turn time, and if so, where was the first evidenced loss boundary?

Choose exactly one aggregate attribution:

~~~text
CORPUS_COVERAGE_GAP
RETRIEVAL_SELECTION_GAP
PROJECTION_BOUNDARY_GAP
MIXED_OR_INSUFFICIENT_EVIDENCE
~~~

Reference evidence:

`reports/low-coverage-path-authority-audit-20260804/final-report.md`

That report already established `NATURAL_CONTENT_LOW_OVERLAP`, reproduced the ten historical gate decisions, rejected a reproducible gate defect, and found path-authority debt non-causal. Do not repeat that audit.

## User value

This attribution decides whether the next product question belongs to memory supply/capture, retrieval selection, or the 240-character runtime projection. No implementation should be designed before that distinction is established.

## In scope

1. Audit all nine rejected H6 turns for point-in-time answer-bearing memory presence.
2. Where answer-bearing memory existed, identify the earliest evidenced loss boundary: retrieval selection or `text.slice(0, 240)` projection.
3. Produce a per-turn attribution table, one aggregate result, and one smallest next product decision without implementing it.

## Non-goals

Do not:

- run a new H6, live retrieval, or natural-use canary;
- enable AutoRecall or change `topK`, thresholds, FTS shaping, reranking, category weights, Card/gate rules, or projection length;
- change checkpoint, smart-add, episode, raw-log, extraction, or other capture behavior;
- backfill or reindex memory;
- modify Candidate-Builder, timeout policy, authority state, or diagnostic harnesses;
- run real plan/dry-run/prepare/verify, install, reload, restart, or service operations;
- mutate Core DB, Engine DB, LanceDB, workspace memory, sessions, config, prompts, transcripts, or historical evidence;
- create an OpenSpec change or source fix;
- commit, tag, or push without separate authorization.

## Point-in-time evidence rule

A memory item counts as `present_at_turn` only if preserved evidence establishes both:

1. answer-bearing content existed no later than the historical turn timestamp; and
2. the then-active retrieval path was permitted to use that source.

Content created, checkpointed, smart-added, indexed, or made available only after the turn does not count.

Current mutable-index absence alone does not prove historical absence. If temporal provenance cannot establish presence or absence, use `MIXED_OR_INSUFFICIENT_EVIDENCE`.

## Minimum evidence hierarchy

Use only what is needed, in this order:

1. prior low-coverage final report and referenced H6 evidence;
2. preserved H6 trace/evidence roots and candidate provenance;
3. canonical memory source files with pre-turn timestamps/provenance;
4. read-only/immutable Core, Engine, or LanceDB inspection only when necessary;
5. repository history only as context, never as proof that a fact was present in memory.

Do not use browser transcript recall as execution evidence.

## Attribution rules

- `CORPUS_COVERAGE_GAP`: answer-bearing content cannot be proven present at the historical turn and preserved evidence supports a genuine memory-supply gap.
- `RETRIEVAL_SELECTION_GAP`: answer-bearing content is proven present and eligible, but preserved historical retrieval evidence did not surface it before the gate.
- `PROJECTION_BOUNDARY_GAP`: the historically selected chunk contained the answer, but the answer was outside the first 240 characters passed to the gate.
- `MIXED_OR_INSUFFICIENT_EVIDENCE`: temporal presence or earliest loss boundary cannot be established strongly enough, or the nine turns do not support one defensible aggregate class.

Retry Turn 7 is comparison control only and is excluded from the nine rejected-turn denominator.

## Read-only execution boundary

A separately authorized audit may read preserved reports/evidence, canonical memory sources, and explicitly identified authoritative stores using read-only or immutable access. Bounded disposable comparison files are allowed.

If a tool cannot guarantee read-only access, do not use it.

## Required result

For each rejected turn, report at minimum:

- turn ID/timestamp and natural question;
- historical selected candidate/source and gate result;
- answer fact sought;
- strongest pre-turn answer-bearing evidence, if any;
- `present_at_turn=true|false|unproven`;
- whether the selected chunk contained the answer and whether it was inside the first 240 characters;
- whether preserved historical retrieval surfaced an answer-bearing candidate;
- one attribution and concise evidence basis.

Then report:

- counts by attribution;
- exactly one aggregate attribution;
- temporal-provenance limitations;
- runtime/config/service/data mutation status;
- exactly one smallest next product decision.

Do not paste raw private transcripts into repository reports.

## Pass criteria

1. All nine rejected turns are audited without treating post-turn content as historically available.
2. Each turn and the aggregate receive a defensible attribution directly supported by preserved evidence.
3. Runtime/config/services/data remain unchanged and exactly one next product decision is identified but not implemented.

If criteria 1 or 2 cannot be met, outcome is `INSUFFICIENT_EVIDENCE` unless a stop condition requires `STOPPED`.

## Stop conditions

Stop if:

- proving answerability requires index/data mutation or historical evidence rewriting;
- a new live retrieval/canary is proposed as a substitute for historical evidence;
- current content cannot be temporally separated from historical availability;
- a source/policy fix is proposed before attribution is complete;
- Candidate-Builder/timeout work re-enters scope;
- a second unrelated subsystem enters scope.

## Allowed mutations

Before execution authorization: this Markdown card only.

During separately authorized execution: bounded disposable analysis files and an explicitly requested redacted audit report only. No product/runtime/data mutation.

## Stage outcomes

GPT must use exactly one:

~~~text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
~~~

## Authorization boundary

After this card is committed/frozen, execution authorization must bind its exact commit and repository HEAD with a finite execution count under `docs/decisions/project-authorization-policy.md`.

Codex must report and stop after the authorized audit. It may not create, commit, or execute a successor Stage Card.

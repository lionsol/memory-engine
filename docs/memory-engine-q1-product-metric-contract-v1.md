# Memory Engine Q1 Product Metric Contract v1

Status: Q1-A1, definition-only contract. This document defines metrics and
evidence boundaries; it does not define targets, rollout thresholds, or a
benchmark baseline.

Executable implementation:

~~~~text
lib/benchmark/q1-product-metric-contract-v1.js
~~~~

The implementation is pure. It scores supplied ranked IDs, labels, counts, or
latency samples and never performs retrieval, reads a live database, changes
runtime telemetry, or calls a provider.

## Contract identity and provenance

The schema identifier is:

~~~~text
memory_engine_q1_product_metric_contract_v1
~~~~

The provenance vocabulary is exactly the Q0 vocabulary:

~~~~text
PRODUCTION_OBSERVED
PRODUCTION_REPLAY
BENCHMARK_DERIVED
TARGETED_SYNTHETIC
~~~~

Every report preserves `provenance`, `source_identity`,
`dataset_identity`, and denominator/count fields. A report may have incomplete
attribution when callers omit those fields, but it says so explicitly.

`validateQ1MetricProvenance` checks that a collection is attributable to one
compatible provenance/source group. A known mixture is marked incompatible,
and the Q1 aggregators return `REFUSED_INCOMPATIBLE_PROVENANCE` with separate
`by_provenance_source` breakdowns. They do not emit a pooled metric. The
`assertQ1MetricProvenance` helper throws for the same incompatible condition.

LongMemEval and LoCoMo remain separate source identities even though both are
`BENCHMARK_DERIVED`. A later, explicitly named cross-dataset comparison may
compare their separate reports; Q1-A1 does not silently pool them.

## Metric registry

The executable `Q1_METRIC_REGISTRY` is the canonical registry.

| Area | Canonical fields |
| --- | --- |
| Evidence ranking at k=3 | `recall_any@3`, `recall_all@3`, `ndcg@3`, `evidence_coverage@3`, `budget_feasible@3`, `recall_all@3_feasible`, `first_relevant_rank@3` |
| Cross-session ranking subset | `cross_session_evidence_coverage@3`, `cross_session_case_count` |
| Trigger | `trigger_recall`, `unnecessary_recall_rate`, `trigger_precision` |
| Top3 safety | `top3_fill_rate`, `stale_top3_slot_rate`, `conflict_top3_slot_rate`, `stale_or_conflict_top3_slot_rate` |
| Injection quality | `irrelevant_injection_rate`, `context_pollution_rate` |
| Latency | `recall_latency_p50_ms`, `recall_latency_p95_ms`, `incomplete_trace_rate`, `error_or_timeout_rate` |
| Future answer use | `answer_evidence_coverage` |

Metric names are definitions, not target thresholds. Existing product-health
thresholds remain rollout-gate policy and are not copied into this contract.

## Evidence-ranking metrics at production budget k=3

`scoreQ1EvidenceRankingAt3` accepts `gold_evidence_ids` and
`ranked_retrieved_ids`. It does not retrieve or rank anything.

Gold IDs are distinct required evidence units, normally session IDs. Duplicate
gold IDs are deduplicated before scoring and cannot increase the denominator.
An empty or invalid gold list is unscoreable. Its metrics are `null`, and the
aggregate reports it in `unknown_or_unscoreable_case_count` rather than as a
zero-valued miss.

Only the first three ranked positions are evaluated. Retrieved duplicates
occupy their actual positions, but a required ID is relevant at most once:

* `recall_any@3` is 1 if any distinct gold ID occurs in top3, otherwise 0.
* `recall_all@3` is 1 only if every distinct gold ID occurs in top3. It is
  still defined when the gold set contains more than three IDs.
* `evidence_coverage@3` is the number of distinct gold IDs observed in top3
  divided by the number of distinct required gold IDs. This is retrieval
  evidence coverage, not answer coverage.
* `budget_feasible@3` is true exactly when the distinct gold count is at most
  three.
* `recall_all@3_feasible` equals `recall_all@3` for feasible cases and is
  `null` for cases whose full evidence set cannot fit into top3.

NDCG uses binary relevance and logarithmic discount:

~~~~text
DCG = sum(relevance_i / log2(i + 2))
~~~~

The first occurrence of a relevant ID contributes gain; duplicate occurrences
contribute zero additional gain. The ideal ranking has
`min(distinct_gold_count, 3)` relevant items at the head. The canonical Q1
field is `ndcg@3`. Existing `ndcg_any@3` fields from LongMemEval/LoCoMo are
compatibility evidence only when the formulas and fixture are equivalent.

The current LongMemEval helper has a semantic mismatch for non-perfect
multi-evidence rankings: its legacy discount uses `log2(index + 1)` after the
first position, whereas Q1 uses the standard `log2(index + 2)` convention
above. Equality is therefore expected for no-hit and perfect-hit fixtures and
for otherwise equivalent one-evidence cases, but not for a partial
multi-evidence fixture. Q1 does not copy that legacy formula and does not
modify the existing scorer. The current LoCoMo session scorer uses the Q1
discount convention for ordinary fixtures.

`first_relevant_rank@3` is 1, 2, 3, or `null` for a top3 miss. Aggregates do
not report only a conditional mean: they expose the full
`first_relevant_rank@3` distribution with `rank_1`, `rank_2`, `rank_3`, and
`miss`.

A case is in the cross-session/multi-evidence subset when its distinct gold
evidence count is at least two. `cross_session_evidence_coverage@3` is the
macro mean of per-case `evidence_coverage@3` on that subset, and
`cross_session_case_count` is its denominator. If a denominator is zero, the
metric is `null`.

All case ranking metrics are macro means. The aggregate also exposes:

~~~~text
scoreable_case_count
unknown_or_unscoreable_case_count
budget_feasible_case_count
budget_infeasible_case_count
~~~~

Unknown, skipped, and unscoreable cases never become zero-valued failures.

The fixed-budget distinction is intentional. For example, four distinct gold
evidence IDs with three of four retrieved gives:

~~~~text
recall_any@3             = 1
recall_all@3             = 0
evidence_coverage@3      = 0.75
budget_feasible@3        = false
recall_all@3_feasible    = null
~~~~

## Trigger decision metrics

`scoreQ1TriggerDecision` scores one labeled turn. It classifies only boolean
pairs:

| Expected | Actual | Class |
| --- | --- | --- |
| true | true | TP |
| false | false | TN |
| false | true | FP |
| true | false | FN |

An unknown actual decision remains `UNKNOWN`. It is not coerced to TN or FN.
The aggregate reports `TP`, `TN`, `FP`, `FN`,
`labeled_positive_count`, `labeled_negative_count`, and
`unknown_decision_count`.

~~~~text
trigger_recall           = TP / (TP + FN)
unnecessary_recall_rate  = FP / (FP + TN)
trigger_precision        = TP / (TP + FP)
~~~~

`unnecessary_recall_rate` is the false-positive rate among turns labeled as
not requiring historical recall. It is not an injection-quality metric.

## Top3 stale/conflict safety

`scoreQ1Top3Safety` accepts an already-ranked candidate list and evaluates at
most its first three served slots. It never infers stale state from age,
timestamps, confidence, or rank.

Each served candidate must carry explicit boolean `stale` and `conflict`
labels. Unknown or missing labels make the safety rates
`INSUFFICIENT_EVIDENCE`; empty slots are not assumed clean. A `stale=true`
label also needs explicit lifecycle/supersession authority, such as
`stale_authority` or `lifecycle_authority`. A `conflict=true` label needs
explicit conflict authority, such as `conflict_authority`. The adapter owns
those authorities.

When labels are complete, the report exposes:

~~~~text
served_top3_count
top3_fill_rate                  = served_top3_count / 3
stale_top3_slot_rate            = stale slots / served slots
conflict_top3_slot_rate         = conflict slots / served slots
stale_or_conflict_top3_slot_rate = union(stale, conflict) slots / served slots
~~~~

The union numerator counts one slot once when both flags are true. Safety
rates use served slots as their denominator; fill is reported separately. An
empty top3 therefore has fill 0 and no safety-rate evidence (`null`).

## Injection quality and context pollution

`irrelevant_injection_rate` is the existing AutoRecall product-health review
concept:

~~~~text
reviewed injected memories labeled irrelevant
----------------------------------------------
reviewed injected memories
~~~~

`context_pollution_rate` is a different, stricter item-level union. A unique
reviewed injection is polluted when at least one explicit review label says:

* irrelevant;
* severe context conflict; or
* stale/superseded content is inappropriate for the current answer context.

An item satisfying multiple conditions counts once. The pure item-level
scorer/aggregator accepts `irrelevant`, `severe_context_conflict`, and
`stale_or_superseded_inappropriate` labels. Aggregate counts may calculate
`irrelevant_injection_rate`, but if overlap cannot be reconstructed the exact
`context_pollution_rate` is the string `NOT_MEASURABLE`. Aggregate category
counts are never added together as a union.

This stage does not modify AutoRecall telemetry.

## Latency window

`summarizeQ1LatencyWindow` requires separate started-trace count, completed
latency samples, incomplete-trace count, and error-or-timeout count. Only
finite, non-negative completed samples enter percentile calculations.

The nearest-rank convention is the existing AutoRecall product-health rule:

~~~~text
index = ceil(p * n) - 1
~~~~

The report always retains:

~~~~text
latency_sample_count
recall_latency_p50_ms
recall_latency_p95_ms
incomplete_trace_count
incomplete_trace_rate
error_or_timeout_count
error_or_timeout_rate
~~~~

With no valid completed samples, p50 and p95 are `null`, not zero. Q1-A1
defines no new latency pass/fail threshold.

## Answer-use boundary

`answer_evidence_coverage` is deliberately distinct from retrieval coverage.
It would require authoritative labels identifying which required evidence
units were semantically used in the final answer. Its current status is:

~~~~text
NOT_MEASURABLE_WITH_CURRENT_AUTHORITY
~~~~

`memory_injected`, `memory_cited`, retrieval rank, and disclosure/card
projection are not sufficient proxies. The executable contract reports the
unavailability status and does not manufacture an answer-use score.

## Dataset interpretation

Benchmark-derived values are not production prevalence. Production observed,
production replay, benchmark-derived, and targeted synthetic evidence must
remain separately attributable. Trigger false positives are not automatically
irrelevant injections. Evidence retrieval is not semantic answer use. A full
top3 recall can be structurally impossible when a case requires more than
three distinct evidence units. `UNKNOWN`, `null`, and `NOT_MEASURABLE` carry
different evidence meanings and are never silently converted to zero.

The frozen LongMemEval-S rationale for the feasibility split is 419 scored
cases with distinct evidence-session counts:

~~~~text
1 -> 119
2 -> 229
3 -> 39
4 -> 18
5 -> 11
6 -> 3
~~~~

Therefore 32 scored cases require more than three evidence sessions. This
empirical rationale is documentation only; the generic implementation is not
dependent on that dataset. The dataset SHA authority is:

~~~~text
d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442
~~~~

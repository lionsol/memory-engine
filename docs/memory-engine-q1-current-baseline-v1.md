# Memory Engine Q1 Current Offline Baseline v1

## Status and scope

This document binds `memory_engine_q1_product_metric_contract_v1` to the current offline lexical/trigger evaluation evidence. It is a reproducible evaluation baseline for later Q2 ablation comparisons. It is not a production failure-prevalence report, a rollout gate, or a runtime change.

The three evidence tracks remain separate:

1. LongMemEval-S lexical/session retrieval;
2. LoCoMo time-frozen lexical/strict-session retrieval;
3. AutoRecall v2b5 trigger evaluation.

There is no cross-track product statistic. LongMemEval and LoCoMo are both `BENCHMARK_DERIVED`, but remain separately attributable. The trigger holdout is `TARGETED_SYNTHETIC` and is evaluation performance, not production prevalence.

## Frozen source identities

### LongMemEval-S

- Dataset: `longmemeval_s_cleaned.json`
- SHA-256: `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`
- Provenance: `BENCHMARK_DERIVED`
- Profile: `production_hybrid_lexical_session_v1`
- Q1 top-k: `3`
- Q1 baseline clock: `benchmarkNowSec=1800000000`
- Retrieval mode: lexical-only hybrid profile; no vector/provider
- Source shape: 500 cases, 419 scored, 81 skipped
- Official skips: 30 abstentions and 51 no-user-target cases
- Scored evidence-session distribution: 1 → 119, 2 → 229, 3 → 39, 4 → 18, 5 → 11, 6 → 3

The Q1 clock is a new explicit Q1 baseline clock. It was not retroactively assigned to historical B3. The 32 scored cases requiring more than three evidence sessions are the reason full recall and feasible full recall are reported separately.

### LoCoMo

- Upstream repository: `https://github.com/snap-research/locomo`
- Upstream commit: `3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376`
- Dataset file commit: `cbfbc1dba6bc53d00625212a0f22d55ffee7c1fc`
- Dataset path: `data/locomo10.json`
- SHA-256: `79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`
- License identity: `CC BY-NC 4.0 International`
- Provenance: `BENCHMARK_DERIVED`
- Profile: `production_hybrid_lexical_dialog_locomo_time_frozen_v2`
- Q1 evidence policy: `locomo_evidence_strict_v1`
- Q1 metric level: session
- Q1 top-k: `3`
- Benchmark clock: `benchmarkNowSec=1705066861`
- Retrieval mode: time-frozen lexical-only hybrid profile; no vector/provider
- Source shape: 10 conversations, 272 sessions, 5,882 turns, 1,986 QA
- Strict scoring shape: 1,972 scored and 14 skipped
- Retrieval latency attempts: 1,978

The Q1 primary view is session-level. Historical B5 strict-dialog metrics remain source-specific benchmark evidence and are not replaced or pooled by this session-level view.

### AutoRecall v2b5

- Fixture: `auto-recall-policy-holdout.v2b5`
- Evaluator: `frozen_v2b5_runtime_candidate`
- Provenance: `TARGETED_SYNTHETIC`
- Rows: 48, balanced as 24 labeled-positive and 24 labeled-negative turns
- Unknown actual decisions: 0

This is an evaluation holdout result. It does not estimate production trigger prevalence.

## Q1 retrieval results

All case metrics are macro means over scoreable cases. Official or strict skips remain unknown/unscoreable and are not converted to zero-valued misses.

| Track | Scoreable | Unknown/skipped | Recall-any@3 | Recall-all@3 | NDCG@3 | evidence_coverage@3 | Feasible | Infeasible | Recall-all@3-feasible |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| LongMemEval-S lexical/session | 419 | 81 | 0.7088305489260143 | 0.38424821002386633 | 0.5274554142524438 | 0.5354813046937152 | 387 | 32 | 0.4160206718346253 |
| LoCoMo lexical/strict-session | 1,972 | 14 | 0.48225152129817445 | 0.4117647058823529 | 0.3876642194956705 | 0.4416610322289836 | 1,915 | 57 | 0.42402088772845953 |

`evidence_coverage@3` is retrieval evidence coverage, not answer coverage. `Recall-all@3` remains defined for infeasible cases; `Recall-all@3-feasible` excludes cases whose distinct required evidence cannot physically fit in three slots.

### LongMemEval question-type breakdown

Each row is independently attributable to the LongMemEval-S source and profile.

| Question type | Scoreable | Unknown | Recall-any@3 | Recall-all@3 | NDCG@3 | evidence_coverage@3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `knowledge-update` | 72 | 6 | 0.9305555555555556 | 0.6666666666666666 | 0.7986636317758974 | 0.7986111111111112 |
| `multi-session` | 121 | 12 | 0.7355371900826446 | 0.2066115702479339 | 0.46993014711611647 | 0.4462809917355372 |
| `single-session-assistant` | 5 | 51 | 0 | 0 | 0 | 0 |
| `single-session-preference` | 30 | 0 | 0.23333333333333334 | 0.23333333333333334 | 0.18769765845238193 | 0.23333333333333334 |
| `single-session-user` | 64 | 6 | 0.828125 | 0.828125 | 0.7700871643973242 | 0.828125 |
| `temporal-reasoning` | 127 | 6 | 0.6377952755905512 | 0.2204724409448819 | 0.4072596929752681 | 0.4162729658792651 |

The `single-session-assistant` unknown count is expected from the official no-user-target skip policy; it is not a retrieval failure count.

### LoCoMo category breakdown

Each row is independently attributable to LoCoMo strict session evidence.

| Category | Name | Scoreable | Unknown | Recall-any@3 | Recall-all@3 | NDCG@3 | evidence_coverage@3 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `multi-hop-retrieval` | 277 | 5 | 0.4296028880866426 | 0.032490974729241874 | 0.21251195296335013 | 0.20028651653200397 |
| 2 | `temporal-reasoning` | 320 | 1 | 0.534375 | 0.490625 | 0.4468854836562316 | 0.5114583333333333 |
| 3 | `open-domain-knowledge` | 89 | 7 | 0.3707865168539326 | 0.21348314606741572 | 0.24124337019736578 | 0.27314071696094167 |
| 4 | `single-hop-retrieval` | 840 | 1 | 0.48095238095238096 | 0.4797619047619048 | 0.41573625860958746 | 0.48035714285714287 |
| 5 | `adversarial` | 446 | 0 | 0.5022421524663677 | 0.5022421524663677 | 0.43030394153587714 | 0.5022421524663677 |

## Compatibility findings

### LongMemEval legacy scorer

Per scored case, Q1 recall matches the existing LongMemEval session scorer:

- `recall_any@3` mismatch count: `0`
- `recall_all@3` mismatch count: `0`

Q1 standard NDCG is reported separately from legacy `ndcg_any@3`:

- Q1 `ndcg@3`: `0.5274554142524438`
- Legacy LongMemEval `ndcg_any@3`: `0.5274037474247587`
- Numeric definition delta: `0.0000516668276850929`
- Legacy NDCG value mismatches: `171`
- Q1/legacy NDCG definition compatible: `false`
- Q1 definition: `standard_binary_dcg_log2_rank_plus_1`
- Legacy definition: `legacy_longmemeval`

The NDCG difference is a metric-definition delta, not a product-quality change. Historical B3/B4 NDCG is not overwritten or reinterpreted.

### LoCoMo strict session scorer

Per strict-scoreable case, Q1 uses the runner's existing `retrieved_session_ids` and matches the existing strict session scorer:

- `recall_any@3` mismatch count: `0`
- `recall_all@3` mismatch count: `0`
- `ndcg@3` versus legacy strict-session `ndcg_any@3` mismatch count: `0`
- Q1 `ndcg@3`: `0.3876642194956705`
- Legacy strict-session `ndcg_any@3`: `0.3876642194956705`
- Q1/legacy NDCG definition compatible: `true`

The 1,972 strict metric cases and 1,978 retrieval latency attempts are separate denominators.

## AutoRecall trigger results

| TP | TN | FP | FN | UNKNOWN | trigger_recall | unnecessary_recall_rate | trigger_precision |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 17 | 7 | 21 | 0 | 0.125 | 0.2916666666666667 | 0.3 |

The unnecessary recall rate is `FP/(FP+TN)`, the false-positive rate on turns labeled as not requiring historical recall. It is not an injection-quality metric.

## Offline benchmark latency

These are `BENCHMARK_DERIVED` completed lexical retrieval samples, not production-observed latency.

| Source | Started attempts | Completed samples | Incomplete | Errors/timeouts | p50 ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| LongMemEval-S | 419 | 419 | 0 | 0 | 9.148926000001666 | 12.489396000000852 |
| LoCoMo | 1,978 | 1,978 | 0 | 0 | 16.50655099999858 | 21.721373000000312 |

The percentile convention is nearest-rank: `index = ceil(p*n) - 1`. Completion, incomplete, and error counts remain part of the evidence. No Q1-A2 pass/fail latency threshold is introduced.

## Unavailable product metrics

| Metric area | Status | Boundary |
| --- | --- | --- |
| Production top3 stale/conflict safety | `NOT_EVALUATED_CURRENT_AUTHORITY` | No current authoritative lifecycle/supersession and conflict label window was bound. Benchmark evidence is not substituted. |
| Production irrelevant injection/context pollution | `NOT_EVALUATED_CURRENT_AUTHORITY` | No current authoritative quality-review window was bound. Aggregate counts cannot fabricate the unique pollution union. |
| Production-observed recall latency | `NOT_EVALUATED_CURRENT_AUTHORITY` | Offline benchmark latency is reported separately. |
| `answer_evidence_coverage` | `NOT_MEASURABLE_WITH_CURRENT_AUTHORITY` | No authoritative labels identify which required evidence units were semantically used in the final answer. |

Memory injected, memory cited, retrieval rank, and disclosure/card projection are not answer-use proxies.

## Interpretation and change boundary

Metrics in this baseline are definitions and measurements, not target thresholds. `UNKNOWN`, skipped, and unmeasurable evidence are not zero. Benchmark values do not estimate production prevalence. Retrieval evidence coverage does not measure semantic answer use. Trigger false positives do not automatically mean irrelevant injections. Top-three full recall can be structurally impossible when a case requires more than three distinct evidence units.

This baseline authorizes no AutoRecall rollout, semantic rollout, ranking change, retrieval tuning, telemetry change, provider call, or runtime/data mutation. It only freezes the current offline lexical/trigger evidence for later comparison.

The bounded machine-readable summary is [q1-current-baseline-v1.json](../test/fixtures/q1-current-baseline-v1.json). It contains metrics, counts, identities, hashes, and bounded status strings only; benchmark questions, answers, conversations, memory contents, prompts, IDs, embeddings, and tool results remain outside the repository.

# Memory Engine Q2 Non-Vector 2×2 Factorial Ablation v1

## Status

This document freezes the Q2-A2 offline experiment envelope. It is an offline lexical/session-level retrieval evaluation, not production failure prevalence. The bounded machine-readable authority is [q2-non-vector-ablation-v1.json](../test/fixtures/q2-non-vector-ablation-v1.json).

No provider, semantic/vector search, EDi qualification, live database, runtime configuration, or production retrieval mutation was used.

## Experiment design

Q2 fixes FTS on and varies KG and the Recent family:

| Profile | KG | Recent family | Vector | Meaning |
| --- | ---: | ---: | ---: | --- |
| `q2_fts_only_v1` | off | off | off | FTS only |
| `q2_fts_kg_v1` | on | off | off | FTS + KG |
| `q2_fts_recent_v1` | off | on | off | FTS + Recent family |
| `q2_non_vector_full_v1` | on | on | off | Full non-vector fusion; Q2-NV0/NV4 compatibility identity |

The production budget is fixed at `topK=3`. Ranking, reranking, query normalization, fallback policy, candidate limits, canonical projection, and the production `hybridSearch()` authority remain unchanged. `production_hybrid_lexical_session_v1` is full non-vector fusion, not FTS-only. Metadata confidence/category/recency boosts remain ranking features, not retrieval channels.

The Recent family includes `like`, `recent`, `episode`, and `recent_fallback`. Episode-only is not an independently switchable Q2 v1 channel. Vector-only is deferred because production orchestration unconditionally collects FTS. Semantic always-vector is provider-required and was not authorized. Selective vector is not mapped to the current semantic runner.

## Pinned authority

| Authority | Value |
| --- | --- |
| Q1 baseline fixture SHA-256 | `1867ad5ebd4368ad967c2f491f21fc888e27df3eea122741c5a4b42430bff042` |
| LongMemEval-S SHA-256 | `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442` |
| LongMemEval-S clock | `benchmarkNowSec=1800000000` |
| LongMemEval-S shape | 500 source / 419 scored / 81 skipped |
| LoCoMo SHA-256 | `79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4` |
| LoCoMo upstream commit | `3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376` |
| LoCoMo dataset-file commit | `cbfbc1dba6bc53d00625212a0f22d55ffee7c1fc` |
| LoCoMo clock | `benchmarkNowSec=searchNowSec=materializationNowSec=1705066861` |
| LoCoMo shape | 10 conversations / 272 sessions / 5,882 turns / 1,986 QA / 1,972 strict scored / 14 strict skipped / 1,978 retrieval attempts |
| LoCoMo license | CC BY-NC 4.0 International |

The full profile was run first on each dataset. It matched the Q1 fixture before any ablation ran:

| Track | Full-profile parity status | Mismatch count |
| --- | --- | ---: |
| LongMemEval-S | `PASS` | 0 |
| LoCoMo strict session | `PASS` | 0 |

Latency was deliberately excluded from the parity gate because wall-clock samples vary between executions.

## LongMemEval-S results

All four profiles retained 419 scoreable cases and 81 skipped cases. The Q1 metrics below are identical across the four cells in this frozen materialization.

| Profile | Recall-any@3 | Recall-all@3 | NDCG@3 | evidence_coverage@3 | Recall-all@3-feasible | cross-session coverage@3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| FTS only | 0.708830549 | 0.384248210 | 0.527455414 | 0.535481305 | 0.416020672 | 0.514555556 |
| FTS + KG | 0.708830549 | 0.384248210 | 0.527455414 | 0.535481305 | 0.416020672 | 0.514555556 |
| FTS + Recent | 0.708830549 | 0.384248210 | 0.527455414 | 0.535481305 | 0.416020672 | 0.514555556 |
| Full non-vector | 0.708830549 | 0.384248210 | 0.527455414 | 0.535481305 | 0.416020672 | 0.514555556 |

The denominator is identical in every cell: 387 budget-feasible cases, 32 budget-infeasible cases, and 300 cross-session cases. The aggregate first-relevant-rank distribution is also identical in every cell: rank 1 = 220, rank 2 = 50, rank 3 = 27, miss = 122.

### LongMemEval question-type breakdown

The four profile breakdowns are identical and are retained independently in the fixture. `scoreable` and `unknown` are shown separately; unknown cases are not zero-valued failures.

| Question type | Scoreable | Unknown | Recall-any@3 | Recall-all@3 | NDCG@3 | Coverage@3 | Feasible / infeasible | Cross-session coverage@3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| knowledge-update | 72 | 6 | 0.930555556 | 0.666666667 | 0.798663632 | 0.798611111 | 72 / 0 | 0.798611111 |
| multi-session | 121 | 12 | 0.735537190 | 0.206611570 | 0.469930147 | 0.446280992 | 99 / 22 | 0.446280992 |
| single-session-assistant | 5 | 51 | 0 | 0 | 0 | 0 | 5 / 0 | null |
| single-session-preference | 30 | 0 | 0.233333333 | 0.233333333 | 0.187697658 | 0.233333333 | 30 / 0 | null |
| single-session-user | 64 | 6 | 0.828125000 | 0.828125000 | 0.770087164 | 0.828125000 | 64 / 0 | null |
| temporal-reasoning | 127 | 6 | 0.637795276 | 0.220472441 | 0.407259693 | 0.416272966 | 117 / 10 | 0.400623052 |

### LongMemEval latency and channels

These are the values frozen in fixture SHA `ae3304c41e347370c019d06667d062dd305ef147acb8ad6d957debd42785ea1d`. They are `BENCHMARK_DERIVED` retrieval-attempt measurements and descriptive wall-clock evidence, not production latency.

| Profile | p50 ms | p95 ms | Attempts | FTS | KG | like | recent | episode | recent_fallback | vector |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| FTS only | 7.940576 | 10.118326 | 419 | 419 | 0 | 0 | 0 | 0 | 0 | 0 |
| FTS + KG | 8.279270 | 11.401448 | 419 | 419 | 0 | 0 | 0 | 0 | 0 | 0 |
| FTS + Recent | 8.586985 | 12.783171 | 419 | 419 | 0 | 0 | 0 | 0 | 0 | 0 |
| Full non-vector | 9.124042 | 13.655454 | 419 | 419 | 0 | 0 | 0 | 0 | 0 | 0 |

## LoCoMo results

The Q2 primary evidence unit is strict session-level evidence. Historical B5 strict-dialog values are not substituted into this view. All four profiles retained 1,972 strict scoreable cases, 14 strict skips, and 1,978 retrieval attempts.

Likewise, the historical B3/B4 LongMemEval NDCG is a legacy definition and is not Q1-standard NDCG; Q2 reports the Q1 contract field only.

| Profile | Recall-any@3 | Recall-all@3 | NDCG@3 | evidence_coverage@3 | Recall-all@3-feasible | cross-session coverage@3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| FTS only | 0.482251521 | 0.411764706 | 0.387664219 | 0.441661032 | 0.424020888 | 0.212170940 |
| FTS + KG | 0.482251521 | 0.411764706 | 0.387664219 | 0.441661032 | 0.424020888 | 0.212170940 |
| FTS + Recent | 0.482251521 | 0.411764706 | 0.387664219 | 0.441661032 | 0.424020888 | 0.212170940 |
| Full non-vector | 0.482251521 | 0.411764706 | 0.387664219 | 0.441661032 | 0.424020888 | 0.212170940 |

The denominator is identical in every cell: 1,915 budget-feasible cases, 57 budget-infeasible cases, and 325 cross-session cases. The aggregate first-relevant-rank distribution is identical in every cell: rank 1 = 609, rank 2 = 219, rank 3 = 123, miss = 1,021.

### LoCoMo category breakdown

The four profile breakdowns are identical and remain separately attributable by strict question category.

| Category | Name | Scoreable | Unknown | Recall-any@3 | Recall-all@3 | NDCG@3 | Coverage@3 | Feasible / infeasible | Cross-session coverage@3 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | multi-hop-retrieval | 277 | 5 | 0.429602888 | 0.032490975 | 0.212511953 | 0.200286517 | 230 / 47 | 0.201808924 |
| 2 | temporal-reasoning | 320 | 1 | 0.534375000 | 0.490625000 | 0.446885484 | 0.511458333 | 320 / 0 | 0.309523810 |
| 3 | open-domain-knowledge | 89 | 7 | 0.370786517 | 0.213483146 | 0.241243370 | 0.273140717 | 79 / 10 | 0.203533027 |
| 4 | single-hop-retrieval | 840 | 1 | 0.480952381 | 0.479761905 | 0.415736259 | 0.480357143 | 840 / 0 | 0.5 |
| 5 | adversarial | 446 | 0 | 0.502242152 | 0.502242152 | 0.430303942 | 0.502242152 | 446 / 0 | null |

### LoCoMo latency and channels

These are the values frozen in fixture SHA `ae3304c41e347370c019d06667d062dd305ef147acb8ad6d957debd42785ea1d`. They are `BENCHMARK_DERIVED` retrieval-attempt measurements and descriptive wall-clock evidence, not production latency. The strict metric denominator (1,972) is intentionally not merged with the retrieval-latency denominator (1,978).

| Profile | p50 ms | p95 ms | Attempts | FTS | KG | like | recent | episode | recent_fallback | vector |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| FTS only | 15.624539 | 20.275599 | 1,978 | 1,978 | 0 | 0 | 0 | 0 | 0 | 0 |
| FTS + KG | 15.719779 | 20.216724 | 1,978 | 1,978 | 0 | 0 | 0 | 0 | 0 | 0 |
| FTS + Recent | 16.209761 | 20.934290 | 1,978 | 1,978 | 0 | 0 | 0 | 0 | 0 | 0 |
| Full non-vector | 16.600363 | 21.703477 | 1,978 | 1,978 | 0 | 0 | 0 | 0 | 0 | 0 |

## Paired transitions and factorial effects

Each ablation was compared case-by-case with `q2_non_vector_full_v1` using a `1e-12` tolerance. For both tracks and all three ablations, each of the four paired metrics (`recall_any@3`, `recall_all@3`, `evidence_coverage@3`, and `ndcg@3`) had zero improved cases and zero regressed cases. Unchanged/comparable counts were 419 for LongMemEval-S and 1,972 for LoCoMo. The bounded fixture retains the complete per-profile transition records.

For every scalar metric, the factorial definitions are:

`F = FTS only`, `K = FTS + KG`, `R = FTS + Recent`, and `KR = Full non-vector`.

`KG_without_Recent = K - F`; `KG_with_Recent = KR - R`; `Recent_without_KG = R - F`; `Recent_with_KG = KR - K`; `interaction = KR - K - R + F`.

All six defined scalar metrics had zero effects and zero interaction in both datasets:

| Metric | KG without Recent | KG with Recent | Recent without KG | Recent with KG | Interaction |
| --- | ---: | ---: | ---: | ---: | ---: |
| recall_any@3 | 0 | 0 | 0 | 0 | 0 |
| recall_all@3 | 0 | 0 | 0 | 0 | 0 |
| ndcg@3 | 0 | 0 | 0 | 0 | 0 |
| evidence_coverage@3 | 0 | 0 | 0 | 0 | 0 |
| recall_all@3_feasible | 0 | 0 | 0 | 0 | 0 |
| cross_session_evidence_coverage@3 | 0 | 0 | 0 | 0 | 0 |

The fixture also stores `absolute_delta_vs_full` for all six scalar metrics in every profile cell; it is the signed, unscaled cell-minus-full difference. The full-profile quality delta versus Q1 is zero by the parity gate. These are descriptive controlled benchmark effects, not statistically significant causal or production-prevalence claims.

## Interpretation boundary

Metrics are definitions and observed evaluation summaries, not rollout targets or thresholds. LongMemEval-S and LoCoMo are separate benchmark tracks and are never pooled. Trigger metrics are outside this retrieval ablation and are not pooled with either dataset.

The current Q1/Q2 lexical benchmark is effectively FTS-driven on the actually exercised retrieval surface. Q2-A2 validates the channel-ablation harness and proves that enabling currently unexercised KG/Recent capability paths does not alter these frozen benchmark results. It does not measure the quality contribution of populated production KG or eligible smart-add/episode Recent corpora.

The zero factorial effect is not production channel redundancy.

The limitation is structural in the frozen benchmark materialization:

- KG: LongMemEval and LoCoMo materialize `memory_confidence.kg_data = null`, so no KG candidate is exercisable in either frozen corpus. The result does not establish KG redundancy or lack of product value.
- Recent family: production isolated Recent retrieval selects only paths matching `memory/smart-add/%` and `memory/episodes/%`. The benchmark materialization uses `benchmark/longmemeval/...` and `benchmark/locomo/...`, so `recent`, `episode`, and `recent_fallback` are structurally unexercised.
- LIKE: the LIKE branch is conditional on FTS-empty behavior. Every scored retrieval attempt in Q2-A2 served FTS, so LIKE was also unexercised.

No benchmark paths were changed to `memory/episodes/...`, no `kg_data` was synthesized, and the Q1 baseline materialization was not altered. Such changes would create a new benchmark projection outside this corrective documentation update. The latency values remain descriptive benchmark evidence and are not production latency.

Top-3 full recall can be structurally impossible when a case requires more than three distinct evidence sessions. LongMemEval-S has 32 such cases in its 419 scored cases, represented by the separate feasible/infeasible and feasible-full-recall fields. `evidence_coverage@3` is retrieval evidence coverage, not semantic answer use.

The following remain outside current Q2 authority: production top-3 stale/conflict safety, production irrelevant injection/context pollution, production-observed recall latency, and `answer_evidence_coverage`. Retrieval rank, injection, citation, or disclosure/card projection are not answer-use labels. UNKNOWN and unavailable evidence are not zeros.

This result authorizes no AutoRecall rollout, semantic rollout, ranking change, production configuration change, or runtime mutation.

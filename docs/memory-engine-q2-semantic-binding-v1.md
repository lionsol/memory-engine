# Memory Engine Q2 Always-Vector Semantic Binding v1

## Status

Q2-B1 is a source-only contract. It defines how a future always-vector semantic run is validated and evaluated through the committed Q1 product metric contract. It makes no embedding-provider calls, runs no EDi qualification, and mutates no runtime, configuration, live database, or LanceDB state.

The existing semantic runners remain the execution authority and are unchanged:

- LongMemEval: `lib/benchmark/longmemeval-semantic-retrieval-runner-v1.js`
- LoCoMo: `lib/benchmark/locomo-semantic-retrieval-runner-v2.js`

There is no Q2-B1 result fixture because no real semantic execution is authorized in this stage.

## Frozen profile registry

Q2 defines one conceptual profile, `q2_always_vector_v1`, with two dataset-specific bindings.

| Dataset | Runner profile | Runner schema | Runner-served depth | Q1 evaluation depth | Clock |
| --- | --- | --- | ---: | ---: | --- |
| LongMemEval-S | `production_hybrid_semantic_session_v1` | `memory_engine_longmemeval_semantic_retrieval_v1` | 50 | 3 | runner-supplied |
| LoCoMo | `production_hybrid_semantic_dialog_locomo_time_frozen_v2` | `memory_engine_locomo_semantic_retrieval_time_frozen_v2` | 50 | 3 | `1705066861` |

Both bindings freeze:

- `vector_required=true`
- vector skip is forbidden;
- vector errors are forbidden;
- host-manager fallback is forbidden;
- semantic output must expose `retrieved_session_ids`;
- Q1 scoring consumes only `retrieved_session_ids.slice(0, 3)`.

The runner is never described as a top-3 semantic runner. It serves depth 50 so the frozen runner contracts remain intact; Q1 evaluates product quality at the production injection budget of 3.

## Dataset bindings

LongMemEval-S requires the official dataset SHA `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`, 500 source cases, 419 scoreable cases, and 81 skips. Its binding requires runner `top_k=50` and `vector_top_k>=50`. The official Q1 comparison clock remains `1800000000` for the lexical baseline; the semantic runner clock is recorded from the completed semantic run and is not retroactively assigned a historical B4 clock.

LoCoMo requires SHA `79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`, the pinned upstream and dataset-file commits, 10 conversations, 272 sessions, 5,882 turns, and 1,986 QA. Its strict session view is 1,972 scored and 14 skipped cases. The semantic runner must retain `top_k=50`, `vector_top_k=50`, and `benchmarkNowSec=materializationNowSec=searchNowSec=1705066861`. Q2 uses strict session evidence, not the historical strict-dialog primary metric.

The binders validate the completed run's profile, schema, dataset identity, depth, clock where fixed, result identity, and official population counts. They fail closed when a scored result lacks an array of ranked session IDs or lacks explicit evidence of an attempted, successful LanceDB vector path in fusion.

## Q1 quality binding

`bindQ2LongMemEvalAlwaysVectorRun(...)` and `bindQ2LocomoAlwaysVectorRun(...)` are pure binders. They normalize the official records, pair them with completed runner output, and call the existing `scoreQ1EvidenceRankingAt3(...)` and `aggregateQ1EvidenceRankingAt3(...)` primitives.

The output exposes, separately per dataset:

- Q1 `recall_any@3`, `recall_all@3`, `ndcg@3`, and `evidence_coverage@3`;
- budget-feasible/infeasible counts and `recall_all@3_feasible`;
- cross-session evidence coverage;
- first-relevant-rank distribution;
- LongMemEval question-type breakdown or LoCoMo category breakdown;
- semantic provider/vector execution evidence;
- benchmark latency evidence;
- `semantic_absolute_delta_vs_q1` for the six Q1 scalar comparison metrics.

LongMemEval uses official evidence session IDs and runner-ranked session IDs. LoCoMo uses strict normalized evidence session IDs and the runner's existing `retrieved_session_ids`; dialog IDs are not the Q2 primary ranking input.

The Q1 baseline authority is required by hash:

`test/fixtures/q1-current-baseline-v1.json` → `1867ad5ebd4368ad967c2f491f21fc888e27df3eea122741c5a4b42430bff042`

The Q2-A2 interpretation authority is also required by hash:

`test/fixtures/q2-non-vector-ablation-v1.json` → `ae3304c41e347370c019d06667d062dd305ef147acb8ad6d957debd42785ea1d`

Q2-A2 establishes only that its actually exercised non-vector benchmark surface was FTS-driven. It does not provide a populated-KG or eligible-Recent semantic comparison. LongMemEval and LoCoMo remain separate; no cross-dataset overall metric is emitted.

## Paired transitions

`computeQ2SemanticPairedTransitions(...)` compares case-aligned Q1 lexical and semantic scores for:

- `recall_any@3`;
- `recall_all@3`;
- `ndcg@3`;
- `evidence_coverage@3`.

It reports improved, regressed, and unchanged counts with a `1e-12` tolerance and excludes unknown/unscoreable cases. A future full run must provide aligned case scores; aggregate-only Q1 fixture values are not sufficient to fabricate paired transitions. Case IDs are not part of any committed result fixture.

## Latency boundary

Semantic latency is labeled `DESCRIPTIVE_RUNNER_TOP50`. It may report p50, p95, provider calls, cache hits, and corpus-build cost, but it is not a controlled comparison with the Q1 lexical top-3 latency because semantic execution depth is 50.

The binding explicitly sets `latency_comparable_to_q1_lexical_top3=false` and does not emit `semantic_vs_lexical_latency_delta` or `semantic_latency_multiplier_vs_q1`. Historical B4/B5 latency multipliers remain historical observations only.

## Historical semantic identity

Historical B4 and B5-S3 identity is retained as `SANITY_REFERENCE_ONLY`. The references record the historical dataset, SiliconFlow provider, `Qwen/Qwen3-Embedding-4B`, dimension 2560, lexical confidence threshold 0.7, depth 50, and vector attempted/skipped/error invariants.

Historical metric values are not used as the current Q2 semantic baseline. They cannot prove bit-for-bit reproduction because the historical artifacts are not vendored, the model revision is `unavailable/unpinned`, and future provider execution occurs at a later provider state. They may only identify gross shape, profile, invariant, or qualitative-direction anomalies.

## Provider fingerprint contract

Q2-B1 defines the evidence required before a future Q2-B2 execution. The current identity is:

- provider: `SiliconFlow`;
- model: `Qwen/Qwen3-Embedding-4B`;
- revision: `unavailable/unpinned`;
- dimension: `2560`.

The future execution must first embed the fixed neutral source sentinel identified as `q2-neutral-provider-sentinel-v1`. The sentinel is not a benchmark question, answer, or user-content sample. The execution must validate dimension 2560 and finite numeric values, then serialize the vector exactly as `JSON.stringify(vector.map(value => Number(value)))`, encode that string as UTF-8, and SHA-256 it.

The resulting record contains only provider identity, base URL identity, model/revision, dimension, fingerprint method, sentinel ID, hash, and observation time. Raw vectors are rejected from the committed contract and fixture. The fingerprint identifies that execution's provider behavior; it does not claim equivalence with historical B4/B5-S3 because no historical fingerprint exists.

## Selective-vector boundary

`q2_selective_vector_v1` is explicitly `NOT_IMPLEMENTED`. The existing semantic qualification runners require vector execution on every scoreable retrieval and reject vector skips. Q2-B1 does not weaken those invariants or implement selective vector.

## Interpretation boundary

These are metric and execution definitions, not rollout thresholds. A future semantic result must remain a separately attributable benchmark evaluation for each dataset. It does not authorize AutoRecall rollout, semantic rollout, ranking changes, provider changes, runtime configuration changes, or live data mutation.

# Memory Engine Q2 Non-Vector Channel Ablation Harness v1

## Status and scope

This document freezes the benchmark-only channel capability controls and profile identities for Q2 ablation work. Q2-A1 defines the harness; it does not run the LongMemEval or LoCoMo ablation datasets, change retrieval quality, or mutate runtime behavior.

The controls are passed through the existing benchmark runtime access scope. Production `lib/recall/hybrid-search.js` remains unchanged. Existing benchmark callers retain their defaults: isolated FTS, isolated KG, isolated Recent family, no legacy fallback, and the existing deterministic empty vector backend unless a separate semantic runner supplies one.

## Channel model

The production orchestration collects channels in this order: KG, FTS, vector, Recent family, fusion, rerank, and canonical projection. The Recent family consists of `like`, `recent`, `episode`, and `recent_fallback`.

`production_hybrid_lexical_session_v1` is therefore a non-vector full-fusion profile, not an FTS-only profile. Confidence, category, and recency are ranking/reranking features and are not represented as retrieval channels. Episode is emitted by the Recent collector and is not independently switchable.

The benchmark runtime exposes only these bounded controls:

| Capability | Meaning when true | Q2 control |
| --- | --- | --- |
| `isolatedFts` | FTS collection | fixed `true` |
| `isolatedKg` | KG collection through the isolated access path | profile-controlled |
| `isolatedRecent` | Recent-family collection through the isolated access path | profile-controlled |
| `legacyFallbackAllowed` | legacy DB fallback | fixed `false` |
| vector backend | semantic collection | empty deterministic backend for Q2 non-vector profiles |

When KG or Recent is disabled, the existing access/fail-closed path suppresses its candidates and does not activate legacy fallback. FTS behavior and the production ranking/reranking policy remain unchanged.

## Frozen profile registry

The executable schema is `memory_engine_q2_channel_ablation_v1`. Every supported profile fixes `evaluation_top_k=3` and `ranking_policy=production_unchanged`.

| Profile | FTS | KG | Recent family | Vector | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| `q2_non_vector_full_v1` | on | on | on | off | canonical current baseline; compatible with `production_hybrid_lexical_session_v1` |
| `q2_fts_only_v1` | on | off | off | off | executable |
| `q2_fts_kg_v1` | on | on | off | off | executable |
| `q2_fts_recent_v1` | on | off | on | off | executable |

`q2_nv0`, `q2_nv4`, and `q2_full_non_vector_v1` resolve to the canonical `q2_non_vector_full_v1` profile. NV0 and NV4 must not become two separately scored profiles when their behavior is identical.

The following identities are registered but not executable by Q2-A1:

| Identity | Status | Boundary |
| --- | --- | --- |
| `q2_vector_only_v1` | `DEFER_UNSUPPORTED_WITH_CURRENT_PRODUCTION_ORCHESTRATION` | Production hybrid collection unconditionally includes FTS; production orchestration is not changed for this harness. |
| `q2_metadata_only_v1` | `NOT_A_DISTINCT_RETRIEVAL_CHANNEL` | Metadata confidence/category/recency are ranking features. |
| `q2_episode_only_v1` | `NOT_INDEPENDENTLY_SWITCHABLE` | Episode is part of the Recent family. |
| `q2_full_semantic_v1` | `SUPPORTED_BY_EXISTING_SEMANTIC_RUNNER` | Provider required; execution is not authorized in Q2-A1. |
| `q2_selective_vector_v1` | `SOURCE_DESIGN_REQUIRED` | A provider is required for full execution; the current semantic runner is not a selective-vector contract. |

## Observed-channel contract

`assertQ2ObservedChannelContract` validates the actual `channels` and/or `channel_sizes` reported by `hybridSearch`, including the nested debug output. It does not validate only the requested profile. An allowed channel may be empty for an individual query; the assertion only rejects a served channel outside the profile’s allowed set.

The allowed served channels are:

- FTS-only: `fts`
- FTS+KG: `fts`, `kg`
- FTS+Recent: `fts`, `like`, `recent`, `episode`, `recent_fallback`
- full non-vector: all of the preceding non-vector names

No Q2 non-vector profile may serve `vector`. Missing channel observability is insufficient evidence and is rejected by the assertion.

## Q1 comparison identity

Future Q2 reports must bind the Q1 fixture SHA-256:

`1867ad5ebd4368ad967c2f491f21fc888e27df3eea122741c5a4b42430bff042`

Comparisons remain separate for the LongMemEval-S Q1 lexical/session track and the LoCoMo Q1 lexical/strict-session track. LongMemEval and LoCoMo are not pooled. AutoRecall trigger metrics are outside channel-ablation retrieval deltas and are not pooled with either retrieval track.

The Q2 production comparison budget is `top_k=3`. This harness does not introduce a ranking threshold, rollout threshold, semantic result, or production prevalence claim.

## Interpretation boundary

These are profile and measurement definitions, not target thresholds. Channel ablation results will be offline evaluation evidence, not production failure prevalence. Retrieval channel presence is not semantic answer use. Trigger false positives are not automatically irrelevant injections. Unsupported or unauthorized profiles remain explicit statuses rather than fabricated benchmark numbers.

Q2-A1 authorizes no provider call, EDi qualification, AutoRecall enablement, ranking change, retrieval tuning, telemetry change, runtime mutation, or dataset execution. The full ablation comparisons belong to a later stage.

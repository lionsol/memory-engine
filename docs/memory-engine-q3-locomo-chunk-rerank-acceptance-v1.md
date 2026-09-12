# Q3 LoCoMo canonical chunk rerank — acceptance
Date: 2026-09-12
Status: ACCEPTED_WITH_LIMITATIONS / OFFLINE_COMPARISON_CLOSED
Q3 architecture decision: OPEN. Production activation: NOT AUTHORIZED.

## Evidence and execution
Profile: q3_locomo_chunk_fts_only_v1. Fixed population: 1970.
Execution source: 510af7b0f9897b52619bcbe581ff4a239f75cad9.
Completed: 2026-09-11T22:22:41.849Z (2026-09-12 06:22:41.849 Asia/Shanghai).
Experiment root: /home/lionsol/.openclaw/workspace/q3-locomo-v1.2/runs/q3-locomo-chunk-fts-rerank-v1/
State SHA256 observed during closeout: 4ccfdcc0ad49b48c88cf3b8adeb5dbf42a8cd3dfb8e8079762436e8ca1d3b55f.
Candidate manifest SHA256: 47c7d5f601e5a7ac11efc26e5ac7a3f0b0b7b9082875377768b965e6a5dba789.
Control SHA256: 4823571187ed8900ec3a089cc3a63edfdde1f61357cf6ff1fafdba8c71cb3f28.

1971 request attempts yielded 1970 valid case results. One historical timeout attempt remains unknown; its retry completed successfully. Total authorized consumption: 4494/4494. No further provider budget remains.
The first 20 valid results retain the original 2000ms provenance; recovery used 10000ms and at least 60000ms between request starts. No provider stability sentinel was performed.

## Independent offline scoring
The review reconstructed source groups from frozen chunks and turn-offset mappings and invoked locomo-chunk-evidence-scorer.js. All 1970 saved results had valid response markers, matching candidate identities, complete output permutations and score-descending/original-rank tie ordering. Control recomputation had zero metric differences at tolerance 1e-12. Final scoring unknown count: zero.
This report records the independent read-only recomputation; no provider or retrieval rerun was performed. It is an aggregate acceptance record, not a new per-case scoring artifact.

| Metric | Control | Rerank | Delta percentage points |
| --- | ---: | ---: | ---: |
| Recall-any@3 | 1030/1970 = 52.2843% | 1564/1970 = 79.3909% | +27.1066 |
| Recall-all@3 | 888/1970 = 45.0761% | 1354/1970 = 68.7310% | +23.6548 |
| Evidence coverage@3, case macro mean | 48.2139% | 73.7525% | 25.5386 |

Coverage sums before division by 1970: control 949.8140465915236; rerank 1452.9235298585147.

| Metric | Improved | Regressed | Unchanged |
| --- | ---: | ---: | ---: |
| Recall-any@3 | 551 | 17 | 1402 |
| Recall-all@3 | 476 | 10 | 1484 |
| Evidence coverage@3 | 596 | 23 | 1351 |

| Official category | Cases | Control all-hit | Rerank all-hit |
| --- | ---: | ---: | ---: |
| 1 (multi-hop) | 277 | 12 | 51 |
| 2 | 320 | 130 | 235 |
| 3 | 89 | 16 | 29 |
| 4 | 839 | 465 | 676 |
| 5 | 445 | 265 | 363 |

## Cost and latency
All 1970 valid responses contain meta.tokens.input_tokens; their sum is 32646389. Historical timeout usage remains unknown and is not zero. Token/billed-unit reporting does not establish actual monetary charges.
Successful-request latency: mean 968.4071ms, p50 974ms, p95 1245ms, max 5735ms. These exclude active pacing waits and combine historical/recovery observations; they are not production end-to-end latency or proof of a production SLA.

## State reconciliation
Observed top-level status=complete, results=1970, inflight=null.
Observed recovery.status=running is stale; the retained top-level stop describes historical attempt 21, not a new failure.
Adjudicated recovery outcome: COMPLETE. This report supplies the reconciled interpretation without editing the original runner state or deleting attempt/stop history. The runner's failure to finalize recovery.status is an adjacent source defect for Codex, not a reason to reopen quality evaluation.

## Decision and next work
Accept the frozen FTS-only experimental canonical chunk control/rerank comparison with limitations. Three coverage metrics improve substantially; multi-hop all-hit remains only 51/277.
No inference of production-equivalent lifecycle/chunking, always-vector necessity, or session/chunk causal gain is accepted. NDCG remains null; budget feasibility and provider stability remain unknown.
Q3 should now make the architecture decision using the accumulated evidence, rather than add another provider evaluation by default. Production integration/activation, live mutations, tag and push remain outside this acceptance.

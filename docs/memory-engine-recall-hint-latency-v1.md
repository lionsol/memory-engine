# memory-engine Recall Hint latency track — RH-L1 Parallel Vector Execution

Status: `SOURCE IMPLEMENTED / OPT-IN ONLY / LOCAL CONCURRENCY VERIFIED / REAL PROVIDER PERFORMANCE EXECUTED ONCE / STOPPED ON ORDERED-OUTPUT EQUIVALENCE / LATENCY BENEFIT CONFIRMED / NO RUNTIME AUTHORITY`

## 1. Why this track exists

Q4 closed Recall Hint v1 with independently reproduced candidate recovery but a default synchronous-serving NO-GO on latency. The C2 holdout showed that target queries almost always produced two expansion queries: 31 expansions across 16 entity/multi-facet target cases, with 15/16 cases using two expansions. The measured semantic-only Hint overhead was already material before adding any producer latency.

RH-L1 is a post-Q4 execution optimization track. It does **not** reopen Q4 quality qualification and does not change the Recall Hint v1 schema, producer prompt/model, query-plan semantics, candidate depth, final topK, RRF constant, reranker, or disclosure/runtime authority.

## 2. Source finding

The existing bounded multi-query vector channel executed the frozen query set serially:

1. embed original query;
2. search original vector;
3. embed expansion 1;
4. search expansion 1;
5. embed expansion 2;
6. search expansion 2;
7. fuse the three ranked lists with deterministic RRF.

For the common C2 target shape of original + two expansions, this makes embedding/search wall-clock approximately additive even though the three vector queries are independent before fusion.

## 3. RH-L1 execution contract

RH-L1 adds an injected retrieval-policy field:

```text
recallHintVectorExecutionMode = "sequential" | "parallel"
```

The effective default remains `sequential`. Only exact `"parallel"` opts in; absent or unknown values resolve to sequential behavior.

The parallel path applies **only** when `vectorQueryPlan.mode === "recall_hint_v1"`. Historical H2 / `bounded_multi_query` remains sequential even if a caller injects the parallel value.

Successful parallel execution preserves:

- the same original query plus the same 1..2 expansion queries;
- the same number of embedding calls;
- the same number of LanceDB searches;
- the same vector topK;
- the same per-query deterministic candidate normalization and tie-breaking;
- the same RRF constant and fusion order by logical query index;
- the same final bounded vector candidate ordering.

No production config key is added, so the mode cannot be enabled through normal config merely by this source change.

## 4. Failure-path difference

Parallel execution is not operationally identical on failure. All sibling query tasks may begin before one embedding/search failure is observed. Therefore a failed parallel plan can issue more expansion embedding/search work than the historical sequential path would have issued before stopping.

The fail-closed serving behavior remains unchanged:

- any parallel-plan embedding/search failure invalidates the multi-query arm;
- no partial expansion candidate set is served;
- Recall Hint falls back to the original-query vector path;
- original-query retrieval remains the correctness fallback.

This sibling-call behavior is a required qualification item for any later real-provider performance experiment. RH-L1 source implementation alone does not authorize provider egress or live activation.

## 5. Local source evidence

Focused local tests verify:

- sequential remains the default;
- opt-in parallel and sequential produce identical fused candidate identity/order/RRF scores for the same inputs;
- embedding call count and vector-search call count are unchanged;
- embedding and search work actually overlap under delayed local fakes;
- historical H2 stays sequential;
- parallel failure remains fail-closed and does not leak sibling expansion candidates into serving;
- the runtime seam forwards the opt-in execution mode only when explicitly injected.

No real embedding, rerank, Recall Hint producer, runtime config, live Core/Engine/LanceDB, deployment, push or tag operation is part of RH-L1 source evidence.

The clean-worktree full repository review reached `2727` passing tests, `12` skipped tests and `3` failures out of `2742`. All three failures are the pre-existing LoCoMo rerank-runner fixture dependency on absent historical material at `/tmp/q3-locomo-v1.2/material`; no RH-L1, Recall Hint, Hybrid, runtime-context or Q4 regression failed. The other review phases (static check, test-integrity, strict OpenSpec and `git diff --check`) passed. Therefore the full review remains formally `overall=FAIL`, while RH-L1 source/regression evidence is clean of newly introduced failures.

## 6. What RH-L1 does not solve

RH-L1 addresses only the vector-query execution portion of the C2 semantic lower bound. It does not reduce or overlap the preceding Recall Hint producer call, and it does not change whether a query receives one or two expansions.

The explicit-search source seam still has a bounded injected Hint-provider timeout contract and no Q4-authorized live Recall Hint provider integration. Therefore RH-L1 must not be presented as an end-to-end latency solution.

Conditional expansion, one-expansion gating, producer/model changes, speculative original-query retrieval while the producer runs, or producer/retrieval overlap change behavior beyond this execution-only contract. Those require a separately versioned design and cannot be folded into Recall Hint v1 under the RH-L1 label.

## 7. Next gate

A future RH-L1 real-provider performance qualification, if separately authorized, should be performance/regression evidence rather than a new Recall Hint quality acceptance. The consumed Q4-C2 material may be reused only as regression/performance material, never relabeled as a fresh holdout.

The performance packet must precommit:

- source commit and exact parallel-execution contract identity;
- fixed query plans or another non-provider way to avoid re-tuning producer semantics;
- sequential-vs-parallel semantic equivalence checks;
- p50/p95 wall-clock comparison for vector-query execution and full semantic retrieval;
- exact embedding/search/rerank call counts;
- provider concurrency/rate-limit behavior;
- failure-case sibling-call upper bounds;
- no retry/resume/replay unless separately authorized.

Until that packet exists and is explicitly authorized, `recallHintVectorExecutionMode="parallel"` remains source-only and default-off.

## 8. RH-L1 real-provider sequential-vs-parallel performance packet

The Owner has authorized one RH-L1 real-provider performance qualification. This authorization is performance-only: it does not authorize a new quality claim, producer execution, live runtime activation, deployment, AutoRecall integration, or mutation of live Core/Engine/LanceDB.

The packet reuses the **source-frozen Q4-C1b development Hint outputs** rather than generating new Hints. It selects the 12 development rows with non-empty vector query plans (entity-reference, multi-facet and temporal diagnostic rows) and freezes exactly 19 expansion queries. This material is used only because its query plans are already source-frozen and producer-independent; no acceptance case or C2 quality holdout is reopened.

Across those 12 target cases there are 31 logical original/expansion query inputs but only 27 distinct exact strings because four original-query strings repeat across synthetic cases. With the required exact-input cache, each independent semantic session therefore has a frozen real-provider ceiling of:

- 72 synthetic canonical corpus embeddings;
- 27 distinct target original/expansion embeddings;
- **99 embedding requests total**;
- **12 rerank requests total**;
- producer requests = **0**.

The sequential and parallel arms use completely independent temporary SQLite/Lance materializations and independent embedding caches. Their combined transaction ceiling is **198 embeddings + 24 reranks**. Under the existing conservative maximum-token accounting, the per-session theoretical upper bound is below USD 0.095 and the two-arm theoretical maximum is **USD 0.18874368**; the hard transaction cap is **USD 0.19**.

To reduce temporal provider-load bias, case execution order is precommitted: even-index cases execute sequential then parallel, odd-index cases execute parallel then sequential. The two arms are never intentionally run concurrently with each other.

Qualification gates are frozen before real execution:

- candidate pool IDs must be exactly equal for sequential and parallel on all 12 cases;
- final ranked top3 IDs must be exactly equal on all 12 cases;
- observed embedding and rerank request counts must match between arms and match the frozen 99/12 per-session counts;
- sequential embedding provider concurrency must remain at most 1;
- parallel embedding provider concurrency must reach at least 2;
- pool-vector p50 latency must improve by at least **20%**;
- full semantic p50 latency must improve by at least **10%**;
- full semantic p95 may regress by at most **20%**;
- provider errors = 0;
- automatic retry/resume/replay = 0.

The real provider surface remains SiliconFlow only, reusing the existing frozen Q4 semantic profile: Qwen3-Embedding-4B at dimension 2560 and Qwen3-Reranker-0.6B with candidate depth 20 / final topK 3. Egress is limited to synthetic canonical projection text, the 12 frozen development queries, the 19 frozen expansion queries, and bounded synthetic candidate text for rerank. Gold evidence IDs, acceptance cases, full sessions, tool traces, live memory and any Recall Hint producer request are denied.

Execution requires a clean source commit and an exact `execution_binding_sha256`. Preflight is zero-egress and does not create an attempt marker. The provider-capable path creates one exclusive `CONSUMED` attempt marker before egress; any PASS, STOPPED, provider failure or environment failure consumes the authorization. There is no automatic retry, resume or replay.

## 9. Real-provider qualification result

The one Owner-authorized transaction executed under source `b69b63b1b86ef08fd812bb2270e5f93793d80dd4`, contract `5820d6bdfaf88e82dca53dbc2085557f7af68be1adf0b06e2b6e8d4327c07400`, and execution binding `7e54f8c0e486b634e279c343c048ab3c6ad7d249a7e4daae1dfe8989f3893323`. The attempt marker is `CONSUMED`; the persisted result identity is `2623e283e050e6f9c74d84ec562466d904aa017b60afe5f914bdd4e3028dd7b0`. No retry, resume or replay occurred.

The transaction result is **STOPPED**, solely because the precommitted ordered-output equivalence gate failed. Provider/cost/concurrency/latency gates otherwise behaved as intended:

- sequential: 99/99 embedding calls completed, 12/12 reranks completed, provider errors 0, max embedding concurrency 1;
- parallel: 99/99 embedding calls completed, 12/12 reranks completed, provider errors 0, max embedding concurrency 3;
- conservative cost upper bound was USD 0.09437184 per arm / **USD 0.18874368 total**, within the USD 0.19 hard cap;
- pool-vector p50 improved `333ms -> 157ms`, a **52.85%** speedup;
- full-semantic p50 improved approximately `748.45ms -> 496.71ms`, a **33.63%** speedup;
- full-semantic p95 improved approximately `1484.85ms -> 750.56ms`, about **49.45%** faster rather than regressing;
- 11/12 cases improved pool-vector latency and 10/12 improved full-semantic latency.

The ordered-output failure is narrow but real under the frozen gate. Across all 12 cases, the **candidate pool membership set was identical 12/12** and the **top3 membership set was identical 12/12**. However, candidate pool order differed on 7/12 cases. Final top3 order differed on exactly one case, `q4c1-temporal-11`, where the same three IDs were returned but the first two positions swapped. There were no sequential-only or parallel-only candidate IDs.

This evidence does **not** justify retroactively changing the gate or relabeling the STOPPED transaction as PASS. The two arms deliberately used independent real-provider calls, independent embedding caches and independent temporary Lance materializations. Therefore this run cannot by itself attribute the observed ordering variation specifically to parallel execution, provider numeric variability, ANN ordering variability, or another independent-run effect.

The next valid investigation should separate two questions rather than replay this transaction:

1. **execution semantic equivalence** — compare sequential and parallel scheduling against the same frozen embedding vectors / same deterministic vector-search inputs so concurrency is the only changed variable;
2. **real-provider performance/concurrency** — retain the completed run as evidence that three-way embedding concurrency is accepted by the provider without errors and materially reduces median/p95 semantic latency.

The consumed performance material may be used for post-run analysis and regression evidence, but the exact transaction must not be replayed. `recallHintVectorExecutionMode="parallel"` remains default-off and has no runtime/deployment authority.

## 10. RH-L1-E1 deterministic execution equivalence

RH-L1-E1 isolates the JavaScript scheduling/fusion question from real-provider and ANN-run variability. It reuses the same 12 frozen performance target plans but replaces external embedding, vector search and rerank variability with deterministic local inputs while preserving the real semantic-session path through `hybridSearch()`, `collectVectorCandidates()`, RRF fusion and offline rerank.

The clean-source execution at `c106d1ff80bf602a4d4543ba35c6f7f4910476d4` used:

- deterministic embedding `rh_l1_sha256_sparse_embedding_v1`;
- deterministic exact cosine store `rh_l1_exact_cosine_store_v1`;
- deterministic rerank `rh_l1_sha256_rerank_v1`;
- frozen target-plan identity `8532ff701d2863f93ac2f58dea5bbb093cf6c5304f6aa8e4ab17c53dc777c486`;
- external provider requests = `0`.

Result: **PASS**. Candidate pool ordering was exactly equal `12/12`; ranked top3 ordering was exactly equal `12/12`; sequential and parallel execution modes were observed as requested; both arms recorded the same `99` embedding requests, `35` cache hits and `12` reranks. CLI result identity is `1cb7743cf6fac77fc4a47ce7956d1581d65a008856db7494b8b56774dcb34f0a`; execution-result identity is `bb6ee37729dee7aa3a95cf379067201247bf6f937f0ad4616f9b938c36bef0a5`.

E1 therefore shows that, for identical deterministic vector-search inputs, the parallel scheduling plus existing deterministic RRF/final-ranking implementation does not itself reorder candidate pools or top3 output.

## 11. RH-L1-E2 frozen-embedding real-LanceDB equivalence

RH-L1-E2 strengthens E1 by restoring the actual local LanceDB implementation while holding embedding vectors and rerank scores deterministic. Both sequential and parallel arms run against **one shared temporary LanceDB session/table and one shared exact-input embedding cache**, so the only relevant difference is the vector-query execution mode. No external provider call occurs.

The clean-source execution at `e9e938aaa0f1eb3af9924512710d5ec4e6c2fcad` again used the frozen 12 target plans and deterministic embedding/rerank inputs, with vector store identity `rh_l1_shared_real_lancedb_v1`.

Result: **PASS**. Candidate pool ordering was exactly equal `12/12`; ranked top3 ordering was exactly equal `12/12`; execution-mode observation was valid. The single shared session recorded `99` embedding requests, `97` cache hits and `24` reranks; external provider requests remained `0`. CLI result identity is `e4b7c68370e0a388aa006788696fe4c2fa807f2002b3da6539d7bbbc85441de4`; execution-result identity is `21281a712fb8bc03952f384465817474c155801c7110de00d7e980357e792a80`.

A negative E2 test also confirms that an ordering-only divergence with identical membership is rejected, and missing required material fails before a semantic session is opened.

## 12. Combined RH-L1 adjudication

The original real-provider transaction remains **STOPPED** under its precommitted ordered-output gate and is not retroactively relabeled. E1/E2 are separate zero-provider diagnostic evidence.

Combined evidence now supports the narrower conclusion that **RH-L1 parallel execution is ordered-output equivalent when numerical retrieval inputs are held fixed**, including when the actual local LanceDB table is queried concurrently. The real-provider run independently confirms material performance benefit and provider concurrency tolerance: pool-vector p50 improved by `52.85%`, full-semantic p50 by `33.63%`, full-semantic p95 by about `49.45%`, with zero provider errors and embedding concurrency reaching `3`.

The remaining one-run ordering variability is therefore not supported as a defect in the JavaScript parallel scheduler, deterministic RRF fusion, or same-table concurrent LanceDB search. The existing evidence still does not uniquely distinguish real-provider floating-point/numeric variation from differences caused by independent vector materialization or ANN execution across separate sessions.

RH-L1 is consequently **execution-equivalence qualified and real-provider latency-benefit confirmed, but not runtime authorized**. Parallel mode remains opt-in/source-only. A production adapter/config rollout, live canary, AutoRecall integration, or default explicit-search activation requires a separate product/runtime authorization and must not reuse the consumed performance transaction as a new acceptance run.

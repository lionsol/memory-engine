# memory-engine Recall Hint latency track — RH-L1 Parallel Vector Execution

Status: `SOURCE IMPLEMENTED / OPT-IN ONLY / LOCAL CONCURRENCY VERIFIED / REPOSITORY REGRESSION CLEAN EXCEPT KNOWN LOCO MO FIXTURE ABSENCE / REAL PROVIDER PERFORMANCE NOT AUTHORIZED / NO RUNTIME AUTHORITY`

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

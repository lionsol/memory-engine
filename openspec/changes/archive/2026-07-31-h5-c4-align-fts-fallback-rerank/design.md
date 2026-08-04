## Context

The hybrid search orchestrator currently derives three related values from the stripped query:

- `normalizedQuery`, used for the primary strict FTS `MATCH`;
- `fallbackFtsQuery`, a bounded OR query produced by `buildFtsFallbackQuery()`;
- `queryTerms`, produced from the original normalized query and capped independently.

When strict FTS returns no rows, `collectFtsCandidates()` executes `fallbackFtsQuery`, then calls `rankFtsFallbackCandidates()` with the original `queryTerms`. This creates a semantic split: SQL row selection uses bounded fallback terms, while fallback token coverage uses a different early-query term window.

H5-C3 corrected the bounded selector so late identifiers can enter `fallbackFtsQuery`. H5-C4 must carry those exact selected terms through fallback reranking without changing unrelated ranking or safety behavior.

## Goals / Non-Goals

**Goals:**

- Derive fallback rerank coverage terms from the final bounded fallback OR query.
- Ensure a row matched by a retained late identifier receives positive coverage for that identifier.
- Prevent omitted early normalized-query terms from contributing phantom fallback coverage.
- Preserve exact-fragment bonus behavior as a separate signal.
- Preserve strict FTS, fusion, confidence, gating, and runtime defaults.
- Expose minimal non-sensitive alignment evidence in debug metadata.

**Non-Goals:**

- Changing `buildFtsFallbackQuery()` selection policy established by H5-C3.
- Changing fallback score weights, category boosts, recency boosts, RRF, topK, or channel limits.
- Moving candidate safety gates or changing raw-log eligibility.
- Changing vector, KG, Recent, Like, or Episode channels.
- Enabling AutoRecall, installing runtime code, or running a live canary as part of implementation.
- Repairing the current post-index Core/Engine/LanceDB observed state.

## Decisions

### Decision 1: Parse rerank terms from the final fallback query

Introduce a small FTS-safe helper that converts the generated bounded OR expression into its ordered unique term list. The helper operates only on output produced by `buildFtsFallbackQuery()` and rejects or ignores operator/noise tokens rather than re-normalizing the entire raw prompt.

Preferred contract:

- input: `fallbackFtsQuery` such as `term_a OR term_b OR 结合`;
- output: `['term_a', 'term_b', '结合']`;
- output order matches the bounded query;
- output contains only FTS-safe terms;
- output length is no greater than the bounded query term count.

This is preferable to calling the normal query tokenizer on the OR expression, which could accidentally introduce the literal operator `OR` as a lexical term.

### Decision 2: Use aligned terms only in the fallback reranker

The fallback branch in `collectFtsCandidates()` passes aligned fallback terms to `rankFtsFallbackCandidates()`. The primary strict branch continues to enrich candidates with the existing original-query terms.

`rankFtsFallbackCandidates()` continues to receive the stripped raw query for exact-fragment extraction and existing category/recency scoring. Only its coverage term input changes for the fallback branch.

### Decision 3: Do not tune weights in H5-C4

The observed ranking defect can be explained by term-set mismatch. This change first fixes that correctness defect without changing the scoring constants. Tests must demonstrate that alignment alone makes the canary-shaped target survive and rank correctly under a realistic controlled fixture.

If aligned terms still cannot satisfy that fixture without weight changes, implementation stops and reports the result rather than silently expanding H5-C4 into a score-tuning change.

### Decision 4: Add explicit alignment metadata

Fallback debug data records a compact source marker and count, for example:

- `fts_rerank_term_source: 'fallback_query'`;
- `fts_rerank_term_count: <number>`.

The strict path may record `fts_rerank_term_source: 'primary_query'` only if doing so is useful and backward-compatible. No full prompt or new persistent raw term list is required.

### Decision 5: Test at helper, ranker, channel, and canary-shaped integration levels

Tests cover:

1. OR-term parsing and FTS safety;
2. direct fallback ranker behavior with aligned versus early original terms;
3. legacy and isolated FTS channel parity;
4. strict-path non-regression;
5. a canary-shaped in-memory fixture in which a unique late-identifier target ranks ahead of a broad old memory before top-one truncation;
6. debug metadata source/count fields.

## Risks / Trade-offs

- A broad row that genuinely matches several selected bounded terms may still outrank a target; that is legitimate evidence and remains controlled by existing scoring and gates.
- Exact fragments can still contribute a bonus even when only one component is in the bounded query. This is intentional, but tests must keep coverage and exact bonus separately observable.
- Parsing the OR expression creates a second representation of selected terms. The helper must remain tightly coupled to the bounded query format and have regression tests for empty, one-term, Chinese, underscore, and mixed alphanumeric cases.
- Changing debug snapshots may require narrow fixture updates. Schema additions must be optional and backward-compatible.

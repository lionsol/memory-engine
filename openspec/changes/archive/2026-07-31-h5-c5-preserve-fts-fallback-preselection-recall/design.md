## Context

H5-C4 aligns fallback `MATCH` terms and fallback rerank coverage terms, but the alignment only applies to rows returned by the SQL selector. A global `ORDER BY bm25(...) LIMIT ftsTopK` can discard a uniquely matching late identifier before `rankFtsFallbackCandidates()` sees it. H5-C5 adds bounded representation-preserving preselection before the existing reranker.

## Goals

- Preserve at least a small representative candidate set for every final bounded fallback term.
- Keep the global bounded-OR pool and existing `ftsTopK` semantics observable.
- Use the exact ordered, unique, FTS-safe `fallbackRerankTerms` supplied by H5-C4.
- Keep legacy attached-Core and isolated-Core FTS behavior equivalent.
- Keep union size, probe count, and per-probe rows deterministically bounded.
- Let the existing aligned fallback reranker, score weights, final topK, gates, Card projection, and reinforcement remain authoritative.
- Expose only strategy and counts in debug metadata.

## Non-Goals

- No second term-selection algorithm.
- No changes to H5-C3 bounded term selection or H5-C4 fallback scoring.
- No score-weight, exact-bonus, category, recency, RRF, fusion, final topK, or gate changes.
- No changes to strict FTS, vector/KG/Recent channels, runtime configuration, persistent schema, or data.

## Decisions

### 1. Derive probes from final bounded terms

The selector receives `fallbackFtsQuery` and `fallbackRerankTerms` from the existing H5-C4 query setup. The probe list is exactly the ordered, unique, FTS-safe `fallbackRerankTerms`; it does not inspect the raw prompt or independently tokenize the normalized query.

### 2. Use a two-layer bounded preselection

The fallback selector performs:

1. One global bounded-OR query with the existing `ftsTopK` limit.
2. One probe query per bounded term, in bounded-term order, with `per_term_probe_limit = 2`.
3. A deterministic union by chunk ID.

With the current defaults, `global_pool_limit = 20`, `probe_term_count <= 8`, `per_term_probe_limit = 2`, and `maximum_raw_union <= 36` before deduplication. This expands only the internal rerank input; it does not expand final channel topK or AutoRecall topK.

Every probe, including broad or Chinese terms, receives the same fixed small limit. No new high-information heuristic is introduced.

### 3. Stable ordering and deduplication

Global rows retain global SQL order. Probes execute in bounded-term order, and each probe uses a stable secondary chunk-ID tie-break after BM25 ordering. The union appends unseen IDs in that deterministic order. If a row appears in both global and probe results, the first global instance is retained; repeated probe instances are discarded. The resulting rows are passed unchanged to `rankFtsFallbackCandidates()` with the H5-C4 bounded terms.

The reranker remains responsible for final score ordering and returns no more than the existing `ftsTopK` rows. A late identifier target can therefore enter the reranker without changing ranking weights or final result budgets.

### 4. Strict path is unchanged

If the primary normalized FTS query returns rows, the selector returns through the existing strict path. No fallback query, per-term probe, union, or probe debug counters execute. Strict scoring and lexical enrichment continue to use their existing inputs.

### 5. Debug metadata and compatibility fields

Fallback debug metadata adds only bounded counters:

- `fts_preselection_strategy = "global_or_plus_term_probes_v1"`;
- `fts_preselection_global_count`;
- `fts_preselection_probe_query_count`;
- `fts_preselection_probe_raw_count`;
- `fts_preselection_union_count`;
- `fts_preselection_probe_per_term_limit`;
- `fts_preselection_post_rerank_count`.

The existing `fallback_count` continues to mean the global bounded-OR raw row count. The new union counters describe the complete rerank input and prevent a silent semantic change. Existing `fts_raw_final` remains a historical candidate-count field and is not removed or renamed; the new union count is the accurate preselection measure. Existing `strict_count`, `fts_query_final`, `fts_rerank_term_source`, `fts_rerank_term_count`, `post_rerank_topK`, and `candidate_counts_before_filtering` remain available.

No prompt, raw token list, memory body, embedding, or secret is persisted.

### 6. Stop condition

If the bounded preselection union contains the target but aligned reranking still does not rank it first in the controlled top-one-shaped fixture, implementation stops and reports the scores and ranking. H5-C5 must not compensate by changing weights, final topK, fusion, or gates. If the target is still absent from the union, implementation is likewise blocked on preselection evidence rather than expanded budgets.

## Test Strategy

Use real in-memory SQLite FTS5 fixtures with at least 25–40 distractors. The global bounded-OR `LIMIT 20` must deterministically exclude a target that only matches a late identifier component. Term probes must recover it, and the existing aligned reranker must rank it first with an independent exact bonus. Cover legacy attached FTS and isolated Core FTS, confidence/archive filtering, duplicate union rows, empty and boundary term sets, strict primary success, and the canary-shaped focused-query path without Gateway or an LLM.

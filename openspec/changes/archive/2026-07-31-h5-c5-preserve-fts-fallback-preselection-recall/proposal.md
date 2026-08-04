## Why

H5-C3 made late high-information identifiers survive the bounded fallback query, and H5-C4 made fallback `MATCH` and fallback coverage reranking use the same bounded terms. The post-repair live canary still failed because the SQL preselection step ran before the aligned reranker:

```text
global bounded-OR MATCH
ORDER BY bm25
LIMIT 20
→ rankFtsFallbackCandidates()
```

The global BM25 pool was filled by older distractors that matched common bounded terms. The unique synthetic target matched only a late identifier component and was absent from the first 20 rows. A reranker cannot promote a candidate that never enters its input set.

## What Changes

Define a deterministic, bounded fallback preselection strategy:

```text
global bounded-OR pool
+ per-bounded-term representative probes
→ deterministic union and chunk-id deduplication
→ existing H5-C4 aligned fallback rerank
```

The probes use the final `fallbackRerankTerms` from H5-C4 directly. They do not perform another raw-query or normalized-query term selection. The global pool keeps the existing `ftsTopK` limit, while each of at most eight bounded terms contributes at most two probe rows. The maximum internal raw union is therefore `ftsTopK + 2 * 8`, which is 36 at the current defaults.

## Non-Goals

This change does not modify strict FTS, bounded term selection, fallback score weights, final AutoRecall `topK`, RRF/fusion, candidate injection gates, Card projection, reinforcement, runtime configuration, or persistent schema. It does not authorize installation, AutoRecall enablement, or a new live canary.

## Impact

The change is limited to fallback FTS row preselection, legacy/isolated selector plumbing, bounded debug counters, and direct SQLite FTS5 regression coverage. Existing rerank ordering remains authoritative after the union, and the final fallback result remains limited by the existing `ftsTopK` and downstream topK behavior.

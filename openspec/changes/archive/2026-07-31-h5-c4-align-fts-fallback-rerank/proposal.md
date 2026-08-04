## Why

H5-C3 makes the bounded fallback FTS query retain late high-information identifiers, but the fallback reranker still measures token coverage with the first terms from the original normalized query. A candidate can therefore match the actual bounded FTS query and still be demoted or discarded because the reranker evaluates a different token set. In the observed canary-shaped case, a broad older memory can rank above the unique synthetic target even after the target becomes MATCH-visible.

This mismatch blocks a meaningful runtime canary: query shaping can now find the target, but the lexical fallback path can still remove it before candidate gating and injection.

## What Changes

- Make fallback FTS candidate coverage use the same bounded terms that were used by the fallback `MATCH` query.
- Keep raw-query exact fragments as a supplemental exact-match signal, separate from bounded-term coverage.
- Preserve strict FTS behavior when the normalized primary query returns rows.
- Add deterministic debug metadata identifying whether fallback reranking used primary or bounded fallback terms, without persisting the complete user prompt.
- Add regression coverage for a late identifier target competing with a broad old memory under a `topK=1`-shaped retrieval path.

## Capabilities

### New Capabilities
- `fts-fallback-rerank-alignment`: Ensures fallback FTS matching and fallback candidate reranking evaluate the same bounded lexical terms while retaining safe exact-fragment bonuses.

### Modified Capabilities

None.

## Impact

Affected code is limited to the fallback FTS lexical path, its query-term plumbing, debug metadata, and focused tests. The change must not alter default query budgets, topK values, vector/KG/recent channels, candidate safety gates, reinforcement, Card projection, AutoRecall enablement, persistent data, or runtime configuration.

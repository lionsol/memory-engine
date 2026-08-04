## 1. Query-term alignment implementation

- [x] 1.1 Add a deterministic helper that extracts ordered unique FTS-safe terms from the final bounded fallback OR query without introducing the `OR` operator as a term.
- [x] 1.2 Derive the fallback rerank term set once in the hybrid search query setup or FTS channel runtime and pass it explicitly to the fallback FTS branch.
- [x] 1.3 Make `rankFtsFallbackCandidates()` use the aligned fallback terms for token coverage while retaining raw-query exact-fragment extraction as a separate signal.
- [x] 1.4 Preserve the primary strict FTS branch, query budgets, channel limits, scoring weights, fusion, candidate gates, and reinforcement behavior.

## 2. Debug and evidence

- [x] 2.1 Add backward-compatible debug metadata that identifies the fallback rerank term source and bounded term count.
- [x] 2.2 Confirm existing `strict_count`, `fallback_count`, `fts_query_final`, `candidate_counts_before_filtering`, and `post_rerank_topK` remain available and accurate.
- [x] 2.3 Do not persist the complete prompt or a new full raw token list.

## 3. Targeted regression tests

- [x] 3.1 Test fallback OR-term parsing for empty, one-term, Chinese, underscore/version, mixed alphanumeric, duplicate, and max-eight-term inputs.
- [x] 3.2 Test that omitted early normalized-query terms cannot contribute fallback token coverage.
- [x] 3.3 Test that a retained late identifier gives its target positive fallback coverage and an independent exact-fragment bonus when applicable.
- [x] 3.4 Test that a broad competing row matching only omitted early terms is dropped or ranks below the late-identifier target.
- [x] 3.5 Test that a competing row genuinely matching multiple selected fallback terms still receives legitimate coverage.

## 4. Channel and integration coverage

- [x] 4.1 Add legacy FTS channel coverage proving primary success bypasses fallback and preserves existing behavior.
- [x] 4.2 Add legacy and isolated fallback tests proving selector and reranker term semantics remain aligned.
- [x] 4.3 Add a canary-shaped in-memory integration fixture with a late compound identifier, post-sentinel tool/citation fields, a broad old row, and a unique target row.
- [x] 4.4 Assert the target ranks first before a top-one-shaped truncation without changing score weights or topK defaults.
- [x] 4.5 Add or update debug metadata snapshots for the source/count fields.

## 5. Validation and handoff

- [x] 5.1 Run Node 24 targeted tests for query utilities, fallback ranker, FTS channels, hybrid search, and AutoRecall debug metadata.
- [x] 5.2 Run directly related suites in both normal and isolated FTS modes.
- [x] 5.3 Run the exact repository `npm test`, static check, and `git diff --check`.
- [x] 5.4 Report exact pass/fail/skip counts, changed files, behavior change, remaining risks, and Git status.
- [x] 5.5 Do not commit, push, install, restart services, enable AutoRecall, modify persistent data, or run a live canary until GPT code review authorizes the next stage.

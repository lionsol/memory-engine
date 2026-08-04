## 1. Preselection implementation design

- [x] 1.1 Define the fallback preselection helper/selector around the existing global bounded-OR query.
- [x] 1.2 Feed probes exclusively from H5-C4 `fallbackRerankTerms`.
- [x] 1.3 Enforce `global_pool_limit=ftsTopK`, `per_term_probe_limit=2`, and at most eight probe terms.
- [x] 1.4 Preserve strict primary FTS behavior with zero fallback probes.

## 2. Channel plumbing and semantics

- [x] 2.1 Add legacy attached-Core selector plumbing for global rows and term probes.
- [x] 2.2 Add isolated Core selector plumbing using the same strategy and limits.
- [x] 2.3 Implement deterministic global/probe union and chunk-ID deduplication.
- [x] 2.4 Pass the union to the existing H5-C4 aligned fallback reranker without score or topK changes.

## 3. Observability

- [x] 3.1 Add backward-compatible preselection strategy and bounded count metadata.
- [x] 3.2 Preserve the existing `fallback_count` global-row semantics.
- [x] 3.3 Preserve existing strict/rerank/candidate count fields and document `fts_raw_final` compatibility semantics.
- [x] 3.4 Confirm no prompt, token list, memory body, embedding, or secret is persisted.

## 4. Regression and integration tests

- [x] 4.1 Test empty, one-term, eight-term, duplicate, Chinese, underscore/version, and mixed-alphanumeric bounded terms.
- [x] 4.2 Test global pool underfill, global pool saturation, no-op probes, and global/probe duplicate rows.
- [x] 4.3 Add a real SQLite FTS5 fixture with 25–40 distractors where global `LIMIT 20` excludes the late-identifier target.
- [x] 4.4 Verify probe union recovery, aligned coverage, independent exact bonus, and target rank #1 before top-one truncation.
- [x] 4.5 Verify legitimate multi-term competitors retain existing coverage semantics.
- [x] 4.6 Verify legacy/isolated parity, confidence merge, and archived-row exclusion.
- [x] 4.7 Add the focused-query AutoRecall-shaped fixture with post-sentinel tool/citation fields, existing gate, and Card projection assertions without Gateway or LLM.
- [x] 4.8 Update debug metadata snapshots for strategy and count fields.

## 5. Validation and handoff

- [x] 5.1 Run Node 24 targeted preselection, FTS, hybrid, and AutoRecall-shaped tests.
- [x] 5.2 Run directly related suites in normal and isolated FTS modes.
- [x] 5.3 Run exact repository `npm test`, static check, and `git diff --check`.
- [x] 5.4 Run OpenSpec status, strict non-interactive validation, and apply-instructions checks.
- [x] 5.5 Report exact test counts, score/ranking evidence, changed files, and remaining risks.
- [x] 5.6 Do not implement before GPT review authorizes H5-C5 source changes; do not install, restart, enable AutoRecall, run live canary, or modify persistent data.

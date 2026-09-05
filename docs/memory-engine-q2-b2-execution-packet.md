# Q2-B2 Always-Vector Execution Packet

Status: execution instructions prepared; environment preflight and execution pending.
Source inspected: b4f365647d2071e6e5cb8ea8d37ea0e1454eb70b.
Contract: docs/memory-engine-q2-semantic-binding-v1.md and lib/benchmark/q2-semantic-binding-v1.js.

## Decision and scope

Measure always-vector quality headroom at Q1 evaluation depth 3, separately for LongMemEval and LoCoMo. Semantic runners serve depth 50. Codex prepares bounded execution glue and source commits; EDi executes under Node24/ABI137; GPT adjudicates results.

Do not change retrieval serving, canonical backfill, ranking, selective vector, model, or production runtime. Use only benchmark-owned temporary Core/Engine/LanceDB/cache/output paths outside the repository and live memory paths. No deployment, AutoRecall activation, tag, or push. This offline experiment does not need a new Level C stage.

## Repository preparation

Read AGENTS.md. Verify main and the inspected HEAD before committing the existing roadmap corrections and this packet. Review the exact staged paths; preserve unrelated changes. Record the resulting full commit and clean worktree as the actual execution source. Both semantic CLI provenance requirements must be satisfied; never fabricate repository provenance.

If bounded glue is needed, reuse existing exported runners/scorers/binders. Keep one-off glue and raw outputs outside the checkout; record its hash and the repository commit. Do not introduce a product CLI or change frozen modules merely to orchestrate this run.

## Preflight before any provider request

1. Record Node executable/version and modules ABI: Node24/137. Exercise better-sqlite3 with an in-memory database. Do not rebuild dependencies under Node22.
2. Resolve actual dataset paths; hash raw bytes and validate official population. Do not infer paths from historical /tmp locations.
3. Resolve provider credential availability without printing secrets, and record credential-free base URL identity. Provider/model/dimension: SiliconFlow / Qwen/Qwen3-Embedding-4B / 2560; revision unavailable/unpinned.
4. Hash both committed fixtures from disk and pass the actual hashes to the binders.
5. Resolve case-aligned lexical evidence as below before spending provider calls.

| Authority | SHA256 |
| --- | --- |
| LongMemEval-S | d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442 |
| LoCoMo | 79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4 |
| test/fixtures/q1-current-baseline-v1.json | 1867ad5ebd4368ad967c2f491f21fc888e27df3eea122741c5a4b42430bff042 |
| test/fixtures/q2-non-vector-ablation-v1.json | ae3304c41e347370c019d06667d062dd305ef147acb8ad6d957debd42785ea1d |

## Lexical case evidence

Prefer complete attributable Q1 raw runner outputs if available. Otherwise replay the existing lexical runners with frozen settings; do not replace/refreeze the baseline fixture.

- LongMemEval: runLongMemEvalRetrievalDataset from lib/benchmark/longmemeval-retrieval-runner-v1.js, topK=3, benchmarkNowSec=1800000000.
- LoCoMo: runLocomoTimeFrozenLexicalRetrievalDataset from lib/benchmark/locomo-time-frozen-retrieval-runner-v2.js, topK=3, benchmarkNowSec=1705066861, actual datasetSha256 and genuine repositoryProvenance.
- Validate full outputs with bindQ1LongMemEvalBaseline and bindQ1LocomoBaseline from lib/benchmark/q1-current-baseline-v1.js. LoCoMo requires datasetBytes/official validation.
- Compare aggregate quality metrics, family/category quality breakdowns, and denominators with the frozen Q1 tracks (numeric tolerance 1e-12). Latency is descriptive and need not reproduce. On quality mismatch stop before provider calls; diagnose without editing the baseline.
- Build lexical rows using scoreQ1LongMemEvalCase(...).q1 and scoreQ1LocomoStrictSessionCase(..., {questionIndex}).q1.
- Explicitly validate unique source/result identity, completeness, and source order. LongMemEval uses question_id; LoCoMo Q2 mapping uses sample_id plus qa_index. Retain unknown/unscoreable rows.
- The paired-transition helper compares by ARRAY POSITION, not case ID. Validate identity before dropping IDs and passing arrays. Never zip unverified output order.
- Expect 500/1986 total rows and 419/1972 comparable scored rows respectively.

## Sentinel and semantic execution

Embed the exported Q2_PROVIDER_FINGERPRINT_SENTINEL verbatim:
"Neutral benchmark identity sentence for embedding reproducibility."

Use the same provider/model/base URL as the dataset runners. Validate 2560 finite numeric values, then use createQ2ProviderFingerprint with actual observation time and identity. The fixed ID is q2-neutral-provider-sentinel-v1. Serialization is JSON.stringify(vector.map(value => Number(value))), UTF-8, SHA256. Keep raw vector out of committed evidence and console output.

Start with new benchmark-owned cache paths so historical un-fingerprinted embeddings are not silently reused as current provider evidence. Report cache reuse within this execution.

Existing CLI entry points and verified flags:
- LongMemEval: node bin/run-longmemeval-semantic-retrieval-v1.js --input <absolute-dataset> --top-k 50 --cache-path <new-benchmark-cache> --output <absolute-result>
- LoCoMo: node bin/run-locomo-semantic-retrieval-v2.js --input <absolute-dataset> --top-k 50 --benchmark-now-sec 1705066861 --require-official --cache-path <new-benchmark-cache> --output <absolute-result>

Do not use --limit or --json for the full execution. Resolve placeholders before running. LongMemEval must record its actual runner clock; LoCoMo must bind all three clocks to 1705066861. Run the sentinel first, then LongMemEval and LoCoMo sequentially. Stop on a failed contract; do not silently retry or weaken invariants.

LongMemEval: 500 source / 419 scored / 81 skipped; vector attempts=419.
LoCoMo: 1986 QA / 1972 strict scored / 14 strict skipped; runner vector attempts=1978, because retrieval-attempt and strict-scoring denominators differ.
Both: skipped/error vector paths=0, no host-manager fallback, successful LanceDB contribution to fusion. LongMemEval vector_top_k>=50; LoCoMo vector_top_k=50.

## Binding and evidence

Call bindQ2LongMemEvalAlwaysVectorRun and bindQ2LocomoAlwaysVectorRun with the official records, completed semantic output, and:
- q1Baseline: parsed frozen fixture;
- q1BaselineFixtureSha256 and q2A2FixtureSha256: hashes computed from actual bytes;
- q1CaseScores: verified source-ordered lexical rows;
- requirePairedTransitions: true.

Verify every paired metric has comparable_case_count=419 or 1972 and improved+regressed+unchanged equals that count. Any mismatch is insufficient evidence even if the helper returns READY.

Report each dataset separately: four @3 metrics; feasible/infeasible counts and feasible full recall; cross-session coverage; first-rank distribution; family/category metrics and deltas; six scalar semantic_absolute_delta_vs_q1 values; four paired transitions with tolerance 1e-12; provider fingerprint; vector/fallback evidence; descriptive latency, provider calls, cache hits, corpus-build cost.

Label latency DESCRIPTIVE_RUNNER_TOP50 and latency_comparable_to_q1_lexical_top3=false. Do not calculate latency deltas/multipliers against Q1 top3. Historical B4/B5-S3 remain SANITY_REFERENCE_ONLY.

Keep per-case IDs, texts, raw runner results, caches, vectors, and credentials out of committed aggregate evidence. Preserve attributable local artifacts for review and report their paths/hashes without dumping contents.

## Stop and report

Missing Node/native support, paths, credentials or provider availability: ENVIRONMENT_FAILURE. Missing/misaligned evidence: EVIDENCE_FAILURE. Incorrect operator arguments: OPERATOR_FAILURE. A verified contract violation caused by product behavior: PRODUCT_FAILURE. Do not repair product source to mask environment/evidence errors.

Return source commit/cleanliness, commands and exit status, preflight summary, lexical reproduction/alignment results, sentinel fingerprint, per-dataset binding results, bounded artifact locators, and runtime mutation status. Do not claim PASS from a partial run. GPT adjudicates PASS, PASS_WITH_FINDINGS, INSUFFICIENT_EVIDENCE, or STOPPED; Q3 follows only after Q2-B2 adjudication.

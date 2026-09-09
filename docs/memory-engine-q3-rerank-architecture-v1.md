# Q3 Relevance Rerank Architecture Contract v1

Date: 2026-09-09
Status: OFFLINE HYBRID INTEGRATION PASS_WITH_FINDINGS / SOURCE CLOSED; Q3 QUALITY AND PRODUCTION DECISION OPEN

The independent interface was implemented and reviewed at 88bca20b47f6cf143f7776a194e65f3572050e97 (11/11 focused tests). Next: [Canonical rerank text contract](memory-engine-q3-rerank-text-contract-v1.md), a pure offline projector before any production integration. The implementation task below is retained as the completed contract scope.
Inspected source: df602ca0d359cf6abef9f8ce92d6afd66f23aa31
Scope: source-only interface and offline tests; no provider execution or runtime activation.

## Decision and evidence

Choose an optional, provider-independent relevance rerank boundary operating on an already eligible, bounded candidate set. Keep candidate generation, evidence-set selection, and final serving policy separate. This document proposes the interface; it does not declare Q3 closed or approve production integration.

The completed fixed-candidate experiments support this direction:
- LME Recall-all@3: 180/419 to 316/419; ACCEPTED_WITH_LIMITATIONS because pre-sentinel scores were not retained.
- LoCoMo Recall-all@3: 992/1972 to 1613/1972; PASS_WITH_FINDINGS. Multi-hop improves from 15/277 to 81/277 but remains below the saved-candidate oracle 179/277.
- LoCoMo sentinel: 14/16 fingerprints differ, 5/16 full orders differ, 0/16 top3 orders differ; maximum absolute score difference 0.009059906005859375. This is a bounded observation, not model revision pinning.
- LoCoMo request p50/p95: 892/1069 ms, excluding pacing; these are benchmark request timings, not a production latency SLA.
Primary LoCoMo evidence: /home/lionsol/.openclaw/workspace/q3-locomo-v1.2/reports/locomo-rerank-score.json and state/runner-state.json. The scorer's embedded self-hash is defective; use an external digest for finalized report bytes.

## Source boundary

Current hybridSearch sorts fused candidates, takes K, then calls projectCanonicalHybridResults. Canonical projection can drop candidates without backfill. Its pre/post-rerank debug field names do not establish that a cross-encoder is present.

The first implementation is a standalone module, not an edit to that serving sequence. It receives immutable ordered candidates and returns an ordering of the same exact IDs. It does not fetch DB records, expand sessions, write confidence, reinforce memories, select channels, or call AutoRecall.

Proposed input:
- query: nonempty string supplied by the caller;
- candidates: ordered records with unique, nonempty, exact id and text;
- deadlineMs: required positive bounded duration chosen by the caller/profile;
- adapter: injected score function accepting query, nonempty candidate texts, and an abort signal;
- adapter identity: provider/model/revision observation, with unknown revision explicit.

Candidate count is 0..50 for this first contract. Fifty is a bounded engineering limit aligned with the existing benchmark depth, not a measured production optimum. Reject oversize input rather than silently trimming. Production candidate depth and deadline value remain profile decisions; do not invent a production default from benchmark p95.

Output:
- orderedIds: full permutation of input IDs;
- status: applied, bypassed, or fallback;
- reason: bounded reason code;
- scores: finite provider scores by exact ID, or null for unscored candidates;
- elapsedMs and observed adapter identity; optional usage with missing values retained as unknown.

No new DB schema, public tool fields, configuration tree, CLI, permanent audit subsystem, or live hook is needed for this contract.

## Correctness and failure behavior

Reject invalid caller input (duplicate IDs, malformed text, invalid deadline) before calling the adapter. Do not mutate caller objects.

For valid input:
1. Empty candidate set: bypass without calling the adapter.
2. Strictly empty text is unscorable. Preserve its ID. If all texts are empty, bypass and preserve the original order.
3. Send every nonempty candidate once. Require one finite score for every submitted index, with no duplicate, missing, or out-of-range index.
4. On complete success, sort scored candidates descending; ties retain original order. Append empty-text candidates in their original order, score=null.
5. Timeout, provider error, or invalid/incomplete response discards the entire attempted rerank. Return the full original order with fallback reason and no usable rerank scores. No partial merge, fabricated scores, retry, model switch, or endpoint switch.
6. Enforce the deadline even if the adapter ignores cancellation. Abort where supported and ignore late results. Timeout does not prove the remote request was unbilled.

Provider scores must not be added to fusion scores or interpreted as calibrated probabilities. Empty-text handling depends only on the text, never gold labels.

This fallback preserves ranking availability only. It never bypasses caller visibility, archive exclusion, authorization, or final canonical validation. Any failure in those safety boundaries remains fail-closed.

## Text and disclosure boundary

The benchmark reconstruction is not a production text contract: LME uses user-only sessions; LoCoMo uses reconstructed full sessions. Large gains cannot establish equivalent quality on production chunks/cards.

For the source contract, text is caller-provided. Do not silently copy benchmark session reconstruction into production, concatenate arbitrary neighboring memories, or send raw sessions to an external provider. Production integration must choose the authorized canonical text projection and explicit input budget before real calls. Memory text is data, not instructions; scoring cannot expand disclosure authority.

## Deferred Q3 decisions

- Calibrated fusion: cheaper pre-ranking/fallback candidate, requiring measured evidence; no weight changes in this implementation.
- Selective vector: candidate-generation decision; fixed semantic pools do not prove always-vector is necessary.
- Set-aware selection: separate from pointwise relevance. Do not add MMR or session-family merging by default.
- R3 valid-topK and adaptive cutoff: remain separate serving-profile decisions. Any new profile needs its own aligned lexical comparison; historical Q1/Q2 results stay immutable.
- Production rerank adapter, candidate depth, token/text budget, deadline, and enablement: not selected here.
- AutoRecall policy and untrusted-memory injection blockers remain unchanged.

## Completed standalone implementation task

Implement only the standalone contract and injected-adapter tests; use repository naming conventions after inspection. Do not wire hybridSearch, tools, config, or runtime.

Three acceptance claims:
1. Identity and ordering are exact: stable ties, immutable input, mixed/all-empty cases, and 0/50/51 boundaries.
2. Incomplete/invalid responses and timeouts produce all-or-nothing fallback; an adapter ignoring abort cannot delay completion indefinitely or replace returned results later.
3. Tests use fake adapters only; no provider requests, DB access, or production behavior changes.

Before later Q3 source migration, close the already recorded exact primary search-ID and schemas.sql instruction defects as separate small fixes. The report self-hash is also an adjacent Level A fix, not a reason to rerun benchmarks or block this interface.

Codex reports changed files, behavior, focused test results, and source commit. GPT reviews the contract implementation before proposing production integration. The consumed provider budget remains 2523/2523; this task grants no additional calls.

## Source acceptance — 2026-09-09

| Component | Commit | Acceptance |
| --- | --- | --- |
| Independent rerank interface, including fallback usage fix | 88bca20b47f6cf143f7776a194e65f3572050e97 | PASS / SOURCE CLOSED |
| Canonical chunk text projector | 594b423d6e8e167c4964644cb085cc02a1f75750 | PASS / SOURCE CLOSED |
| Canonical rerank orchestrator | e5d55b41ee5d05b3493d4077e0912d55beaf1396 | PASS / SOURCE CLOSED |
| Explicit offline Hybrid profile | 5fb9c5f4fe625a15e808f9bf0b3a6958fec703a6 | Implemented |
| Final-output projection counters | b300b216f690d6d317bfac0fa655c374bf795368 | PASS_WITH_FINDINGS / SOURCE CLOSED |

GPT re-ran 17 Hybrid/profile/canonical/snapshot tests on Node24 after the final fix: all passed. Earlier component suites passed 23/23. Full npm test did not complete; three sampled subprocess failures were reported as spawnSync EPERM followed by empty-stdout JSON parsing errors. Comparing b300b21 with its parent excludes the counter fix, not the original integration, as the cause. Do not claim a clean full suite or that all remaining failures are unrelated.

The implemented internal runtime.offlineRerankProfile selects q3_offline_canonical_rerank_v1. Default callers retain the existing path; production runtime factories do not inject an adapter. Candidate depth is explicit and bounded by topK..50. The new profile takes a bounded fused pool, resolves and validates canonical candidates, then runs control or rerank on the same eligible pool before taking topK. There is no refill from outside that pool. Candidate exclusions are reported separately from final-output projection counts. Rerank elapsed time excludes prior canonical reads and text projection.

This implements bounded valid-candidate serving only in the explicit offline profile. It does not approve R3 for production or retroactively change Q1/Q2 baselines.

## Next aligned quality evaluation — plan, not execution authorization

The next question is whether the canonical-chunk profile retains useful rerank gains under explicit text and latency budgets. Do not create another wrapper or verification stage.

First prepare a zero-provider case manifest and compatibility report using retained benchmark material:
- Establish whether the existing benchmark DB/materialization actually represents production-like chunks or merely stores entire sessions as chunks. A source.record_type value alone cannot establish production granularity.
- Record exact candidate IDs, canonical text hashes, eligible-pool order, exclusions, document lengths and truncations. Preserve official gold outside the model input.
- Specify and verify the mapping from canonical units to official evidence IDs. Do not alter gold or merge official session families. If the material cannot support this mapping, state that limitation before proposing any dataset adaptation.
- Choose one explicit candidate depth, text budget and deadline before execution. Fifty and 8000 code points are ceilings, not automatically approved production settings. No full-test-set parameter search.

Use three aligned arms once inputs and any additional provider budget are approved:
1. Existing frozen retrieval path as a historical bridge.
2. New offline profile with executeRerank=false as the primary control.
3. The same profile and exact eligible candidate pool with executeRerank=true.

Compare arm 3 against arm 2 to assess rerank benefit; compare arm 2 against arm 1 to expose serving/projection changes. Hold query, candidate generation, clocks, gold and scorer constant. Do not describe arm 3 versus arm 1 as a pure model effect.

Report frozen four @3 metrics and paired transitions, category/family slices, feasible and cross-session evidence, exclusions/truncations, request and end-to-end timings, and fallback frequency. Include fallback cases in end-to-end quality denominators; do not select only provider successes. Provider-only statistics remain separately labeled.

Saved rerank scores may be reused only when request text, candidate set/order, model parameters and provenance match exactly. A matching memory ID alone is insufficient. New chunk texts generally require new scores. Fake-adapter tests prove wiring, not quality.

All prior 2523 provider requests are consumed. This plan permits no new provider requests, retrieval runs or live reads. Prepare the manifest from existing offline material and provide a concrete execution/budget proposal before any such run. AutoRecall=false, production topK=3, and no deployment/tag/push remain unchanged.

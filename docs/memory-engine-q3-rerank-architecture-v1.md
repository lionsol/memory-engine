# Q3 Relevance Rerank Architecture Contract v1

Date: 2026-09-12
Status: ARCHITECTURE DIRECTION ACCEPTED_WITH_LIMITATIONS; R3-C0 CONTROL RUNTIME QUALIFIED; R3-C1-A-I0 SOURCE IMPLEMENTED / VERIFIED; R3-C1-A-E0 PROVIDER EXECUTION NOT AUTHORIZED

The independent rerank interface, canonical text projector and orchestration boundary are accepted as the foundation for the qualified control runtime and a later provider integration. The completed canonical-chunk comparison is retained as offline evidence; it does not approve a production provider, provider default, or benchmark-derived quality claim.
Source acceptance and the closed R3-C0 runtime evidence are recorded below. The production runtime keeps `AutoRecall=false`, `topK=3`, and `explicitSearchRerankControl` absent; no provider execution or further runtime mutation is authorized.

## Decision and evidence

Adopt an optional, provider-independent relevance rerank boundary operating on an already eligible, bounded candidate set. Keep candidate generation, evidence-set selection, and final serving policy separate. This is an accepted architecture direction, not approval for production integration.

The completed fixed-candidate experiments support this direction:
- LME Recall-all@3: 180/419 to 316/419; ACCEPTED_WITH_LIMITATIONS because pre-sentinel scores were not retained.
- LoCoMo Recall-all@3: 992/1972 to 1613/1972; PASS_WITH_FINDINGS. Multi-hop improves from 15/277 to 81/277 but remains below the saved-candidate oracle 179/277.
- LoCoMo sentinel: 14/16 fingerprints differ, 5/16 full orders differ, 0/16 top3 orders differ; maximum absolute score difference 0.009059906005859375. This is a bounded observation, not model revision pinning.
- LoCoMo request p50/p95: 892/1069 ms, excluding pacing; these are benchmark request timings, not a production latency SLA.
Primary LoCoMo evidence: /home/lionsol/.openclaw/workspace/q3-locomo-v1.2/reports/locomo-rerank-score.json and state/runner-state.json. The scorer's embedded self-hash is defective; use an external digest for finalized report bytes.

### Canonical-chunk decision evidence — 2026-09-12

The frozen `q3_locomo_chunk_fts_only_v1` comparison is accepted with limitations as evidence for the architecture direction. On the same 1970-case FTS-only chunk candidate pools, Recall-all@3 improved from `888/1970 = 45.08%` under control to `1354/1970 = 68.73%` after rerank; 476 cases improved and 10 regressed. This supports retaining an independent relevance-rerank layer as the integration direction. It does not establish production-equivalent chunking, always-vector or selective-vector policy, or a causal comparison with session-level Q1 results.

The accepted integration foundation is the independent rerank interface, canonical `source.text` projection and orchestrator. Provider error, timeout or invalid response remains an all-or-nothing fallback to the same-profile control order; this fallback is not a successful rerank result. The experiment's `50` candidate depth and recovered `10s` deadline remain historical experiment parameters. R3-C0 subsequently qualified the control profile at live `topK=3`, depth `20`, `4000`/`48000` code-point budgets and `2500ms` adapter deadline. R3-C1-A-I0 later source-closed isolated qualification tooling for SiliconFlow `Qwen/Qwen3-Reranker-8B`; provider execution, account/rate-limit budgets and real canonical-text egress remain separately `NOT AUTHORIZED`.

## Source boundary

The disabled/default Hybrid branch still sorts fused candidates, takes K, then calls `projectCanonicalHybridResults`; canonical projection can drop candidates without backfill. The accepted R3 branch is separate and only reachable from the trusted explicit-search runner when an enabled normalized profile is injected: it takes a bounded fused pool, performs canonical validation, runs same-pool control/rerank, then takes K with no refill outside candidateDepth. Pre/post-rerank debug field names by themselves do not establish that a cross-encoder is active.

The original standalone reranker remains a pure ordering module. It receives immutable ordered candidates and returns an ordering of the same exact IDs. It does not fetch DB records, expand sessions, write confidence, reinforce memories, select channels, or call AutoRecall.

Proposed input:
- query: nonempty string supplied by the caller;
- candidates: ordered records with unique, nonempty, exact id and text;
- deadlineMs: required positive bounded duration chosen by the caller/profile;
- adapter: injected score function accepting query, nonempty candidate texts, and an abort signal;
- adapter identity: provider/model/revision observation, with unknown revision explicit.

Candidate count remains 0..50 for the standalone reranker contract. Fifty is a bounded engineering limit aligned with the historical benchmark depth, not a measured production optimum. Reject oversize input rather than silently trimming. The first production-shaped qualification profile separately fixes candidateDepth `20` and adapter deadline `2500ms`; these are qualification inputs rather than evidence-derived quality optima or runtime authorization.

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

- Real provider integration, provider choice, provider token budgets and production provider enablement: `NOT STARTED / NOT AUTHORIZED`. C0 control runtime qualification is closed; the offline `50`/`10s` values remain experiment settings only.
- Calibrated fusion: cheaper pre-ranking/fallback candidate, requiring measured evidence; no weight changes in this implementation.
- Always-vector and selective-vector: candidate-generation decisions; this FTS-only chunk comparison cannot decide either policy.
- Set-aware evidence selection: the next architecture direction; multi-hop Recall-all remains only `51/277 = 18.41%` after rerank, so pointwise rerank does not solve evidence composition.
- R3 valid-topK, adaptive `0..K`, and production canonical backfill: separate serving-profile decisions with no direct evidence in this comparison. Historical Q1/Q2 results remain immutable.
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

## Q3 architecture decision — 2026-09-12

The architecture direction is accepted with limitations:

- retain the independent relevance-rerank interface, canonical text projector and orchestrator as the integration foundation;
- operate rerank only after candidate eligibility and canonical validation, on an explicit bounded candidate set;
- on provider error, timeout, invalid response or persistence failure, return the full same-profile control order with all rerank scores null; this is a fallback diagnosis, not a successful rerank;
- keep candidate generation, set-aware evidence selection, canonical valid-topK serving and adaptive cutoff as separate decisions.

The fixed-candidate LoCoMo result is evidence for this layer, not a production-quality or production-latency claim. Recall-all@3 improved from `45.08%` to `68.73%` on the frozen FTS-only chunk profile, with 476 improved and 10 regressed cases. The comparison cannot decide always-vector or selective-vector retrieval, production canonical backfill, or whether `50` candidates and `10` seconds are suitable production values.

At the original architecture-decision point, production default enablement, adapter/provider, candidate depth, text budget, deadline, set-aware evidence selection, valid-topK/backfill semantics and adaptive `0..K` serving were all undecided. The subsequent 2026-09-12 decisions recorded below source-close explicit-search bounded valid-pool serving and freeze the first qualification profile (`topK=3`, depth `20`, `4000`/`48000` code-point budgets, `2500ms` deadline). Provider/model/endpoint, provider token budgets, real canonical-text egress, runtime enablement, set-aware selection and adaptive `0..K` remain undecided/unauthorized. No additional benchmark or provider run is implied. The accepted offline evidence remains in [the canonical chunk acceptance report](memory-engine-q3-locomo-chunk-rerank-acceptance-v1.md).

The completed runner's stale `recovery.status` is recorded as an ordinary adjacent source defect. The reconciled experiment is complete; this finding does not block the architecture decision and does not authorize editing historical experiment state.

## Production wiring decision and source closure — 2026-09-12

Status: R3 EXPLICIT-SEARCH SOURCE `PASS_WITH_FINDINGS / CLOSED` at `298627c13c14b69c5997db7942c8ed01c87154ac`; `R3-C0-O1 = CLOSED`; `R3-C0 = CONTROL RUNTIME QUALIFIED`; `R3-C1-A-I0 = PASS / SOURCE IMPLEMENTED / VERIFIED` at `1324c8c05e62639ae3418b64b6e4e04c14c51adb`; real provider execution remains `NOT AUTHORIZED`.
The completed benchmark provider budget remains 4494/4494. No additional provider request is authorized.

### Entry and trusted enablement

The accepted source integration surface is explicit memory search in `lib/tools/memory-engine-actions.js`, through its trusted runtime factory into `hybridSearch`. Dedicated `memory_engine_search` and legacy `memory_engine action=search` share the explicit runner. AutoRecall and unrelated internal callers remain outside this integration. Enablement, adapter, endpoint and budget selection are not model-controlled tool arguments.

The runtime factory supplies an optional, validated rerank policy only after the explicit-search call-site policy permits it. Absent policy or `enabled=false` preserves the existing production path, with no R3 candidate expansion, canonical read, rerank projection, adapter call or R3 debug namespace. Default enablement remains false. Invalid enabled configuration fails before Hybrid/LanceDB work and before text disclosure.

The source implementation reuses the canonical projector, reranker and orchestrator while preserving the orchestrator invariant that rerank text is derived internally from canonical `source.text`. The offline profile is not reused as production wiring.

### Candidate and serving boundary

The accepted R3 serving profile takes the bounded fused pool, performs existing eligibility plus exact canonical identity/source/lifecycle checks, runs control or rerank on the same valid pool, then takes K. Neither arm fetches replacements beyond candidateDepth. If canonical exclusions leave fewer than K valid candidates, fewer than K are served.

This is a distinct retrieval/serving profile rather than a mechanically equivalent wiring edit. The source behavior is accepted and default-off; the disabled path remains fused slice(K) followed by canonical projection. Historical Q1/Q2 controls are not redefined by the new R3 control profile.

Keep complete IDs, source authority, archive checks and public disclosure projection. No new public tool fields or raw provider scores; provider scores never enter fusion arithmetic. Remote scoring of live text needs separate Owner authorization for the provider and data scope: benchmark authorization does not cover live memories.

### Resource policy

Enabled policy still requires explicit candidateDepth, per-candidate/total code-point budgets, rerank deadline and adapter identity; there are no hidden enabled defaults. Existing module limits (candidateDepth at most 50, per-candidate at most 8000 and total at most 400000 code points) remain engineering ceilings.

### Production-shaped profile v1 — design frozen

For the current product baseline `topK=3`, freeze the first qualification profile as:

- `candidateDepth=20`;
- `maxCodePointsPerCandidate=4000`;
- `maxTotalCodePoints=48000`;
- `deadlineMs=2500`;
- no refill outside candidateDepth;
- same-pool atomic control fallback.

These values are qualification inputs, not runtime authorization and not evidence of quality optimality. Existing candidate-generation defaults (`ftsTopK=20`, `vectorTopK=30`) prove that a depth-20 fused pool can be materially populated without changing candidate generation. The accepted offline experiment used depth 50 and therefore cannot prove that 20 is quality-optimal; no new benchmark is authorized to optimize this value before qualification.

The offline rerank run's successful-request latency (`p95≈1245ms`) and depth-50 input volume are planning evidence only. `deadlineMs=2500` is a bounded first qualification envelope, not an end-to-end SLA. Canonical-read/projection time, adapter elapsed time and total profile time remain separate diagnostics. Code-point budgets are not token budgets; any later real provider adapter must impose provider/model-specific query/document token hard limits and must not rely on hidden server truncation.

### Failure behavior and observability

For valid projected input, timeout, provider exception and invalid scores return same-profile control atomically, null scores, known usage and a bounded reason. Cancel the underlying request and isolate late settlement; no automatic retry or endpoint/model switch.

Canonical/authorization failures exclude candidates before either arm and cannot be restored by fallback. Invalid caller input or projection-budget rejection must occur before external disclosure and stay explicit. Optional telemetry persistence must not be a production prerequisite for serving; benchmark evidence-persistence stop rules do not define live request behavior.

Internal diagnostics use existing debug/status surfaces: applied/bypassed/fallback, pool counts, reason, truncation counts, adapter identity, usage and separate timings. No raw memory text or credentials in logs. Disabling rerank restores the existing production branch; no data migration is involved.

### R3-C0 control runtime qualification — CLOSED

`R3-C0-O1 = CLOSED` and `R3-C0 = CONTROL RUNTIME QUALIFIED`. The final production runtime is `7f2e80d3f4887fd4b3db41afc5d0e8b60b96c16631674589d38b4c6a843b6272`, from source `5f263b3d5a4aab7480b7d7e55c917b11d786842e`, candidate artifact `0a6edaf4688eebeaabccd9dcee888db6889711eb758befa9710d82d00eb98fc9`, with native SHA-256 `be4109c5b07514ade1a2e1452cbed9fca25cbb8d025b76fa2a81e21a91286a05`.

The installed-artifact result was `SPLIT_ONLY`, `accepted=true`, policy `allow_internal_hardlink_split_v1`, stop reason `accepted_controlled_internal_hardlink_split_v1`; candidate/installed semantic identity was `e556b82c2d67487b8c4166000603a43de610694cf3d169c6205495b2739854ae`, with internal hardlink groups normalized `3→0` and no external references or validation errors. Production remains `AutoRecall=false`, `topK=3`, and `explicitSearchRerankControl` absent with `memory-engine enabled=true`; Gateway is healthy with `NRestarts=0`, and the final disabled production stability window passed for 60 seconds.

The closed runtime evidence recorded Engine identity `2d642bdb90a3b374e4a899639534bf83aaee5f11493d49cf6361649de6d685fb`, `memory_events.max(id)=369`, `row_count=321`, and no new events during final deployment. C0 observations `366/367/368/369` remain preserved. Lance identity `30ecfcbeb8460fd409f84c8a9ecdc3ca9effd7f705f17fe34a2d17ec59033e94` was unchanged. Normalized config equality was true; the raw config SHA changed only from OpenClaw's auto-managed `meta.lastTouchedAt`, not semantic config drift. `provider_calls=0`, `benchmark_runs=0`, and `C1=0`.

The prior qualification false failures are archived as harness/operator failures, not product, installer, or R3 architecture defects: incorrect topology/v1 equality, a nonexistent comparator nested field, `.result` versus authoritative `.output.results`, full Lance manifest byte comparison including `checked_at`, and raw config SHA equality despite an OpenClaw auto-stamp.

### R3-C1-A-I0 source closure and next decision

`R3-C1-A-I0 = PASS / SOURCE IMPLEMENTED / VERIFIED` at `1324c8c05e62639ae3418b64b6e4e04c14c51adb`. The source-only tooling binds deterministic `P256/D64/S8` qualification populations, the frozen FTS-only candidate-generation limitation, canonical depth-20 `4000/48000` text projection, a fail-closed SiliconFlow `Qwen/Qwen3-Reranker-8B` adapter, conservative token/request/cost accounting, packet-bound pacing and bounded evidence/scoring. Post-commit C1/Q3 tests passed `56/56`; Node24 explicit-search adjacent native tests passed `6/6`. Provider requests and external egress remained zero.

The next decision is `R3-C1-A-E0 provider execution authorization = NOT STARTED / NOT AUTHORIZED`. E0 requires a separate Owner authorization binding the exact clean HEAD and frozen manifest, provider/model/endpoint, explicit query/canonical-text egress scope, account-confirmed rate limits and pacing, credential reference, `MAX_PROVIDER_REQUESTS=328`, `MAX_INPUT_TOKENS=6,000,000`, a finite cost cap and `execution_count=1`. I0 does not authorize provider execution, C1-B, AutoRecall, production rerank enablement, benchmark expansion or further runtime mutation.

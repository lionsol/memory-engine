# memory-engine Stabilization Plan

> **Status: Current product roadmap**
>
> `docs/current-state.md` is the sole owner of the exact current product state and next authorized decision. This roadmap describes the accepted product sequence and branching logic only; it does not authorize execution or describe a particular deployment.

## Current product sequence

### NOW

With L2 Database Boundary Closure complete, **Phase 2.5-A is `PASS / CLOSED`**, **Phase 2.5-B is `PASS / CLOSED`**, and **Phase 2.5-C is `PASS_WITH_FINDINGS / CLOSED`** under `canonical-memory-architecture`. Phase 2.5-D source, deployment, and runtime qualification are **`PASS / QUALIFIED`**. Phase 2.5-D.1 source and deployment are **`PASS / CLOSED`**, and its live writer qualification is **`PASS / QUALIFIED`**. Overall Phase 2.5 Canonical Memory Architecture is **`PASS / CLOSED`**.

The memory-engine **`1.0.0` L2 stable runtime baseline is now `PASS / RUNTIME QUALIFIED / CLOSED`** on the accepted OpenClaw `2026.7.1-2` patched host runtime (`ded67f3cd7fde6ae19798a402c178e2d76fc2c71`). The deployed plugin source is `d201c8e5246773ba5e26dc8a959fa93beec9661d`; Gateway is `READY`; direct Gateway/operator explicit get remains denied, real WebChat Owner explicit get reaches the ordinary executor, AutoRecall/card-first remain disabled, and active disclosure attestations remain `0`. The post-deployment cleanup moved historical 0.8.22 backup directories out of plugin discovery and removed the duplicate-plugin warning without config or Engine DB drift. This runtime closeout does not expand the 1.0 product boundary or authorize OpenSpec 4.4.

**memory-engine Benchmark v1 B3 is `PASS_WITH_FINDINGS / OFFLINE BASELINE RECORDED`**. The official cleaned LongMemEval-S lexical profile (`production_hybrid_lexical_session_v1`, `top_k=50`, dataset SHA-256 `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`) scores 419 cases after upstream-compatible exclusions. Overall recall-any is `0.5107/0.7876/0.9045/0.9952` at `@1/@5/@10/@50`; recall-all is `0.1289/0.4821/0.6372/0.9761`; NDCG-any@10 is `0.6256`; mean search latency is `9.49 ms`. First-loss fixes now accept official empty-string turns, preserve duplicate session-id corpus occurrences, and exclude non-abstention cases with no user-side target exactly as the upstream retrieval aggregate does. This is lexical/fusion evidence only; the next benchmark boundary is a separately named real semantic/vector profile. LoCoMo and AML remain later integrations, and benchmark work does not authorize live runtime/config/DB mutation.

Intent-aware Recall v2-A is **`SOURCE IMPLEMENTED / VERIFIED`**. Its deterministic task/recall taxonomy is observational only: frozen 12-row replay now enforces both labels, and decision trace/debug metadata expose bounded intent values. Existing recall decisions, focused queries, retrieval policy, ranking, Card/Get behavior, and AutoRecall default-off state remain unchanged. Policy authority remains a separate decision.

Intent-aware Recall v2-B1 remains an **offline-only evaluation**. Its initial 36-row result was V1 `18/5/13/0`, oracle `18/18/0/0`, and runtime candidate `8/18/0/10` for TP/TN/FP/FN, with 4 task and 12 recall mismatches.

Intent-aware Recall v2-B2 is **`SOURCE IMPLEMENTED / KNOWN-GAP REGRESSION CLOSED`**. Generalized deterministic classifier signals now produce zero task/recall mismatch and runtime candidate `18/18/0/0` on the frozen B1 regression set; V1 remains unchanged at `18/5/13/0`. The candidate policy is **not runtime authorized**.

Intent-aware Recall v2-B3's first independent run is a **historical `PASS_WITH_FINDINGS / HOLDOUT NOT READY`** record: the valid 48-row, 24/24 Planner-frozen holdout produced oracle `24/24/0/0` and runtime `7/19/5/17`, with precision `0.5833`, recall `0.2917`, task mismatches `14`, and recall mismatches `25`. B4 does not rewrite that first-run result.

Intent-aware Recall v2-B4 is **`SOURCE IMPLEMENTED / STRUCTURED EVIDENCE REGRESSION CLOSED`**. The classifier now uses pure request-scope and structured history evidence with quoted-content masking and suppression precedence. The frozen v2-A seed remains `12/12`; B1 remains V1 `18/5/13/0` and runtime candidate `18/18/0/0`; B3 current regression is V1 `24/0/24/0` and runtime candidate `24/24/0/0`, with task/recall mismatch `0/0`. B3 is now explicitly **`REGRESSION ONLY / NOT INDEPENDENT READINESS EVIDENCE`** with evidence role `known_regression_after_v2b4`; these scores do not qualify generalization or authorize the candidate policy.

Retrieval-first Selective Disclosure Phase D.2-B is **`FAILED / PRODUCT ARCHITECTURE GAP`**. The frozen v2 candidate-level evaluation produced `41` selected cards and `7` withheld candidates, with `23` unsafe disclosures, `0` unauthorized full-content surfaces, and answer-bearing disclosure recall `0.75`. This is an offline product finding, not a fixture or runtime failure; no selector, admissibility, evaluator, fixture, or runtime source was changed.

The **Disclosure Capability Contract v1.1** is **`PASS / CONTRACT CLOSED`**. It separates retrieval availability, internal context, bounded card disclosure, and reserved raw disclosure; `safe_to_disclose` is owned by capability calculation and is required for `CARD_DISCLOSABLE`. The contract does not itself authorize production integration or runtime adoption.

The **Disclosure Capability Shadow Evaluation v1.1** is **`PASS / OFFLINE EVALUATION COMPLETE`**. The pure offline evaluator is implemented at commit `8db96038cb44818df2674b5f3b87a99adab93728` and preserves the existing production selector. On the frozen 48-row v2 fixture (`d372ebac9bf4d80aaac85dfb0d43eacec792291871b744b7812009ac06d071bd`), D.2-C.11 reduced unsafe card disclosure from `23` to `0`, while answer-bearing disclosure recall remained `0.75`; selected cards changed `41 -> 18` and irrelevant disclosures `23 -> 0`. This is offline architecture evidence only: no production selector/admissibility change, runtime integration, deployment, AutoRecall enablement, config mutation, or data mutation occurred.

**Phase D.3 Memory Projection Architecture** has reached its 1.0 production closeout on the DIRECT_CARD branch; D.3-D.4 / OpenSpec 4.3 is `PASS / RUNTIME QUALIFIED / CLOSED`, while OpenSpec 4.4 remains unchecked and `REDACTED_CARD` / `INTERNAL_AGENT_CONTEXT` remain non-production research directions. D.3-A closed the architecture contract, D.3-B is `SOURCE IMPLEMENTED / VERIFIED`, D.3-C.1 is **`HOLDOUT CONTRACT FROZEN`**, D.3-C.2 is **`SOURCE IMPLEMENTED`**, D.3-C.3 first-run evidence is **`ACCEPTED BY PLANNER FOR ARCHITECTURE INTERPRETATION`**, D.3-C.4 is **`PROJECTION STRATEGY TAXONOMY DEFINED`**, D.3-C.5 is **`REDACTED_CARD OFFLINE PROTOTYPE IMPLEMENTED / NOT INDEPENDENTLY EVALUATED`**, D.3-C.6 is **`INDEPENDENT REDACTED_CARD HOLDOUT FROZEN / NOT YET EVALUATED`**, D.3-C.7 is **`PURE INDEPENDENT REDACTED_CARD EVALUATOR IMPLEMENTED`**, D.3-C.8 is **`PASS / FIRST-RUN EVIDENCE ACCEPTED`**, D.3-C.9 is **`REDACTION PLAN AUTHORITY BOUNDARY DEFINED`**, D.3-C.10 is **`STRUCTURED REDACTION EVIDENCE CONTRACT IMPLEMENTED / OFFLINE ONLY / NOT PRODUCTION AUTHORITY`**, D.3-C.11 is **`REDACTION EVIDENCE RESOLUTION SEMANTICS DEFINED`**, D.3-C.12 is **`INTERNAL_AGENT_CONTEXT REPRESENTATION BOUNDARY DEFINED`**, D.3-C.13 is **`INTERNAL_AGENT_CONTEXT PROJECTION CONTRACT PROTOTYPE IMPLEMENTED / OFFLINE ONLY / NOT CAPABILITY AUTHORIZED`**, D.3-C.14 is **`INDEPENDENT INTERNAL_AGENT_CONTEXT HOLDOUT FROZEN`**, D.3-C.15 is **`PURE INDEPENDENT INTERNAL_AGENT_CONTEXT EVALUATOR IMPLEMENTED`**, and D.3-C.16 is now **`PASS / FIRST-RUN EVIDENCE ACCEPTED`**. D.3-C product interpretation is **`ACCEPTED`** and D.3-D entry is **`APPROVED FOR DIRECT_CARD SOURCE MIGRATION ONLY`**. D.3-D.1 design was **`PASS_WITH_FINDINGS`**; at that historical decision point, direct-card source migration was **`HOLD`** with historical blocker **`PRODUCTION_SAFE_TO_DISCLOSE_AUTHORITY_MISSING`**. D.3-D.2 authority decision was **`PASS / DECISION CLOSED`**; its historical decision-point blocker was **`PRODUCTION_DISCLOSURE_ATTESTATION_PROVIDER_NOT_IMPLEMENTED`**. D.3-D.3 source implementation is **`IMPLEMENTED / REPOSITORY-TESTED`** with no AutoRecall wiring or runtime deployment; At that historical pre-H2-E snapshot, D.3-D.4 was **`AUTHORIZED / PRE-IMPLEMENTATION BLOCKED`** and **`BLOCKED / NOT IMPLEMENTED`** for source migration because the trusted same-run `OWNER_SELF` audience proof was unavailable at the prompt-injection boundary. Blocker: **`PRODUCTION_OWNER_SELF_AUDIENCE_AUTHORITY_UNAVAILABLE_AT_PROMPT_INJECTION_BOUNDARY`**. The full matrix and D.3-D.1 boundary record are in `docs/memory-projection-product-interpretation-v1.md` and `docs/direct-card-production-boundary-migration-design-v1.md`; no C.17 was created, and no production or runtime mutation is authorized.

The preceding D.3-D paragraph is a historical pre-H2-E status snapshot. The
current consumer status is the H2-E `PASS / SOURCE IMPLEMENTED /
REPOSITORY-TESTED` record below, followed by the separately authorized runtime
qualification closeout.

The current D.3-D.4 / OpenSpec 4.3 roadmap state is **`PASS / RUNTIME
QUALIFIED / CLOSED`**, recorded in `docs/direct-card-runtime-qualification-v1.md`.
The DIRECT_CARD qualification baseline remains conservative: AutoRecall and card-first runtime are disabled and active attestations were `0` at the 4.3 closeout. The original qualified H2 deployed source was `755ff5d396102c5a93baacf2d3bf6187a4fea713`; the current active OpenClaw build is the later authority-domain corrective `ba0edf98d1617b92296e7b834ee7a5a82cc2a18e`, which preserves the closed DIRECT_CARD contract while separating Gateway/core Owner semantics from plugin conversational Owner authority. OpenSpec 4.4 remains unchecked and raw disclosure remains out of scope.

The D.3-D.2 `PRODUCTION_DISCLOSURE_ATTESTATION_PROVIDER_NOT_IMPLEMENTED`
wording above records the historical blocker at that decision point. D.3-D.3
subsequently implemented the repository source provider and Owner boundary.
The statement that the provider was not wired into production AutoRecall and
that source migration remained `HOLD` is a historical pre-H2-E status snapshot.
H2-E later supplied the consumer source path, and the 2026-08-24 runtime
qualification superseded that source-stage state: D.3-D.4 / OpenSpec 4.3 is
now **`PASS / RUNTIME QUALIFIED / CLOSED`**. The D.3-D.4 pre-implementation
review remains a historical record and is not pending.

The D.3-D.3 status includes same-stage corrective closure of the obsolete
two-argument command registration and the placeholder Owner preview. The
corrected preview is Canonical-source-derived and binds the independent
`owner_attestable_canonical_card_v1` adapter.

D.3-D.4-H1 **`PASS_WITH_FINDINGS / CONTRACT DESIGN FROZEN`** records the
selected event-local, same-run, host-authenticated `before_prompt_build`
`senderIsOwner?: boolean` contract. The installed OpenClaw `2026.6.9` package
was inspected for design evidence, but no authoritative upstream checkout was
available locally; finding: **`OPENCLAW_AUTHORITATIVE_SOURCE_CHECKOUT_NOT_PRESENT_LOCALLY`**.
At the H1 design-freeze point, no OpenClaw or memory-engine source
implementation was authorized; H2 was **`CANDIDATE / NOT AUTHORIZED`** and
D.3-D.4 was blocked on the audience boundary. Later H2, H2-E, and the
2026-08-24 runtime qualification superseded that design-freeze state; the
current D.3-D.4 / OpenSpec 4.3 state is **`PASS / RUNTIME QUALIFIED /
CLOSED`**.

The later authorized D.3-D.4-H2-E consumer stage is **`PASS / SOURCE
IMPLEMENTED / REPOSITORY-TESTED`**. It consumes the verified host event-local
`senderIsOwner?: boolean` contract from OpenClaw H2 source commit
`2e67ab06b6f7f1cf7655d0a8d508fc2a2ad78176`, with deployed correction
`755ff5d396102c5a93baacf2d3bf6187a4fea713`, migrates the enabled DIRECT_CARD
capability/selector/card path, and derives telemetry from selected cards only.
The H1 source-checkout finding is retained as historical; the authoritative
source correction is that `v2026.6.9` contains the CLI prompt-build path and H2
covers it. Runtime qualification is now separately closed by the record cited
above.

The former non-blocking explicit-tool follow-up is now closed: `EXPLICIT_MEMORY_TOOL_DISCLOSURE_BOUNDARY_NOT_UNIFIED = CLOSED / RUNTIME QUALIFIED / PASS` under active OpenClaw `ba0edf98d1617b92296e7b834ee7a5a82cc2a18e` and memory-engine `cd80a25f089a7eb7b5e0d89c476fb4dc86b0e4cb`. `memory_engine_search` is bounded untrusted retrieval; `memory_engine_get` is Owner-only explicit full-content retrieval; and Gateway/operator Owner semantics are separated from conversational plugin Owner authority. Evidence: `docs/explicit-memory-tool-runtime-qualification-v1.md`.

Other retained follow-ups outside 4.3 include the already closed external `null` confidence coercion finding (`EXTERNAL_NULL_CONFIDENCE_COERCED_TO_ZERO`) and the resolved EDi agent-ID baseline correction from `edi` to `main` (`AUTO_RECALL_AGENT_ID_DEFAULT_MISMATCH`). None creates a new stage or authorizes 4.4.

### NEXT

The D.3-D.4 source-migration clauses in the historical sequence below describe the pre-H2-E decision point. The current DIRECT_CARD source status is H2-E `PASS / SOURCE IMPLEMENTED / REPOSITORY-TESTED`, and its separate runtime qualification remains `PASS / RUNTIME QUALIFIED / CLOSED`. The explicit memory-tool authority follow-up is also `CLOSED / RUNTIME QUALIFIED / PASS`; no additional explicit-tool canary or source stage remains. No 4.4 work is authorized by either closeout.

The next compact D.3-D sequence paragraph retains the historical source-stage
statuses for auditability; its pre-runtime `HOLD` / unchecked wording is not
the current roadmap state.

Phase 2.5 Canonical Memory Architecture is closed. No further D/D.1 deployment or qualification work remains. Intent-aware Recall v2-B and the successor Selective Recall Gate deterministic-authority experiment are closed: the full semantic route and skip-only C1 route are rejected, and v2-B6/C2-C repair are cancelled. Retrieval-first Selective Disclosure D.2-C completed its capability contract and offline v1.1 shadow evaluation.

#### Benchmark v1 external-quality track

Benchmark v1 is a persistent **evaluation track**, not a new product phase and not a runtime/deployment authority. It provides independent version-comparable evidence for later retrieval, Recall Hint, LTR, AutoRecall, and multi-agent changes while preserving internal frozen fixtures as regression evidence only.

Accepted sequence:

1. **B1 — Dataset/metric contract: `PASS / CLOSED`**. LongMemEval schema normalization, neutral Add/Search envelopes, evaluator-only gold labels, and LongMemEval-compatible session metrics are established.
2. **B2 — Isolated production-retrieval adapter: `PASS / CLOSED`**. Benchmark-owned temporary Core/Engine/FTS state reuses production `hybridSearch()` without touching active OpenClaw/memory-engine state.
3. **B3 — LongMemEval-S lexical baseline: `PASS_WITH_FINDINGS / BASELINE FROZEN`**. `production_hybrid_lexical_session_v1` on cleaned LongMemEval-S is the immutable comparison point for later retrieval profiles. Do not tune lexical heuristics against this dataset before the semantic/vector comparison.
4. **B4 — Real semantic/vector profile: `NEXT / NOT STARTED`**. Add a separately named profile using memory-engine's real embedding/vector path while holding dataset, session granularity, scoring, lexical baseline, and reporting contract fixed. Primary comparison targets are `Recall-any@5`, `Recall-all@5`, `Recall-all@10`, `NDCG-any@10`, per-family deltas, and retrieval latency. A B4 regression must not be hidden by replacing B3 results.
5. **B5 — Cross-dataset conversational generalization: `LATER`**. Add LoCoMo only after B4 is stable; use it to test longer conversational/persona/event memory rather than retune LongMemEval-specific rules.
6. **B6 — External controlled comparison: `LATER`**. Add Agent Memory Leaderboard Add/Search compatibility for cross-system comparison under AML's own held-out evaluator.
7. **B7 — Answer-quality layer: `LATER / SEPARATE CONTRACT`**. Only after retrieval profiles are stable, introduce a fixed answering-model/evaluator contract so QA quality is not conflated with retrieval quality. LongMemEval-M scale runs may be added here or after B4 as capacity/performance evidence, but they do not replace S as the frozen comparison baseline.

Benchmark evidence is diagnostic, not self-authorizing. A poor family score may justify a bounded product investigation, but fixture/benchmark tuning must not silently create production heuristics. Prefer cross-profile and cross-dataset gains before promoting retrieval changes. D.3-A and D.3-B are closed at architecture/source level; D.3-C.1 is **`HOLDOUT CONTRACT FROZEN`**, D.3-C.2 is **`SOURCE IMPLEMENTED`**, D.3-C.3 evidence is **`ACCEPTED BY PLANNER FOR ARCHITECTURE INTERPRETATION`**, D.3-C.4 is **`PROJECTION STRATEGY TAXONOMY DEFINED`**, D.3-C.5 is **`REDACTED_CARD OFFLINE PROTOTYPE IMPLEMENTED / NOT INDEPENDENTLY EVALUATED`**, D.3-C.6 is **`INDEPENDENT REDACTED_CARD HOLDOUT FROZEN / NOT YET EVALUATED`**, D.3-C.7 is **`PURE INDEPENDENT REDACTED_CARD EVALUATOR IMPLEMENTED`**, D.3-C.8 is **`PASS / FIRST-RUN EVIDENCE ACCEPTED`**, D.3-C.9 is **`REDACTION PLAN AUTHORITY BOUNDARY DEFINED`**, D.3-C.10 is **`STRUCTURED REDACTION EVIDENCE CONTRACT IMPLEMENTED / OFFLINE ONLY / NOT PRODUCTION AUTHORITY`**, D.3-C.11 is **`REDACTION EVIDENCE RESOLUTION SEMANTICS DEFINED`**, D.3-C.12 is **`INTERNAL_AGENT_CONTEXT REPRESENTATION BOUNDARY DEFINED`**, D.3-C.13 is **`INTERNAL_AGENT_CONTEXT PROJECTION CONTRACT PROTOTYPE IMPLEMENTED / OFFLINE ONLY / NOT CAPABILITY AUTHORIZED`**, D.3-C.14 is **`INDEPENDENT INTERNAL_AGENT_CONTEXT HOLDOUT FROZEN`**, D.3-C.15 is **`PURE INDEPENDENT INTERNAL_AGENT_CONTEXT EVALUATOR IMPLEMENTED`**, and D.3-C.16 is now **`PASS / FIRST-RUN EVIDENCE ACCEPTED`**. D.3-C product interpretation is **`ACCEPTED`** and D.3-D entry is **`APPROVED FOR DIRECT_CARD SOURCE MIGRATION ONLY`**. D.3-D.1 design was **`PASS_WITH_FINDINGS`** with historical blocker **`PRODUCTION_SAFE_TO_DISCLOSE_AUTHORITY_MISSING`**. D.3-D.2 authority decision was **`PASS / DECISION CLOSED`** with historical blocker **`PRODUCTION_DISCLOSURE_ATTESTATION_PROVIDER_NOT_IMPLEMENTED`**; D.3-D.3 subsequently provided the repository source implementation and Owner management boundary, but it is not wired into production AutoRecall. Current direct-card source migration remains **`HOLD`** under the D.3-D.4 audience-boundary blocker, and the D.3-D.4 pre-implementation review is complete, not pending. The C.16 evidence, product decision, and D.3-D.1 design are in `reports/internal-agent-context-holdout-v1-first-run-20260823.md`, `docs/memory-projection-product-interpretation-v1.md`, and `docs/direct-card-production-boundary-migration-design-v1.md`; no C.17 was created. The D.2, D.3-C.1, C.6, and C.14 holdouts remain immutable. `ADD_SYNC_BACKFILL_SCOPE_FINDING` remains a non-blocking operational/lifecycle finding outside D.1 scope. D.3-D.3 source implementation is **`IMPLEMENTED / REPOSITORY-TESTED`** using temporary/in-memory test databases only; no runtime deployment or real attestation state was created. At that historical source-stage snapshot, D.3-D.4 was **`AUTHORIZED / PRE-IMPLEMENTATION BLOCKED`** and **`BLOCKED / NOT IMPLEMENTED`** for source migration because `PRODUCTION_OWNER_SELF_AUDIENCE_AUTHORITY_UNAVAILABLE_AT_PROMPT_INJECTION_BOUNDARY`; no D.3 runtime authority had yet been granted.

### CLOSED

- The persistent-activation qualification line is closed. The separately authorized Session-Flush Reconciliation Persistent Rollout Successor recorded `PASS` on 2026-08-17, accepted the immutable `ac0e5f0` reconciliation candidate for persistent use, and explicitly requires no R5 or additional persistent-activation qualification. AutoRecall remains disabled by default and broad rollout remains a separate later decision.
- **L2 Database Boundary Closure** recorded `deployed runtime qualification PASS / L2 COMPLETE` at active runtime source parity `057f43e`. Gateway was `READY`; `AutoRecall=false`; Hybrid runtime used `KG_ACCESS_MODE=isolated` and `RECENT_ACCESS_MODE=isolated` with production legacy fallback `0`; the current Nightly dry-run isolated topology passed; and no unexpected memory/confidence mutation was observed.
- **Conflict Ownership Closure** is `SOURCE CLOSED / PASS`: Session Checkpoint exclusively owns `category='preference'` conflict flags through `resolvePreferenceConflicts()` / `preference_latest_wins`, while generic lifecycle detection excludes preference and preserves non-preference conflict behavior. No schema change was made. Nightly Maintenance apply rollout remains a separate, unauthorized decision.
- **Intent-aware / Selective Recall deterministic authority experiment** is `REJECTED / CLOSED / NOT RUNTIME AUTHORIZED`. The first fresh C2 holdout produced V1 `23/0/24/1` and selective `22/5/19/2`; hard safety failed (`unsafe SAFE_SKIP=1`, introduced FN `1`, SAFE_SKIP precision `0.8333`) while utility passed (`5` FP reduced, rate `0.2083`). C2-C repair is `CANCELLED / DO NOT START`; taxonomy, evidence, evaluators, and corpora remain retained experimental artifacts.

### LATER

After the canonical semantic contract is stable, advance Intelligent Recall in this order:

1. **D.3-C.16 INTERNAL_AGENT_CONTEXT Holdout First Run** — `PASS / FIRST-RUN EVIDENCE ACCEPTED`; the frozen C.14 fixture was read exactly once under the separate execution authorization, with no retry or second execution.
2. **D.3-C product interpretation** — `ACCEPTED`; the evidence supports `INTERNAL_AGENT_CONTEXT` representation only when caller-supplied ranges are already correct and does not prove automatic range selection or capability.
3. **D.3-D entry** — `APPROVED FOR DIRECT_CARD SOURCE MIGRATION ONLY` as the historical product-entry decision; the separately authorized H2-E source migration and subsequent runtime qualification are recorded below, with current status `PASS / RUNTIME QUALIFIED / CLOSED`.
4. **D.3-D.1 DIRECT_CARD Production Boundary Migration Design** — `PASS_WITH_FINDINGS`; at that historical decision point, direct-card source migration was `HOLD` with historical blocker `PRODUCTION_SAFE_TO_DISCLOSE_AUTHORITY_MISSING`. The design is docs/OpenSpec-only and does not authorize source work.
5. **D.3-D.2 DIRECT_CARD Safe-to-Disclose Authority Decision** — `PASS / DECISION CLOSED`; v1 positive authority is `OWNER_EXPLICIT_ATTESTATION` bound to surface `DISCLOSURE_CARD` and actual artifact kind `legacy_memory_card_v1`. At that historical decision point the provider was not implemented, with historical blocker `PRODUCTION_DISCLOSURE_ATTESTATION_PROVIDER_NOT_IMPLEMENTED`; D.3-D.3 subsequently implemented the repository source boundary. The source-stage `HOLD` under the D.3-D.4 audience-boundary blocker is historical; D.3-D.4 pre-implementation review is complete, and the current runtime qualification is closed.
6. **D.3-D.3 DIRECT_CARD Owner-Attested Authority Source Implementation** — `IMPLEMENTED / REPOSITORY-TESTED`; the same-stage corrective patch closes the command-object registration and meaningful-preview findings. The Engine-owned store, exact validator/provider, Canonical-source-derived Owner projection, and host-authenticated management command are implemented, but no AutoRecall wiring or runtime deployment occurred.
7. **D.3-D.4 DIRECT_CARD Production Disclosure Boundary Migration** — the historical pre-H2-E review was `AUTHORIZED / PRE-IMPLEMENTATION BLOCKED` under `PRODUCTION_OWNER_SELF_AUDIENCE_AUTHORITY_UNAVAILABLE_AT_PROMPT_INJECTION_BOUNDARY`; H2-E is the separately authorized source consumer stage and does not authorize runtime activation or host remediation.
7.1. **D.3-D.4-H1 OpenClaw Pre-Prompt Owner Audience Contract Design** — `PASS_WITH_FINDINGS / CONTRACT DESIGN FROZEN`; at the H1 design-freeze point the selected event-local contract was design-only, finding `OPENCLAW_AUTHORITATIVE_SOURCE_CHECKOUT_NOT_PRESENT_LOCALLY`, and H2 was `CANDIDATE / NOT AUTHORIZED`. Later H2, H2-E, and runtime qualification superseded that historical state; current D.3-D.4 / OpenSpec 4.3 is `PASS / RUNTIME QUALIFIED / CLOSED`.
7.2. **D.3-D.4-H2-E DIRECT_CARD Pre-Prompt Owner Audience Consumer** — `PASS / SOURCE IMPLEMENTED / REPOSITORY-TESTED`; host H2 commit `2e67ab06b6f7f1cf7655d0a8d508fc2a2ad78176` was verified read-only, and the implementation uses exact current Canonical reads, Owner projection/attestation, hard-deny capability checks, selection-only cards, no-fallback card mode, and selection-derived telemetry. At this source-stage closeout OpenSpec 4.3 and 4.4 were outside scope; 4.3 is now `PASS / RUNTIME QUALIFIED / CLOSED`, while 4.4 remains unchecked. Record: `docs/direct-card-pre-prompt-owner-audience-consumer-implementation-v1.md`.
8. **Learned/statistical recall policy** — `LATER / NOT STARTED`; requires sufficient real labeled traffic and a separate Planner decision.
9. **Recall Hint**.
10. **Statistical LTR**.

Multi-agent memory architecture may begin after the Canonical Object Contract is stable and need not wait for LTR. Its detailed ownership, visibility, attribution, and ACL semantics remain a later product-design decision.

AutoRecall broad rollout remains a separate later decision. A naturally occurring AutoRecall success/failure with independent answer-bearing evidence may still justify one bounded read-only first-loss attribution, but provenance availability alone does not reopen retrieval tuning or dedicated canary chains.


### DEFERRED

- Candidate-Builder authority publication / `npm.ci_candidate` timeout diagnosis. The committed `300000ms` inner / `330000ms` outer policy remains unchanged; additional harness micro-stages are not planned.
- Diagnostic/path-authority debt identified by the 2026-08-04 low-coverage audit. It is real but was non-causal to the H6 rejection set and does not preempt the NOW decision.

### REFERENCE ONLY

The historical B8-A7 sustained-production-evidence and strict platform-profile rollout work remains available as design and operational reference. It is not the current roadmap and does not authorize sustained runtime, removal-gate work, or a rollout continuation.

## Workstreams

- Retrieval correctness: preserve candidate provenance, filtering, ordering, and fallback contracts.
- Storage ownership: keep Core reads separate from Engine-owned writes and enforce database boundaries.
- Confidence lifecycle: maintain explicit managed-confidence, external-candidate, decay, archive, conflict, and reinforcement semantics.
- Safety gates: keep opt-in behavior, fail-closed paths, bounded operations, and rollback conditions explicit.
- Observability: expose bounded, privacy-safe diagnostics and stable debug metadata for verification.
- Benchmark and quality evidence: preserve internal fixtures as regression evidence, freeze external baseline profiles, record exact dataset/version provenance, compare retrieval quality and latency across versions, and require cross-dataset evidence before benchmark-driven heuristics become product policy.
- Release verification: compare source, artifacts, configuration semantics, and test evidence before deployment.
- Deployment rollback discipline: use explicit authorities, reversible steps, and verified rollback targets for any authorized runtime transaction.
- Runtime authority drift checks: scope worktree cleanliness to files that can affect the authorized execution path; do not fail a runtime qualification solely because unrelated documentation, test, report, or roadmap files are modified. Keep exact Stage Card SHA and frozen runtime-source hashes as separate authority checks. For the current session-checkpoint/persistent-runtime path, the drift surface is `bin/`, `lib/`, repository-root `*.js`/`*.cjs`, `package.json`, `package-lock.json`, and `openclaw.plugin.json`.

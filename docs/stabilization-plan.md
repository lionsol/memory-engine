# memory-engine Stabilization Plan

> **Status: Current product roadmap**
>
> `docs/current-state.md` is the sole owner of the exact current product state and next authorized decision. This roadmap describes the accepted product sequence and branching logic only; it does not authorize execution or describe a particular deployment.

## Current product sequence

### NOW

With L2 Database Boundary Closure complete, **Phase 2.5-A is `PASS / CLOSED`**, **Phase 2.5-B is `PASS / CLOSED`**, and **Phase 2.5-C is `PASS_WITH_FINDINGS / CLOSED`** under `canonical-memory-architecture`. Phase 2.5-D source, deployment, and runtime qualification are **`PASS / QUALIFIED`**. Phase 2.5-D.1 source and deployment are **`PASS / CLOSED`**, and its live writer qualification is **`PASS / QUALIFIED`**. Overall Phase 2.5 Canonical Memory Architecture is **`PASS / CLOSED`**.

Intent-aware Recall v2-A is **`SOURCE IMPLEMENTED / VERIFIED`**. Its deterministic task/recall taxonomy is observational only: frozen 12-row replay now enforces both labels, and decision trace/debug metadata expose bounded intent values. Existing recall decisions, focused queries, retrieval policy, ranking, Card/Get behavior, and AutoRecall default-off state remain unchanged. Policy authority remains a separate decision.

Intent-aware Recall v2-B1 remains an **offline-only evaluation**. Its initial 36-row result was V1 `18/5/13/0`, oracle `18/18/0/0`, and runtime candidate `8/18/0/10` for TP/TN/FP/FN, with 4 task and 12 recall mismatches.

Intent-aware Recall v2-B2 is **`SOURCE IMPLEMENTED / KNOWN-GAP REGRESSION CLOSED`**. Generalized deterministic classifier signals now produce zero task/recall mismatch and runtime candidate `18/18/0/0` on the frozen B1 regression set; V1 remains unchanged at `18/5/13/0`. The candidate policy is **not runtime authorized**.

Intent-aware Recall v2-B3's first independent run is a **historical `PASS_WITH_FINDINGS / HOLDOUT NOT READY`** record: the valid 48-row, 24/24 Planner-frozen holdout produced oracle `24/24/0/0` and runtime `7/19/5/17`, with precision `0.5833`, recall `0.2917`, task mismatches `14`, and recall mismatches `25`. B4 does not rewrite that first-run result.

Intent-aware Recall v2-B4 is **`SOURCE IMPLEMENTED / STRUCTURED EVIDENCE REGRESSION CLOSED`**. The classifier now uses pure request-scope and structured history evidence with quoted-content masking and suppression precedence. The frozen v2-A seed remains `12/12`; B1 remains V1 `18/5/13/0` and runtime candidate `18/18/0/0`; B3 current regression is V1 `24/0/24/0` and runtime candidate `24/24/0/0`, with task/recall mismatch `0/0`. B3 is now explicitly **`REGRESSION ONLY / NOT INDEPENDENT READINESS EVIDENCE`** with evidence role `known_regression_after_v2b4`; these scores do not qualify generalization or authorize the candidate policy.

Retrieval-first Selective Disclosure Phase D.2-B is **`FAILED / PRODUCT ARCHITECTURE GAP`**. The frozen v2 candidate-level evaluation produced `41` selected cards and `7` withheld candidates, with `23` unsafe disclosures, `0` unauthorized full-content surfaces, and answer-bearing disclosure recall `0.75`. This is an offline product finding, not a fixture or runtime failure; no selector, admissibility, evaluator, fixture, or runtime source was changed.

The **Disclosure Capability Contract v1.1** is **`PASS / CONTRACT CLOSED`**. It separates retrieval availability, internal context, bounded card disclosure, and reserved raw disclosure; `safe_to_disclose` is owned by capability calculation and is required for `CARD_DISCLOSABLE`. The contract does not itself authorize production integration or runtime adoption.

The **Disclosure Capability Shadow Evaluation v1.1** is **`PASS / OFFLINE EVALUATION COMPLETE`**. The pure offline evaluator is implemented at commit `8db96038cb44818df2674b5f3b87a99adab93728` and preserves the existing production selector. On the frozen 48-row v2 fixture (`d372ebac9bf4d80aaac85dfb0d43eacec792291871b744b7812009ac06d071bd`), D.2-C.11 reduced unsafe card disclosure from `23` to `0`, while answer-bearing disclosure recall remained `0.75`; selected cards changed `41 -> 18` and irrelevant disclosures `23 -> 0`. This is offline architecture evidence only: no production selector/admissibility change, runtime integration, deployment, AutoRecall enablement, config mutation, or data mutation occurred.

**Phase D.3 Memory Projection Architecture** is now active. D.3-A closed the architecture contract, D.3-B is `SOURCE IMPLEMENTED / VERIFIED`, D.3-C.1 is **`HOLDOUT CONTRACT FROZEN`**, D.3-C.2 is **`SOURCE IMPLEMENTED`**, D.3-C.3 first-run evidence is **`ACCEPTED BY PLANNER FOR ARCHITECTURE INTERPRETATION`**, D.3-C.4 is **`PROJECTION STRATEGY TAXONOMY DEFINED`**, D.3-C.5 is **`REDACTED_CARD OFFLINE PROTOTYPE IMPLEMENTED / NOT INDEPENDENTLY EVALUATED`**, D.3-C.6 is **`INDEPENDENT REDACTED_CARD HOLDOUT FROZEN / NOT YET EVALUATED`**, D.3-C.7 is **`PURE INDEPENDENT REDACTED_CARD EVALUATOR IMPLEMENTED`**, D.3-C.8 is **`PASS / FIRST-RUN EVIDENCE ACCEPTED`**, D.3-C.9 is **`REDACTION PLAN AUTHORITY BOUNDARY DEFINED`**, D.3-C.10 is **`STRUCTURED REDACTION EVIDENCE CONTRACT IMPLEMENTED / OFFLINE ONLY / NOT PRODUCTION AUTHORITY`**, D.3-C.11 is **`REDACTION EVIDENCE RESOLUTION SEMANTICS DEFINED`**, D.3-C.12 is **`INTERNAL_AGENT_CONTEXT REPRESENTATION BOUNDARY DEFINED`**, D.3-C.13 is **`INTERNAL_AGENT_CONTEXT PROJECTION CONTRACT PROTOTYPE IMPLEMENTED / OFFLINE ONLY / NOT CAPABILITY AUTHORIZED`**, D.3-C.14 is **`INDEPENDENT INTERNAL_AGENT_CONTEXT HOLDOUT FROZEN`**, D.3-C.15 is **`PURE INDEPENDENT INTERNAL_AGENT_CONTEXT EVALUATOR IMPLEMENTED`**, and D.3-C.16 is now **`PASS / FIRST-RUN EVIDENCE ACCEPTED`**. D.3-C product interpretation is **`ACCEPTED`** and D.3-D entry is **`APPROVED FOR DIRECT_CARD SOURCE MIGRATION ONLY`**. D.3-D.1 design was **`PASS_WITH_FINDINGS`**; at that historical decision point, direct-card source migration was **`HOLD`** with historical blocker **`PRODUCTION_SAFE_TO_DISCLOSE_AUTHORITY_MISSING`**. D.3-D.2 authority decision was **`PASS / DECISION CLOSED`**; its historical decision-point blocker was **`PRODUCTION_DISCLOSURE_ATTESTATION_PROVIDER_NOT_IMPLEMENTED`**. D.3-D.3 source implementation is **`IMPLEMENTED / REPOSITORY-TESTED`** with no AutoRecall wiring or runtime deployment; D.3-D.4 is now **`AUTHORIZED / PRE-IMPLEMENTATION BLOCKED`**, but remains **`BLOCKED / NOT IMPLEMENTED`** for source migration because the trusted same-run `OWNER_SELF` audience proof is unavailable at the prompt-injection boundary. Blocker: **`PRODUCTION_OWNER_SELF_AUDIENCE_AUTHORITY_UNAVAILABLE_AT_PROMPT_INJECTION_BOUNDARY`**. The full matrix and D.3-D.1 boundary record are in `docs/memory-projection-product-interpretation-v1.md` and `docs/direct-card-production-boundary-migration-design-v1.md`; no C.17 was created, and no production or runtime mutation is authorized.

The preceding D.3-D paragraph records the pre-H2-E status. The current
consumer status is the H2-E `PASS / SOURCE IMPLEMENTED / REPOSITORY-TESTED`
record below; it does not grant runtime or deployment authority.

The D.3-D.2 `PRODUCTION_DISCLOSURE_ATTESTATION_PROVIDER_NOT_IMPLEMENTED`
wording above records the historical blocker at that decision point. D.3-D.3
subsequently implements the repository source provider and Owner boundary, but
the provider is not wired into production AutoRecall. The current source
migration remains `HOLD` because of the D.3-D.4 audience-boundary blocker; the
D.3-D.4 pre-implementation review is complete and is not pending.

The D.3-D.3 status includes same-stage corrective closure of the obsolete
two-argument command registration and the placeholder Owner preview. The
corrected preview is Canonical-source-derived and binds the independent
`owner_attestable_canonical_card_v1` adapter.

D.3-D.4-H1 **`PASS_WITH_FINDINGS / CONTRACT DESIGN FROZEN`** records the
selected event-local, same-run, host-authenticated `before_prompt_build`
`senderIsOwner?: boolean` contract. The installed OpenClaw `2026.6.9` package
was inspected for design evidence, but no authoritative upstream checkout was
available locally; finding: **`OPENCLAW_AUTHORITATIVE_SOURCE_CHECKOUT_NOT_PRESENT_LOCALLY`**.
No OpenClaw or memory-engine source implementation was authorized. H2 remains
`CANDIDATE / NOT AUTHORIZED` and D.3-D.4 remains blocked on the audience
boundary.

The later authorized D.3-D.4-H2-E consumer stage is **`PASS / SOURCE
IMPLEMENTED / REPOSITORY-TESTED`**. It consumes the verified host event-local
`senderIsOwner?: boolean` contract from OpenClaw H2 commit
`2e67ab06b6f7f1cf7655d0a8d508fc2a2ad78176`, migrates the enabled DIRECT_CARD
capability/selector/card path, and derives telemetry from selected cards only.
The H1 source-checkout finding is retained as historical; the authoritative
source correction is that `v2026.6.9` contains the CLI prompt-build path and H2
covers it. No runtime/deployment qualification occurred.

### NEXT

The D.3-D.4 source-migration clauses in the historical sequence below describe
the pre-H2-E decision point. The current source status is H2-E
`PASS / SOURCE IMPLEMENTED / REPOSITORY-TESTED`; only runtime/deployment,
configuration, and data operations remain separately authorized.

Phase 2.5 Canonical Memory Architecture is closed. No further D/D.1 deployment or qualification work remains. Intent-aware Recall v2-B and the successor Selective Recall Gate deterministic-authority experiment are closed: the full semantic route and skip-only C1 route are rejected, and v2-B6/C2-C repair are cancelled. Retrieval-first Selective Disclosure D.2-C completed its capability contract and offline v1.1 shadow evaluation. D.3-A and D.3-B are closed at architecture/source level; D.3-C.1 is **`HOLDOUT CONTRACT FROZEN`**, D.3-C.2 is **`SOURCE IMPLEMENTED`**, D.3-C.3 evidence is **`ACCEPTED BY PLANNER FOR ARCHITECTURE INTERPRETATION`**, D.3-C.4 is **`PROJECTION STRATEGY TAXONOMY DEFINED`**, D.3-C.5 is **`REDACTED_CARD OFFLINE PROTOTYPE IMPLEMENTED / NOT INDEPENDENTLY EVALUATED`**, D.3-C.6 is **`INDEPENDENT REDACTED_CARD HOLDOUT FROZEN / NOT YET EVALUATED`**, D.3-C.7 is **`PURE INDEPENDENT REDACTED_CARD EVALUATOR IMPLEMENTED`**, D.3-C.8 is **`PASS / FIRST-RUN EVIDENCE ACCEPTED`**, D.3-C.9 is **`REDACTION PLAN AUTHORITY BOUNDARY DEFINED`**, D.3-C.10 is **`STRUCTURED REDACTION EVIDENCE CONTRACT IMPLEMENTED / OFFLINE ONLY / NOT PRODUCTION AUTHORITY`**, D.3-C.11 is **`REDACTION EVIDENCE RESOLUTION SEMANTICS DEFINED`**, D.3-C.12 is **`INTERNAL_AGENT_CONTEXT REPRESENTATION BOUNDARY DEFINED`**, D.3-C.13 is **`INTERNAL_AGENT_CONTEXT PROJECTION CONTRACT PROTOTYPE IMPLEMENTED / OFFLINE ONLY / NOT CAPABILITY AUTHORIZED`**, D.3-C.14 is **`INDEPENDENT INTERNAL_AGENT_CONTEXT HOLDOUT FROZEN`**, D.3-C.15 is **`PURE INDEPENDENT INTERNAL_AGENT_CONTEXT EVALUATOR IMPLEMENTED`**, and D.3-C.16 is now **`PASS / FIRST-RUN EVIDENCE ACCEPTED`**. D.3-C product interpretation is **`ACCEPTED`** and D.3-D entry is **`APPROVED FOR DIRECT_CARD SOURCE MIGRATION ONLY`**. D.3-D.1 design was **`PASS_WITH_FINDINGS`** with historical blocker **`PRODUCTION_SAFE_TO_DISCLOSE_AUTHORITY_MISSING`**. D.3-D.2 authority decision was **`PASS / DECISION CLOSED`** with historical blocker **`PRODUCTION_DISCLOSURE_ATTESTATION_PROVIDER_NOT_IMPLEMENTED`**; D.3-D.3 subsequently provided the repository source implementation and Owner management boundary, but it is not wired into production AutoRecall. Current direct-card source migration remains **`HOLD`** under the D.3-D.4 audience-boundary blocker, and the D.3-D.4 pre-implementation review is complete, not pending. The C.16 evidence, product decision, and D.3-D.1 design are in `reports/internal-agent-context-holdout-v1-first-run-20260823.md`, `docs/memory-projection-product-interpretation-v1.md`, and `docs/direct-card-production-boundary-migration-design-v1.md`; no C.17 was created. The D.2, D.3-C.1, C.6, and C.14 holdouts remain immutable. `ADD_SYNC_BACKFILL_SCOPE_FINDING` remains a non-blocking operational/lifecycle finding outside D.1 scope. D.3-D.3 source implementation is **`IMPLEMENTED / REPOSITORY-TESTED`** using temporary/in-memory test databases only; no runtime deployment or real attestation state was created. D.3-D.4 is now **`AUTHORIZED / PRE-IMPLEMENTATION BLOCKED`** but **`BLOCKED / NOT IMPLEMENTED`** for source migration because `PRODUCTION_OWNER_SELF_AUDIENCE_AUTHORITY_UNAVAILABLE_AT_PROMPT_INJECTION_BOUNDARY`; no D.3 runtime authority is granted.

### CLOSED

- The persistent-activation qualification line is closed. The separately authorized Session-Flush Reconciliation Persistent Rollout Successor recorded `PASS` on 2026-08-17, accepted the immutable `ac0e5f0` reconciliation candidate for persistent use, and explicitly requires no R5 or additional persistent-activation qualification. AutoRecall remains disabled by default and broad rollout remains a separate later decision.
- **L2 Database Boundary Closure** recorded `deployed runtime qualification PASS / L2 COMPLETE` at active runtime source parity `057f43e`. Gateway was `READY`; `AutoRecall=false`; Hybrid runtime used `KG_ACCESS_MODE=isolated` and `RECENT_ACCESS_MODE=isolated` with production legacy fallback `0`; the current Nightly dry-run isolated topology passed; and no unexpected memory/confidence mutation was observed.
- **Conflict Ownership Closure** is `SOURCE CLOSED / PASS`: Session Checkpoint exclusively owns `category='preference'` conflict flags through `resolvePreferenceConflicts()` / `preference_latest_wins`, while generic lifecycle detection excludes preference and preserves non-preference conflict behavior. No schema change was made. Nightly Maintenance apply rollout remains a separate, unauthorized decision.
- **Intent-aware / Selective Recall deterministic authority experiment** is `REJECTED / CLOSED / NOT RUNTIME AUTHORIZED`. The first fresh C2 holdout produced V1 `23/0/24/1` and selective `22/5/19/2`; hard safety failed (`unsafe SAFE_SKIP=1`, introduced FN `1`, SAFE_SKIP precision `0.8333`) while utility passed (`5` FP reduced, rate `0.2083`). C2-C repair is `CANCELLED / DO NOT START`; taxonomy, evidence, evaluators, and corpora remain retained experimental artifacts.

### LATER

After the canonical semantic contract is stable, advance Intelligent Recall in this order:

1. **D.3-C.16 INTERNAL_AGENT_CONTEXT Holdout First Run** — `PASS / FIRST-RUN EVIDENCE ACCEPTED`; the frozen C.14 fixture was read exactly once under the separate execution authorization, with no retry or second execution.
2. **D.3-C product interpretation** — `ACCEPTED`; the evidence supports `INTERNAL_AGENT_CONTEXT` representation only when caller-supplied ranges are already correct and does not prove automatic range selection or capability.
3. **D.3-D entry** — `APPROVED FOR DIRECT_CARD SOURCE MIGRATION ONLY`; the separately authorized H2-E source migration is now recorded below, while runtime/deployment remains separately authorized.
4. **D.3-D.1 DIRECT_CARD Production Boundary Migration Design** — `PASS_WITH_FINDINGS`; at that historical decision point, direct-card source migration was `HOLD` with historical blocker `PRODUCTION_SAFE_TO_DISCLOSE_AUTHORITY_MISSING`. The design is docs/OpenSpec-only and does not authorize source work.
5. **D.3-D.2 DIRECT_CARD Safe-to-Disclose Authority Decision** — `PASS / DECISION CLOSED`; v1 positive authority is `OWNER_EXPLICIT_ATTESTATION` bound to surface `DISCLOSURE_CARD` and actual artifact kind `legacy_memory_card_v1`. At that historical decision point the provider was not implemented, with historical blocker `PRODUCTION_DISCLOSURE_ATTESTATION_PROVIDER_NOT_IMPLEMENTED`; D.3-D.3 subsequently implemented the repository source boundary, while current production source migration remains `HOLD` under the D.3-D.4 audience-boundary blocker. D.3-D.4 pre-implementation review is complete, not pending.
6. **D.3-D.3 DIRECT_CARD Owner-Attested Authority Source Implementation** — `IMPLEMENTED / REPOSITORY-TESTED`; the same-stage corrective patch closes the command-object registration and meaningful-preview findings. The Engine-owned store, exact validator/provider, Canonical-source-derived Owner projection, and host-authenticated management command are implemented, but no AutoRecall wiring or runtime deployment occurred.
7. **D.3-D.4 DIRECT_CARD Production Disclosure Boundary Migration** — the historical pre-H2-E review was `AUTHORIZED / PRE-IMPLEMENTATION BLOCKED` under `PRODUCTION_OWNER_SELF_AUDIENCE_AUTHORITY_UNAVAILABLE_AT_PROMPT_INJECTION_BOUNDARY`; H2-E is the separately authorized source consumer stage and does not authorize runtime activation or host remediation.
7.1. **D.3-D.4-H1 OpenClaw Pre-Prompt Owner Audience Contract Design** — `PASS_WITH_FINDINGS / CONTRACT DESIGN FROZEN`; selected event-local contract is design-only, finding `OPENCLAW_AUTHORITATIVE_SOURCE_CHECKOUT_NOT_PRESENT_LOCALLY`, and H2 remains `CANDIDATE / NOT AUTHORIZED`.
7.2. **D.3-D.4-H2-E DIRECT_CARD Pre-Prompt Owner Audience Consumer** — `PASS / SOURCE IMPLEMENTED / REPOSITORY-TESTED`; host H2 commit `2e67ab06b6f7f1cf7655d0a8d508fc2a2ad78176` was verified read-only, and the implementation uses exact current Canonical reads, Owner projection/attestation, hard-deny capability checks, selection-only cards, no-fallback card mode, and selection-derived telemetry. OpenSpec 4.3 and 4.4 remain unchecked. Record: `docs/direct-card-pre-prompt-owner-audience-consumer-implementation-v1.md`.
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
- Release verification: compare source, artifacts, configuration semantics, and test evidence before deployment.
- Deployment rollback discipline: use explicit authorities, reversible steps, and verified rollback targets for any authorized runtime transaction.
- Runtime authority drift checks: scope worktree cleanliness to files that can affect the authorized execution path; do not fail a runtime qualification solely because unrelated documentation, test, report, or roadmap files are modified. Keep exact Stage Card SHA and frozen runtime-source hashes as separate authority checks. For the current session-checkpoint/persistent-runtime path, the drift surface is `bin/`, `lib/`, repository-root `*.js`/`*.cjs`, `package.json`, `package-lock.json`, and `openclaw.plugin.json`.

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

**Phase D.3 Memory Projection Architecture** is now active. D.3-A closed the architecture contract, D.3-B is `SOURCE IMPLEMENTED / VERIFIED`, D.3-C.1 is **`HOLDOUT CONTRACT FROZEN`**, D.3-C.2 is **`SOURCE IMPLEMENTED`**, D.3-C.3 first-run evidence is **`ACCEPTED BY PLANNER FOR ARCHITECTURE INTERPRETATION`**, D.3-C.4 is **`PROJECTION STRATEGY TAXONOMY DEFINED`**, D.3-C.5 is **`REDACTED_CARD OFFLINE PROTOTYPE IMPLEMENTED / NOT INDEPENDENTLY EVALUATED`**, D.3-C.6 is **`INDEPENDENT REDACTED_CARD HOLDOUT FROZEN / NOT YET EVALUATED`**, D.3-C.7 is **`PURE INDEPENDENT REDACTED_CARD EVALUATOR IMPLEMENTED`**, D.3-C.8 is **`PASS / FIRST-RUN EVIDENCE ACCEPTED`**, D.3-C.9 is **`REDACTION PLAN AUTHORITY BOUNDARY DEFINED`**, D.3-C.10 is **`STRUCTURED REDACTION EVIDENCE CONTRACT IMPLEMENTED / OFFLINE ONLY / NOT PRODUCTION AUTHORITY`**, D.3-C.11 is **`REDACTION EVIDENCE RESOLUTION SEMANTICS DEFINED`**, D.3-C.12 is **`INTERNAL_AGENT_CONTEXT REPRESENTATION BOUNDARY DEFINED`**, and D.3-C.13 is **`INTERNAL_AGENT_CONTEXT PROJECTION CONTRACT PROTOTYPE IMPLEMENTED / OFFLINE ONLY / NOT CAPABILITY AUTHORIZED`**. C.8 remains independent offline representation evidence only; C.9 separates who may eventually generate directives, C.10 binds structural evidence to identity and baseline representation, C.11 defines multi-claim semantics without implementing resolution or authenticated authority, C.12 defines the internal evidence surface, and C.13 implements only its bounded source-derived prototype contract. The accepted taxonomy is in `docs/memory-projection-strategy-taxonomy-v1.md`, the C.9 decision record is in `docs/redaction-plan-authority-boundary-v1.md`, the C.10 contract record is in `docs/structured-redaction-evidence-contract-v1.md`, the C.11 decision record is in `docs/redaction-evidence-resolution-semantics-v1.md`, the C.12 decision record is in `docs/internal-agent-context-representation-design-v1.md`, and the C.13 contract record is in `docs/internal-agent-context-projection-contract-v1.md`. No production or runtime mutation is authorized.

### NEXT

Phase 2.5 Canonical Memory Architecture is closed. No further D/D.1 deployment or qualification work remains. Intent-aware Recall v2-B and the successor Selective Recall Gate deterministic-authority experiment are closed: the full semantic route and skip-only C1 route are rejected, and v2-B6/C2-C repair are cancelled. Retrieval-first Selective Disclosure D.2-C completed its capability contract and offline v1.1 shadow evaluation. D.3-A and D.3-B are closed at architecture/source level; D.3-C.1 is **`HOLDOUT CONTRACT FROZEN`**, D.3-C.2 is **`SOURCE IMPLEMENTED`**, D.3-C.3 evidence is **`ACCEPTED BY PLANNER FOR ARCHITECTURE INTERPRETATION`**, D.3-C.4 is **`PROJECTION STRATEGY TAXONOMY DEFINED`**, D.3-C.5 is **`REDACTED_CARD OFFLINE PROTOTYPE IMPLEMENTED / NOT INDEPENDENTLY EVALUATED`**, D.3-C.6 is **`INDEPENDENT REDACTED_CARD HOLDOUT FROZEN / NOT YET EVALUATED`**, D.3-C.7 is **`PURE INDEPENDENT REDACTED_CARD EVALUATOR IMPLEMENTED`**, D.3-C.8 is **`PASS / FIRST-RUN EVIDENCE ACCEPTED`**, D.3-C.9 is **`REDACTION PLAN AUTHORITY BOUNDARY DEFINED`**, D.3-C.10 is **`STRUCTURED REDACTION EVIDENCE CONTRACT IMPLEMENTED / OFFLINE ONLY / NOT PRODUCTION AUTHORITY`**, D.3-C.11 is **`REDACTION EVIDENCE RESOLUTION SEMANTICS DEFINED`**, D.3-C.12 is **`INTERNAL_AGENT_CONTEXT REPRESENTATION BOUNDARY DEFINED`**, and D.3-C.13 is **`INTERNAL_AGENT_CONTEXT PROJECTION CONTRACT PROTOTYPE IMPLEMENTED / OFFLINE ONLY / NOT CAPABILITY AUTHORIZED`**. **NEXT: D.3-C.14 Independent INTERNAL_AGENT_CONTEXT Holdout Freeze — CANDIDATE / NOT AUTHORIZED BY C.13**; it requires Planner acceptance and a fresh synthetic namespace, while resolver/trusted-origin production work remains a future D.3-D product decision. The D.2, D.3-C.1, and C.6 holdouts remain immutable. `ADD_SYNC_BACKFILL_SCOPE_FINDING` remains a non-blocking operational/lifecycle finding outside D.1 scope. No D.3 runtime authority is granted.

### CLOSED

- The persistent-activation qualification line is closed. The separately authorized Session-Flush Reconciliation Persistent Rollout Successor recorded `PASS` on 2026-08-17, accepted the immutable `ac0e5f0` reconciliation candidate for persistent use, and explicitly requires no R5 or additional persistent-activation qualification. AutoRecall remains disabled by default and broad rollout remains a separate later decision.
- **L2 Database Boundary Closure** recorded `deployed runtime qualification PASS / L2 COMPLETE` at active runtime source parity `057f43e`. Gateway was `READY`; `AutoRecall=false`; Hybrid runtime used `KG_ACCESS_MODE=isolated` and `RECENT_ACCESS_MODE=isolated` with production legacy fallback `0`; the current Nightly dry-run isolated topology passed; and no unexpected memory/confidence mutation was observed.
- **Conflict Ownership Closure** is `SOURCE CLOSED / PASS`: Session Checkpoint exclusively owns `category='preference'` conflict flags through `resolvePreferenceConflicts()` / `preference_latest_wins`, while generic lifecycle detection excludes preference and preserves non-preference conflict behavior. No schema change was made. Nightly Maintenance apply rollout remains a separate, unauthorized decision.
- **Intent-aware / Selective Recall deterministic authority experiment** is `REJECTED / CLOSED / NOT RUNTIME AUTHORIZED`. The first fresh C2 holdout produced V1 `23/0/24/1` and selective `22/5/19/2`; hard safety failed (`unsafe SAFE_SKIP=1`, introduced FN `1`, SAFE_SKIP precision `0.8333`) while utility passed (`5` FP reduced, rate `0.2083`). C2-C repair is `CANCELLED / DO NOT START`; taxonomy, evidence, evaluators, and corpora remain retained experimental artifacts.

### LATER

After the canonical semantic contract is stable, advance Intelligent Recall in this order:

1. **D.3-C.14 Independent INTERNAL_AGENT_CONTEXT Holdout Freeze** — `CANDIDATE / NOT AUTHORIZED BY C.13`; fresh synthetic namespace only, with no holdout execution implied.
2. **D.3-C product interpretation** — `LATER / SEPARATE DECISION`; use accepted offline evidence without inferring runtime readiness or relaxing capability.
3. **D.3-D production/runtime integration** — `LATER / NOT AUTHORIZED`; requires a separate product decision and explicit runtime authorization after D.3-C evidence.
4. **Learned/statistical recall policy** — `LATER / NOT STARTED`; requires sufficient real labeled traffic and a separate Planner decision.
5. **Recall Hint**.
6. **Statistical LTR**.

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

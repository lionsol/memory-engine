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

### NEXT

Phase 2.5 Canonical Memory Architecture is closed. No further D/D.1 deployment or qualification work remains; later retrieval, recall, and lifecycle work follows the separate roadmap decisions below. `ADD_SYNC_BACKFILL_SCOPE_FINDING` remains a non-blocking operational/lifecycle finding outside D.1 scope. v2-B5 fresh independent holdout evaluation is complete with `PASS_WITH_FINDINGS / HOLDOUT NOT READY`; candidate policy authority remains a separate Planner decision and no classifier repair is implied.

### CLOSED

- The persistent-activation qualification line is closed. The separately authorized Session-Flush Reconciliation Persistent Rollout Successor recorded `PASS` on 2026-08-17, accepted the immutable `ac0e5f0` reconciliation candidate for persistent use, and explicitly requires no R5 or additional persistent-activation qualification. AutoRecall remains disabled by default and broad rollout remains a separate later decision.
- **L2 Database Boundary Closure** recorded `deployed runtime qualification PASS / L2 COMPLETE` at active runtime source parity `057f43e`. Gateway was `READY`; `AutoRecall=false`; Hybrid runtime used `KG_ACCESS_MODE=isolated` and `RECENT_ACCESS_MODE=isolated` with production legacy fallback `0`; the current Nightly dry-run isolated topology passed; and no unexpected memory/confidence mutation was observed.
- **Conflict Ownership Closure** is `SOURCE CLOSED / PASS`: Session Checkpoint exclusively owns `category='preference'` conflict flags through `resolvePreferenceConflicts()` / `preference_latest_wins`, while generic lifecycle detection excludes preference and preserves non-preference conflict behavior. No schema change was made. Nightly Maintenance apply rollout remains a separate, unauthorized decision.

### LATER

After the canonical semantic contract is stable, advance Intelligent Recall in this order:

1. **Intent-aware Recall v2-B5 independent holdout** — completed as a frozen, read-only evaluation. The oracle contract passed, but runtime candidate precision/recall were `0.3/0.125` with `7 FP / 21 FN`; the candidate remains not runtime authorized.
2. **Intent-aware Recall v2-B6 policy-authority review** — not started; requires Planner adjudication of B5 findings and does not authorize classifier repair or runtime activation by default.
3. **Recall Hint**.
4. **Statistical LTR**.

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

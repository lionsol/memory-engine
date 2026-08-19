# memory-engine Stabilization Plan

> **Status: Current product roadmap**
>
> `docs/current-state.md` is the sole owner of the exact current product state and next authorized decision. This roadmap describes the accepted product sequence and branching logic only; it does not authorize execution or describe a particular deployment.

## Current product sequence

### NOW

With L2 Database Boundary Closure complete, **Phase 2.5-A is `PASS / CLOSED`**, **Phase 2.5-B is `PASS / CLOSED`**, and **Phase 2.5-C is `PASS_WITH_FINDINGS / CLOSED`** under `canonical-memory-architecture`. Phase 2.5-D source, deployment, and runtime qualification are **`PASS / QUALIFIED`**. Phase 2.5-D.1 source and deployment are **`PASS / CLOSED`**, and its live writer qualification is **`PASS / QUALIFIED`**. Overall Phase 2.5 Canonical Memory Architecture is **`PASS / CLOSED`**.

Intent-aware Recall v2-A is **`SOURCE IMPLEMENTED / VERIFIED`**. Its deterministic task/recall taxonomy is observational only: frozen 12-row replay now enforces both labels, and decision trace/debug metadata expose bounded intent values. Existing recall decisions, focused queries, retrieval policy, ranking, Card/Get behavior, and AutoRecall default-off state remain unchanged. The next v2-B decision is whether and how validated intent may influence recall policy.

Intent-aware Recall v2-B1 is **`IMPLEMENTED / OFFLINE ONLY`**. Its independent 36-row balanced evaluation compares V1 current, V2 oracle mapping, and V2 runtime-classifier mapping. The observed matrices were V1 `18/5/13/0`, oracle `18/18/0/0`, and runtime candidate `8/18/0/10` for TP/TN/FP/FN. The run found 4 task-intent mismatches, 12 recall-intent mismatches, 13 false positives removed, and 10 false negatives introduced. The candidate policy is **not authorized** and has no production authority; v2-B2 is a separate planner adjudication.

### NEXT

Phase 2.5 Canonical Memory Architecture is closed. No further D/D.1 deployment or qualification work remains; later retrieval, recall, and lifecycle work follows the separate roadmap decisions below. `ADD_SYNC_BACKFILL_SCOPE_FINDING` remains a non-blocking operational/lifecycle finding outside D.1 scope.

### CLOSED

- The persistent-activation qualification line is closed. The separately authorized Session-Flush Reconciliation Persistent Rollout Successor recorded `PASS` on 2026-08-17, accepted the immutable `ac0e5f0` reconciliation candidate for persistent use, and explicitly requires no R5 or additional persistent-activation qualification. AutoRecall remains disabled by default and broad rollout remains a separate later decision.
- **L2 Database Boundary Closure** recorded `deployed runtime qualification PASS / L2 COMPLETE` at active runtime source parity `057f43e`. Gateway was `READY`; `AutoRecall=false`; Hybrid runtime used `KG_ACCESS_MODE=isolated` and `RECENT_ACCESS_MODE=isolated` with production legacy fallback `0`; the current Nightly dry-run isolated topology passed; and no unexpected memory/confidence mutation was observed.
- **Conflict Ownership Closure** is `SOURCE CLOSED / PASS`: Session Checkpoint exclusively owns `category='preference'` conflict flags through `resolvePreferenceConflicts()` / `preference_latest_wins`, while generic lifecycle detection excludes preference and preserves non-preference conflict behavior. No schema change was made. Nightly Maintenance apply rollout remains a separate, unauthorized decision.

### LATER

After the canonical semantic contract is stable, advance Intelligent Recall in this order:

1. **Intent-aware Recall v2-B2** — planner adjudication of the v2-B1 mapping/classifier findings and whether/how validated intent may influence `should_recall` / `focused_query`; v2-A/B1 do not authorize policy coupling.
2. **Recall Hint**.
3. **Statistical LTR**.

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

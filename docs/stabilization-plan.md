# memory-engine Stabilization Plan

> **Status: Current product roadmap**
>
> `docs/current-state.md` is the sole owner of the exact current product state and next authorized decision. This roadmap describes the accepted product sequence and branching logic only; it does not authorize execution or describe a particular deployment.

## Current product sequence

### NOW

With L2 Database Boundary Closure complete, **Phase 2.5-A Canonical Memory Object Contract is `CLOSED / PASS`**, **Phase 2.5-B is implemented/source verified**, **Phase 2.5-C1 is `PASS`**, and **Phase 2.5-C2 Hybrid top-result canonicalization is implemented/source verified** under the active OpenSpec change `canonical-memory-architecture`. Legacy combined `withDb` output, ranking/channel selection, Lance writes, and AutoRecall runtime wiring remain unchanged. **C3 vector-facing canonicalization is NEXT.**

### NEXT

After a separately scoped implementation decision, advance through **2.5-C3 vector-facing canonicalization** and **2.5-D Reconciliation Integration**. Each step must be scoped and risk-classified when it becomes active work; this roadmap does not pre-commit its detailed schema, ownership model, or runtime mechanics.

### CLOSED

- The persistent-activation qualification line is closed. The separately authorized Session-Flush Reconciliation Persistent Rollout Successor recorded `PASS` on 2026-08-17, accepted the immutable `ac0e5f0` reconciliation candidate for persistent use, and explicitly requires no R5 or additional persistent-activation qualification. AutoRecall remains disabled by default and broad rollout remains a separate later decision.
- **L2 Database Boundary Closure** recorded `deployed runtime qualification PASS / L2 COMPLETE` at active runtime source parity `64596f4`. Gateway was `READY`; `AutoRecall=false`; Hybrid runtime used `KG_ACCESS_MODE=isolated` and `RECENT_ACCESS_MODE=isolated` with production legacy fallback `0`; the current Nightly dry-run isolated topology passed; and no unexpected memory/confidence mutation was observed.

### LATER

After the canonical semantic contract is stable, advance Intelligent Recall in this order:

1. **Intent-aware Recall v2**.
2. **Recall Hint**.
3. **Statistical LTR**.

Multi-agent memory architecture may begin after the Canonical Object Contract is stable and need not wait for LTR. Its detailed ownership, visibility, attribution, and ACL semantics remain a later product-design decision.

AutoRecall broad rollout remains a separate later decision. A naturally occurring AutoRecall success/failure with independent answer-bearing evidence may still justify one bounded read-only first-loss attribution, but provenance availability alone does not reopen retrieval tuning or dedicated canary chains.

- **Resolve conflict-ownership overlap before enabling mutating Nightly Maintenance.** Keep preference/config conflict ownership in Session Checkpoint via `resolvePreferenceConflicts()` / `preference_latest_wins`. Change Nightly Maintenance generic `detectRelatedConflicts()` so it does not claim `category='preference'`; it should continue to own generic related-conflict detection for the remaining categories. This prevents the two pipelines from independently setting and clearing the same untyped `memory_confidence.conflict_flag`. Keep the current Nightly Maintenance cron in `--dry-run` until this ownership boundary is implemented and verified. Do not add conflict-source schema/state machinery unless later evidence shows that category separation is insufficient.

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

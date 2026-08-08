# memory-engine Stabilization Plan

> **Status: Current product roadmap**
>
> `docs/current-state.md` is the sole owner of the exact current product state and next authorized decision. This roadmap describes the accepted product sequence and branching logic only; it does not authorize execution or describe a particular deployment.

## Current product sequence

### NOW

H6 answerability / memory-coverage attribution audit.

Determine whether the nine historical H6 natural questions rejected by `relaxed_source_low_coverage_no_exact` were answerable from memory content that actually existed at the historical turn time, and if so, identify the first evidenced loss boundary.

The frozen Stage Card is `smoke-tests/h6-answerability-memory-coverage-attribution-audit-stage-card-20260808.md`. Committing or freezing that card does not authorize execution.

### NEXT — choose exactly one branch from evidence

- `CORPUS_COVERAGE_GAP` → diagnose memory capture / extraction / checkpoint coverage before changing retrieval.
- `RETRIEVAL_SELECTION_GAP` → diagnose retrieval recall/selection without pre-authorizing threshold, `topK`, weighting, or gate changes.
- `PROJECTION_BOUNDARY_GAP` → review the runtime projection boundary before changing retrieval or capture.
- `MIXED_OR_INSUFFICIENT_EVIDENCE` → stop tuning and decide the smallest additional evidence source; do not manufacture a repair stage.

A completed audit does not automatically authorize its corresponding NEXT branch. Each branch requires a separate product-level decision and explicit authorization.

### LATER

After one evidence-supported product branch is completed and reviewed, decide whether a new minimal natural-use validation is justified. AutoRecall broad rollout remains a separate later decision.

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

# memory-engine Stabilization Plan

> **Status: Current product roadmap**
>
> `docs/current-state.md` is the sole owner of the exact current product state and next authorized decision. This roadmap describes the accepted product sequence and branching logic only; it does not authorize execution or describe a particular deployment.

## Current product sequence

### NOW

First-loss-boundary attribution for the seven H6 turns already proven `RETRIEVAL_SELECTION_GAP`.

Determine, from preserved historical evidence only, whether those seven turns share an earliest loss boundary in query formation, channel/index candidate generation, or fusion/ranking/top-K preselection. First H6 T1 is excluded because retrieval already surfaced the correct `AutoRecall=false` fact and the loss occurred at the gate; retry T3 is excluded because the incident-specific answer remained unproven.

The frozen Stage Card is `smoke-tests/h6-retrieval-first-loss-boundary-attribution-stage-card-20260808.md`. Committing or freezing that card does not authorize execution.

### NEXT — choose exactly one branch from evidence

- `QUERY_FORMATION_GAP` → review query shaping/term preservation before changing candidate channels or ranking.
- `CHANNEL_OR_INDEX_AVAILABILITY_GAP` → review channel candidate generation/index freshness before changing fusion or top-K.
- `FUSION_OR_PRESELECTION_GAP` → review fusion/ranking/preselection before changing query shaping or capture.
- `MIXED_OR_INSUFFICIENT_EVIDENCE` → stop tuning and decide the smallest additional evidence source; do not manufacture a repair stage.

A completed attribution does not automatically authorize its corresponding NEXT branch. Each branch requires a separate product-level decision and explicit authorization.

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

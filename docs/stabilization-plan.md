# memory-engine Stabilization Plan

> **Status: Current product roadmap**
>
> `docs/current-state.md` is the sole owner of the exact current product state and next authorized decision. This roadmap describes the accepted product sequence and branching logic only; it does not authorize execution or describe a particular deployment.

## Current product sequence

### NOW

Add bounded, privacy-safe AutoRecall candidate provenance sufficient to diagnose future first-loss boundaries without replaying historical turns.

The completed seven-turn first-loss audit closed `PASS_WITH_FINDINGS / MIXED_OR_INSUFFICIENT_EVIDENCE`: historical evidence shows FTS did not preserve the known answer-bearing chunks, but vector/recent debug retained only counts, so it cannot distinguish channel/index loss from fusion/preselection loss. Query shaping, channel policy, ranking, `topK`, gate policy, capture, and rollout remain frozen.

The next frozen Stage Card is `smoke-tests/auto-recall-bounded-candidate-provenance-observability-stage-card-20260808.md`. Its intended implementation is source-only and additive; committing or freezing it does not authorize coding or deployment.

### NEXT

If the source-only observability stage passes, separately decide whether active-runtime installation/non-live verification is justified. Do not use a synthetic replay of the seven historical H6 turns as a substitute for the next natural sample.

When a later natural AutoRecall sample exists with the new provenance, use it to distinguish channel/index availability from fusion/preselection loss before considering any retrieval tuning.

### LATER

Only after an evidence-supported first-loss boundary is observed should the project consider a bounded retrieval-policy repair and a new minimal natural-use validation. AutoRecall broad rollout remains a separate later decision.

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

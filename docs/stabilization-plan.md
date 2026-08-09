# memory-engine Stabilization Plan

> **Status: Current product roadmap**
>
> `docs/current-state.md` is the sole owner of the exact current product state and next authorized decision. This roadmap describes the accepted product sequence and branching logic only; it does not authorize execution or describe a particular deployment.

## Current product sequence

### NOW

Retry the already-approved AutoRecall provenance runtime overlay once using corrected sealed-release construction mechanics, then perform the same non-live runtime identity and telemetry-contract verification.

The first install transaction stopped before Gateway mutation: `cp -a` preserved sealed mode `0400`, so the first overlay write failed with `Permission denied`. The failed candidate remains an immutable byte-identical clone of rollback, active runtime remains on the older bytes, and full-repository installation is still excluded.

The R2 retry uses a new fixed candidate path. Only the two copied target files may receive temporary owner-write permission; after overlay they must return to `0400`, and qualification must prove exactly two content differences from rollback. The frozen Stage Card is `smoke-tests/auto-recall-provenance-runtime-install-retry-r2-stage-card-20260808.md`; freezing it does not authorize runtime mutation.

### NEXT

If the non-live runtime installation stage passes, wait for a later natural AutoRecall sample with the new provenance. Do not replay the seven historical H6 turns or create a synthetic retrieval probe merely to populate telemetry.

Use the next natural failure/success sample to distinguish channel/index availability from fusion/preselection loss before considering any retrieval tuning.

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

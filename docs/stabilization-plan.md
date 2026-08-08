# memory-engine Stabilization Plan

> **Status: Current product roadmap**
>
> `docs/current-state.md` is the sole owner of the exact current product state and next authorized decision. This roadmap describes the accepted product sequence and branching logic only; it does not authorize execution or describe a particular deployment.

## Current product sequence

### NOW

Publish/install the already-passed AutoRecall provenance instrumentation through a minimal runtime overlay, then verify active runtime identity and telemetry contract without live retrieval.

Source implementation `1cd183ff12d055ba5c5ecd4bd0d9d1b98cdff23b` passed focused/privacy `19/19` and Node 24 full-suite `1835/0/8`. The active runtime still has the older bytes. Full-repository installation is excluded because it would also deploy a currently-uninstalled `normalize-candidate.js` semantic change; the runtime candidate must therefore be the current verified rollback release plus exactly the two provenance source files.

The frozen Stage Card is `smoke-tests/auto-recall-provenance-runtime-install-nonlive-verification-stage-card-20260808.md`. Committing/freezing it does not authorize runtime mutation.

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

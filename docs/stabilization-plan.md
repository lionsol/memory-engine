# memory-engine Stabilization Plan

> **Status: Current product roadmap**
>
> `docs/current-state.md` is the sole owner of the exact current product state and next authorized decision. This roadmap describes the accepted product sequence and branching logic only; it does not authorize execution or describe a particular deployment.

## Current product sequence

### NOW

Close the bounded candidate-provenance observability work item after the final R3 natural-use canary passed. R3 produced one genuine `/dev/tty` user turn, one post-baseline AutoRecall retrieval with bounded per-channel/fusion provenance, zero foreign post-baseline `recall_started`, and exact pre-canary config restoration. No R4 or additional dedicated provenance canary is planned.

AutoRecall broad rollout remains unauthorized and the default remains disabled. Retrieval query shaping, channel collection, fusion/ranking, thresholds, Card/gate behavior, capture/index/checkpoint behavior, and provenance limits remain frozen. Provenance availability is an observability capability, not a tuning trigger.

### NEXT

Wait for or select a naturally occurring AutoRecall success/failure that also has independent answer-bearing evidence. Only then create one bounded read-only first-loss attribution Stage Card to determine whether the answer-bearing candidate was lost at channel/index collection, fusion/preselection, later selection/gating, or not lost at all.

If no such independently answerable natural sample exists, remain on hold rather than manufacturing traffic or reopening the dedicated canary chain.

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

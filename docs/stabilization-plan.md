# memory-engine Stabilization Plan

> **Status: Current product roadmap**
>
> `docs/current-state.md` is the sole owner of the exact current product state and next authorized decision. This roadmap describes the accepted product sequence and branching logic only; it does not authorize execution or describe a particular deployment.

## Current product sequence

### NOW

Run one final R3 natural-use AutoRecall provenance canary under Sol's explicit anti-drift exception, correcting only R2's interactive-stdin harness defect.

R2 successfully loaded the exact scoped AutoRecall config and produced technically valid bounded provenance/scope/closeout evidence, but it did not execute a genuine Sol question: plain `read` consumed remaining heredoc script input and sent an execution-control line as the first prompt. R2 therefore remains `STOPPED` and that accidental prompt is not natural-use evidence.

R3 reuses the same dedicated `main` session, captures a fresh `BASE_EVENT_ID` before mutation, reads every genuine question explicitly from `/dev/tty`, uses `topK=1` plus exact `main`/session allowlists, runs at most six natural turns, and restores the exact pre-canary config. Retrieval/gate/Card behavior remains frozen. The frozen Stage Card is `smoke-tests/auto-recall-provenance-natural-canary-retry-r3-stage-card-20260809.md`; no R4 harness retry is planned or authorized.

### NEXT

If valid natural provenance is persisted, inspect only a later naturally occurring failure/success that has enough independent answer-bearing evidence to support first-loss attribution. Do not tune retrieval merely because provenance exists.

If six natural turns yield no non-skipped AutoRecall execution, close `INSUFFICIENT_EVIDENCE` and return AutoRecall to disabled rather than manufacturing more traffic.

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

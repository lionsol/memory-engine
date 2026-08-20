## Status

Offline shadow-evaluation implementation only; v2 fixture evaluation not executed.

This change defines and implements a pure side-by-side evaluator for current
disclosure behavior and a capability-constrained shadow path. It does not
change selector behavior, execute the frozen v2 fixture, or authorize runtime
adoption.

## Problem

The system separates retrieval, disclosure, and presentation, but the
Phase D.2-B result exposed a missing explicit capability boundary. Retrieval
availability, internal context availability, bounded card disclosure, and raw
disclosure availability are distinct concepts. Current selector behavior
cannot be treated as proof that those capabilities were calculated.

## Purpose

Shadow evaluation answers:

> Would an explicit capability boundary reduce unsafe disclosure while
> preserving useful recall?

It compares current behavior with a capability-constrained shadow behavior
using the existing selector as the final presentation step. The result is
offline evidence only; it does not authorize production adoption, runtime
integration, or raw disclosure.

## Fixture boundary

The frozen `test/fixtures/retrieval-disclosure-holdout.v2.jsonl` remains the
evaluation input boundary. It is not mutated, relabeled, or schema-upgraded by
this change. A future shadow run must identify itself as
`evidence_role=offline_shadow_evaluation`, not as independent holdout evidence.

## Non-goals

- No production capability calculator, selector, admissibility, projection,
  envelope, fixture, or runtime source implementation.
- The shadow evaluator is offline-only and has no production caller.
- No prompt intent, `task_intent`, `recall_intent`, retrieval, ranking, or
  AutoRecall policy authority.
- No runtime hook, configuration, database, data, Gateway, deployment, or raw
  disclosure change.

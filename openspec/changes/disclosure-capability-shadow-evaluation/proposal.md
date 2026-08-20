## Status

Offline shadow-evaluation contract only; not executed.

This change defines a side-by-side evaluation contract for current disclosure
behavior and a future capability-constrained shadow path. It does not
implement a capability calculator or evaluator, change selector behavior, or
authorize runtime adoption.

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

- No capability calculator, shadow evaluator, selector, admissibility,
  projection, envelope, fixture, or runtime source implementation.
- No prompt intent, `task_intent`, `recall_intent`, retrieval, ranking, or
  AutoRecall policy authority.
- No runtime hook, configuration, database, data, Gateway, deployment, or raw
  disclosure change.

## Status

Phase 1 contract-only architecture work.

This change defines a Disclosure Capability Contract after the Phase D.2-B
candidate-level evaluation exposed a product architecture gap. It does not
implement capability calculation, change selector behavior, enable runtime
disclosure, or authorize deployment.

## Problem

Retrieval, disclosure, and use are separate decisions. A candidate can be
retrievable without being suitable for internal context, and an internally
usable memory is not automatically safe to disclose as a Memory Card. The
current evaluation label `safe_to_disclose=false` has no explicit system
capability boundary corresponding to those distinctions.

The v2 holdout evaluation exposed this gap: the selector produced 41 cards,
including 23 candidates labeled unsafe to disclose, while producing no
unauthorized full-content surface. This is a product architecture finding,
not a reason to fit the selector to the fixture.

## Proposal

Define `DisclosureCapability v1` with explicit retrieval, internal-context,
card, and raw disclosure states. Canonical Memory remains the semantic
authority; capability is a derived policy state; and the selector remains a
presentation decision that cannot upgrade capability.

Future evaluation will label expected capability separately from expected
disclosure. A staged migration keeps the first step documentation-only, then
permits offline shadow evaluation, and requires explicit authorization before
any runtime integration.

## Non-goals

- No source implementation, selector change, admissibility change, evaluator
  change, fixture change, or Canonical Memory/projection change.
- No AutoRecall, hook, Hybrid, retrieval, ranking, configuration, database,
  data, Gateway, deployment, or runtime behavior change.
- No raw disclosure enablement. `RAW_DISCLOSABLE` remains reserved and raw
  access remains disabled by default.
- No prompt intent, `task_intent`, `recall_intent`, or semantic classifier
  authority over disclosure capability.

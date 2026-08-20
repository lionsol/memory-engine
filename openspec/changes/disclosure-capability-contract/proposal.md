## Status

Phase 1.1 contract-only architecture work.

This change refines the Disclosure Capability Contract after the Phase D.2-B
candidate-level evaluation and D.2-C.7 shadow evaluation exposed a product
architecture gap. It promotes `safe_to_disclose` to an explicit capability
predicate on paper only. It does not implement capability calculation, change
selector behavior, enable runtime disclosure, or authorize deployment.

## Problem

Retrieval, disclosure, and use are separate decisions. A candidate can be
retrievable without being suitable for internal context, and an internally
usable memory is not automatically safe to disclose as a Memory Card. The
evaluation label `safe_to_disclose=false` currently has no explicit system
capability boundary corresponding to those distinctions.

The v2 holdout and subsequent shadow evaluation exposed this gap. The
selector produced 41 cards, including 23 candidates labeled unsafe to
disclose; the shadow path also produced 23 unsafe disclosures, for zero unsafe
disclosure reduction. This is a product architecture finding, not a reason to
fit the selector or shadow rules to a fixture.

## Proposal

Define `DisclosureCapability v1.1` with explicit retrieval, internal-context,
card, and raw disclosure states. `CARD_DISCLOSABLE` requires active lifecycle,
valid projection, allowed scope, acceptable risk, and
`safe_to_disclose=true`. Canonical Memory remains the semantic authority;
capability is a derived policy state owned by admissibility/capability
calculation; and the selector remains a presentation decision that cannot
upgrade capability.

`safe_to_disclose=false` does not automatically deny retrieval. A sensitive or
unsafe candidate that remains usable for authorized internal context maps to
`INTERNAL_CONTEXT`; a blocked or unusable candidate maps to
`RETRIEVAL_ONLY`.

Future evaluation will label expected capability separately from expected
disclosure. A four-stage migration keeps this contract update
documentation-only, then permits an offline evaluator update and shadow
re-evaluation, and requires explicit authorization before any runtime
integration.

## Non-goals

- No source implementation, selector change, admissibility change, evaluator
  change, fixture change, or Canonical Memory/projection change.
- No AutoRecall, hook, Hybrid, retrieval, ranking, configuration, database,
  data, Gateway, deployment, or runtime behavior change.
- No raw disclosure enablement. `RAW_DISCLOSABLE` remains reserved and raw
  access remains disabled by default.
- No prompt intent, `task_intent`, `recall_intent`, or semantic classifier
  authority over disclosure capability.

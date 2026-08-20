## Phase D.2-C.10 implementation boundary

This change refines the pure offline evaluator to implement
`DisclosureCapability v1.1`. The frozen v2 fixture is not executed in this
change; no runtime adoption occurs.

## Current and shadow flows

The current path is measured without changing existing behavior:

`Candidate -> existing admissibility -> existing selector -> disclosure result`

The shadow path is conceptual and side-by-side:

`Candidate -> capability calculation -> capability state -> existing selector -> disclosure result`

The capability-constrained path must preserve the existing selector as the
presentation mechanism. It may only make a candidate eligible for the
presentation level allowed by its capability; it must not ask the selector to
invent or upgrade capability.

## Capability reference

The shadow contract reuses the states defined by the
`disclosure-capability-contract` change:

- `RETRIEVAL_ONLY`
- `INTERNAL_CONTEXT`
- `CARD_DISCLOSABLE`
- `RAW_DISCLOSABLE` (reserved and disabled by default)

The selector MUST NOT upgrade capability. In particular,
`INTERNAL_CONTEXT -> CARD_DISCLOSABLE` is forbidden. Retrieval evidence,
missing evidence, and selector convenience are not capability authority.

`CARD_DISCLOSABLE` requires active lifecycle, valid projection, allowed scope,
acceptable risk, and `safe_to_disclose=true`. The v2 evaluation envelope
stores `safe_to_disclose` in the bounded candidate label; the shadow-only
adapter supplies that predicate to capability calculation without changing
the envelope schema, fixture, or production selector.

The v1.1 shadow mapping is:

- blocked or unusable input -> `RETRIEVAL_ONLY`;
- unsafe but internally usable input, including `safe_to_disclose=false` ->
  `INTERNAL_CONTEXT`;
- all v1.1 card predicates satisfied -> `CARD_DISCLOSABLE`;
- `RAW_DISCLOSABLE` is never emitted.

Each result carries a bounded `capability_reason`. Supported denial reasons
include `unsafe_disclosure`, `unsafe_artifact`, `invalid_projection`,
`blocked_lifecycle`, `scope_denied`, and
`safe_disclosure_not_authorized`.

## Shadow result contract

Each candidate-level result is bounded to:

- `candidate_id`;
- `expected_capability`;
- `predicted_capability`;
- `current_disclosure`;
- `shadow_disclosure`;
- `expected_disclosure`.
- `capability_reason`.

Diagnostics must use identifiers, families, and bounded reasons only. Prompt
bodies, canonical memory bodies, raw content, and evidence excerpts are not
part of the result contract.

## Metrics contract

The future offline report compares current and shadow outcomes separately.

### Safety

`unsafe_card_disclosure_count` is reported for each path. The target is `0`.
Raw/full-content surfaces are unauthorized and remain a hard safety failure.

### Capability

`capability_accuracy` compares `predicted_capability` with
`expected_capability`. Subtype mismatches must remain distinguishable from
boolean disclosure errors.

### Preservation

`answer_bearing_disclosure_recall` is reported for current and shadow paths.
The comparison must show whether a capability constraint removes useful
answer-bearing disclosure.

### Utility

Each path reports `selected_cards`, `withheld_cards`,
`irrelevant_disclosures`, and `reduction_rate`.

The report also includes `capability_denial_breakdown`, counting bounded
capability reasons for candidates that are not `CARD_DISCLOSABLE`.

## Phase D.2-C.10 implementation note

`lib/recall/disclosure/disclosure-capability-shadow-evaluator.js` provides the
pure offline v1.1 implementation and
`test/recall-disclosure/disclosure-capability-shadow-evaluator.test.js` covers
synthetic candidates only. A candidate with a valid active safe context and
`safe_to_disclose=true` is predicted `CARD_DISCLOSABLE`; blocked artifacts,
invalid projections, blocked lifecycle/scope, and unsafe risk flags are
predicted `RETRIEVAL_ONLY`; explicitly sensitive context or
`safe_to_disclose=false` is predicted `INTERNAL_CONTEXT` when it remains
internally usable. `RAW_DISCLOSABLE` is never emitted.

The existing v2 fixture has no `expected_capability` label. The evaluator
therefore treats `CARD` labels as the minimum card expectation and leaves
`NONE` capability expectations unspecified; it does not rewrite or extend the
fixture. No v2 fixture execution or metrics run is part of this implementation.

## Evidence and authority boundary

The report role is `offline_shadow_evaluation`. It MUST NOT claim
`independent_holdout_evidence`, production readiness, runtime authorization,
or selector adoption. The frozen v2 fixture is a synthetic evaluation
boundary, not production traffic evidence.

## Migration stages

### Stage 1 — Contract only

Define the capability states and this side-by-side shadow result/metric
contract. This stage is documentation-only and is complete only as a design
specification.

### Stage 2 — Offline shadow evaluator

Under a separate implementation decision, construct capability-qualified
shadow inputs, run the existing selector side-by-side with current behavior,
and report bounded metrics. Do not mutate fixtures, tune the selector to the
fixture, or infer runtime authority from the report.

### Stage 3 — Runtime integration after explicit authorization

Only a separately authorized product stage may implement capability
calculation and connect it to admissibility, projection, or selector flow.
AutoRecall, runtime configuration, raw access, and deployment remain
unchanged until that authorization exists.

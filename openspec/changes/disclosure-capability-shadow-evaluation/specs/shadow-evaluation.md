## ADDED Requirements

### Requirement: Shadow evaluation compares current and capability-constrained paths

The shadow contract MUST compare current disclosure behavior with a
capability-constrained path while preserving the existing selector as the
presentation step. The shadow path MUST calculate a capability state before
the selector decision.

#### Scenario: Current and shadow results remain distinguishable

- **WHEN** a candidate is evaluated
- **THEN** the result records separate current and shadow disclosure outcomes

### Requirement: Shadow capability uses the Disclosure Capability Contract

The shadow path MUST use only `RETRIEVAL_ONLY`, `INTERNAL_CONTEXT`,
`CARD_DISCLOSABLE`, and reserved `RAW_DISCLOSABLE` states from the Disclosure
Capability Contract. The selector MUST NOT upgrade a capability.

#### Scenario: Internal context cannot become card disclosure

- **WHEN** predicted capability is `INTERNAL_CONTEXT`
- **THEN** the shadow path MUST NOT report `CARD_DISCLOSABLE` authority merely
  because the selector can produce a card

### Requirement: Shadow results use a bounded candidate-level schema

Each result MUST contain `candidate_id`, `expected_capability`,
`predicted_capability`, `current_disclosure`, `shadow_disclosure`, and
`expected_disclosure`. Diagnostics MUST NOT contain prompt or memory bodies.

#### Scenario: Result contains no content excerpts

- **WHEN** a shadow result is emitted
- **THEN** it contains identifiers and bounded reasons only, not raw content

### Requirement: Shadow metrics report safety, capability, preservation, and utility

The offline contract MUST report unsafe card disclosure, capability accuracy,
answer-bearing disclosure recall, selected cards, withheld cards, irrelevant
disclosures, and reduction rate for current and shadow paths. The target for
`unsafe_card_disclosure_count` MUST be zero.

#### Scenario: Safety is a hard observation

- **WHEN** either path discloses a card labeled unsafe
- **THEN** `unsafe_card_disclosure_count` is positive for that path

### Requirement: Shadow evidence has no runtime authority

The report MUST use `evidence_role=offline_shadow_evaluation` and MUST NOT
claim independent holdout evidence, production readiness, or runtime
authorization. The frozen v2 fixture MUST remain unchanged.

#### Scenario: Offline shadow output does not enable production

- **WHEN** a shadow evaluation is later executed
- **THEN** it remains offline evidence and does not mutate source, fixture,
  runtime policy, configuration, database, or data

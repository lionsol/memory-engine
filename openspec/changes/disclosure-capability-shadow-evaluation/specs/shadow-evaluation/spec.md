## ADDED Requirements

### Requirement: Shadow capability enforces Disclosure Capability v1.1

The shadow evaluator MUST require active lifecycle, valid projection, allowed
scope, acceptable risk, and `safe_to_disclose=true` before predicting
`CARD_DISCLOSABLE`. A candidate that is unsafe but remains internally usable
MUST be predicted as `INTERNAL_CONTEXT`; blocked or unusable candidates MUST
be predicted as `RETRIEVAL_ONLY`. `RAW_DISCLOSABLE` MUST never be emitted.

#### Scenario: Safe predicate controls card authority

- **WHEN** `safe_to_disclose=false` on an otherwise valid candidate
- **THEN** the shadow path withholds the card and does not predict
  `CARD_DISCLOSABLE`

### Requirement: Shadow results expose bounded capability denial reasons

Each shadow result MUST expose a bounded capability reason, and aggregate
metrics MUST include a capability denial breakdown. Reasons MUST remain
category enums such as `unsafe_disclosure`, `invalid_projection`,
`blocked_lifecycle`, and `scope_denied`; they MUST NOT include prompt or
memory content.

#### Scenario: Denial breakdown remains bounded

- **WHEN** multiple candidates receive non-card capability states
- **THEN** the aggregate counts their bounded reasons without exposing content

### Requirement: Shadow evaluation is not independent readiness evidence

The shadow contract MUST label its evidence role as
`offline_shadow_evaluation` and MUST NOT label the frozen v2 fixture result as
`independent_holdout_evidence`.

#### Scenario: Capability comparison remains experimental

- **WHEN** current and shadow metrics are compared
- **THEN** the comparison remains offline evidence and does not authorize
  runtime adoption

### Requirement: Fixture identity is immutable during shadow evaluation

The frozen v2 fixture MUST remain byte-identical, with no relabeling or schema
change, before and after any future shadow evaluation.

#### Scenario: Fixture is consumed read-only

- **WHEN** a future offline shadow evaluator reads the v2 fixture
- **THEN** it does not rewrite or extend the fixture

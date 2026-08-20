## ADDED Requirements

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

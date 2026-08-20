## ADDED Requirements

### Requirement: Candidate-level holdout is frozen before evaluation

The v1 holdout MUST validate fixed row schema, identity uniqueness, family
balance, and disclosure-label consistency without importing or executing the
selector or evaluator.

#### Scenario: Freeze-only validation

- **WHEN** the holdout fixture test runs
- **THEN** it checks static contract and immutability only, with no disclosure
  decision evaluation

### Requirement: The holdout is not runtime authority

The frozen fixture MUST be marked `future_independent_holdout` and MUST NOT be
represented as production readiness, runtime enablement, or selector quality
validation.

#### Scenario: Unevaluated fixture remains offline-only

- **WHEN** the fixture is committed
- **THEN** runtime behavior, configuration, database, and data remain
  unchanged

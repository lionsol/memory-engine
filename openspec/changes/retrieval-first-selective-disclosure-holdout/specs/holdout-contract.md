## ADDED Requirements

### Requirement: Holdout rows use a fixed candidate-level schema

Each Candidate Disclosure Holdout Row v1 MUST contain schema version `1`, the
fixed dataset ID, turn/family/query metadata, candidates, high label
confidence, and the fixed holdout annotator. Each candidate MUST contain a
unique-in-row ID, retrieval rank/sources/final score, and the three disclosure
label fields.

#### Scenario: Valid holdout row is accepted

- **WHEN** a row satisfies the fixed schema and value constraints
- **THEN** static validation returns `valid: true` with no diagnostics

#### Scenario: Invalid row is rejected

- **WHEN** a required field, boolean, enum, dataset identity, or label
  consistency rule is invalid
- **THEN** static validation returns `valid: false` with bounded code/path
  diagnostics

### Requirement: The frozen fixture has balanced family coverage

The holdout fixture MUST contain 48 rows across the twelve named families,
four rows per family, with exactly two rows containing answer-bearing
candidates and two rows containing only non-answer-bearing candidates in each
family. Turn IDs MUST be unique and candidate IDs MUST be unique within a row.

#### Scenario: Balanced fixture is accepted

- **WHEN** the 48-row fixture has the required family and identity balance
- **THEN** the fixture validator returns `valid: true`

### Requirement: Freeze phase performs no evaluation

The fixture validator and freeze tests MUST NOT invoke the disclosure selector
or candidate disclosure evaluator. The fixture MUST be marked with evidence
role `future_independent_holdout`, while readiness evidence remains false.

#### Scenario: Fresh fixture remains unevaluated

- **WHEN** the freeze tests run
- **THEN** they only parse and validate schema/shape/immutability and do not
  produce selector-quality or readiness results

### Requirement: Freeze has no runtime authority

The holdout contract MUST NOT modify production selector behavior, runtime
hooks, retrieval, configuration, databases, or data. It MUST NOT be described
as production ready or runtime enabled.

#### Scenario: Static-only change has no production flow

- **WHEN** the holdout module and fixture are added
- **THEN** no production caller or runtime flow is introduced

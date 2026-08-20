## ADDED Requirements

### Requirement: Evaluation envelope v2 closes the admissibility input boundary

Each v2 candidate MUST include canonical lifecycle, scope, risk, artifact, and
projection context alongside retrieval evidence and a separate disclosure
label. A pure adapter MAY construct the existing Recall Candidate Envelope,
but MUST NOT execute selector or evaluator logic.

#### Scenario: Static v2 contract validation

- **WHEN** the v2 fixture is parsed
- **THEN** schema, identity, context, and label validation succeeds without
  selector execution

### Requirement: The v2 fixture is not evaluated in D.1

The v2 fixture MUST remain a future evaluation contract only. It MUST NOT be
represented as selector quality, production readiness, or runtime authority.

#### Scenario: D.1 remains source/offline contract work

- **WHEN** D.1 tests run
- **THEN** no v2 selector/evaluator result or runtime mutation is produced

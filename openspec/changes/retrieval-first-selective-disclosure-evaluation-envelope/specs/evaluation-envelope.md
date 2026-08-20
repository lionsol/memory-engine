## ADDED Requirements

### Requirement: v2 rows contain canonical evaluation context

Candidate Disclosure Evaluation Envelope v2 MUST use schema version `2` and
include dataset/turn/family/query metadata, candidates, high label confidence,
and the v2 annotator. Every candidate MUST contain `candidate_id`,
`canonical_context`, `retrieval`, and `label`.

#### Scenario: Valid v2 row is accepted

- **WHEN** a row contains all v2 fields with valid lifecycle, scope, risk,
  artifact, projection, retrieval, and label values
- **THEN** validation returns `valid: true` with no diagnostics

#### Scenario: Missing canonical context is rejected

- **WHEN** a candidate omits `canonical_context`
- **THEN** validation returns `valid: false` with a bounded required-field
  diagnostic

### Requirement: Canonical context reproduces admissibility inputs

The v2 context MUST contain lifecycle state/flags, scope, risk flags,
artifact state, and projection validity. Invalid lifecycle or context values
MUST be rejected before any future evaluation.

#### Scenario: Invalid lifecycle is rejected

- **WHEN** lifecycle state is outside the bounded lifecycle contract
- **THEN** validation returns `valid: false` with an `invalid_lifecycle`
  diagnostic

### Requirement: Labels remain evaluation-only

Labels MUST contain boolean `answer_bearing` and `safe_to_disclose` values and
`expected_disclosure` in `NONE|CARD`. The safe/disclosure relationship MUST be
consistent. Labels MUST NOT be copied into the production Recall Candidate
Envelope.

#### Scenario: Inconsistent disclosure label is rejected

- **WHEN** `safe_to_disclose: false` is paired with `expected_disclosure: CARD`
- **THEN** validation returns `valid: false`

### Requirement: v2 adapter is pure and offline-only

The adapter MUST construct the existing Recall Candidate Envelope from
canonical context and retrieval evidence without calling the selector,
evaluator, database, network, LLM, or runtime hook.

#### Scenario: Envelope construction has no policy execution

- **WHEN** a valid v2 candidate is adapted
- **THEN** the result contains an existing envelope plus the separate label,
  and no disclosure decision is produced

### Requirement: v1 and v2 remain separate

The v1 holdout MUST remain unchanged as a historical record. The v2 fixture
MUST contain 48 rows across the twelve preserved families and MUST remain
unevaluated in Phase D.1.

#### Scenario: Historical v1 fixture remains intact

- **WHEN** v1 and v2 fixture hashes are checked
- **THEN** v1 retains its prior hash and v2 is validated independently

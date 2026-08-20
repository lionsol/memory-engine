## ADDED Requirements

### Requirement: Candidate-level disclosure evaluation is offline-only

Candidate Disclosure Evaluation Row v1 MUST validate fixed schema and
candidate labels, and the evaluator MUST report safety, preservation, and
utility metrics from supplied selector output without retrieval, intent
classification, persistence, network, LLM, or runtime-hook access.

#### Scenario: Offline selector output is measured

- **WHEN** a valid frozen row set and selector decisions are supplied
- **THEN** the evaluator returns bounded metrics and no persistent side effect

### Requirement: Safety gates reject unsafe disclosure

`unsafe_disclosure_count` and `unauthorized_full_content_count` MUST both be
zero for the hard safety gate to pass.

#### Scenario: Unsafe output is rejected

- **WHEN** a non-safe candidate is returned as `DISCLOSE_CARD` or full content
  is returned
- **THEN** the corresponding count is positive and the hard safety gate fails

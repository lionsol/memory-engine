## ADDED Requirements

### Requirement: Candidate disclosure rows use a fixed v1 schema

The evaluator MUST accept only rows with schema version `1`, required turn
metadata, a candidate array, `label_confidence: high`, and
`annotator: retrieval_disclosure_planner_v1`. Each candidate MUST contain
`candidate_id`, retrieval `rank`, `sources`, `final_score`, and the three
disclosure label fields.

#### Scenario: Valid row is accepted

- **WHEN** a row satisfies the v1 fields and enum/boolean constraints
- **THEN** validation returns `valid: true` with no diagnostics

#### Scenario: Invalid row is rejected with bounded diagnostics

- **WHEN** a required field, enum, boolean, or fixed metadata value is invalid
- **THEN** validation returns `valid: false` and diagnostics containing only
  bounded code/path entries

### Requirement: Evaluation is candidate-level and offline

The evaluator MUST consume frozen candidate rows and already-produced selector
output. It MUST NOT call retrieval, prompt intent classification,
`should_recall`, a database, a network, an LLM, or a runtime hook.

#### Scenario: Selector output is evaluated without retrieval

- **WHEN** selector decisions are supplied for candidate IDs
- **THEN** the evaluator reports candidate-level disclosure metrics without
  executing retrieval or changing any persistent state

### Requirement: Unsafe and full-content disclosure are hard failures

The evaluator MUST count a `DISCLOSE_CARD` decision for a label with
`safe_to_disclose: false` as unsafe, and MUST count raw/full-content selector
surfaces as unauthorized. Both counts MUST be zero for the hard safety gate to
pass.

#### Scenario: Unsafe card fails the gate

- **WHEN** an unsafe candidate is selected as `DISCLOSE_CARD`
- **THEN** `unsafe_disclosure_count` increases and the hard safety gate fails

#### Scenario: Full content fails the gate

- **WHEN** selector output contains a raw/full-content decision or body field
- **THEN** `unauthorized_full_content_count` increases and the hard safety gate
  fails

### Requirement: Evaluation reports preservation and utility

The report MUST include answer-bearing totals/disclosure recall, candidate
pool size, selected card count, withheld count, irrelevant disclosure count,
and disclosure reduction rate, plus bounded diagnostics keyed by turn and
family.

#### Scenario: Answer-bearing recall is measurable

- **WHEN** an answer-bearing candidate is selected as a card
- **THEN** the report increments disclosed answer-bearing count and computes
  disclosure recall

### Requirement: Synthetic fixture is not readiness evidence

The Phase B fixture MUST contain 48 rows across the twelve named families,
with two answer-bearing and two non-answer-bearing rows per family. The
report MUST identify the fixture as synthetic and set independent readiness
evidence to false.

#### Scenario: Synthetic evaluation remains offline-only

- **WHEN** the fixed fixture is evaluated
- **THEN** the report states `OFFLINE ONLY / NOT RUNTIME AUTHORIZED` and does
  not claim production readiness

## Phase C freeze boundary

The holdout evaluation unit is:

`turn + candidate pool + human disclosure labels`

It does not evaluate prompt intent, task intent, recall intent, or
`should_recall`. This phase only creates and statically validates the rows.

## Row schema

Each row uses schema version `1` and the fixed dataset identity
`retrieval-disclosure-holdout-v1`. Required row metadata is `turn_id`,
`family`, `query`, `candidates`, `label_confidence: high`, and
`annotator: retrieval_disclosure_holdout_v1`.

Each candidate carries a unique-in-row `candidate_id`, retrieval evidence
(`rank`, `sources`, `final_score`), and labels
`answer_bearing`, `safe_to_disclose`, and `expected_disclosure`.
Expected disclosure is restricted to `NONE` and `CARD`; the safe-to-disclose
boolean must agree with that value.

## Fixture contract

The fixture has 48 rows, twelve fixed families, four rows per family, and a
two answer-bearing/two non-answer-bearing balance within every family. Turn
IDs are unique across the fixture, candidate IDs are unique within each row,
and all rows share one dataset identity.

The validator returns bounded `{code, path}` diagnostics. The freeze test
also records the fixture SHA-256 so accidental edits are detected after the
freeze commit.

## Evidence boundary

The fixture has evidence role `future_independent_holdout`. This is a
provenance marker only. No selector or evaluator is called by the validator or
freeze tests, and the fixture is explicitly not readiness evidence until a
separate authorized offline evaluation stage.

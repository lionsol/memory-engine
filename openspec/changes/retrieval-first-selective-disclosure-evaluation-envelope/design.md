## Phase D.1 boundary

The v2 evaluation row contains the same candidate inputs needed to construct a
Recall Candidate Envelope: canonical context, retrieval evidence, and the
evaluation-only disclosure label. The adapter produces the existing envelope
and keeps the label outside that production object. It does not call the
selector or evaluator.

## Canonical context

`canonical_context` is bounded and explicit:

- `lifecycle` records the lifecycle state and blocking flags;
- `scope` records scope and agent scope;
- `risk_flags` records disclosure risk flags;
- `artifact_state` is one of `safe`, `raw_log`, `tool_output`, `dreaming`,
  `diagnostic`, or `unsafe`;
- `projection_valid` records whether the projected card is valid.

The adapter maps these facts to the existing canonical/card projection. A
false `projection_valid` value is represented as an invalid card projection in
the adapter output, while labels remain evaluation metadata and are never
added to the production envelope.

## v2 fixture

The v2 fixture uses dataset ID `retrieval-disclosure-holdout-v2`, schema
version `2`, and annotator `retrieval_disclosure_holdout_v2`. It contains 48
rows across the same twelve families, four rows per family, with two
answer-bearing and two non-answer-bearing rows per family. The v1 fixture is a
historical record and remains byte-identical.

## Evidence boundary

This phase closes the input contract only. The v2 fixture is not evaluated,
does not produce selector-quality metrics, and does not authorize any runtime
or production policy change.

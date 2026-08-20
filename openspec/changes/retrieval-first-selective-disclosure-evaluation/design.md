## Phase B boundary

The evaluation unit is:

`turn + retrieved candidate pool + candidate labels -> expected disclosure`

The evaluator consumes already-produced selector output. It does not call
retrieval, classify the query, infer `should_recall`, or access a database.
This preserves the separation:

`retrieval != disclosure`

## Row contract

Each row uses schema version `1`, a turn and family identity, a bounded query
label, a candidate array, and the fixed planner metadata. Every candidate has
retrieval evidence (`rank`, `sources`, `final_score`) and a label containing
`answer_bearing`, `safe_to_disclose`, and `expected_disclosure`.

`expected_disclosure` is limited to `NONE` and `CARD`. A safe candidate must
expect `CARD`; an unsafe candidate must expect `NONE`. The validator rejects
unknown fields and returns only bounded `{code, path}` diagnostics.

## Evaluation contract

The evaluator aligns selector output to candidate IDs and treats omitted
decisions as withheld. It reports:

- hard safety: unsafe card disclosures and unauthorized full-content output;
- preservation: answer-bearing population, disclosed count, and disclosure
  recall;
- utility: pool size, selected cards, withheld candidates, irrelevant
  disclosures, and disclosure reduction.

The hard safety gate is true only when the row/selector contract is valid and
both safety failure counts are zero. The report identifies itself as offline
only and explicitly marks the synthetic fixture as not independent readiness
evidence.

## Data and authority boundary

The 48-row fixture is synthetic, with 12 families and a 2/2 answer-bearing
balance per family. It is a regression/evaluation artifact, not a production
traffic sample or an authorization signal. The new module has no runtime
caller; future use must remain an explicit offline evaluator invocation.

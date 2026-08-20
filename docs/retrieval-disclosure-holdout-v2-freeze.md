# Retrieval-first Selective Disclosure v2 Holdout Freeze

## Freeze status

`FROZEN / NOT EVALUATED`

This record establishes the immutable boundary for the future independent
candidate-level evaluation. It records fixture identity and static shape only;
it is not an evaluation result and does not authorize runtime disclosure
policy.

| Field | Value |
| --- | --- |
| dataset_id | `retrieval-disclosure-holdout-v2` |
| schema_version | `2` |
| fixture | `test/fixtures/retrieval-disclosure-holdout.v2.jsonl` |
| fixture_sha256 | `d372ebac9bf4d80aaac85dfb0d43eacec792291871b744b7812009ac06d071bd` |
| row_count | `48` |
| family_count | `12` |
| candidate_count | `48` |
| answer_bearing_count | `24` |
| annotator | `retrieval_disclosure_holdout_v2` |
| evidence_role | `future_independent_holdout` |
| evaluated | `false` |
| runtime_authorized | `false` |
| freeze_commit | this freeze commit; exact hash is reported in the closeout |

The Phase C v1 fixture remains a separate historical record:

- fixture: `test/fixtures/retrieval-disclosure-holdout.v1.jsonl`
- SHA256: `7b9a1ced3c78584f9b746e63a03a90d9ba3f9bda58a3b72986a7f89bf9df055a`
- role: `historical_record`

No selector or evaluator was executed against the v2 fixture while establishing
this boundary. No metrics were generated, and no runtime, configuration,
database, or data mutation was performed.

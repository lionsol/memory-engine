# REDACTED_CARD Holdout v1 Freeze

| Field | Value |
| --- | --- |
| dataset_id | `redacted-card-holdout-v1` |
| schema_version | `1` |
| fixture | `test/fixtures/redacted-card-holdout.v1.jsonl` |
| fixture_sha256 | `55d1d876b111bc7e3dcc7dcadb6761721cb6b05568edc27cc0ff1d81de5a5d48` |
| row_count | `12` |
| family_count | `6` |
| rows_per_family | `2` |
| answer_bearing_per_family | `1` |
| non_answer_bearing_per_family | `1` |
| annotator | `redacted_card_holdout_v1_synthetic` |

## Boundary

`D.3-C.6 = INDEPENDENT REDACTED_CARD HOLDOUT FROZEN / NOT YET EVALUATED`

Evidence role: `fresh_post_prototype_holdout_contract`

The REDACTED_CARD prototype implementation was completed before this fixture.
The C.1 holdout was not reused, and C.5 unit literals were not reused. The
fixture stores acceptance constraints, not expected output. It contains
independent projection inputs, explicit redaction plans, and surface/semantic
constraints; it stores no expected candidate payload, rewritten field, full
projected artifact, replacement output, capability expectation, or
disclosure-authority expectation.

No evaluation execution occurred. This record authorizes no C.7 evaluator,
capability change, selector change, production integration, runtime operation,
configuration change, DB write, or data mutation.

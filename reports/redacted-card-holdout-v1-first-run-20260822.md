# REDACTED_CARD Holdout v1 First Run

## Execution authority

- Phase: `D.3-C.8`
- Execution HEAD: `b4ce5980f2e2b26962ac1bc9daa5fbc9c056edc6`
- Execution commit: `test(recall): add independent redacted card evaluator`
- Worktree before execution: clean
- Formal execution count: `1`
- Input: `test/fixtures/redacted-card-holdout.v1.jsonl`
- Evidence status: `ONE-SHOT FIRST-RUN EVIDENCE RECORDED / AWAITING PLANNER ADJUDICATION`

The C.6 fixture was evaluated exactly once through
`evaluateRedactedCardFixture(rows)`. No warmup, sample, partial, family-by-family,
retry, or second evaluation was run.

## Immutable inputs

| Input | SHA-256 |
| --- | --- |
| C.6 fixture | `55d1d876b111bc7e3dcc7dcadb6761721cb6b05568edc27cc0ff1d81de5a5d48` |
| REDACTED_CARD prototype | `213b2aa2c0e87028fccb395b0317ec5cf817e00939be94f2bc63c9b28dcd578c` |
| REDACTED_CARD evaluator | `1c04e520ef9fa1338221063779fac080dc7e347878c16400c6ed0559778fbdf4` |
| C.6 holdout validator | `9c51cf45c6b7b6f0ec7c796ce2f5fc0fba5282f56144a5be2082a0684d0d3a0a` |
| D.3 C.1 fixture | `cd0af809fc1e774dd9d782d5a9c20fa231f5a406f62006c4f7a6a66a0747d919` |
| D.2 fixture | `d372ebac9bf4d80aaac85dfb0d43eacec792291871b744b7812009ac06d071bd` |

No source, evaluator, validator, or fixture tuning occurred before or after
the execution.

## Aggregate result

- `mode`: `offline_redacted_card_evaluation_v1`
- `runtime_authorized`: `false`
- `case_count`: `12`
- `transform_success_count`: `12`
- `transform_failure_count`: `0`
- `structural_compatibility_match_count`: `12`
- `structural_compatibility_match_rate`: `1`
- `surface_safe_count`: `12`
- `surface_unsafe_count`: `0`
- `answer_bearing_total`: `6`
- `answer_bearing_semantic_preserved`: `6`
- `semantic_preservation_rate`: `1`
- `protected_fields_preserved_count`: `12`
- `no_unplanned_field_drift_count`: `12`
- `useful_redacted_projection_count`: `6`
- `useful_redacted_projection_rate`: `1`

These are bounded offline measurements only. No production PASS/FAIL,
readiness, or capability decision is assigned here.

## Family breakdown

| Family | Cases | Answer-bearing | Transform success | Surface safe | Semantic preserved | Protected preserved | No drift | Useful |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `summary_single` | 2 | 1 | 2 | 2 | 1 | 2 | 2 | 1 |
| `summary_multiple_occurrences` | 2 | 1 | 2 | 2 | 1 | 2 | 2 | 1 |
| `title_summary_multi_field` | 2 | 1 | 2 | 2 | 1 | 2 | 2 | 1 |
| `salience_reason` | 2 | 1 | 2 | 2 | 1 | 2 | 2 | 1 |
| `source_hint_path` | 2 | 1 | 2 | 2 | 1 | 2 | 2 | 1 |
| `risk_metadata_preservation` | 2 | 1 | 2 | 2 | 1 | 2 | 2 | 1 |

## Case results

All fields below are bounded evaluator output. No canonical source body,
runtime body, candidate payload, or baseline payload is recorded.

### `summary-single-01`

- family: `summary_single`; answer_bearing: `true`
- transform_success: `true`; transform_reason: `valid`
- structural_compatibility_matches_expected: `true`
- forbidden_literals_present: `[]`; actual_surface_safe: `true`
- required_literals_missing: `[]`; actual_semantic_preserved: `true`
- protected_field_mismatches: `[]`; protected_fields_preserved: `true`
- unplanned_drift_fields: `[]`; no_unplanned_field_drift: `true`
- useful_redacted_projection: `true`
- redaction_evidence: directive `1`, applied `1`, occurrences `1`, fields `summary`

### `summary-single-02`

- family: `summary_single`; answer_bearing: `false`
- transform_success: `true`; transform_reason: `valid`
- structural_compatibility_matches_expected: `true`
- forbidden_literals_present: `[]`; actual_surface_safe: `true`
- required_literals_missing: `null`; actual_semantic_preserved: `null`
- protected_field_mismatches: `[]`; protected_fields_preserved: `true`
- unplanned_drift_fields: `[]`; no_unplanned_field_drift: `true`
- useful_redacted_projection: `false`
- redaction_evidence: directive `1`, applied `1`, occurrences `1`, fields `summary`

### `summary-multiple-occurrences-01`

- family: `summary_multiple_occurrences`; answer_bearing: `true`
- transform_success: `true`; transform_reason: `valid`
- structural_compatibility_matches_expected: `true`
- forbidden_literals_present: `[]`; actual_surface_safe: `true`
- required_literals_missing: `[]`; actual_semantic_preserved: `true`
- protected_field_mismatches: `[]`; protected_fields_preserved: `true`
- unplanned_drift_fields: `[]`; no_unplanned_field_drift: `true`
- useful_redacted_projection: `true`
- redaction_evidence: directive `1`, applied `1`, occurrences `2`, fields `summary`

### `summary-multiple-occurrences-02`

- family: `summary_multiple_occurrences`; answer_bearing: `false`
- transform_success: `true`; transform_reason: `valid`
- structural_compatibility_matches_expected: `true`
- forbidden_literals_present: `[]`; actual_surface_safe: `true`
- required_literals_missing: `null`; actual_semantic_preserved: `null`
- protected_field_mismatches: `[]`; protected_fields_preserved: `true`
- unplanned_drift_fields: `[]`; no_unplanned_field_drift: `true`
- useful_redacted_projection: `false`
- redaction_evidence: directive `1`, applied `1`, occurrences `2`, fields `summary`

### `title-summary-multi-field-01`

- family: `title_summary_multi_field`; answer_bearing: `true`
- transform_success: `true`; transform_reason: `valid`
- structural_compatibility_matches_expected: `true`
- forbidden_literals_present: `[]`; actual_surface_safe: `true`
- required_literals_missing: `[]`; actual_semantic_preserved: `true`
- protected_field_mismatches: `[]`; protected_fields_preserved: `true`
- unplanned_drift_fields: `[]`; no_unplanned_field_drift: `true`
- useful_redacted_projection: `true`
- redaction_evidence: directive `2`, applied `2`, occurrences `2`, fields `title`, `summary`

### `title-summary-multi-field-02`

- family: `title_summary_multi_field`; answer_bearing: `false`
- transform_success: `true`; transform_reason: `valid`
- structural_compatibility_matches_expected: `true`
- forbidden_literals_present: `[]`; actual_surface_safe: `true`
- required_literals_missing: `null`; actual_semantic_preserved: `null`
- protected_field_mismatches: `[]`; protected_fields_preserved: `true`
- unplanned_drift_fields: `[]`; no_unplanned_field_drift: `true`
- useful_redacted_projection: `false`
- redaction_evidence: directive `2`, applied `2`, occurrences `2`, fields `title`, `summary`

### `salience-reason-01`

- family: `salience_reason`; answer_bearing: `true`
- transform_success: `true`; transform_reason: `valid`
- structural_compatibility_matches_expected: `true`
- forbidden_literals_present: `[]`; actual_surface_safe: `true`
- required_literals_missing: `[]`; actual_semantic_preserved: `true`
- protected_field_mismatches: `[]`; protected_fields_preserved: `true`
- unplanned_drift_fields: `[]`; no_unplanned_field_drift: `true`
- useful_redacted_projection: `true`
- redaction_evidence: directive `1`, applied `1`, occurrences `1`, fields `salience_reason`

### `salience-reason-02`

- family: `salience_reason`; answer_bearing: `false`
- transform_success: `true`; transform_reason: `valid`
- structural_compatibility_matches_expected: `true`
- forbidden_literals_present: `[]`; actual_surface_safe: `true`
- required_literals_missing: `null`; actual_semantic_preserved: `null`
- protected_field_mismatches: `[]`; protected_fields_preserved: `true`
- unplanned_drift_fields: `[]`; no_unplanned_field_drift: `true`
- useful_redacted_projection: `false`
- redaction_evidence: directive `1`, applied `1`, occurrences `1`, fields `salience_reason`

### `source-hint-path-01`

- family: `source_hint_path`; answer_bearing: `true`
- transform_success: `true`; transform_reason: `valid`
- structural_compatibility_matches_expected: `true`
- forbidden_literals_present: `[]`; actual_surface_safe: `true`
- required_literals_missing: `[]`; actual_semantic_preserved: `true`
- protected_field_mismatches: `[]`; protected_fields_preserved: `true`
- unplanned_drift_fields: `[]`; no_unplanned_field_drift: `true`
- useful_redacted_projection: `true`
- redaction_evidence: directive `1`, applied `1`, occurrences `1`, fields `source_hint`

### `source-hint-path-02`

- family: `source_hint_path`; answer_bearing: `false`
- transform_success: `true`; transform_reason: `valid`
- structural_compatibility_matches_expected: `true`
- forbidden_literals_present: `[]`; actual_surface_safe: `true`
- required_literals_missing: `null`; actual_semantic_preserved: `null`
- protected_field_mismatches: `[]`; protected_fields_preserved: `true`
- unplanned_drift_fields: `[]`; no_unplanned_field_drift: `true`
- useful_redacted_projection: `false`
- redaction_evidence: directive `1`, applied `1`, occurrences `1`, fields `source_hint`

### `risk-metadata-preservation-01`

- family: `risk_metadata_preservation`; answer_bearing: `true`
- transform_success: `true`; transform_reason: `valid`
- structural_compatibility_matches_expected: `true`
- forbidden_literals_present: `[]`; actual_surface_safe: `true`
- required_literals_missing: `[]`; actual_semantic_preserved: `true`
- protected_field_mismatches: `[]`; protected_fields_preserved: `true`
- unplanned_drift_fields: `[]`; no_unplanned_field_drift: `true`
- useful_redacted_projection: `true`
- redaction_evidence: directive `1`, applied `1`, occurrences `1`, fields `summary`

### `risk-metadata-preservation-02`

- family: `risk_metadata_preservation`; answer_bearing: `false`
- transform_success: `true`; transform_reason: `valid`
- structural_compatibility_matches_expected: `true`
- forbidden_literals_present: `[]`; actual_surface_safe: `true`
- required_literals_missing: `null`; actual_semantic_preserved: `null`
- protected_field_mismatches: `[]`; protected_fields_preserved: `true`
- unplanned_drift_fields: `[]`; no_unplanned_field_drift: `true`
- useful_redacted_projection: `false`
- redaction_evidence: directive `1`, applied `1`, occurrences `1`, fields `summary`

## Evidence limitations

- This is `offline_redacted_card_evaluation_v1` representation evidence only.
- The evaluator does not calculate capability or disclosure authority.
- No production threshold, readiness decision, or implementation recommendation
  is assigned by this report.
- The result does not authorize projector, evaluator, fixture, capability,
  selector, runtime, configuration, or data changes.

## Mutation / runtime boundary

- C.6 fixture evaluated exactly once.
- No source/fixture tuning occurred before or after execution.
- `retrieval: false`
- `db_writes: false`
- `data_mutation: false`
- `selector: false`
- `capability: false`
- `network: false`
- `llm: false`
- `runtime: false`

## Status

`D.3-C.8 = ONE-SHOT FIRST-RUN EVIDENCE RECORDED / AWAITING PLANNER ADJUDICATION`

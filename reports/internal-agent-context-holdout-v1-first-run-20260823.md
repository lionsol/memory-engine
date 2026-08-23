# INTERNAL_AGENT_CONTEXT Holdout v1 — First-Run Evidence

**Status:** ONE-SHOT FIRST-RUN EVIDENCE RECORDED / AWAITING PLANNER ADJUDICATION

This report records the bounded result of the authorized offline first run. It
does not assign a PASS/FAIL threshold, production-readiness status, runtime
readiness, capability authorization, or final architecture interpretation.

## Execution authority and scope

- **Phase:** D.3-C.16
- **Execution HEAD:** `f5cae8c321e588e8ccd9a2844a2623aac0599255`
- **Execution commit:** `feat(recall): add internal agent context evaluator`
- **Worktree before execution:** clean
- **Formal execution count:** 1
- **Execution RC:** 0
- **Input:** `test/fixtures/internal-agent-context-holdout.v1.jsonl`
- **Evaluator:** `evaluateInternalAgentContextFixture(rows)`
- **Bounded result source:** `/tmp/memory-engine-c16-first-run.json`

The formal execution had no warmup, no sample run, no partial run, no
family-by-family run, and no retry. There was no second execution. The frozen
rows were not passed to `evaluateInternalAgentContextCase()` or
`evaluateInternalAgentContextCases()`.

## Immutable input evidence

| Input | SHA-256 |
| --- | --- |
| `test/fixtures/internal-agent-context-holdout.v1.jsonl` (C.14 fixture) | `bc0aaa7e5bca0cb7c77f057c56327250c90b48e652032782e1bdd279f8d11085` |
| `lib/recall/disclosure/internal-agent-context-holdout.js` (C.14 validator) | `13c94bcf01278336c7bdceb7d772dc3fe42f613960c3ebbcd75b5c6c08496635` |
| `lib/recall/disclosure/internal-agent-context-evaluator.js` (C.15 evaluator) | `584bc512bc4d78581b00a688c6aac4e7f45095462bd28668b57c08a8445d0671` |
| `lib/canonical/projection-artifact.js` (C.13 ProjectionArtifact) | `293d6862293c51ebacf8430b6cb1560b3105a312a66c57820909c5296ceee98a` |
| `test/fixtures/memory-projection-holdout.v1.jsonl` (C.1 fixture) | `cd0af809fc1e774dd9d782d5a9c20fa231f5a406f62006c4f7a6a66a0747d919` |
| `test/fixtures/redacted-card-holdout.v1.jsonl` (C.6 fixture) | `55d1d876b111bc7e3dcc7dcadb6761721cb6b05568edc27cc0ff1d81de5a5d48` |
| one-shot bounded result `/tmp/memory-engine-c16-first-run.json` | `7e7b7343a97da3b5c3d575665ec8dd1e5fbffb40d0d1e6109f85d7e8e2c8d6da` |

The post-execution SHA check matched the preflight values for the four
execution-critical source/fixture files. The execution-base diff
`git diff f5cae8c321e588e8ccd9a2844a2623aac0599255..HEAD -- lib test` was
empty.

## Aggregate result

The following values are extracted from the one-shot bounded JSON result as
measured; no result was manually improved or adjudicated.

| Metric | Measured value |
| --- | ---: |
| `mode` | `offline_internal_agent_context_evaluation_v1` |
| `runtime_authorized` | `false` |
| `capability_authorized` | `false` |
| `case_count` | `12` |
| `projection_success_count` | `12` |
| `projection_failure_count` | `0` |
| `projection_valid_count` | `12` |
| `projection_valid_rate` | `1` |
| `projection_validity_match_count` | `12` |
| `projection_validity_match_rate` | `1` |
| `boundedness_valid_count` | `12` |
| `boundedness_valid_rate` | `1` |
| `source_faithful_count` | `12` |
| `source_faithful_rate` | `1` |
| `answer_bearing_total` | `6` |
| `answer_bearing_semantic_preserved` | `6` |
| `semantic_preservation_rate` | `1` |
| `instruction_like_case_count` | `2` |
| `instruction_like_representation_valid_count` | `2` |
| `instruction_like_representation_valid_rate` | `1` |
| `data_only_marker_valid_count` | `12` |
| `data_only_marker_valid_rate` | `1` |
| `risk_metadata_preserved_count` | `12` |
| `risk_metadata_preserved_rate` | `1` |
| `provenance_preserved_count` | `12` |
| `provenance_preserved_rate` | `1` |
| `no_capability_authority_count` | `12` |
| `no_capability_authority_rate` | `1` |
| `source_full_selection_match_count` | `12` |
| `source_full_selection_match_rate` | `1` |
| `useful_internal_projection_count` | `6` |
| `useful_internal_projection_rate` | `1` |

## Family breakdown

All family values below are the evaluator's bounded counts.

| Family | cases | answer-bearing | projection_valid | boundedness_valid | source_faithful | semantic_preserved | instruction_data_representation_valid | risk_metadata_preserved | provenance_preserved | no_capability_authority | useful_internal_projection |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `raw_log_single` | 2 | 1 | 2 | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 1 |
| `tool_output_single` | 2 | 1 | 2 | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 1 |
| `multi_segment_operational` | 2 | 1 | 2 | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 1 |
| `instruction_like_evidence` | 2 | 1 | 2 | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 1 |
| `full_source_selection` | 2 | 1 | 2 | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 1 |
| `risk_metadata_preservation` | 2 | 1 | 2 | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 1 |

## Bounded case results

Only evaluator-returned bounded fields are recorded. No canonical source body,
segment text, full artifact, payload, selection body, or raw fixture row is
included.

### Projection and source checks

| case_id | family | answer_bearing | instruction_like_case | projection_success | projection_reason | actual_projection_valid | projection_valid_matches_expected | actual_boundedness_valid | actual_source_faithful |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| `IACH1_RAW_LOG_SINGLE_ANSWER` | `raw_log_single` | true | false | true | `valid` | true | true | true | true |
| `IACH1_RAW_LOG_SINGLE_NONANSWER` | `raw_log_single` | false | false | true | `valid` | true | true | true | true |
| `IACH1_TOOL_OUTPUT_SINGLE_ANSWER` | `tool_output_single` | true | false | true | `valid` | true | true | true | true |
| `IACH1_TOOL_OUTPUT_SINGLE_NONANSWER` | `tool_output_single` | false | false | true | `valid` | true | true | true | true |
| `IACH1_MULTI_SEGMENT_OPERATIONAL_ANSWER` | `multi_segment_operational` | true | false | true | `valid` | true | true | true | true |
| `IACH1_MULTI_SEGMENT_OPERATIONAL_NONANSWER` | `multi_segment_operational` | false | false | true | `valid` | true | true | true | true |
| `IACH1_INSTRUCTION_LIKE_ANSWER` | `instruction_like_evidence` | true | true | true | `valid` | true | true | true | true |
| `IACH1_INSTRUCTION_LIKE_NONANSWER` | `instruction_like_evidence` | false | true | true | `valid` | true | true | true | true |
| `IACH1_FULL_SOURCE_SELECTION_ANSWER` | `full_source_selection` | true | false | true | `valid` | true | true | true | true |
| `IACH1_FULL_SOURCE_SELECTION_NONANSWER` | `full_source_selection` | false | false | true | `valid` | true | true | true | true |
| `IACH1_RISK_METADATA_PRESERVATION_ANSWER` | `risk_metadata_preservation` | true | false | true | `valid` | true | true | true | true |
| `IACH1_RISK_METADATA_PRESERVATION_NONANSWER` | `risk_metadata_preservation` | false | false | true | `valid` | true | true | true | true |

### Semantic, representation, and risk checks

| case_id | required_literals_missing | actual_semantic_preserved | data_only_marker_valid | instruction_literals_missing | instruction_data_representation_valid | actual_risk_metadata_preserved |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| `IACH1_RAW_LOG_SINGLE_ANSWER` | `[]` | true | true | `[]` | true | true |
| `IACH1_RAW_LOG_SINGLE_NONANSWER` | `null` | null | true | `[]` | true | true |
| `IACH1_TOOL_OUTPUT_SINGLE_ANSWER` | `[]` | true | true | `[]` | true | true |
| `IACH1_TOOL_OUTPUT_SINGLE_NONANSWER` | `null` | null | true | `[]` | true | true |
| `IACH1_MULTI_SEGMENT_OPERATIONAL_ANSWER` | `[]` | true | true | `[]` | true | true |
| `IACH1_MULTI_SEGMENT_OPERATIONAL_NONANSWER` | `null` | null | true | `[]` | true | true |
| `IACH1_INSTRUCTION_LIKE_ANSWER` | `[]` | true | true | `[]` | true | true |
| `IACH1_INSTRUCTION_LIKE_NONANSWER` | `null` | null | true | `[]` | true | true |
| `IACH1_FULL_SOURCE_SELECTION_ANSWER` | `[]` | true | true | `[]` | true | true |
| `IACH1_FULL_SOURCE_SELECTION_NONANSWER` | `null` | null | true | `[]` | true | true |
| `IACH1_RISK_METADATA_PRESERVATION_ANSWER` | `[]` | true | true | `[]` | true | true |
| `IACH1_RISK_METADATA_PRESERVATION_NONANSWER` | `null` | null | true | `[]` | true | true |

### Identity, provenance, authority, and selection checks

| case_id | canonical_identity_preserved | projection_provenance_preserved | actual_provenance_preserved | authority_keys_present | no_capability_authority | actual_source_fully_selected | source_full_selection_matches_label | useful_internal_projection |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| `IACH1_RAW_LOG_SINGLE_ANSWER` | true | true | true | `[]` | true | false | true | true |
| `IACH1_RAW_LOG_SINGLE_NONANSWER` | true | true | true | `[]` | true | false | true | false |
| `IACH1_TOOL_OUTPUT_SINGLE_ANSWER` | true | true | true | `[]` | true | false | true | true |
| `IACH1_TOOL_OUTPUT_SINGLE_NONANSWER` | true | true | true | `[]` | true | false | true | false |
| `IACH1_MULTI_SEGMENT_OPERATIONAL_ANSWER` | true | true | true | `[]` | true | false | true | true |
| `IACH1_MULTI_SEGMENT_OPERATIONAL_NONANSWER` | true | true | true | `[]` | true | false | true | false |
| `IACH1_INSTRUCTION_LIKE_ANSWER` | true | true | true | `[]` | true | false | true | true |
| `IACH1_INSTRUCTION_LIKE_NONANSWER` | true | true | true | `[]` | true | false | true | false |
| `IACH1_FULL_SOURCE_SELECTION_ANSWER` | true | true | true | `[]` | true | true | true | true |
| `IACH1_FULL_SOURCE_SELECTION_NONANSWER` | true | true | true | `[]` | true | true | true | false |
| `IACH1_RISK_METADATA_PRESERVATION_ANSWER` | true | true | true | `[]` | true | false | true | true |
| `IACH1_RISK_METADATA_PRESERVATION_NONANSWER` | true | true | true | `[]` | true | false | true | false |

## Interpretation boundary

- `instruction_data_representation_valid` is representation-level evidence
  only. It cannot prove runtime prompt-injection isolation,
  system/developer/tool-channel isolation, or safe runtime injection.
- `useful_internal_projection` is a useful metric under the frozen offline
  representation constraints only. It cannot prove `INTERNAL_CONTEXT`
  capability, production eligibility, selector eligibility, or runtime
  readiness.
- `actual_source_fully_selected=true` is a representation fact and does not
  mean `RAW_DISCLOSABLE` or raw-access authority.
- `runtime_authorized=false` and `capability_authorized=false` remain the
  measured evaluator values. No capability, selector, runtime, or production
  authority is inferred from this report.

## Mutation and verification boundary

- Formal holdout execution was offline only.
- Runtime verification: NOT APPLICABLE.
- Runtime/config/DB/data mutation: NONE.
- Production source, fixture, evaluator, validator, projector,
  capability, and selector mutation: NONE.
- No C.17, D.3-D, or runtime stage was created by this run.

**Final status:** ONE-SHOT FIRST-RUN EVIDENCE RECORDED / AWAITING PLANNER
ADJUDICATION

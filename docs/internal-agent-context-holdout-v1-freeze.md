# INTERNAL_AGENT_CONTEXT Holdout v1 Freeze

Status: `INDEPENDENT INTERNAL_AGENT_CONTEXT HOLDOUT FROZEN / NOT YET EVALUATED`

| field | value |
| --- | --- |
| dataset_id | `internal-agent-context-holdout-v1` |
| schema_version | `1` |
| fixture | `test/fixtures/internal-agent-context-holdout.v1.jsonl` |
| fixture SHA256 | `bc0aaa7e5bca0cb7c77f057c56327250c90b48e652032782e1bdd279f8d11085` |
| row_count | `12` |
| family_count | `6` |
| rows_per_family | `2` |
| answer_bearing_per_family | `1` |
| non_answer_bearing_per_family | `1` |
| annotator | `internal_agent_context_holdout_v1_synthetic` |

Families:

- `raw_log_single`
- `tool_output_single`
- `multi_segment_operational`
- `instruction_like_evidence`
- `full_source_selection`
- `risk_metadata_preservation`

Evidence role: `fresh_post_c13_holdout_contract`.

C.13 implementation was completed before this fixture. C.13 unit literals were not reused. C.1/C.6 fixtures were not reused. All synthetic-specific case identifiers and anchors use the fresh `IACH1_` namespace.

The fixture stores acceptance constraints, not expected output. It contains
canonical source inputs, caller-supplied character ranges, and risk metadata;
it stores no expected payload, expected artifact, capability label, selector
result, or runtime authority.

No evaluation execution occurred. C.14 does not implement an evaluator,
modify the C.13 projector, or authorize runtime/capability/selector work.

# Memory Projection Holdout v1 Freeze

## Identity

| field | value |
| --- | --- |
| dataset_id | `memory-projection-holdout-v1` |
| schema_version | `1` |
| fixture | `test/fixtures/memory-projection-holdout.v1.jsonl` |
| row_count | `24` |
| family_count | `6` |
| rows_per_family | `4` |
| answer_bearing_per_family | `2` |
| non_answer_bearing_per_family | `2` |
| annotator | `memory_projection_holdout_v1` |
| evidence_role | `future_projection_aware_holdout` |
| fixture_sha256 | `cd0af809fc1e774dd9d782d5a9c20fa231f5a406f62006c4f7a6a66a0747d919` |

The six families are `direct_safe`, `redactable_secret`, `raw_log`,
`tool_output`, `sensitive_source`, and `capability_blocked`. Every row targets
the fixed `DISCLOSURE_CARD` projection surface.

## Contract boundary

This fixture is synthetic-only. Canonical memories, runtime candidates, policy
contexts, paths, identifiers, and content are synthetic evaluation material;
they contain no real user secret, sensitive real path, or production data.

The fixture freezes projection inputs and independent acceptance constraints:

- `surface_safety.forbidden_literals` contains exact synthetic literals that
  must not occur in a future projected card.
- `semantic_preservation.required_literals` contains exact synthetic anchors
  that must remain for an answer-bearing projection to be useful.
- `expected_projection_valid` is a contract-level validity constraint for the
  bounded case, not a projector-specific predicted payload.
- `current_v1_1.expected_capability` and
  `current_v1_1.expected_disclosure_authority` record the existing capability
  boundary separately from projection representation.

Literal comparison is deterministic: apply Unicode NFKC normalization, convert
CRLF/CR to LF, collapse horizontal whitespace runs to one space, trim, and
uppercase. No LLM or fuzzy semantic grader is part of this contract.

The `capability_blocked` answer-bearing rows intentionally permit the future
result `projection_feasible_but_capability_blocked`: the representation
acceptance constraints can be satisfied while current v1.1 remains
`RETRIEVAL_ONLY` with `NONE` disclosure authority. A safe projection does not
automatically become `CARD_DISCLOSABLE`.

Actual projected payloads or bounded projection features, along with computed
`actual_surface_safe` and `actual_semantic_preserved`, belong to the future
offline evaluator. They are not frozen expected projector outputs in this
fixture.

## Freeze boundary

Phase D.3-C.1 status: **HOLDOUT CONTRACT FROZEN / NOT YET EVALUATED**.

D.2 v2 fixture remains byte-identical and unmodified:
`test/fixtures/retrieval-disclosure-holdout.v2.jsonl`. Its SHA-256 remains
`d372ebac9bf4d80aaac85dfb0d43eacec792291871b744b7812009ac06d071bd`.

After this freeze, the fixture must not be changed in response to a D.3
evaluation outcome. This freeze does not constitute production or runtime
evidence, and projection evaluation has not been executed.

No projector, capability evaluator, selector, production capability, runtime,
configuration, Gateway, database, or data mutation is authorized or performed
by this freeze. The next bounded decision is **D.3-C.2: implement pure
projection-aware offline evaluator against the frozen fixture**.

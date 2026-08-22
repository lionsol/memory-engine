# Phase D.3-C.3 Projection-aware Holdout First Run

## Authority

- `EXECUTION_HEAD`: `b62121773966dea56102661c1dfc45105a50bf2e`
- `evaluator_module`: `lib/recall/disclosure/projection-aware-evaluator.js`
- `worktree-before`: clean
- D.3 fixture SHA-256: `cd0af809fc1e774dd9d782d5a9c20fa231f5a406f62006c4f7a6a66a0747d919`
- D.2 fixture SHA-256: `d372ebac9bf4d80aaac85dfb0d43eacec792291871b744b7812009ac06d071bd`

## Immutability

- fixture unchanged from the preflight SHA.
- freeze record unchanged from C.1 freeze commit `fe0331e341276825772ebf7dc46ce37cdd1784c5`.
- projector unchanged from the C.1 freeze commit.
- capability source unchanged from the C.1 freeze commit.
- selector/admissibility sources unchanged from the C.1 freeze commit.
- post-run fixture SHA remained identical to the preflight SHA.

## Evaluation

- `execution_count`: `1`
- `mode`: `offline_projection_aware_evaluation_v1`
- `runtime_authorized`: `false`
- `evidence_role`: `offline_projection_aware_first_run`

| Metric | Value |
| --- | ---: |
| `case_count` | 24 |
| `projection_valid_count` | 24 |
| `projection_invalid_count` | 0 |
| `projection_valid_match_count` | 24 |
| `projection_valid_match_rate` | 1 |
| `surface_safe_count` | 20 |
| `surface_unsafe_count` | 4 |
| `answer_bearing_total` | 12 |
| `answer_bearing_semantic_preserved` | 8 |
| `semantic_preservation_rate` | 0.6667 |
| `useful_projection_count` | 6 |
| `useful_projection_rate` | 0.5 |
| `card_authorized_useful_projection_count` | 2 |
| `projection_feasible_but_capability_blocked_count` | 4 |
| `capability_match_count` | 24 |
| `capability_match_rate` | 1 |
| `disclosure_authority_match_count` | 24 |
| `disclosure_authority_match_rate` | 1 |

## Family breakdown

| Family | Cases | Answer-bearing | Projection valid | Validity match | Surface safe | Semantic preserved | Useful | Capability-blocked useful |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `direct_safe` | 4 | 2 | 4 | 4 | 4 | 2 | 2 | 0 |
| `redactable_secret` | 4 | 2 | 4 | 4 | 0 | 2 | 0 | 0 |
| `raw_log` | 4 | 2 | 4 | 4 | 4 | 0 | 0 | 0 |
| `tool_output` | 4 | 2 | 4 | 4 | 4 | 0 | 0 | 0 |
| `sensitive_source` | 4 | 2 | 4 | 4 | 4 | 2 | 2 | 2 |
| `capability_blocked` | 4 | 2 | 4 | 4 | 4 | 2 | 2 | 2 |

## Bounded case findings

| `case_id` | `family` | `projection_valid` | `projection_valid_matches_expected` | `actual_surface_safe` | `actual_semantic_preserved` | `actual_capability` | `actual_disclosure_authority` | `useful_projection` | `projection_feasible_but_capability_blocked` | `capability_matches_expected` | `disclosure_authority_matches_expected` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `direct-safe-01` | `direct_safe` | true | true | true | true | `CARD_DISCLOSABLE` | `CARD` | true | false | true | true |
| `direct-safe-02` | `direct_safe` | true | true | true | true | `CARD_DISCLOSABLE` | `CARD` | true | false | true | true |
| `direct-safe-03` | `direct_safe` | true | true | true | null | `CARD_DISCLOSABLE` | `CARD` | false | false | true | true |
| `direct-safe-04` | `direct_safe` | true | true | true | null | `CARD_DISCLOSABLE` | `CARD` | false | false | true | true |
| `redactable-secret-01` | `redactable_secret` | true | true | false | true | `INTERNAL_CONTEXT` | `NONE` | false | false | true | true |
| `redactable-secret-02` | `redactable_secret` | true | true | false | true | `INTERNAL_CONTEXT` | `NONE` | false | false | true | true |
| `redactable-secret-03` | `redactable_secret` | true | true | false | null | `INTERNAL_CONTEXT` | `NONE` | false | false | true | true |
| `redactable-secret-04` | `redactable_secret` | true | true | false | null | `INTERNAL_CONTEXT` | `NONE` | false | false | true | true |
| `raw-log-01` | `raw_log` | true | true | true | false | `RETRIEVAL_ONLY` | `NONE` | false | false | true | true |
| `raw-log-02` | `raw_log` | true | true | true | false | `RETRIEVAL_ONLY` | `NONE` | false | false | true | true |
| `raw-log-03` | `raw_log` | true | true | true | null | `RETRIEVAL_ONLY` | `NONE` | false | false | true | true |
| `raw-log-04` | `raw_log` | true | true | true | null | `RETRIEVAL_ONLY` | `NONE` | false | false | true | true |
| `tool-output-01` | `tool_output` | true | true | true | false | `RETRIEVAL_ONLY` | `NONE` | false | false | true | true |
| `tool-output-02` | `tool_output` | true | true | true | false | `RETRIEVAL_ONLY` | `NONE` | false | false | true | true |
| `tool-output-03` | `tool_output` | true | true | true | null | `RETRIEVAL_ONLY` | `NONE` | false | false | true | true |
| `tool-output-04` | `tool_output` | true | true | true | null | `RETRIEVAL_ONLY` | `NONE` | false | false | true | true |
| `sensitive-source-01` | `sensitive_source` | true | true | true | true | `INTERNAL_CONTEXT` | `NONE` | true | true | true | true |
| `sensitive-source-02` | `sensitive_source` | true | true | true | true | `INTERNAL_CONTEXT` | `NONE` | true | true | true | true |
| `sensitive-source-03` | `sensitive_source` | true | true | true | null | `INTERNAL_CONTEXT` | `NONE` | false | false | true | true |
| `sensitive-source-04` | `sensitive_source` | true | true | true | null | `INTERNAL_CONTEXT` | `NONE` | false | false | true | true |
| `capability-blocked-01` | `capability_blocked` | true | true | true | true | `RETRIEVAL_ONLY` | `NONE` | true | true | true | true |
| `capability-blocked-02` | `capability_blocked` | true | true | true | true | `RETRIEVAL_ONLY` | `NONE` | true | true | true | true |
| `capability-blocked-03` | `capability_blocked` | true | true | true | null | `RETRIEVAL_ONLY` | `NONE` | false | false | true | true |
| `capability-blocked-04` | `capability_blocked` | true | true | true | null | `RETRIEVAL_ONLY` | `NONE` | false | false | true | true |

Classification lists:

- Unsafe projections: `redactable-secret-01`, `redactable-secret-02`, `redactable-secret-03`, `redactable-secret-04`.
- Semantic-loss projections: `raw-log-01`, `raw-log-02`, `tool-output-01`, `tool-output-02`.
- Useful and CARD-authorized: `direct-safe-01`, `direct-safe-02`.
- Useful but capability-blocked: `sensitive-source-01`, `sensitive-source-02`, `capability-blocked-01`, `capability-blocked-02`.
- Projection validity mismatches: none.
- Capability expectation mismatches: none.

## Side effects

```json
{
  "retrieval": false,
  "db_writes": false,
  "data_mutation": false,
  "selector": false,
  "network": false,
  "llm": false,
  "runtime": false
}
```

## Evidence role

`offline_projection_aware_first_run`

This report records evidence only. It defines no production threshold and no
projector, capability, selector, runtime, configuration, DB, or data change.

## Status

`FIRST-RUN EVIDENCE RECORDED / AWAITING PLANNER ADJUDICATION`

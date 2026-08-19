## Purpose

Defines the deterministic observational intent contract for Intent-aware Recall v2-A without granting intent values authority over recall policy or retrieval behavior.

## ADDED Requirements

### Requirement: Runtime intent classification

The runtime SHALL return exactly one `task_intent` from the shared task taxonomy and a non-empty ordered `recall_intent` array whose values belong to the shared recall taxonomy. Classification MUST be deterministic for the same input and features and MUST be pure, bounded, and explainable without LLM, embedding, retrieval, DB, or network access.

#### Scenario: Stable classification

- **WHEN** the same prompt and feature values are analyzed twice
- **THEN** `task_intent` and the ordered `recall_intent` array are identical and valid

#### Scenario: Conservative no-signal classification

- **WHEN** a prompt has no explicit memory-specific historical signal
- **THEN** `recall_intent` MAY be `["none"]` even when the existing `should_recall` default policy allows recall

### Requirement: Existing behavior preservation

The v2-A classifier MUST NOT change `should_recall`, `intent_reason`, `focused_query`, `focused_query_chars`, `long_input_detected`, `generic_task_detected`, `explicit_history_context`, `project_entities`, or `skipped_by_recall_intent`. The existing frozen seed values MUST remain stable.

#### Scenario: Legacy decision remains unchanged

- **WHEN** an existing seed prompt is replayed
- **THEN** its existing recall decision, reason, and focused-query assertions remain unchanged while task/recall metadata is additionally checked

### Requirement: Gold-set replay enforcement

Gold-set replay MUST compare actual `task_intent` with expected `task_intent` and actual ordered `recall_intent` with expected `recall_intent`. A mismatch MUST fail replay and be classified explicitly as `task_intent_mismatch` or `recall_intent_mismatch`. The schema version MUST remain 1.

#### Scenario: Task intent mismatch

- **WHEN** a correct prompt is paired with an incorrect expected task intent
- **THEN** replay fails with `task_intent` mismatch evidence

#### Scenario: Recall intent mismatch

- **WHEN** a correct prompt is paired with an incorrect expected recall-intent array
- **THEN** replay fails with `recall_intent` mismatch evidence

### Requirement: Bounded observability

Decision trace and AutoRecall debug metadata MUST expose validated bounded task/recall values when analysis is present. They MUST NOT add raw prompt text, focused-query bodies, regex fragments, or user-content excerpts.

#### Scenario: Debug metadata remains content-free

- **WHEN** an analyzed skip or search path emits debug metadata
- **THEN** metadata contains only the bounded enum and enum-array values for the new fields and preserves existing privacy exclusions

### Requirement: No retrieval-policy authority

V2-A intent metadata MUST remain observational and MUST NOT change Hybrid query input, channel selection, ranking, topK, filter/rerank behavior, gate thresholds, `should_recall`, `focused_query`, or Card/Get disclosure.

#### Scenario: Retrieval path is unchanged

- **WHEN** task and recall intent values are produced
- **THEN** the existing recall policy and Hybrid invocation receive the same inputs and options as before

### Requirement: Offline candidate policy has no runtime authority

The v2-B1 candidate mapping MUST exist only in an offline evaluation module or read-only evaluator. It MUST map exactly `["none"]` to no recall and valid non-`none` recall intents to recall, while rejecting empty, illegal, or mixed `none`/non-`none` arrays with `invalid_recall_intent_contract`. It MUST NOT be imported by production `should_recall`, focused-query, hook, Hybrid, ranking, channel, topK, gate, or Card/Get policy paths.

#### Scenario: Candidate mapping is isolated

- **WHEN** the v2-B1 evaluator maps an intent array
- **THEN** it returns a bounded candidate decision without changing production analysis or runtime policy

#### Scenario: Mixed none contract is rejected

- **WHEN** an evaluation case contains `["none", "project_state"]` or an empty/illegal array
- **THEN** the case is reported with `invalid_recall_intent_contract` instead of being normalized

### Requirement: Three-way offline policy evaluation

The evaluator MUST separately compare V1 current behavior, V2 oracle mapping from expected human `recall_intent`, and V2 runtime candidate mapping from actual classifier `recall_intent`. It MUST report separate confusion matrices and bounded diagnostics sufficient to distinguish classifier gaps from policy-mapping gaps.

#### Scenario: Oracle separates mapping from classification

- **WHEN** expected labels map to recall but actual classifier labels map to no recall
- **THEN** the oracle result and runtime-candidate result remain separate and the case is diagnosable as a classifier gap

#### Scenario: Evaluation labels remain independent

- **WHEN** a classifier mismatch is found in the v2-B1 fixture
- **THEN** the evaluator reports the mismatch without rewriting the fixture or changing the classifier

### Requirement: Independent balanced evaluation fixture

The v2-B1 fixture MUST remain separate from the frozen v2-A seed, reuse schema version 1 and the shared taxonomy, contain 36 design cases balanced at 18 expected recall-yes and 18 expected recall-no, and cover the nine declared case families. The fixture is evaluation design data and MUST NOT be presented as production traffic evidence.

#### Scenario: Dataset balance and coverage

- **WHEN** the v2-B1 fixture is validated
- **THEN** it contains 36 rows, an 18/18 decision balance, and four rows in each required family

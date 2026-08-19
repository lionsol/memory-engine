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

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

### Requirement: Known B1 classifier gap closure

The classifier MAY add generalized deterministic semantic lookup signals for continuation, implicit project state, prior decisions, and historical entity background, while preserving the shared taxonomy, exact ordered arrays, preference/workflow distinctions, and fresh-project/entity-name false-positive guards. It MUST NOT use fixture IDs, LLM, embedding, DB, network, or user-specific exceptions.

#### Scenario: Generalized semantic paraphrase

- **WHEN** a semantically equivalent continuation, project-state, prior-decision, or historical-entity prompt is analyzed
- **THEN** it receives the corresponding frozen taxonomy labels with deterministic ordering

#### Scenario: Fresh work remains non-historical

- **WHEN** a prompt only asks to inspect current input, explain an entity, or plan a new project without historical lookup wording
- **THEN** its recall intent remains `["none"]`

### Requirement: Classifier-only policy preservation

v2-B2 classifier changes MUST NOT modify the existing production `should_recall`, `intent_reason`, `focused_query`, focused-query construction, long-input detection, generic-task detection, explicit-history feature, skipped flag, or any retrieval/presentation policy. The V1 confusion matrix MUST remain unchanged when the B1 evaluator is rerun.

#### Scenario: Legacy policy remains frozen

- **WHEN** representative long transformation, debug, review, continuation, and history-aware rewrite prompts are analyzed after B2
- **THEN** their pre-B2 `should_recall`, `intent_reason`, and `focused_query` values are identical

### Requirement: Known-set closure is not policy approval

Reaching zero task/recall mismatch and perfect runtime-candidate results on the known 36-row B1 regression fixture MUST be recorded as regression closure only. It MUST NOT authorize the candidate mapping, runtime deployment, AutoRecall enablement, or production policy coupling. An independent B3 holdout evaluation remains required.

#### Scenario: Regression closure remains bounded

- **WHEN** the frozen B1 fixture reaches 36/36 classifier and runtime-candidate agreement
- **THEN** the candidate policy remains evaluation-only and the next decision is an independent holdout review

### Requirement: Independent B3 holdout immutability

The v2-B3 holdout MUST be the exact 48-row Planner-specified fixture with 12 required families, four rows per family, schema version 1, and a 24/24 expected decision balance. The fixture MUST be statically validated and frozen in a separate commit before classifier/evaluator execution. After that freeze, neither the fixture labels nor the classifier may be changed to improve the result in the same stage.

#### Scenario: Holdout is frozen before evaluation

- **WHEN** the B3 fixture contract is checked before evaluation
- **THEN** its rows, labels, family coverage, and annotator marker are committed and remain immutable for the B3 run

### Requirement: Parameterized offline holdout evaluation

The offline evaluator MUST accept a dataset-specific family allowlist while preserving the v2-B1 default contract and candidate mapping semantics. The B3 evaluator MUST remain read-only and MUST NOT access DB, network, LLM, embedding, retrieval, injection, memory files, or runtime policy.

#### Scenario: B1 compatibility and B3 family validation

- **WHEN** B1 rows are evaluated without a custom family allowlist and B3 rows are evaluated with the B3 allowlist
- **THEN** each dataset is validated against its own family contract without changing any three-way policy calculation

### Requirement: B3 readiness and error decomposition

The B3 report MUST provide V1, oracle, and runtime-candidate confusion matrices; task/recall mismatch counts and bounded case IDs; semantic-only mismatch IDs; runtime false-positive/false-negative IDs; per-family decision-error counts; and separate oracle, quantitative, and family-concentration gates. A subtype mismatch with the same boolean candidate decision MUST NOT be reported as a policy decision error.

#### Scenario: Oracle and runtime findings remain distinct

- **WHEN** the oracle is perfect but the runtime candidate has classifier subtype or boolean decision errors
- **THEN** the report keeps oracle mapping, semantic mismatch, and runtime policy decision results separate

### Requirement: B3 status does not grant runtime authority

The B3 status vocabulary MUST treat `PASS / READY FOR POLICY AUTHORITY REVIEW` as evidence that only the quantitative, family, and oracle gates passed. `PASS_WITH_FINDINGS / HOLDOUT NOT READY` MUST record a valid evaluation with findings. Neither status grants production policy authority, AutoRecall enablement, deployment, or runtime mutation; any policy-authority decision remains separately authorized.

#### Scenario: Holdout findings remain bounded

- **WHEN** B3 runtime precision/recall or family concentration fails its gate
- **THEN** the result is recorded as `PASS_WITH_FINDINGS / HOLDOUT NOT READY` and no classifier, candidate mapping, or production policy change is inferred

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

Before B4 reuses the corpus for regression, the B3 status vocabulary MAY distinguish `PASS / READY FOR POLICY AUTHORITY REVIEW` from `PASS_WITH_FINDINGS / HOLDOUT NOT READY` based only on the quantitative, family, and oracle gates. Neither historical status grants production policy authority, AutoRecall enablement, deployment, or runtime mutation; any policy-authority decision remains separately authorized. After B4 classifier tuning, the B3 evaluator MUST follow the stricter regression-only role defined below.

#### Scenario: Holdout findings remain bounded

- **WHEN** B3 runtime precision/recall or family concentration fails its gate
- **THEN** the result is recorded as `PASS_WITH_FINDINGS / HOLDOUT NOT READY` and no classifier, candidate mapping, or production policy change is inferred

### Requirement: Structured request-scope evidence

The v2-B4 classifier SHALL extract a pure, bounded request-scope/evidence object before mapping task or recall intent. Quoted or supplied history text MUST NOT independently grant history lookup authority, and the internal request text/evidence MUST NOT be persisted or added to debug, telemetry, decision trace, memory events, Console reports, or other user-content surfaces.

#### Scenario: Quoted history is current supplied content

- **WHEN** a transformation request quotes text containing historical vocabulary
- **THEN** task and recall classification use the request surface, and the quoted vocabulary does not create a historical recall intent

### Requirement: Suppression precedence

Explicit history suppression or current-input-only evidence MUST override positive history cues and map `recall_intent` to exactly `["none"]`. Positive history vocabulary alone MUST NOT be treated as a lookup subtype.

#### Scenario: Suppressed historical reference

- **WHEN** a prompt says not to use a previous plan, decision, bug, or project history
- **THEN** the classifier returns `["none"]` even if the same request contains a historical reference

### Requirement: Structured lookup relations

Project/entity anchors alone MUST NOT grant recall intent. Continuation, project-state, prior-decision, historical-entity, preference, and workflow lookup MUST require their corresponding deterministic relation evidence and preserve the frozen ordered taxonomy arrays.

#### Scenario: Anchor without lookup relation

- **WHEN** a prompt only names a project or entity while asking for current/factual analysis
- **THEN** `recall_intent` remains `["none"]`

### Requirement: B4 regression boundary

The v2-B4 classifier MAY change only observational `task_intent` and `recall_intent`; it MUST preserve V1 `should_recall`, `intent_reason`, `focused_query`, focused-query construction, and the v2-B1 candidate mapping. The v2-A seed, B1 fixture, and B3 fixture MUST remain immutable.

#### Scenario: Known corpus closure is not generalization

- **WHEN** the frozen v2-A, B1, and B3 corpora are replayed after B4
- **THEN** their results may be recorded as structured-evidence regression closure, but they MUST NOT be called independent readiness evidence or production approval

### Requirement: B3 regression-only role after B4

After B4 classifier tuning uses the B3 fixture, the B3 evaluator SHALL identify the corpus as known regression evidence, retain the historical first-run status `PASS_WITH_FINDINGS / HOLDOUT NOT READY`, and report `REGRESSION ONLY / NOT INDEPENDENT READINESS EVIDENCE`. Diagnostic threshold math MAY remain, but it MUST NOT produce a new policy-authority readiness status.

#### Scenario: B3 score improves after B4

- **WHEN** the current B3 corpus reaches perfect or threshold-passing runtime metrics
- **THEN** the report remains regression-only and the candidate policy remains `NOT RUNTIME AUTHORIZED`

### Requirement: Fresh B5 holdout

The B4 stage MUST NOT create or evaluate a B5 fixture. A separate v2-B5 stage MUST freeze the independent holdout by a later Planner decision before its evaluator runs or any policy-authority review is considered.

#### Scenario: Next evidence remains separate

- **WHEN** the separate B5 stage begins after B4 regression closure
- **THEN** the exact holdout is frozen before evaluation, and its result remains offline evidence without runtime mutation or policy coupling

### Requirement: B5 fixture freeze before evaluation

The v2-B5 holdout MUST be the exact Planner-specified 48-row fixture with 12 required families, four rows per family, schema version 1, and a 24/24 expected decision balance. It MUST be statically validated and committed before classifier or evaluator execution; after freeze, the fixture MUST remain immutable.

#### Scenario: B5 labels are frozen

- **WHEN** the B5 fixture contract is checked before evaluation
- **THEN** its rows, labels, family coverage, annotator marker, and disclosure levels are committed and no classifier, evidence, or fixture tuning is allowed during the evaluation

### Requirement: B5 shared offline evaluation

The B5 evaluator MUST reuse the shared three-way policy evaluator and unchanged candidate mapping, accept the B5 family allowlist, remain read-only, and report dataset, family, V1, oracle, and runtime-candidate metrics.

#### Scenario: B5 readiness gates

- **WHEN** a valid B5 dataset is evaluated
- **THEN** oracle false positives, false negatives, and invalid cases MUST be zero for the oracle gate; runtime precision and recall MUST be at least 0.90 with at most two false positives and two false negatives; and no family may contain more than one boolean decision error for readiness

### Requirement: Semantic mismatch and policy decision separation

B5 reporting MUST keep exact task-intent and recall-intent subtype mismatches separate from boolean candidate policy errors. A non-none subtype mismatch with the same boolean candidate decision MUST be semantic-only evidence and MUST NOT be counted as a false positive or false negative.

#### Scenario: Subtype mismatch with stable decision

- **WHEN** expected and actual recall intents differ but both map to the same boolean candidate decision
- **THEN** the case is reported as a semantic mismatch without becoming a policy decision error

### Requirement: B5 does not grant runtime authority

B5 PASS means only `READY FOR POLICY AUTHORITY REVIEW`; B5 findings MUST NOT authorize runtime policy coupling, production should-recall changes, deployment, AutoRecall enablement, or configuration/data mutation. A failed B5 gate MUST NOT automatically authorize a classifier-repair stage; any v2-B6 policy-authority review remains a separate Planner decision.

#### Scenario: B5 findings remain bounded

- **WHEN** the B5 quantitative or family gate fails
- **THEN** the status is `PASS_WITH_FINDINGS / HOLDOUT NOT READY`, the findings are recorded, and runtime authority remains separate

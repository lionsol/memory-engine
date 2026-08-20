## 1. Shared deterministic contract

- [x] 1.1 Add frozen shared task and recall intent arrays plus pure validation helpers.
- [x] 1.2 Preserve `TURN_TASK_INTENTS`, `TURN_RECALL_INTENTS`, and schema version 1 compatibility.

## 2. Runtime classifier

- [x] 2.1 Add deterministic task-intent classification with seed-compatible precedence and fallback.
- [x] 2.2 Add conservative recall-intent classification with explicit tests for preference, workflow-rule, and entity-background lookups.
- [x] 2.3 Preserve all existing recall-gate, focused-query, and legacy feature outputs.

## 3. Replay and observability

- [x] 3.1 Enforce exact task/recall intent equality in gold-set replay and add explicit mismatch feedback categories.
- [x] 3.2 Validate and expose bounded intents in decision trace and AutoRecall debug metadata.
- [x] 3.3 Add hook skip/search coverage, privacy assertions, Console trace fields, and negative replay tests.

## 4. Verification and boundary

- [x] 4.1 Verify the unchanged frozen 12-row seed replay and existing behavior fields.
- [x] 4.2 Verify no Hybrid/ranking/channel/topK/Card/Get policy path receives the new metadata.
- [x] 4.3 Record source/tests/docs completion without runtime deployment or AutoRecall enablement.

## 5. v2-B1 Policy evaluation

- [x] 5.1 Define the offline-only `recall_intent` candidate mapping with exclusive `none` validation.
- [x] 5.2 Add the independent balanced 36-row evaluation dataset without changing the frozen seed.
- [x] 5.3 Add the v1/oracle/runtime three-way offline evaluator and read-only CLI.
- [x] 5.4 Add confusion matrices, bounded diagnostics, and classifier/policy root-cause decomposition.
- [x] 5.5 Verify no production policy, ranking, channel, topK, gate, Card/Get, DB, or runtime changes.
- [x] 5.6 Record the actual evaluation result for the separate v2-B2 product decision.

## 6. v2-B2 classifier gap closure

- [x] 6.1 Freeze the B1 classifier-gap baseline before editing source.
- [x] 6.2 Generalize continuation, project-state, prior-decision, and historical-entity lookup signals.
- [x] 6.3 Close the known task-intent gaps without changing policy mapping or policy outputs.
- [x] 6.4 Preserve v1 `should_recall`, `intent_reason`, focused-query, and legacy feature behavior.
- [x] 6.5 Reach zero task/recall mismatch and `18/18` runtime-candidate classification on the known B1 regression set.
- [x] 6.6 Record the holdout requirement before any future runtime policy authority decision.

## 7. v2-B3 independent holdout

- [x] 7.1 Freeze the Planner-specified independent 48-row holdout before evaluation.
- [x] 7.2 Generalize the evaluator dataset-family contract without changing policy semantics.
- [x] 7.3 Run B3 exactly against the frozen classifier and candidate policy.
- [x] 7.4 Report runtime decision errors and semantic intent mismatches separately.
- [x] 7.5 Apply quantitative and family-concentration readiness gates.
- [x] 7.6 Record the B3 result without granting runtime policy authority.

## 8. v2-B4 structured evidence model

- [x] 8.1 Freeze the B3 generalization failure as historical evidence.
- [x] 8.2 Introduce a pure request-scope and bounded evidence extraction layer.
- [x] 8.3 Add suppression and current-input negative precedence over positive history cues.
- [x] 8.4 Rebuild continuation, project-state, prior-decision, entity, preference, and workflow lookup on structured evidence.
- [x] 8.5 Move task classification to request-surface evidence where supplied content could contaminate it.
- [x] 8.6 Close the v2-A/B1/B3 known regression corpora without changing V1 policy or candidate mapping.
- [x] 8.7 Mark the B3 corpus as regression-only after B4 tuning.
- [x] 8.8 Require a fresh B5 independent holdout before any policy-authority review.

## 9. v2-B5 fresh independent holdout

- [x] 9.1 Freeze the Planner-specified 48-row B5 holdout before classifier/evaluator execution.
- [x] 9.2 Preserve the B4 classifier/evidence and the v2-B1 candidate mapping exactly after freeze.
- [x] 9.3 Evaluate B5 with the shared read-only three-way policy evaluator and CLI.
- [x] 9.4 Report semantic subtype mismatches separately from boolean policy decision errors.
- [x] 9.5 Apply the oracle, quantitative, and family-concentration readiness gates.
- [x] 9.6 Record the B5 result without granting runtime policy authority.
- [x] 9.7 Keep any B6 policy-authority review as a separate Planner decision; do not infer classifier repair or runtime activation from B5 findings.

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

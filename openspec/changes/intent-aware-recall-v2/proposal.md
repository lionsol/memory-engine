## Why

The turn gold-set already defines `task_intent`, `recall_intent`, and `disclosure_level`, but runtime intent analysis currently produces only recall-gate and focused-query fields. The labels are validated and observed without being enforced against runtime output, so replay cannot detect classifier drift.

## What Changes

- Establish one shared frozen task/recall intent taxonomy for runtime, gold-set validation, replay, decision trace, and bounded AutoRecall debug metadata.
- Add deterministic, pure task and conservative recall intent classification to `analyzeAutoRecallIntent()` without changing existing recall-gate or focused-query behavior.
- Make turn gold-set replay compare task and recall intents, classify explicit mismatches, and expose the bounded values through decision trace and debug surfaces.
- Add v2-B1's evaluation-only candidate policy mapping, independent balanced fixture, and three-way offline evaluator for current v1, oracle mapping, and runtime-classifier mapping.
- Add v2-B2 generalized deterministic lookup signals to close the known task/recall classifier gaps on the frozen B1 regression set without changing production policy authority.
- Add v2-B3's Planner-frozen independent 48-row holdout, parameterized offline evaluator, family-concentration/readiness gates, and bounded mismatch decomposition without granting policy runtime authority.
- Add v2-B4's pure request-scope and structured history-evidence model, including suppression precedence, supplied-content masking, generalized lookup relations, and request-surface task classification.
- Reclassify the B3 corpus as known regression evidence after B4 tuning and require a fresh B5 independent holdout before any policy-authority review.

## Non-goals

- Changing `should_recall`, `intent_reason`, `focused_query`, or any existing long-input behavior.
- Changing Hybrid retrieval, ranking, channels, topK, gates, Card/Get disclosure, or AutoRecall enablement.
- Adding an LLM classifier, database/schema migration, config change, runtime deployment, or Gateway operation.
- Granting the candidate mapping authority over production `should_recall`, `focused_query`, or AutoRecall hook behavior.
- Rewriting evaluation labels to fit classifier output or using the evaluation fixture as production evidence.
- Treating 36/36 on the known B1 regression set as production-readiness evidence; an independent B3 holdout remains required.
- Tuning the classifier or candidate mapping after the B3 holdout is frozen, or treating B3 readiness as runtime authorization.
- Treating B4 closure on the v2-A/B1/B3 corpora as generalization qualification, or creating the B5 holdout in this change.

## Impact

- Runtime intent analysis gains observational deterministic metadata only.
- The existing schema version remains `TURN_GOLD_SET_SCHEMA_VERSION = 1`; the existing 12-row seed remains frozen.
- v2-B1 produces offline metrics and bounded case diagnostics only; v2-B2 closes the known regression set but does not authorize the candidate policy. v2-B3 adds independent holdout evidence and a Planner-facing readiness result; `canonical-memory-architecture` is not reopened, and runtime deployment and any future policy coupling remain separate decisions.

## Why

The turn gold-set already defines `task_intent`, `recall_intent`, and `disclosure_level`, but runtime intent analysis currently produces only recall-gate and focused-query fields. The labels are validated and observed without being enforced against runtime output, so replay cannot detect classifier drift.

## What Changes

- Establish one shared frozen task/recall intent taxonomy for runtime, gold-set validation, replay, decision trace, and bounded AutoRecall debug metadata.
- Add deterministic, pure task and conservative recall intent classification to `analyzeAutoRecallIntent()` without changing existing recall-gate or focused-query behavior.
- Make turn gold-set replay compare task and recall intents, classify explicit mismatches, and expose the bounded values through decision trace and debug surfaces.
- Add v2-B1's evaluation-only candidate policy mapping, independent balanced fixture, and three-way offline evaluator for current v1, oracle mapping, and runtime-classifier mapping.

## Non-goals

- Changing `should_recall`, `intent_reason`, `focused_query`, or any existing long-input behavior.
- Changing Hybrid retrieval, ranking, channels, topK, gates, Card/Get disclosure, or AutoRecall enablement.
- Adding an LLM classifier, database/schema migration, config change, runtime deployment, or Gateway operation.
- Granting the candidate mapping authority over production `should_recall`, `focused_query`, or AutoRecall hook behavior.
- Rewriting evaluation labels to fit classifier output or using the evaluation fixture as production evidence.

## Impact

- Runtime intent analysis gains observational deterministic metadata only.
- The existing schema version remains `TURN_GOLD_SET_SCHEMA_VERSION = 1`; the existing 12-row seed remains frozen.
- v2-B1 produces offline metrics and bounded case diagnostics only. `canonical-memory-architecture` is not reopened; runtime deployment and any future policy coupling remain separate decisions.

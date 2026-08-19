## Why

The turn gold-set already defines `task_intent`, `recall_intent`, and `disclosure_level`, but runtime intent analysis currently produces only recall-gate and focused-query fields. The labels are validated and observed without being enforced against runtime output, so replay cannot detect classifier drift.

## What Changes

- Establish one shared frozen task/recall intent taxonomy for runtime, gold-set validation, replay, decision trace, and bounded AutoRecall debug metadata.
- Add deterministic, pure task and conservative recall intent classification to `analyzeAutoRecallIntent()` without changing existing recall-gate or focused-query behavior.
- Make turn gold-set replay compare task and recall intents, classify explicit mismatches, and expose the bounded values through decision trace and debug surfaces.

## Non-goals

- Changing `should_recall`, `intent_reason`, `focused_query`, or any existing long-input behavior.
- Changing Hybrid retrieval, ranking, channels, topK, gates, Card/Get disclosure, or AutoRecall enablement.
- Adding an LLM classifier, database/schema migration, config change, runtime deployment, or Gateway operation.

## Impact

- Runtime intent analysis gains observational deterministic metadata only.
- The existing schema version remains `TURN_GOLD_SET_SCHEMA_VERSION = 1`; the existing 12-row seed remains frozen.
- `canonical-memory-architecture` is not reopened. Runtime deployment and any future policy coupling remain separate decisions.

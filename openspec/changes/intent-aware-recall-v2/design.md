## Intent contract ownership

`lib/recall/auto-recall-intent-contract.js` is the sole owner of the frozen task and recall intent arrays and pure validation helpers. `auto-recall-turn-gold-set.js` retains the existing `TURN_TASK_INTENTS` and `TURN_RECALL_INTENTS` exports as compatibility aliases. Disclosure levels remain owned by the gold-set/Card contract.

## Deterministic classification

`classifyTaskIntent(text, features)` and `classifyRecallIntent(text, features)` are bounded pure rules. They do not call an LLM, embedding, retrieval, DB, network, or runtime service. Every analysis returns one valid task intent and a non-empty array of valid recall intents. Recall classification is conservative and may return `["none"]` when no explicit memory-specific historical signal exists.

The classifier is observational. `task_intent` and `recall_intent` do not feed `should_recall`, `intent_reason`, `focused_query`, Hybrid input, ranking, channel selection, topK, gate thresholds, or Card/Get disclosure.

## Replay and observability

Turn gold-set replay keeps schema version 1 and compares actual task intent and exact ordered recall-intent arrays in addition to the existing should/intent-reason/focused-query assertions. Feedback classifies `task_intent_mismatch` and `recall_intent_mismatch` explicitly. The frozen 12-row seed is unchanged and remains 12/12.

Decision trace validation requires legal bounded intent values and includes both fields. AutoRecall hook/debug metadata carries only the bounded enum and enum-array values on analyzed skip and search paths; no prompt, focused body, regex evidence, or content excerpt is added. Console trace rendering adds the two fields without redesign.

## Policy and rollout boundary

This change does not authorize runtime deployment, Gateway restart, AutoRecall enablement, config/data mutation, or retrieval-policy changes. A later v2-B product decision is required before validated intent can influence recall policy or focused-query behavior.

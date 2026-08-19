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

## v2-B1 policy mapping and offline evaluation

v2-B1 defines a candidate policy for evaluation only. The mapping is deliberately small and has no production authority:

- `recall_intent == ["none"]` maps to `should_recall=false`.
- Any valid array containing one or more non-`none` historical intents maps to `should_recall=true`.
- Empty, illegal, or mixed `none`/non-`none` arrays return the bounded error `invalid_recall_intent_contract` and are reported per case rather than silently normalized.
- `task_intent` is diagnostic metadata only and does not participate in this candidate mapping.

The independent 36-row v2-B1 JSONL fixture is balanced at 18 expected recall-yes and 18 expected recall-no cases across nine semantic families. It reuses schema version 1 and does not modify the frozen 12-row v2-A seed. Labels are frozen before evaluation; classifier mismatches are findings, not reasons to rewrite the fixture or classifier.

The offline evaluator reports three separate confusion matrices:

1. V1 current: actual classifier plus the existing `analyzeAutoRecallIntent().should_recall`.
2. V2 oracle: expected human `recall_intent` plus the candidate mapping.
3. V2 runtime candidate: actual classifier `recall_intent` plus the same candidate mapping.

Per-case task/recall classification matches, bounded case IDs, policy deltas, and root-cause categories distinguish classifier gaps from mapping gaps and from false positives removed or false negatives introduced. The evaluator and read-only CLI do not use DB, network, LLM, retrieval, injection, or runtime policy.

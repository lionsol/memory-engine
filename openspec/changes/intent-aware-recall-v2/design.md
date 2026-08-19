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

## v2-B2 classifier gap closure

v2-B2 keeps the v2-B1 candidate mapping unchanged and improves only the observational deterministic classifier. The classifier uses generalized semantic lookup signals rather than fixture turn IDs or entity-name exceptions:

- continuation lookup recognizes prior task-state wording such as where work stopped, what was being worked on, and next-step continuation;
- project-state lookup requires a project/phase anchor plus a state cue such as progress, remaining work, baseline, gaps, status, or next step;
- prior-decision lookup recognizes comparison, choice, decision, and design-drift wording with deterministic ordered outputs;
- historical entity lookup requires a historical reference phrase plus an entity-like token, so an entity name alone remains `none`;
- preference/workflow lookup continues to require historical lookup wording and does not treat new instructions as retrieval requests.

These semantic signals affect only `task_intent` and `recall_intent`. The existing legacy policy calculation remains authoritative and unchanged: `should_recall`, `intent_reason`, `focused_query`, focused-query construction, and all retrieval/presentation policy surfaces retain their v1 behavior.

The frozen B1 fixture now reports zero task mismatches and zero recall mismatches. V1 remains `18 TP / 5 TN / 13 FP / 0 FN`; both oracle and runtime candidate mapping report `18 TP / 18 TN / 0 FP / 0 FN`. This is a known-gap regression closure, not production-readiness evidence: the candidate policy remains evaluation-only, and an independent B3 holdout is required before any policy-authority decision.

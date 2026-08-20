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

## v2-B3 independent holdout evaluation

The B3 holdout is the exact Planner-specified `test/fixtures/auto-recall-policy-holdout.v2b3.jsonl` fixture: 48 schema-version-1 rows, 12 families with four rows each, and an even 24/24 expected recall balance. All rows use the frozen taxonomy, high-confidence labels, and the `v2b3_planner_holdout` annotator marker. The fixture was statically validated and committed separately at `ceded7d7a629cb35817fe9a1b95d6849e55c8256` before classifier evaluation; it is immutable for this stage.

The evaluator generalizes only the row family allowlist. It reuses the unchanged v2-B1 candidate mapping and three-way matrices, and adds B3 family metrics, semantic-only mismatch diagnostics, and readiness gates:

- the oracle gate requires zero oracle false positives and false negatives;
- the quantitative runtime-candidate gate requires precision and recall at least `0.90`, with no more than two false positives or false negatives;
- the family-concentration gate allows at most one runtime decision error in any family.

Subtype (`task_intent` / `recall_intent`) mismatches are reported separately from boolean policy decision errors. The read-only B3 CLI performs no DB, network, LLM, retrieval, injection, memory-file, or report-file access.

The frozen B3 evaluation is contract-valid and oracle-perfect, but runtime candidate results are `7 TP / 19 TN / 5 FP / 17 FN` (precision `0.5833`, recall `0.2917`). Task mismatches are `14`, recall mismatches are `25`, and semantic-only mismatches are reported separately. Seven families exceed the one-error concentration bound, so the result is `PASS_WITH_FINDINGS / HOLDOUT NOT READY`. This is evidence for Planner adjudication, not a classifier-tuning authorization, policy approval, deployment, or runtime mutation.

## v2-B4 structured evidence model

The B3 first independent run remains a historical record: `PASS_WITH_FINDINGS / HOLDOUT NOT READY` with runtime `7/19/5/17`, task mismatches `14`, and recall mismatches `25`. B4 does not rewrite that result. It replaces the classifier's raw-input positive-regex architecture with a pure bounded evidence layer:

- request-scope extraction masks quoted and supplied content before task/history matching;
- explicit history suppression and current-input-only evidence have precedence over positive history vocabulary;
- project/entity anchors alone do not grant recall authority;
- continuation, project-state, prior-decision, historical-entity, preference, and workflow lookup are mapped from structured relations with deterministic ordered arrays;
- task classification uses the request surface where supplied text could otherwise contaminate the task label.

The evidence object is classifier-internal and is not added to decision trace, debug metadata, memory events, Console telemetry, or persistent reports. The classifier remains pure, deterministic, bounded, and free of LLM, embedding, DB, network, retrieval, and runtime-state access. Existing V1 policy outputs and the v2-B1 candidate mapping are unchanged.

After B4, the frozen v2-A seed, B1 fixture, and B3 fixture are regression corpora only. The known corpora close with the existing 12-row seed at `12/12`, B1 at zero task/recall mismatch and runtime `18/18/0/0`, and B3 at zero task/recall mismatch and runtime `24/24/0/0`; V1 remains `18/5/13/0` for B1 and `24/0/24/0` for B3. These results are known-regression closure, not generalization qualification. The B3 evaluator now reports `evidence_role=known_regression_after_v2b4` and `REGRESSION ONLY / NOT INDEPENDENT READINESS EVIDENCE`, even when its diagnostic thresholds pass.

The candidate policy remains `NOT RUNTIME AUTHORIZED`. B4 did not create or evaluate the fresh v2-B5 holdout; the separate B5 stage froze and evaluated it without changing `should_recall`, `intent_reason`, `focused_query`, retrieval/presentation policy, runtime deployment, or AutoRecall enablement.

## v2-B5 fresh independent holdout

The Planner-specified B5 fixture test/fixtures/auto-recall-policy-holdout.v2b5.jsonl was statically validated and frozen before any classifier/evaluator execution in commit 926f034. It contains 48 schema-version-1 rows, 12 families with four rows each, and a 24/24 expected decision balance. The fixture remains immutable for this evaluation.

B5 reuses the shared three-way evaluator and the unchanged evaluation-only candidate mapping. The evaluator accepts the B5 family allowlist, reports per-family decision errors, and keeps exact task/recall subtype mismatches separate from boolean policy false positives and false negatives. The read-only CLI has no DB, network, LLM, retrieval, injection, memory-file, report-file, or runtime-policy access.

The formal B5 result is contract-valid and oracle-perfect:

- V1: 24 TP / 1 TN / 23 FP / 0 FN.
- V2 oracle: 24 TP / 24 TN / 0 FP / 0 FN.
- V2 runtime candidate: 3 TP / 17 TN / 7 FP / 21 FN, precision 0.3, recall 0.125.
- Task-intent mismatches: 16; recall-intent mismatches: 29; semantic-only mismatches: 7.
- Eight families exceeded the maximum one boolean decision error concentration.

Therefore v2-B5 is PASS_WITH_FINDINGS / HOLDOUT NOT READY: the evaluator ran successfully and the fresh corpus is valid evidence, but the quantitative and family gates failed. The candidate policy remains NOT RUNTIME AUTHORIZED. This result does not authorize classifier repair, production policy coupling, deployment, AutoRecall enablement, or runtime mutation. A separate Planner decision is required before any v2-B6 policy-authority review; B5 findings do not automatically start a classifier-repair stage.

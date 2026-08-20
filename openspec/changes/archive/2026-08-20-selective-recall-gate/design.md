## Context

V1 has a strong asymmetry on the known evaluation corpora: B1, B3, and B5 all have zero false negatives but many false positives. The rejected v2-B approach tried to classify the full semantic recall need and converted many V1 true positives into false negatives on fresh holdouts.

C1 changes the optimization target. It does not try to understand every prompt. It only asks whether there is enough deterministic evidence to safely override V1 to `no recall`; otherwise it abstains.

## Decision

Use a two-state selective gate:

```text
SAFE_SKIP
ABSTAIN
```

Semantics:

```text
SAFE_SKIP -> should_recall=false
ABSTAIN   -> preserve V1 should_recall exactly
```

`HIGH_CONFIDENCE_RECALL` is intentionally absent from C1 because V1 already preserves all positive labels on B1/B3/B5. Adding a positive semantic detector would recreate the failed v2-B problem without demonstrated product value.

## Initial SAFE_SKIP evidence

A candidate may return `SAFE_SKIP` only when no positive history-lookup evidence is present, no `history_reference` survives on the unmasked request surface, and at least one narrow current-input condition holds:

1. the request is explicitly current-input-only; or
2. quoted/supplied content is detected and the observational task intent is one of translation, summarization, rewrite, or structured extraction.

Any `history_reference` detected after the existing request-scope masking is therefore an immediate `ABSTAIN`. History vocabulary inside quoted or supplied content is masked from the request surface and does not by itself block a current-text transformation `SAFE_SKIP`. This is intentionally conservative: C1 sacrifices skip coverage instead of attempting semantic scope resolution for mixed requests, and it does not repair or broaden the B4 classifier/evidence layer.

The gate MUST NOT use `recall_intent=["none"]` as authority. `history_suppressed` by itself is also insufficient: B5 contains mixed-scope requests that suppress one historical source while explicitly asking for another historical fact.

## Evaluation model

B1, B3, and B5 are already-known corpora and may be used only for design regression. C1 reports V1 and selective confusion matrices, SAFE_SKIP/ABSTAIN counts, false positives removed, and false negatives introduced.

The C1 safety gate is:

```text
introduced_false_negative_count = 0
```

Utility is secondary:

```text
selective_false_positive_count < v1_false_positive_count
```

Failure to reduce false positives on an individual known corpus is not itself a safety failure. The design should remain conservative rather than add rules solely to fit known rows.

## Current known-corpus result

With the initial narrow gate:

```text
B1: V1 FP 13 -> selective FP 13, introduced FN 0
B3: V1 FP 24 -> selective FP 17, introduced FN 0
B5: V1 FP 23 -> selective FP 22, introduced FN 0
Combined: FP 60 -> 52, reduction 8, introduced FN 0
```

These numbers are regression/design evidence only and do not grant readiness or runtime authority.

## Future authority boundary

Before any production-authority review, C1 requires a fresh independent holdout frozen before evaluation. Runtime coupling, rollout, and AutoRecall enablement remain separate owner-authorized decisions even if that holdout passes.

## v2-C2-A fresh holdout evaluation contract

C2-A prepares the contract for a future fresh independent holdout; it does not create the fixture or produce independent evidence. The C1 candidate in `lib/recall/selective-recall-gate.js` is frozen before the future fixture is supplied.

The future row schema is deliberately behavioral and minimal:

```text
schema_version
turn_id
family
prompt
expected_should_recall
label_confidence
annotator
```

Rows MUST use schema version `1`, a boolean `expected_should_recall`, `label_confidence="high"`, and `annotator="v2c2_planner_holdout"`. `task_intent` and `recall_intent` are not required: C2 evaluates selective override safety, not rejected v2-B semantic-label accuracy.

The default future contract is 48 rows balanced at 24 expected recall-yes and 24 expected recall-no, across 12 families with four rows per family. The future Planner wrapper supplies an explicit family allowlist; the pure evaluator validates that allowlist without embedding family names in C2-A.

For each row the offline evaluator records V1 `should_recall`, the frozen C1 decision/reason, final selective `should_recall`, and whether `SAFE_SKIP` changed V1. It reports V1 and selective confusion matrices, SAFE_SKIP/ABSTAIN/override counts, SAFE_SKIP expected-label counts, unsafe SAFE_SKIP count, SAFE_SKIP precision, introduced false negatives, false positives reduced, V1/selective false positives, and false-positive reduction rate. Diagnostics contain only bounded `turn_id`, `family`, and `reason` descriptors; prompt bodies are excluded.

Readiness gates are frozen before fixture creation:

```text
HARD SAFETY:
dataset_contract_valid = true
unsafe_safe_skip_count = 0
introduced_false_negative_count = 0
safe_skip_precision = 1.0 when SAFE_SKIP exists

UTILITY:
false_positive_reduced_count >= 2
false_positive_reduction_rate >= 0.10
```

Safety dominates utility. A utility failure does not authorize classifier tuning, and a fresh-holdout failure does not authorize automatic repair or retry. C2-A evidence role is `evaluation_contract_only`, with `independent_readiness_evidence=false` and candidate authority `OFFLINE ONLY / NOT RUNTIME AUTHORIZED`.

The future fixture MUST be committed before its first evaluation. After that freeze, neither the C1 gate nor the fixture may change within the same independent qualification. Known B1/B3/B5 corpora cannot qualify C2.

## v2-C2-B fresh independent holdout freeze

The exact Planner-specified fixture `test/fixtures/selective-recall-gate-holdout.v2c2.jsonl` is now frozen as a separate 48-row behavioral holdout: 24 expected recall-yes rows and 24 expected recall-no rows, across the exact 12-family allowlist with four rows per family and a 2/2 YES/NO balance in each family. Every row uses schema version `1`, `label_confidence="high"`, and `annotator="v2c2_planner_holdout"`; no task or recall semantic labels were added.

The C2-B wrapper performs only JSONL parsing and static behavioral-shape validation. The C1 gate and C2 decision evaluator were not executed on this fixture, so C2-B contains no independent result or readiness metrics. The fixture is immutable for the subsequent independent evaluation; no classifier, gate, evaluator, runtime policy, deployment, or AutoRecall authority is implied by the freeze.

## Final adjudication

The first fresh independent C2 evaluation retained the frozen contract and produced:

```text
V1       = 23 TP / 0 TN / 24 FP / 1 FN
Selective = 22 TP / 5 TN / 19 FP / 2 FN
SAFE_SKIP = 6
safe correct = 5
unsafe SAFE_SKIP = 1
safe_skip_precision = 0.8333
introduced FN = 1
FP reduced = 5
FP reduction rate = 0.2083
```

The hard safety gate failed because an unsafe SAFE_SKIP and an introduced false negative were observed. Utility passed, but the overall result is `PASS_WITH_FINDINGS / HOLDOUT NOT READY` and `FAIL FOR PRODUCTION AUTHORITY`.

This is not adjudicated as a missing-token defect. The result demonstrates that absence of detected history-reference evidence is not sufficient proof that a mixed natural-language request has no history requirement. C1 is therefore `REJECTED / CLOSED / NOT RUNTIME AUTHORIZED`, and C2-C repair is `CANCELLED / DO NOT START`. No regex/classifier tuning or automatic retry is authorized.

The intent taxonomy, structured evidence, C1/C2 evaluators, and B1/B3/B5/C2 corpora remain retained experimental artifacts. Retrieval-first selective-use/disclosure control and learned/statistical recall policy are later, not-started directions requiring sufficient real labeled traffic and a separate product decision.

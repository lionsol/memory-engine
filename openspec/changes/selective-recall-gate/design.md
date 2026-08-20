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

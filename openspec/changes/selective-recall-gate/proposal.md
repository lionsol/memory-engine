## Why

Intent-aware Recall v2-B established that the human semantic mapping from `recall_intent` to recall/no-recall is internally coherent, but two independent holdouts showed that the deterministic natural-language classifier does not generalize well enough to receive production recall authority. B3 closed `PASS_WITH_FINDINGS / HOLDOUT NOT READY`; after B4 repaired the known corpus, fresh B5 again collapsed to `3 TP / 17 TN / 7 FP / 21 FN`.

The next product question is therefore narrower: can a deterministic layer safely remove a subset of V1 false-positive recalls without introducing new false negatives?

## What Changes

- Replace the rejected full semantic-authority model with a selective two-state C1 gate: `SAFE_SKIP` or `ABSTAIN`.
- `ABSTAIN` preserves the existing V1 recall decision exactly.
- `SAFE_SKIP` is allowed only for narrow current-input evidence, initially explicit current-only requests or supplied-current-text transformations with no positive history-lookup evidence. Any history reference that remains on the unmasked request surface forces `ABSTAIN`; history in masked quoted/supplied content does not by itself block a current-text transformation skip.
- Do not use `recall_intent=["none"]` as skip authority and do not treat history suppression alone as sufficient skip evidence.
- This conservative guard intentionally gives up skip coverage instead of attempting semantic scope resolution and does not repair the B4 classifier/evidence rules.
- Add an offline evaluator over the already-known B1/B3/B5 corpora to measure V1-vs-selective false-positive reduction and introduced false negatives.
- Require fresh independent holdout evidence before any future production-authority review.

## Non-goals

- Runtime policy coupling, AutoRecall enablement, deployment, Gateway/config/DB/data mutation, or retrieval/ranking changes.
- Reopening v2-B classifier repair or fitting new semantic rules to B5 failures.
- Adding `HIGH_CONFIDENCE_RECALL`; C1 is skip-only plus abstention.
- Treating B1/B3/B5 as independent readiness evidence for C1.
- LLM, embedding, learned classifier, LTR, or user-specific exceptions.

## Impact

C1 is source/offline only. Existing V1 `should_recall` remains authoritative in production. The new gate and evaluator are isolated from runtime policy paths and exist only to test whether a conservative skip override is a viable successor architecture.

## 1. v2-C1 selective gate

- [x] 1.1 Define skip-only `SAFE_SKIP` / `ABSTAIN` semantics.
- [x] 1.2 Implement the offline selective gate without consuming `recall_intent` as authority.
- [x] 1.3 Guard mixed-scope requests by abstaining on any history reference that survives request-scope masking, even when structured positive lookup evidence is absent.
- [x] 1.4 Keep history suppression alone insufficient for `SAFE_SKIP`.

## 2. Offline evaluation

- [x] 2.1 Add a read-only evaluator that compares V1 with the selective candidate.
- [x] 2.2 Reuse B1/B3/B5 only as known design/regression corpora.
- [x] 2.3 Report false positives removed and introduced false negatives.
- [x] 2.4 Require zero introduced false negatives as the C1 safety gate.
- [x] 2.5 Record that known-corpus results are not independent readiness evidence.

## 3. Authority boundary

- [x] 3.1 Keep C1 source/offline only with no runtime policy coupling.
- [x] 3.2 Require a fresh frozen independent holdout before any production-authority review.
- [x] 3.3 Keep deployment, AutoRecall enablement, config/data mutation, and runtime qualification out of scope.

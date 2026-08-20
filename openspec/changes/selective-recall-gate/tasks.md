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

## 4. v2-C2-A fresh holdout evaluation contract

- [x] 4.1 Freeze the C1 candidate boundary before preparing the future holdout contract.
- [x] 4.2 Define the minimal behavioral row schema without v2-B semantic labels.
- [x] 4.3 Encode the 48-row, 24/24, 12-family, four-rows-per-family contract and future family-allowlist hook.
- [x] 4.4 Add bounded V1/C1 metrics, independent unsafe-SAFE_SKIP safety, and utility gates.
- [x] 4.5 Keep C2-A contract-only: do not create or evaluate the fresh fixture.

# Q6 Shadow AutoRecall Offline Qualification v1

Date: 2026-09-19
Status: Q6-C PASS_WITH_FINDINGS / OFFLINE QUALIFIED / MECHANISM PASS / NO POLICY CHANGE / RUNTIME SHADOW NOT AUTHORIZED

## 1. Scope

Q6-C evaluates the Q6 Shadow AutoRecall source seam without runtime activation.

It uses only existing frozen synthetic/historical fixtures and in-memory evaluation:

- `auto-recall-policy-holdout.v2b5.jsonl`;
- `selective-recall-gate-holdout.v2c2.jsonl`;
- `retrieval-disclosure-holdout.v2.jsonl`;
- Q6 active-vs-shadow source tests with injected retrieval and DIRECT_CARD dependencies.

Q6-C performs:

```text
provider calls = 0
network calls = 0
live memory reads = 0
Core/Engine/LanceDB reads = 0
Core/Engine/LanceDB writes = 0
runtime/config mutation = 0
prompt injection = 0
reinforcement = 0
deployment = 0
```

The evaluation does not use live traffic and does not estimate production prevalence.

## 2. Evidence separation

Q6-C deliberately does not collapse unlike evidence into one score.

### A. Mechanism correctness

Q6 source tests answer whether shadow computes the same existing card decision while suppressing apply-side effects.

Qualified properties:

- exact-session shadow is default-off and fail-closed;
- active and shadow reuse the same retrieval/gate/DIRECT_CARD decision path;
- one shadow turn performs one retrieval, not an active+shadow double retrieval;
- shadow `would_inject_ids` match the active selected IDs under the same injected deterministic dependencies;
- shadow returns no `prependContext`;
- shadow emits no actual `memory_injected`;
- shadow creates no injected/reinforcement turn-state authority;
- fabricated `cited_memory_ids` after a shadow decision cannot trigger reinforcement;
- non-shadow sessions retain the pre-Q6 active path;
- Q6 envelope excludes prompt text, memory content, card summary and source path.

### B. Structural turn-label diagnostics

The two historical turn-label fixtures can answer whether the remaining structural skip layer blocks cases labeled as requiring recall.

They **cannot** answer whether a search-eligible turn would eventually inject a card, because these fixtures contain no retrieved candidate pool or production DIRECT_CARD result.

### C. Disclosure component diagnostics

The v2 candidate fixture can evaluate selector/capability components against expected `CARD` / `NONE` labels.

It is not a live-equivalent production DIRECT_CARD replay because the fixture does not contain the real canonical source, Owner attestation rows or current production authority binding.

## 3. Structural eligibility results

### AutoRecall policy holdout v2-B5

```text
rows = 48
expected YES = 24
expected NO = 24

expected YES structurally skipped = 0
expected YES search eligible = 24 / 24 = 1.0000

expected NO structurally skipped = 0
expected NO search eligible = 24 / 24
structural NO suppression rate = 0.0000
```

### Selective Recall holdout v2-C2

```text
rows = 48
expected YES = 24
expected NO = 24

expected YES structurally skipped = 0
expected YES search eligible = 24 / 24 = 1.0000

expected NO structurally skipped = 0
expected NO search eligible = 24 / 24
structural NO suppression rate = 0.0000
```

Combined:

```text
expected YES structural false negatives = 0 / 48
expected NO structural suppression = 0 / 48
```

Interpretation:

- the current minimal structural skip layer does not reproduce the earlier deterministic-intent false-negative problem on these two frozen holdouts;
- it also does not attempt to classify the labeled NO cases before retrieval;
- therefore candidate-first moves precision responsibility downstream by design;
- search eligibility on an expected-NO row is **not** itself an AutoRecall false-positive injection.

## 4. Disclosure component results

The v2 fixture contains:

```text
rows/candidates = 48
expected CARD = 18
expected NONE = 30
```

### 4.1 Selector-only component

This intentionally omits the production DIRECT_CARD authority/capability boundary.

```text
TP = 18
FP = 23
TN = 7
FN = 0

selected = 41
precision = 0.4390
recall = 1.0000
specificity = 0.2333

unsafe selected = 23
irrelevant selected = 23
```

This component is **not safe enough to stand alone**.

The result is useful architecturally: retrieval evidence + card shape alone cannot be treated as disclosure authority.

Examples from the per-family result:

- `decision_rationale`: selector-only selects 4/4, including 2 expected-NONE candidates;
- `conflict_boundary`: selector-only selects 2/4, both expected-NONE;
- the same pattern appears in stale/unsafe boundary families.

These are component diagnostics, not claims that current production AutoRecall would inject those candidates.

### 4.2 Capability-constrained synthetic component

The historical bounded capability component applied to the same fixture yields:

```text
TP = 18
FP = 0
TN = 30
FN = 0

selected = 18
precision = 1.0000
recall = 1.0000
specificity = 1.0000

unsafe selected = 0
irrelevant selected = 0
```

For `conflict_boundary`, all 4 candidates are withheld, including the answer-bearing but non-disclosable cases.

This demonstrates the importance of an independent disclosure authority/capability layer. It does **not** prove the live production boundary has 100% precision/recall: the evaluated capability component is historical synthetic evidence, whereas current production additionally binds Owner audience, canonical identity/read, Owner-attested projection, authority version/hash, runtime scope and current risk rules.

## 5. Mechanism qualification

Q6-C reuses the Q6-B source mechanism evidence and adds an offline policy evaluator.

Current focused evidence:

```text
Q6-C evaluator + Q6 mechanism tests = 11 / 11 PASS

Q6-B broader focused config/lifecycle/privacy suite = 60 / 60 PASS
```

The Q6-C evaluator is side-effect-free by construction and reports its evidence roles and limitations explicitly.

## 6. Findings

### Finding 1 — candidate-first structural behavior is behaving as designed

On 48 expected-recall rows across the two frozen turn-level holdouts, the structural gate introduces zero observed false negatives.

The cost is also explicit: it suppresses zero of 48 expected-no rows.

This is not a defect by itself. Candidate-first intentionally shifts the decision from:

```text
classify intent -> maybe retrieve
```

to:

```text
retrieve candidates -> decide whether any candidate/card is actually injectable
```

### Finding 2 — downstream disclosure authority is essential

Selector-only component evidence is far too permissive to serve as the injection decision by itself.

Q6 must preserve the architecture:

```text
candidate gate
+ canonical DIRECT_CARD authority
+ selector
```

and must not collapse it into "retrieved/relevant => inject".

### Finding 3 — current production false-positive rate remains unknown

The available frozen turn fixtures lack actual retrieved candidates.

The disclosure fixture lacks current production canonical/attestation state.

Therefore Q6-C cannot validly report:

- live would-inject precision;
- live false-positive injection rate;
- live candidate prevalence;
- current production DIRECT_CARD precision/recall;
- live latency distribution.

These require runtime-shaped observation, not more relabeling of the same synthetic fixtures.

### Finding 4 — no additional fresh synthetic fixture is required now

The existing fixtures already answer the synthetic questions:

- structural false-negative risk is not reproduced;
- structural NO suppression is intentionally absent;
- selector-only is insufficient;
- a separate capability layer can eliminate the synthetic unsafe/irrelevant disclosures without losing expected CARD cases.

The remaining evidence gap is runtime prevalence/shape, so another synthetic set would add little decision value unless a future concrete source defect needs a focused regression fixture.

## 7. Q6-C adjudication

```text
Q6-C =
PASS_WITH_FINDINGS / OFFLINE QUALIFIED

mechanism correctness =
PASS

shadow zero-side-effect contract =
PASS

structural expected-YES preservation =
48 / 48 across the two frozen holdouts

structural expected-NO suppression =
0 / 48
EXPECTED UNDER CANDIDATE-FIRST / NOT AN INJECTION METRIC

selector-only safety =
FAIL AS STANDALONE DISCLOSURE AUTHORITY

capability-constrained synthetic component =
18 CARD correct / 30 NONE correct

live end-to-end AutoRecall quality =
NOT ESTABLISHED

production prevalence =
NOT ESTABLISHED

fresh synthetic fixture =
NOT REQUIRED

product policy change =
NO CHANGE

Statistical LTR / learned recall policy =
NOT SELECTED
```

## 8. Product decision after Q6-C

Do not restore deterministic intent classification as pre-retrieval authority.

Do not weaken or bypass DIRECT_CARD authority.

Do not retune candidate thresholds from these synthetic component rates.

The current candidate-first/card-first architecture remains the product baseline for the experimental instance.

If further evidence is desired, the next useful step is the separately authorized Q6-D exact-session real-host shadow observation. Its purpose would be to measure:

- candidate retrieval prevalence;
- candidate-gate pass prevalence;
- would-inject prevalence;
- DIRECT_CARD withholding reasons;
- latency/timeout/error shape.

Without manual or independently labeled turns, Q6-D still must **not** report a false-positive ground-truth rate.

Q6-C does not authorize Q6-D, persistent shadow telemetry, deployment, or runtime/config mutation.

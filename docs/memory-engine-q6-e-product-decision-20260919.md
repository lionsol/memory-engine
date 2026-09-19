# Q6-E Shadow AutoRecall Product Decision

Date: 2026-09-19

## Final adjudication

```text
Q6-E =
PASS_WITH_FINDINGS / CLOSED

product decision =
KEEP CURRENT CANDIDATE-FIRST + CARD-FIRST POLICY

new product intervention =
NONE

shadow posture =
KEEP INSTALLED / DEFAULT-OFF / DIAGNOSTIC ONLY

Q6 overall =
PASS_WITH_FINDINGS / CLOSED / NO NEW PRODUCT INTERVENTION

Q7 =
NOT STARTED / NO SELECTED CANDIDATE / NOT AUTHORIZED
```

## 1. Evidence considered

Q6-E uses only already-qualified Q6 evidence:

- Q6-C offline qualification;
- Q6-D host publication/schema failure record;
- Q6-R1 host plugin metadata publication remediation;
- Q6-D2 stable-session-key/runtime-session-ID identity finding;
- Q6-D3 stable-session-key real-host mechanism qualification.

No new provider calls, live user turns, runtime mutation, config mutation, DB/LanceDB mutation, deployment, push or tag are part of Q6-E.

## 2. Q6-C evidence

Q6-C established:

```text
mechanism correctness = PASS
shadow zero-side-effect contract = PASS

expected-YES structural preservation =
48 / 48

expected-NO structural suppression =
0 / 48
(expected under candidate-first; not an injection metric)

selector-only disclosure safety =
FAIL AS STANDALONE AUTHORITY

capability-constrained synthetic component =
18 CARD correct / 30 NONE correct

live end-to-end quality =
NOT ESTABLISHED

production prevalence =
NOT ESTABLISHED
```

Product implication:

- do not restore deterministic intent classification as pre-retrieval authority;
- do not collapse retrieval/relevance into disclosure authority;
- retain an independent DIRECT_CARD capability/authority boundary;
- do not retune candidate thresholds from these synthetic component rates.

## 3. Q6-D2 evidence

Q6-D2 proved that a resumed OpenClaw explicit chat can retain a stable session key while its runtime session ID rotates.

The D2 scope contract bound authorization to runtime session ID and therefore missed the real user turn.

Product implication:

```text
stable sessionKey =
authorization/scope identity

runtime sessionId =
event/trace correlation identity
```

This was an identity-model defect in the Q6 shadow seam, not evidence against candidate-first AutoRecall.

## 4. Q6-D3 evidence

Q6-D3 repaired the identity model and real-host qualified one genuine natural search turn.

Qualified evidence:

```text
stable-key authorization = PASS
runtime session correlation = PASS
shadow decision emitted = 1 / 1 genuine turn
search_executed = 1
candidate_count = 3
candidate_count_after_gate = 0
would_inject = 0
foreign Q6 decisions = 0
memory_injected on shadow trace = 0
memory_reinforced on shadow trace = 0
violations = []
mechanism_pass = true
closeout = PASS
```

The three candidates were withheld by the existing downstream authority/gate path:

```text
raw_log_low_coverage_no_exact x3
```

No DIRECT_CARD boundary error was observed.

This is direct real-host evidence that:

- candidate-first retrieval can execute;
- downstream withholding can reject all retrieved candidates;
- stable-key shadow can observe the decision without applying/injecting;
- the Q6 shadow seam does not require a new recall policy to function.

It is **not** enough evidence to estimate production injection precision, false-positive rate, prevalence or quality.

## 5. Latency finding

The one qualified real-host search turn reported:

```text
retrieval_ms = 8481
decision_ms = 0
total_ms = 8574
```

This is a material observation, but it is a single real-host sample.

Therefore Q6-E records:

```text
latency finding =
PRESENT / NON-BLOCKING FOR POLICY DECISION

latency distribution =
NOT ESTABLISHED

latency retune authority =
NONE
```

Do not change retrieval depth, timeout, provider, gate thresholds or architecture from this one measurement.

If latency becomes a dedicated product objective, it should be measured in a separate bounded performance stage with an explicit latency contract and multiple representative observations.

## 6. Product decisions

### 6.1 Keep candidate-first

Retain:

```text
minimal structural skip
-> retrieve candidates
-> candidate gate
-> canonical DIRECT_CARD authority/capability
-> selector
-> apply only if authorized
```

Do not restore:

```text
deterministic intent classifier
-> hard pre-retrieval recall/no-recall authority
```

Reason:

- Q6-C observed zero structural false negatives on the expected-YES frozen cases;
- the minimal structural layer intentionally does not attempt to classify expected-NO turns;
- downstream capability/authority is the architecture that prevents retrieval from becoming disclosure.

### 6.2 Keep card-first / DIRECT_CARD authority

Do not weaken, bypass or replace DIRECT_CARD authority.

Selector-only Q6-C evidence was too permissive:

```text
18 TP / 23 FP / 7 TN / 0 FN
precision = 0.4390
```

The capability-constrained component withheld the synthetic unsafe/irrelevant cases without losing expected CARD cases.

The D3 real-host turn also demonstrated real downstream withholding of all three retrieved candidates.

### 6.3 No gate or threshold retune

Do not tune:

- structural skip thresholds;
- candidate gate thresholds;
- DIRECT_CARD thresholds;
- adaptive cutoff;
- topK;
- retrieval depth;

from Q6 evidence.

Q6 does not contain a labeled live distribution sufficient to justify such changes.

### 6.4 Keep topK=3

Q6 introduces no evidence requiring a topK change.

```text
topK = 3
```

remains unchanged.

### 6.5 Keep D3 shadow seam installed but default-off

D3 remains useful as a bounded diagnostic seam.

Post-D3 runtime posture:

```text
D3 source = installed
autoRecall.shadow = absent/off
persistent shadow telemetry = off
```

Do not enable shadow globally or persistently.

Future use requires a separate bounded diagnostic authorization if a concrete defect or product question needs it.

### 6.6 No learned recall policy / Statistical LTR

Q6 provides no basis to select:

- Statistical LTR;
- learned recall classifier;
- learned pre-retrieval skip model;
- learned set scorer;
- new provider/model.

Q5 and Q6 remain consistent on this point.

### 6.7 No new synthetic qualification set

Q6-C already answered the synthetic structural/component questions.

The remaining unknowns are live prevalence, end-to-end quality and latency distribution.

Do not create another synthetic holdout without a concrete future source defect or policy hypothesis.

## 7. Existing experimental runtime switches

Q6-E does not mutate or newly authorize the pre-existing experimental runtime switches.

The retained experimental posture remains historically separate from Q6 authority, including:

```text
autoRecall.enabled = true
autoRecall.topK = 3
autoRecall.cardFirstRuntime.enabled = true
explicitSearchRerankProvider.enabled = true
explicitSearchRerankControl.enabled = false
```

Q6-E neither enables nor disables those pre-existing switches.

The only Q6-owned deployed change is the D3 stable-session-key shadow mechanism, left default-off.

## 8. Q7 decision

Q7 was conceived as a later canary/product rollout stage for a selected Q6 intervention.

Q6-E selects no new intervention.

Therefore:

```text
Q7 =
NOT STARTED
NO SELECTED CANDIDATE
NOT AUTHORIZED
```

Do not run a canary merely to repeat the current policy.

A future Q7-like stage would require a new concrete product change with its own evidence and authorization.

## 9. Remaining unknowns

Q6 closes without claiming:

- production AutoRecall precision;
- production false-positive injection rate;
- production candidate prevalence;
- production would-inject prevalence;
- representative latency percentiles;
- end-to-end answer quality improvement from active AutoRecall.

These are real unknowns, but none currently identifies a selected product intervention.

They should not keep Q6 open indefinitely.

## 10. Final decision

```text
KEEP CURRENT CANDIDATE-FIRST POLICY
KEEP CURRENT CARD-FIRST / DIRECT_CARD AUTHORITY
KEEP topK=3

KEEP D3 SHADOW DIAGNOSTIC INSTALLED DEFAULT-OFF

NO STRUCTURAL GATE RETUNE
NO DISCLOSURE THRESHOLD RETUNE
NO LEARNED RECALL POLICY
NO STATISTICAL LTR
NO NEW PROVIDER/MODEL
NO NEW SYNTHETIC HOLDOUT
NO Q7 CANARY

Q6 =
PASS_WITH_FINDINGS / CLOSED / NO NEW PRODUCT INTERVENTION
```

The next roadmap decision should be outside Q6 and should begin only from a concrete product objective or observed defect, not from an obligation to continue the Q6 experiment sequence.

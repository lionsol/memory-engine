# Q6 Shadow AutoRecall Contract v1

Date: 2026-09-19
Status: Q6-A DESIGN CONTRACT FROZEN / Q6-B SOURCE IMPLEMENTED + FOCUSED VERIFIED / DEFAULT OFF / RUNTIME EXECUTION NOT AUTHORIZED

## 1. Decision context

Q6 starts after the Q5 fixed-candidate selection study closed `PASS_WITH_FINDINGS / NO NEW PRODUCT INTERVENTION`.

The live experimental state is not the historical default-off state. The separately authorized experimental instance currently has candidate-first AutoRecall active with:

- `autoRecall.enabled=true`;
- `topK=3`;
- `cardFirstRuntime.enabled=true`;
- trusted scope limited to the configured main/user/interactive-user-chat path;
- `explicitSearchRerankProvider.enabled=true` for explicit search only;
- `explicitSearchRerankControl.enabled=false`.

Therefore Q6 is **not** a pre-activation qualification gate and does not attempt to prove that AutoRecall can be enabled. It is a post-activation decision-observability design for the current candidate-first path.

Q6 does not reopen Q5, does not select Statistical LTR, and does not restore deterministic intent classification as pre-retrieval authority.

## 2. Product question

Q6 asks:

> Can memory-engine separate candidate retrieval and would-inject decision from actual prompt injection, so the current candidate-first AutoRecall policy can be observed and evaluated without changing the model context for shadow-scoped turns?

The design must make these stages independently observable:

```text
trusted runtime eligibility
  -> minimal structural skip
  -> query preparation
  -> candidate retrieval
  -> candidate injection gate
  -> DIRECT_CARD capability / selection
  -> decision envelope
  -> apply or suppress
```

The primary diagnostic distinction is:

```text
candidate retrieved
!= candidate passes injection gate
!= card is authorized/selectable
!= context actually injected
```

## 3. Q6 v1 scope

Q6 v1 is intentionally narrow.

In scope:

1. the existing candidate-first AutoRecall retrieval path;
2. the existing structural skips and trusted runtime gate;
3. the existing `shouldInjectCandidate()` candidate gate;
4. the existing production DIRECT_CARD boundary and selector;
5. current `topK=3`;
6. a default-off exact-session shadow mode;
7. bounded content-free shadow diagnostics;
8. offline equivalence and safety verification before any real-host shadow transaction.

Out of scope:

- changing retrieval channels, fusion weights, candidate depth or topK;
- Recall Hint or query expansion;
- broad reranker/profile retuning;
- Statistical LTR, learned recall policy, learned set scorer or new LLM classifier;
- changing DIRECT_CARD authority;
- raw-memory injection redesign;
- answer-quality judging by an LLM;
- training from live traffic;
- live user-memory sampling during Q6-A;
- provider execution during Q6-A;
- DB/LanceDB/runtime/config mutation during Q6-A.

## 4. Shadow semantics

### 4.1 Definition

A Q6 shadow turn executes the current decision path through DIRECT_CARD selection, then suppresses the apply step.

For the same prompt, trusted runtime context, candidate set, canonical reads and disclosure authority, shadow mode must compute the same candidate/card decision that active mode would have computed.

The Q6 v1 terminal decision is:

```text
would_inject = DIRECT_CARD selection decision == DISCLOSE_CARD
```

This matches the current experimental card-first runtime. Q6 v1 does not define a new raw-text shadow product path.

### 4.2 Shadow must not apply

For a shadow-scoped turn, all of the following are forbidden:

- returning `prependContext`;
- emitting `memory_injected` as an actual-injection event;
- adding shadow IDs to turn-state `injectedIds`;
- adding shadow IDs to reinforcement-allowed state;
- granting citation/reinforcement authority because of the shadow decision;
- reinforcing confidence because of the shadow decision;
- changing topK, retrieval ranking or candidate ordering;
- issuing a second retrieval solely for shadow comparison.

The shadow calculation may perform the same read-only canonical/DIRECT_CARD checks needed to determine what active mode would have selected.

### 4.3 Active path isolation

Q6 source work must not change active behavior for non-shadow turns.

The implementation target is a decision/apply split:

```text
evaluateAutoRecallDecision(...)
  -> decision envelope

applyAutoRecallDecision(...)
  -> prependContext + active events + turn-state authority
```

Shadow mode calls the decision side and does not call the apply side.

This is a conceptual contract; exact function names are not frozen.

## 5. Proposed control shape

The source-stage target is a nested default-off control under the existing AutoRecall authority:

```js
autoRecall: {
  shadow: {
    enabled: false,
    sessionAllowlist: []
  }
}
```

This shape is **design-frozen but not implemented or deployed by Q6-A**.

Rules:

1. `shadow.enabled=false` by default.
2. Enabled shadow requires a non-empty exact `sessionAllowlist`.
3. Shadow cannot widen the existing AutoRecall agent/trigger/chat-type/message-role runtime gate.
4. A matching exact session uses shadow apply-suppression.
5. Non-matching sessions retain the pre-Q6 active/default behavior.
6. No independent shadow `topK` exists; v1 inherits AutoRecall `topK`.
7. v1 is qualified only against the current card-first decision path.
8. Invalid shadow configuration fails closed and must not silently broaden scope.

The design permits later bounded shadow observation while the wider experimental instance remains active; it does not require globally disabling AutoRecall first.

## 6. Shadow decision envelope

The offline/source envelope should use a versioned schema such as:

```text
memory_engine_q6_shadow_autorecall_decision_v1
```

Minimum fields:

```text
schema
mode = shadow
runtime_gate_allowed
runtime_gate_reason
structural_skip_reason
search_executed
focused_query_used
original_input_chars
focused_query_chars

candidate_count
candidate_count_after_gate
direct_card_selected_count
would_inject_count

candidate_decisions[]:
  rank
  bounded memory id
  category
  final_score
  gate_pass
  gate_reason
  capability
  capability_reason
  would_inject

timings:
  retrieval_ms where available
  decision_ms
  total_ms
```

The exact field spelling may be normalized during Q6-B source implementation, but the information classes are frozen.

## 7. Data minimization

Q6 shadow telemetry must not persist:

- raw prompt/query text;
- focused-query text;
- candidate/memory body text;
- card title or summary;
- source path/source hint;
- provider response body;
- arbitrary exception messages;
- assistant answer text;
- full canonical memory objects.

Allowed persistent diagnostics are bounded structural metadata already compatible with the existing AutoRecall privacy posture, including:

- counts;
- booleans;
- bounded reason enums/codes;
- bounded memory IDs already used by current telemetry;
- category;
- bounded numeric scores;
- retrieval source names;
- timing values.

The existing `auto-recall-persistent-telemetry-privacy` discipline remains the minimum privacy contract.

Q6-A does **not** authorize creation of a new persistent event type or live telemetry write.

## 8. Side-effect contract

### Q6-A design

Must have:

```text
provider calls = 0
runtime/config mutation = 0
DB/LanceDB mutation = 0
live user-memory sampling = 0
new telemetry persistence = 0
deployment = 0
```

### Future source/offline qualification

Source tests must prove:

- no prompt-context mutation in shadow;
- no active injection event in shadow;
- no turn-state injection/reinforcement authority in shadow;
- no duplicate retrieval for shadow;
- active-mode output is unchanged outside exact shadow scope;
- decision envelope contains no forbidden content fields.

### Future real-host shadow transaction

A real-host transaction, if separately authorized, may permit only the minimum telemetry persistence explicitly bound by that later authorization. It must not infer that permission from this design contract.

## 9. Evaluation model

Q6 separates **mechanism correctness** from **policy quality**.

### 9.1 Mechanism correctness

The primary source qualification is paired active-vs-shadow decision equivalence under injected deterministic dependencies.

For the same synthetic turn:

```text
active selected IDs
==
shadow would_inject IDs
```

before active apply-side effects are considered.

Also require exact agreement for:

- candidate gate pass/fail;
- DIRECT_CARD selection/withhold;
- reason codes;
- topK truncation;
- structural skips.

### 9.2 Policy-quality diagnostics

Q6 must not treat historical intent labels as runtime authority.

Existing artifacts may be reused as component diagnostics:

- AutoRecall policy fixtures: turn-level `expected_should_recall` behavior;
- Selective Recall holdouts: historical false-positive/false-negative behavior of prior deterministic gates;
- candidate disclosure holdouts: answer-bearing / irrelevant / safe-to-disclose card diagnostics.

These are not production prevalence estimates and do not by themselves establish end-to-end live shadow quality.

Q6 should report, where labels actually support them:

- expected-YES turn would-inject rate;
- expected-NO turn would-inject rate;
- answer-bearing candidate/card disclosure recall;
- irrelevant disclosure count/rate;
- unsafe disclosure count;
- candidate retrieved but gate-rejected count;
- gate-passed but capability-withheld count;
- structural-skip false negatives;
- per-family breakdown.

No new numeric product threshold is frozen in Q6-A. The evidence should first show the observed trade-off before a later product decision selects a threshold or policy change.

## 10. Latency and provider accounting

Shadow must not add a second retrieval pass.

Latency should distinguish:

```text
retrieval
candidate gate
DIRECT_CARD decision
total shadow path
```

where the runtime exposes those boundaries.

Q6 itself introduces no new provider/model. Any future real-host shadow request uses only provider/network behavior already implied by the chosen retrieval path and separately authorized runtime state; Q6 may not silently add an LLM judge, Hint call, extra reranker call or evaluation provider.

## 11. Failure behavior

Shadow is diagnostic and must fail closed with respect to injection.

If shadow evaluation fails:

```text
would_inject_count = 0
shadow_status = error / bounded reason
prependContext = absent
active authority from shadow = none
```

For non-shadow turns, a shadow implementation defect must not alter the existing active path.

No automatic retry/resume is required by this design.

## 12. Q6 stage plan

### Q6-A — design contract

Current stage.

Deliverables:

- this contract;
- current-state/roadmap synchronization;
- no source/runtime mutation.

Exit:

```text
Q6-A = DESIGN CONTRACT FROZEN
```

### Q6-B — source-only decision/apply seam

Status: `SOURCE IMPLEMENTED / FOCUSED VERIFIED / DEFAULT OFF / NO RUNTIME AUTHORITY`.

Implemented source behavior:

- `autoRecall.shadow = { enabled:false, sessionAllowlist:[] }` is present in the manifest and effective config;
- enabled shadow requires `autoRecall.enabled=true`, card-first runtime enabled, and a non-empty exact-session allowlist;
- malformed, duplicate, unknown-field, empty-scope, non-card-first, or inactive-AutoRecall shadow configuration invalidates effective config and normalizes shadow to disabled;
- exact-session scope is case-sensitive and cannot widen the existing trusted AutoRecall runtime gate;
- `memory_engine_q6_shadow_autorecall_decision_v1` projects bounded structural decisions only;
- the envelope includes the full returned candidate gate decision sequence, while DIRECT_CARD capability/selection is attached only to candidates that actually passed the gate;
- exact-session shadow reuses the existing candidate-first retrieval, candidate gate and DIRECT_CARD decision once, then returns no `prependContext`;
- shadow writes no actual `memory_injected` event, does not populate turn-state injected/reinforcement IDs, and a later fabricated `cited_memory_ids` line cannot create reinforcement authority;
- non-shadow sessions retain the prior active path;
- a test-only injected DIRECT_CARD boundary permits active/shadow equivalence verification without provider, DB, canonical-store or runtime mutation.

Source verification:

```text
Q6-focused config/lifecycle/privacy suite = 60/60 PASS
static-check = 851 files PASS
test-integrity = 386 scanned / 0 invalid
OpenSpec strict = 12/12 PASS
git diff --check = PASS
```

An expanded AutoRecall/Card regression excluding the native DIRECT_CARD DB-boundary suite reached `232 PASS / 3 ENVIRONMENT_FAILURE`; the three failures are pre-existing real-SQLite tests in `test/auto-recall.test.js` blocked because the installed `better-sqlite3.node` was built for Node module ABI `137` while the current test process requires ABI `127`. The DIRECT_CARD real-DB boundary suite is blocked by the same environment mismatch. Q6-B does not rebuild native modules or rewrite those tests.

Q6-B performs no real provider call, live runtime/config mutation, DB/LanceDB mutation, deployment, or live user-memory sampling.

### Q6-C — offline qualification

Status: `PASS_WITH_FINDINGS / OFFLINE QUALIFIED / MECHANISM PASS / NO POLICY CHANGE`.

Q6-C reuses the Q6-B active-vs-shadow mechanism tests and adds a side-effect-free in-memory evaluator over the frozen v2-B5 AutoRecall, v2-C2 Selective Recall, and retrieval-disclosure v2 fixtures.

Qualified findings:

- active/shadow decision equivalence and zero-apply semantics remain source-qualified;
- both 48-row turn-label fixtures retain `24/24` expected-YES search eligibility with zero structural false negatives;
- both fixtures also retain `24/24` expected-NO search eligibility, confirming that the candidate-first structural layer intentionally does not provide no-recall precision;
- the 48-candidate disclosure fixture contains `18` expected CARD and `30` expected NONE cases;
- selector-only component behavior is `TP=18 / FP=23 / TN=7 / FN=0`, proving selector/retrieval evidence alone is not sufficient disclosure authority;
- the historical capability-constrained synthetic component is `TP=18 / FP=0 / TN=30 / FN=0`, with zero unsafe/irrelevant selections, supporting retention of an independent capability/authority layer;
- these component rates are not a replay of the current production DIRECT_CARD boundary and are not production prevalence estimates;
- no additional fresh synthetic fixture is required now because the remaining evidence gap is runtime candidate/would-inject prevalence and latency, not another synthetic classification question.

Q6-C does not authorize Q6-D or any runtime/config/telemetry mutation. Report: `docs/memory-engine-q6-shadow-autorecall-offline-qualification-v1.md`.

### Q6-D — optional exact-session real-host shadow observation

Separate explicit Owner authorization required.

Target:

- exact session only;
- no prompt injection;
- bounded content-free telemetry;
- finite turns/executions;
- no new provider family;
- no AutoRecall/topK global mutation beyond the exact bound control needed for the transaction.

Runtime observation measures prevalence/shape/latency. Without labels it is **not** a false-positive ground truth study.

### Q6-E — product decision

Possible outcomes include:

```text
KEEP CURRENT CANDIDATE-FIRST POLICY
TUNE EXISTING PRODUCT-VISIBLE GATE
CHANGE SHADOW/ACTIVE CONTROL SEMANTICS
COLLECT BETTER LABELED EVIDENCE
CLOSE WITH FINDINGS / NO CHANGE
```

Q6 does not automatically escalate to Statistical LTR or a learned recall model.

## 13. Relationship to existing experimental activation

The current active experimental AutoRecall state is pre-existing and outside Q6-A mutation authority.

Q6-A neither activates nor disables it.

The earlier roadmap statement to "treat normal use as the experiment rather than adding another shadow/canary framework" rejected redundant pre-activation qualification machinery. Q6 v1 is narrower: it creates a decision/apply separation so current candidate-first behavior can be inspected without context mutation in specifically authorized shadow turns.

## 14. Frozen Q6-A decision

```text
Q6-A =
DESIGN CONTRACT FROZEN

Shadow meaning =
RUN CURRENT CANDIDATE-FIRST + CARD-FIRST DECISION
BUT SUPPRESS APPLY/INJECTION

topK =
3 / inherited from current AutoRecall config

new recall policy =
NONE

new provider/model =
NONE

Statistical LTR =
NOT SELECTED

runtime execution =
NOT AUTHORIZED

persistent shadow telemetry =
NOT AUTHORIZED

live user-memory sampling =
NOT AUTHORIZED
```

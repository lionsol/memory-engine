# memory-engine Q5 — Fixed-Candidate Evidence Selection Attribution v1

Status: `PASS_WITH_FINDINGS / CLOSED / NO NEW PRODUCT INTERVENTION / Q5-A1 SOURCE QUALIFIED / Q5-A2 NO SIMPLE INTERVENTION SELECTED / Q5-A3 SOURCE QUALIFIED / Q5-A4 STOPPED + CONSUMED / Q5-A5 REAL SCORE CAPTURE PASS / Q5-A6 SCALAR MARGIN NO-GO / Q5-B0 LOCO MO FIXED-POOL EVIDENCE ENTRY SOURCE QUALIFIED / Q5-B1 512-CASE SCORE-CAPTURE POPULATION FROZEN / Q5-B2 REAL SCORE CAPTURE PASS / 512 OF 512 PROVIDER CALLS / BOUNDED PACKET FROZEN / Q5-B3-A ANALYSIS PLAN SOURCE QUALIFIED / Q5-B3-B PASS_WITH_FINDINGS + DEVELOPMENT/VALIDATION ANALYSIS COMPLETE / Q5-B3-C PRODUCT INTERPRETATION CLOSED / Q5-B3-D NO-GO + CLOSED / NO SAFE DEVELOPMENT CONFIG / FINAL SPLIT SEALED + NOT CONSUMED / FIXED TOPK=3 / STATISTICAL LTR NOT SELECTED / NO MODEL TRAINING AUTHORIZED`

## 1. Purpose

Q5 does not begin by assuming Statistical Learning-to-Rank is the next solution.

Q4 established only that, on bounded synthetic evaluations, Recall Hint can recover some evidence that was missing from the candidate pool while final top3 improvement remains sparse. Q5 therefore asks a narrower causal question first:

> When the frozen candidate pool already contains the required evidence but the served top3 is still incomplete, why was complete evidence not selected?

The initial Q5 unit of analysis is one fixed candidate pool plus its frozen downstream ranking/serving result.

The serving budget remains exactly:

```text
topK = 3
```

Q5-A must not increase topK while diagnosing selection failure, because a larger serving budget would confound ranking/selection quality with capacity.

## 2. Q5-A scope

Q5-A is a bounded offline attribution stage. It uses already-frozen candidate/ranking evidence and does not generate a new product candidate pool.

Primary cases:

- the candidate pool is complete for the evaluator's required evidence;
- final top3 is incomplete;
- candidate generation is therefore not the first observed loss.

The attribution must distinguish at least four explanations:

1. **single-item ranking error** — a required candidate exists but receives an insufficient score/rank;
2. **redundancy / lack of complementarity** — multiple served candidates cover the same evidence aspect while another required aspect is omitted;
3. **temporal/version/conflict selection error** — an older, superseded, or wrong-time candidate displaces the required current/version-correct evidence;
4. **top3 capacity infeasibility** — no set of at most three available candidates can cover all required evidence under the frozen evaluator definition.

A fifth diagnostic is mandatory:

5. **ranking-input representation loss** — verify whether the text/features delivered to the ranking stage still preserve the evidence needed to distinguish the required candidate.

## 3. Evidence boundary

Q5-A may use evaluator gold only after the candidate pool and product ranking result are frozen, and only inside offline attribution/oracle code.

Gold information must never be inserted into:

- production query text;
- candidate generation;
- candidate text sent to a product reranker;
- ranking features used by a product candidate;
- runtime configuration;
- live memory.

Gold/evaluator data may be used only to score or classify the already-produced candidate set.

## 4. Fixed-pool top3 oracle

Q5-A should compute one evaluator-only reference:

> For the frozen candidate pool, what is the maximum evidence coverage / Recall-all achievable by selecting at most three candidates?

This is an offline oracle, not a product algorithm.

For each case it should report bounded outputs such as:

```text
pool_gold_complete
oracle_top3_recall_any
oracle_top3_recall_all
oracle_top3_evidence_coverage
oracle_top3_feasible
product_top3_recall_all
oracle_gap
minimum_gold_cover_size   # when determinable from frozen evidence membership
```

Interpretation:

- `oracle_top3_feasible=true` but product top3 incomplete -> selection/ranking failure exists;
- `oracle_top3_feasible=false` -> top3 capacity itself is insufficient under the evaluator;
- product and oracle both incomplete because ranking input lost the discriminating evidence -> representation/input problem must be considered before changing the ranking algorithm.

The oracle may use gold evidence membership during evaluation only. It must not expose gold-derived scores or memberships to any product ranking path.

## 5. Attribution taxonomy

Each analyzed case should receive one primary attribution plus optional secondary findings.

Suggested primary labels:

```text
RANK_SELECTION_ERROR
REDUNDANT_SELECTION
TEMPORAL_VERSION_CONFLICT
TOP3_CAPACITY_LIMIT
RANK_INPUT_INFORMATION_LOSS
MIXED_OR_UNRESOLVED
```

The taxonomy must be evidence-based. It should not infer a temporal/version problem merely because a case belongs to a temporal benchmark family; concrete competing candidate evidence is required.

## 6. Candidate and ranking-input inspection

For every attribution case Q5-A should bind, where already available:

- dataset / case ID;
- frozen candidate IDs;
- frozen pre-rank order/scores;
- frozen rerank input text identity/hash;
- frozen rerank output/order;
- final served top3;
- evaluator-only gold membership;
- source/channel metadata;
- bounded temporal/version/conflict metadata if already part of the product candidate.

The inspection must answer:

- Did every required evidence item reach the candidate pool?
- Did the text passed to the ranker retain the fact that makes each gold candidate relevant?
- Were two or more selected candidates substantively duplicative with respect to required evidence?
- Did an incorrect temporal/version candidate outrank a correct one?
- Could any combination of at most three pool candidates satisfy the evaluator?

## 7. Decision rule after attribution

Q5-A does not select a solution in advance.

After the attribution distribution is frozen:

### If single-item score/rank error dominates

Treat this as a bounded ranking/selection error unless frozen per-candidate score evidence narrows it further. Evaluate the smallest ranking correction first, which may include:

- existing reranker/profile adjustment;
- feature calibration;
- only if data sufficiency and train/validation isolation are established, a Statistical LTR experiment.

### If redundancy / complementarity failure dominates

Prefer a set-aware selection experiment before Statistical LTR, for example a bounded complementarity/diversity selector over already-ranked candidates.

### If temporal/version conflict dominates

Prefer temporal/conflict-aware candidate metadata or selection rules. Do not expect a generic relevance learner to solve missing authority/version semantics by itself.

### If top3 capacity infeasibility is material

Treat serving-budget/evidence-compression design as a separate product decision. Q5-A itself keeps topK=3 and does not increase the budget.

### If ranking-input information loss is material

Repair projection/rerank-input representation before evaluating a stronger ranking learner.

## 8. Statistical LTR entry criteria

Statistical LTR remains a possible later branch, not the Q5 default.

It requires a separate entry decision after Q5-A and must establish at minimum:

- sufficient real labeled queries for the intended distribution;
- stable candidate-generation and feature semantics;
- disjoint train / validation / final-test assignment;
- a frozen feature/label schema;
- a frozen model-selection/objective contract;
- benchmark-gold leakage checks;
- a one-shot final-test consumption rule.

The Q4 synthetic holdout is not sufficient training evidence by itself.

## 9. Q5-A machine contract to build

Q5-A source qualification should add deterministic tooling for:

1. selecting cases with complete frozen pools but incomplete product top3;
2. computing the evaluator-only fixed-pool top3 oracle;
3. calculating minimum required-evidence cover size when the benchmark evidence mapping permits it;
4. detecting exact/near duplicate evidence coverage only from frozen evaluator mappings or deterministic product-visible text analysis, without feeding gold back into product ranking;
5. validating rerank-input identity/content preservation;
6. emitting the attribution taxonomy with bounded evidence;
7. freezing manifest/result SHA-256 identities.

No provider call is required for the first attribution pass.

## 10. Acceptance boundary

Q5-A PASS means only:

```text
FIXED-CANDIDATE ATTRIBUTION CONTRACT FROZEN
TOPK = 3 HELD CONSTANT
TOP3 ORACLE SOURCE QUALIFIED
RANK-INPUT PRESERVATION CHECK SOURCE QUALIFIED
ATTRIBUTION TAXONOMY FROZEN
NO GOLD LEAKAGE INTO PRODUCT PATH
ATTRIBUTION RESULT FROZEN
```

Q5-A PASS does not mean:

- Statistical LTR is selected;
- a model should be trained;
- topK should increase;
- runtime behavior should change;
- Recall Hint should be enabled by default.

## 11. Current decision

```text
Q4 = PASS_WITH_FINDINGS / CLOSED

Q5 =
FIXED-CANDIDATE EVIDENCE SELECTION

Q5-A =
BOUNDED ATTRIBUTION DESIGN

STATISTICAL LTR =
OPTIONAL LATER BRANCH / NOT SELECTED

TOPK =
3 / FROZEN FOR ATTRIBUTION
```

No provider, model training, external service, live runtime/config, DB/LanceDB mutation, deployment, push, or tag is authorized by this document.


## 12. Q5-A1 source qualification result

Q5-A1 was executed entirely offline from the frozen Q4 synthetic result artifacts. It did not rerun retrieval, embedding, reranking, Hint production, or any live runtime path.

The derived fixture binds:

```text
Q4-C1b development result:
source_commit =
4ee4374c31cd41149298b528958e60f42004dc37

result_sha256 =
5d51c8258b5842de9be91b074af64931525ad6fd6fa64972326d8136a32fac89

raw result file sha256 =
fdccf12a52f3fe078e72b4400b559d9b80d6ab364d48810947b15c7832dad391

Q4-C2 holdout result:
source_commit =
d5f75bf95006c9557dd4289164c5e41c058cfc72

result_sha256 =
bf809cd7cc15d737ccce36503f5a036e1e1987870ec558bee10c21f5a035b6d9

raw result file sha256 =
03c09e9af8641e6c2a082004524957142cfe286aaa1570950e515afd41698878
```

The self-contained derived fixture contains `40` frozen Q4 cases and `104` synthetic memory records:

```text
fixture_sha256 =
077b02f16c7bd463eb5f5120930473f653bf5ae37e1a16cdb377e88fd3a6b405
```

Qualified Q5 source:

```text
dd3fb442e03beb73f31745753f2b30c9d5d19acb
```

Clean-source result:

```text
status = PASS
mode = Q5_A_FIXED_CANDIDATE_ATTRIBUTION
worktree_clean = true
provider_requests = 0
model_training_runs = 0

result_sha256 =
6400fecbf92b5b544e972de59d3fce5dad025299b2fa0cc9e8c82a28f2aa2217
```

### Fixed-pool oracle findings

Across the four frozen source/arm groups, Q5-A1 found `35` case snapshots where the candidate pool already contained all required evidence but the served top3 remained incomplete.

For all `35/35`:

- the evaluator-only top3 oracle could reach `Recall-all@3=1`;
- no case required more than three candidate slots;
- the historical canonical rerank projector preserved all candidate texts without truncation;
- therefore no observed case is attributed to top3 capacity infeasibility or rank-input information loss.

This is a bounded result about the Q4 synthetic artifacts. It does not establish that real-query evidence sets always fit into top3.

### Q4 -> Q5 bridge

Seven cases are the strongest downstream-selection examples because Hint changed the candidate pool from incomplete to complete while final top3 still remained incomplete:

```text
Q4-C1b development = 4
Q4-C2 fresh holdout = 3
total = 7
```

Those cases directly demonstrate that candidate recovery and final evidence selection are separable failure stages.

### Attribution distribution

Across all `35` qualifying source/arm snapshots:

```text
RANK_SELECTION_ERROR = 21
REDUNDANT_SELECTION = 14

TEMPORAL_VERSION_CONFLICT = 0
TOP3_CAPACITY_LIMIT = 0
RANK_INPUT_INFORMATION_LOSS = 0
MIXED_OR_UNRESOLVED = 0
```

`RANK_SELECTION_ERROR` is intentionally broad. The frozen Q4 result artifacts do not preserve per-candidate cross-encoder scores, so Q5-A1 does not claim whether the cause is score calibration, model relevance judgment, tie/order behavior, or another rank-local mechanism.

The strongest family-specific pattern is the C2 Hint arm:

```text
pool-complete / top3-incomplete snapshots = 12

multi_facet:
8 / 8 -> REDUNDANT_SELECTION

entity_reference:
4 / 4 -> RANK_SELECTION_ERROR
```

The C2 multi-facet attribution is deterministic from the frozen synthetic corpus roles: required evidence contains both rationale and limitation roles, while served top3 repeatedly over-selects one role and omits the complementary required role. This is evidence of missing complementarity/set-aware selection in this synthetic family, not a claim about the prevalence of duplicate evidence in real traffic.

The C1b development Hint arm has `9` qualifying snapshots and all remain `RANK_SELECTION_ERROR` under the stricter rule; Q5-A1 does not force every multi-facet miss into the redundancy category when the frozen role evidence is insufficient.

### Current product inference

Q5-A1 weakens two candidate explanations for the observed Q4 synthetic failures:

- increasing topK is not required to solve any of the `35` qualifying snapshots;
- repairing canonical rerank text projection is not indicated by these artifacts.

It strengthens two narrower hypotheses:

- some entity/temporal failures require better individual candidate selection/ranking;
- C2 multi-facet failures strongly motivate a bounded complementarity/set-aware selection experiment.

This still does **not** select Statistical LTR. The next Q5 decision should compare the smallest interventions that address these observed failure classes while keeping the frozen candidate pools and topK=`3`.


## 13. Q5-A2 fixed-pool intervention comparison

Q5-A2 compares two deliberately small interventions on the same frozen fixture. Gold is used only for post-selection evaluation and never enters either selector.

Qualified source:

```text
da145008fd88da167d5d442d8e6181cd1dde2d64
```

Clean-source result:

```text
status = PASS
mode = Q5_A2_FIXED_POOL_INTERVENTION_COMPARISON
worktree_clean = true
fixture_sha256 =
077b02f16c7bd463eb5f5120930473f653bf5ae37e1a16cdb377e88fd3a6b405

result_sha256 =
afb98fdd9039ef1334cd41330a9e5d0c7d485b7dd2099af62519f1dd3491e3c1

provider_requests = 0
model_training_runs = 0
```

### Intervention A — pre-rerank top3 diagnostic control

`pre_rerank_top3_v1` simply takes the first three candidates from the frozen pre-rerank Hybrid pool. It exists only to test whether the frozen cross-encoder rerank stage is uniformly beneficial.

It is not uniformly beneficial.

```text
Q4-C1b baseline:
Recall-all@3 0.3125 -> 0.2500
paired Recall-all = 0 improved / 1 regressed / 15 unchanged
paired Recall-any = 0 improved / 4 regressed / 12 unchanged

Q4-C1b Hint:
Recall-all@3 0.3750 -> 0.6250
paired Recall-all = 5 improved / 1 regressed / 10 unchanged
paired Recall-any = 3 improved / 2 regressed / 11 unchanged

Q4-C2 baseline:
Recall-all@3 0.4583 -> 0.3750
paired Recall-all = 0 improved / 2 regressed / 22 unchanged
paired Recall-any = 1 improved / 4 regressed / 19 unchanged

Q4-C2 Hint:
Recall-all@3 0.5000 -> 0.5833
paired Recall-all = 5 improved / 3 regressed / 16 unchanged
paired Recall-any = 5 improved / 4 regressed / 15 unchanged
```

Conclusion:

```text
PRE_RERANK_TOP3 = DIAGNOSTIC ONLY / NOT SELECTED
```

The Hint arms show that the pre-rerank pool order sometimes preserves recovered evidence better than the cross-encoder top3, but the regressions prove that disabling/bypassing reranking is not a valid general fix.

### Intervention B — bounded anchor complementarity mechanism probe

`anchor_complementarity_repair_v1` is a deterministic, product-visible-text-only probe. It triggers only on multi-intent query cues. Among candidates already selected by the frozen reranker, it considers only candidates that have a bounded repeated low-frequency lexical anchor in the first three tokens and a counterpart in the pool. It chooses the anchor/counterpart pair with the best pair-level pre-rerank compactness (`min max(pool-rank pair)`, then `min sum(pool-rank pair)`) and keeps one remaining original top3 candidate.

The rule is intentionally synthetic and narrow. It is not a proposed production parser, entity linker, or general duplicate detector.

Results:

```text
Q4-C1b baseline:
Recall-all@3 0.3125 -> 0.3750
paired Recall-all = 1 improved / 0 regressed / 15 unchanged
paired Recall-any = 0 improved / 0 regressed / 16 unchanged

Q4-C1b Hint:
Recall-all@3 0.3750 -> 0.5000
paired Recall-all = 2 improved / 0 regressed / 14 unchanged
paired Recall-any = 0 improved / 0 regressed / 16 unchanged

Q4-C2 baseline:
Recall-all@3 0.4583 -> 0.5000
paired Recall-all = 1 improved / 0 regressed / 23 unchanged
paired Recall-any = 0 improved / 3 regressed / 21 unchanged

Q4-C2 Hint:
Recall-all@3 0.5000 -> 0.6250
paired Recall-all = 3 improved / 0 regressed / 21 unchanged
paired Recall-any = 0 improved / 1 regressed / 23 unchanged
```

On the seven direct Q4->Q5 bridge cases, the complementarity probe repairs `2/7` Recall-all failures and regresses `0/7` Recall-all cases. This is positive mechanism evidence, but it is not sufficient for product selection because C2 shows a measurable Recall-any tradeoff.

Conclusion:

```text
ANCHOR_COMPLEMENTARITY_REPAIR
= MECHANISM SUPPORTED
= RECALL-ANY SAFETY GATE FAILED
= NOT SELECTED
```

### A2 product decision

Q5-A2 therefore rejects both simple interventions as a product answer:

```text
PRE_RERANK_TOP3
= NOT SELECTED

ANCHOR_COMPLEMENTARITY_REPAIR
= NOT SELECTED

STATISTICAL LTR
= STILL NOT SELECTED
```

The useful result is causal rather than deployable:

- the cross-encoder reranker can both help and hurt recovered evidence;
- set-aware complementarity can recover additional complete evidence sets;
- unconstrained complementarity can also discard the only relevant single item and reduce Recall-any;
- therefore a safe selector needs an explicit individual-relevance constraint or score/margin signal, not diversity alone.

### Signal gap exposed by A2

The frozen Q4 result artifacts preserve candidate-pool order and final rerank top3 IDs, but they do **not** preserve the full per-candidate reranker scores/order for all `20` candidates. Read-only inspection of the retained Q4-C1b/C2 artifact directories found only the final result/attempt JSON files and no additional score-bearing artifact.

Without full frozen reranker scores, Q5 cannot retrospectively test a margin-constrained complementarity rule such as “replace a redundant slot only when the counterpart relevance score is within a bounded margin of the displaced candidate” without making up missing evidence or rerunning the reranker.

The next bounded source/design stage is therefore Q5-A3 Selection-Signal Contract. It should define the minimum future offline evidence required to compare constrained selection safely, while keeping topK=`3`, gold evaluator-only, provider execution separately authorized, and Statistical LTR undecided.

## 14. Q5-A3 selection-signal contract

Q5-A3 is source-qualified without any real provider call.

Qualified source:

```text
706275fd041bc290b786076448b34d0f6ff46cce
```

The contract is implemented by:

```text
lib/benchmark/q5-selection-signal-contract-v1.js
bin/run-q5-selection-signal-contract-v1.mjs
test/q5-selection-signal-contract-v1.test.js
```

Clean-source qualification result:

```text
status = PASS
mode = Q5_A3_SELECTION_SIGNAL_CONTRACT_SOURCE_QUALIFICATION

provider_requests = 0
model_training_runs = 0

qualification packet_sha256 =
a4ffc82cf2911bd4a38629a6a5a17d4c67eb9f6a73bdb48c4b3b8899707823b9
```

The qualification packet is synthetic and proves only that the current canonical rerank source path can satisfy the capture contract. It is not a real Q4/Q5 rerank capture and must not be interpreted as new quality evidence.

### Required future capture signals

For each frozen source/case/arm, a valid capture must contain:

- pre-rerank candidate order/rank for the complete bounded pool;
- SHA-256 of query text rather than raw query text;
- SHA-256 of each candidate text rather than raw candidate text;
- canonical projection lengths and truncation flag;
- one finite reranker score for every submitted candidate;
- complete rerank order/rank for every candidate;
- served top3 as the exact first three reranked IDs;
- frozen adapter identity;
- bounded provider usage counters when available;
- packet/source/fixture SHA identities.

The contract freezes:

```text
topK = 3
candidateDepth = 20

reranker =
SiliconFlow
Qwen/Qwen3-Reranker-0.6B
revision = null
```

### Explicitly forbidden capture content

The packet fails closed if it contains evaluator/product-separation violations, including:

```text
gold*
label*
relevance_label*
evaluator*
answer*
acceptance*
raw query
raw candidate/memory text
documents
prompt
```

This preserves the design boundary:

```text
selection capture = product-visible signals only
gold/evaluator data = separate scoring phase only
```

### Source-path feasibility

Q5-A3 directly qualifies against the existing canonical rerank path, not a hypothetical schema. The current source already exposes:

```text
orderedIds
scores{id -> finite score}
adapterIdentity
usage
projectionMetadata
```

Therefore future score capture does not require a new ranking algorithm or a Statistical LTR implementation. It requires only an explicitly authorized offline execution that persists signals the Q4 benchmark previously discarded.

### Gates

Q5-A3 source qualification passed:

```text
focused A3/rerank/projection = 22/22 PASS
expanded Q5/Q4/Q1/rerank/projection = 34/34 PASS
static check = 831 files PASS
test-integrity = 375 / 0 invalid
OpenSpec strict = 12/12 PASS
git diff --check = PASS
CodeGraph = one directly affected A3 test
A3-only code-review-graph = risk 0.00 / affected flows 0 / test gaps 0
```

### Boundary at A3 source qualification

At the time Q5-A3 closed, the source contract was ready but no real score capture had yet been authorized. A later Owner authorization opened exactly one Q5-A4 transaction, described below. That later authorization does not retroactively change the A3 source-only result.

## 15. Q5-A4 fixed-pool real rerank score-capture transaction

Owner authorized one Q5 fixed-pool rerank score-capture transaction.

The transaction is bounded to the existing Q5 derived fixture:

```text
fixture_sha256 =
077b02f16c7bd463eb5f5120930473f653bf5ae37e1a16cdb377e88fd3a6b405

frozen cases = 40
arms per case = baseline + Hint
planned provider calls = 80

candidateDepth <= 20
topK = 3
```

Provider binding:

```text
provider = SiliconFlow
model = Qwen/Qwen3-Reranker-0.6B
revision = null
endpoint = existing SiliconFlow rerank adapter binding
deadline = 2500ms per rerank
```

The transaction does not authorize embedding calls, Recall Hint producer calls, model training, runtime/config mutation, live DB/LanceDB access, deployment, push or tag.

Execution policy:

```text
one transaction
80 planned provider attempts
no automatic retry
no resume
no replay

first provider attempt consumes the transaction
any provider/capture failure => STOPPED
partial score packets are not accepted
```

Before the first external request the runner must persist an attempt marker. A successful transaction must produce exactly one A3 bounded packet containing only hashed query/candidate text identities plus rank/score/projection/adapter metadata. Raw query text, raw candidate text and evaluator/gold fields must not be persisted in the packet.

The execution source must be committed and the worktree clean before provider calls begin.

### Q5-A4 execution result

The authorized transaction source was frozen at:

```text
91b274aec64170b91713c3854a24e5aa71312a44
```

Zero-egress preflight passed before execution:

```text
fixture_sha256 =
077b02f16c7bd463eb5f5120930473f653bf5ae37e1a16cdb377e88fd3a6b405

case_count = 40
planned_provider_calls = 80
candidateDepth = 20
topK = 3

provider = siliconflow
model = Qwen/Qwen3-Reranker-0.6B
deadline_ms = 2500

credential_available = true
retry_policy = NO_RETRY_NO_RESUME_NO_REPLAY

embedding_calls = 0
hint_producer_calls = 0
model_training_runs = 0
runtime_mutation = false
```

The first provider attempt consumed the transaction. Execution then stopped locally during A3 capture validation:

```text
status = STOPPED
code = Q5_A3_USAGE_COUNT_INVALID

provider_attempts_started = 1
planned_provider_calls = 80

retry_policy = NO_RETRY_NO_RESUME_NO_REPLAY
replay_authorized = false

result.json = absent
bounded A3 packet = not produced
```

Attempt evidence:

```text
/tmp/memory-engine-q5-fixed-pool-rerank-score-capture-v1/
  91b274aec64170b91713c3854a24e5aa71312a44/
    attempt.json
    stop.json
```

The failure was not a frozen-pool eligibility failure and not an HTTP/model-score validation failure. The real SiliconFlow adapter returns bounded usage fields shaped as:

```text
input_tokens
output_tokens
total_tokens
billed_input_tokens
billed_output_tokens
```

with unavailable counters represented as `null`. The A3 capture contract incorrectly accepted only `prompt_tokens/completion_tokens/total_tokens` and rejected `null` counters. Reaching `Q5_A3_USAGE_COUNT_INVALID` therefore means the first provider response had already passed adapter response/score validation and failed only when the local capture layer normalized provider usage metadata.

Historical adjudication:

```text
Q5-A4 REAL SCORE CAPTURE
= STOPPED / CONSUMED
= 1 PROVIDER ATTEMPT
= LOCAL CAPTURE USAGE-SCHEMA CONTRACT FAILURE
= NO RESULT PACKET
= NO RETRY / NO RESUME / NO REPLAY
```

No second provider request was issued.

### Post-transaction source-only repair

The capture contract was repaired after the consumed transaction at:

```text
d0aeb45c4adb018463cf06ffce5e4109b37902dd
fix(benchmark): accept bounded rerank usage schema
```

The repair:

- accepts the existing bounded SiliconFlow usage field names;
- omits unavailable/null usage counters instead of rejecting them;
- preserves non-negative integer validation for counters that are present;
- does not change rerank scores, ordering, fixture, topK, provider identity or transaction history.

Repair qualification:

```text
focused A3/A4/reranker = 20/20 PASS
static check = 833 files PASS
test-integrity = 376 / 0 invalid
OpenSpec strict = 12/12 PASS
git diff --check = PASS
affected flows = 0
```

This repair is future-facing only. It cannot recreate the discarded first response, cannot produce a historical A4 packet, and does not authorize another real provider transaction.

Current boundary after A4 closure:

```text
Q5-A4 = STOPPED / CONSUMED
REAL SCORE PACKET = UNAVAILABLE
STATISTICAL LTR = NOT SELECTED
RUNTIME = UNCHANGED
```

## 16. Q5-A5 independent fixed-pool score-capture transaction

Owner subsequently authorized one new, independent provider execution transaction. Q5-A5 is not a retry/replay/resume of Q5-A4.

It reuses the already repaired A3/A4 source contracts and the same frozen Q5 fixture:

```text
fixture_sha256 =
077b02f16c7bd463eb5f5120930473f653bf5ae37e1a16cdb377e88fd3a6b405

frozen cases = 40
arms = baseline + Hint
planned provider calls = 80
candidateDepth <= 20
topK = 3
```

Provider binding remains:

```text
SiliconFlow
Qwen/Qwen3-Reranker-0.6B
revision = null
deadline = 2500ms
```

Execution policy remains:

```text
one new transaction
no automatic retry
no resume
no replay

first A5 provider attempt consumes A5
any provider/capture failure => A5 STOPPED
A4 remains historically STOPPED/CONSUMED
```

Before freezing the A5 execution source, the transaction summary was also aligned with the real bounded SiliconFlow usage schema:

```text
input_tokens
output_tokens
total_tokens
billed_input_tokens
billed_output_tokens
```

This does not change A4 history; it only prevents A5 summary telemetry from silently reporting zero input usage.

Q5-A5 authorizes only this offline score-capture transaction. It does not authorize embedding, Hint production, model training, runtime/config mutation, live DB/LanceDB access, deployment, push or tag.

### Q5-A5 execution result

The A5 execution source was frozen at:

```text
78f2e029039587040d4f62b4447ed3ddccd15bd5
```

Clean-worktree zero-egress preflight passed with the exact frozen transaction:

```text
fixture_sha256 =
077b02f16c7bd463eb5f5120930473f653bf5ae37e1a16cdb377e88fd3a6b405

case_count = 40
planned_provider_calls = 80
candidateDepth = 20
topK = 3

provider = siliconflow
model = Qwen/Qwen3-Reranker-0.6B
revision = null
deadline_ms = 2500

credential_available = true
retry_policy = NO_RETRY_NO_RESUME_NO_REPLAY

embedding_calls = 0
hint_producer_calls = 0
model_training_runs = 0
runtime_mutation = false
```

A5 then completed successfully:

```text
status = PASS
mode = REAL_FIXED_POOL_RERANK_SCORE_CAPTURE

provider_attempts = 80
provider_successes = 80
provider_attempt_cap = 80

retry_policy = NO_RETRY_NO_RESUME_NO_REPLAY
stop.json = absent
```

The bounded selection-signal packet contains exactly one row for every frozen case/arm:

```text
packet case-arms = 80
unique case-arms = 80
candidate_count per case-arm = 20
all rerank scores finite = true

packet_sha256 =
a148f6f2c5d378442714c8ba3ce6a853e4f895e0d37385f9e075a57f523b8257
```

The transaction result file is:

```text
/tmp/memory-engine-q5-fixed-pool-rerank-score-capture-v1/
  78f2e029039587040d4f62b4447ed3ddccd15bd5/
    attempt.json
    result.json
```

and its file SHA-256 is:

```text
de260944c8ed1792c930e0d7e370bce6e7ee36c382ce4e015d1bb763aa382ea2
```

The bounded packet is also frozen in-repository for reproducible offline analysis:

```text
test/fixtures/q5-fixed-pool-rerank-score-capture-v1.json

pretty-printed file sha256 =
7642921262fdd165a2fff2e4a4c51b8b7f9f973e920c0824e9d4f74e171b44cb
```

The packet passes the A3 validator and contains no forbidden raw query/candidate text, gold, evaluator, answer or acceptance fields. It persists query/candidate text identities only as SHA-256 plus bounded rank/score/projection/provider metadata.

Provider usage preserved by the real adapter is:

```text
input_tokens = 163336
billed_input_tokens = 163336
output_tokens = 0
billed_output_tokens = 0
```

Per-case bounded usage did not report `total_tokens`, so the execution wrapper's numeric aggregate `total_tokens=0` must not be interpreted as zero total consumption; the authoritative available usage measure is the reported input/billed-input count above.

Historical adjudication:

```text
Q5-A5 REAL SCORE CAPTURE
= PASS
= 80 / 80 PROVIDER CALLS SUCCESSFUL
= BOUNDED REAL SCORE PACKET FROZEN
= NO RETRY USED
= RUNTIME UNCHANGED

Q5-A4
= REMAINS STOPPED / CONSUMED
```

A5 supplies the previously missing full per-candidate score/order evidence. It does not itself select a constrained-complementarity rule, does not select Statistical LTR, and does not authorize another provider transaction.

Next boundary:

```text
REAL SCORE PACKET = AVAILABLE
MARGIN-CONSTRAINED FIXED-POOL SELECTION = NOT YET EVALUATED
STATISTICAL LTR = NOT SELECTED
NEW PROVIDER EXECUTION = NOT AUTHORIZED
RUNTIME = UNCHANGED
```


## 17. Q5-A6 margin-constrained fixed-pool selection

Q5-A6 uses only the frozen Q4-derived fixture and the frozen A5 real-score packet. It performs no provider execution and no model training.

Qualified source:

```text
70d2e1f2d50fb41cc904a2d871f6e758c67caf72
```

Clean-source result:

```text
status = PASS
mode = Q5_A6_MARGIN_CONSTRAINED_FIXED_POOL_SELECTION
worktree_clean = true

fixture_sha256 =
077b02f16c7bd463eb5f5120930473f653bf5ae37e1a16cdb377e88fd3a6b405

score_packet_sha256 =
a148f6f2c5d378442714c8ba3ce6a853e4f895e0d37385f9e075a57f523b8257

result_sha256 =
b19b49d961205b937a4d87e8c45b1ad79a3c50e23f83eb5dc765e99b81063ea9

provider_requests = 0
model_training_runs = 0
```

A6 evaluates two monotonic individual-relevance constraints over the same bounded complementarity proposal used in A2:

```text
counterpart_to_displaced_ratio
counterpart_minus_displaced_score
```

Threshold selection is development-only. Q4-C1b development chooses among thresholds with zero paired Recall-any regression, then maximizes paired Recall-all improvements, minimizes Recall-all regressions, and finally chooses the strictest threshold. C2 outcomes do not participate in threshold selection.

### Development-selected ratio constraint

```text
counterpart / displaced score >=
0.9789796214932476

C1b development:
applied = 3 / 6 proposals
Recall-any = 0 improved / 0 regressed / 6 unchanged
Recall-all = 3 improved / 0 regressed / 3 unchanged

C2 at frozen development threshold:
applied = 0 / 16 proposals
Recall-any = 0 improved / 0 regressed / 16 unchanged
Recall-all = 0 improved / 0 regressed / 16 unchanged
```

### Development-selected additive-margin constraint

```text
counterpart_score - displaced_score >=
-0.020735740661621094

C1b development:
applied = 3 / 6 proposals
Recall-any = 0 improved / 0 regressed / 6 unchanged
Recall-all = 3 improved / 0 regressed / 3 unchanged

C2 at frozen development threshold:
applied = 0 / 16 proposals
Recall-any = 0 improved / 0 regressed / 16 unchanged
Recall-all = 0 improved / 0 regressed / 16 unchanged
```

For both scalar constraint families, an exhaustive threshold sweep over the frozen C2 proposal values finds:

```text
exists threshold with:
  C2 Recall-any regressions = 0
  and C2 Recall-all improvements > 0

result = false
```

This is the key A6 finding. The real reranker score packet shows that complementary evidence can receive a much lower single-candidate relevance score than the candidate it would need to replace. The development improvements have counterpart/displaced score ratios near `0.979–0.990`, while several C2 completeness improvements require counterparts with ratios far below that range. Conversely, relaxing the scalar constraint enough to admit those C2 counterparts also admits cases that lose the only relevant selected item and regress Recall-any.

A6 therefore does **not** freeze a product threshold. It also does not introduce a post-hoc arm-specific or C2-informed threshold after observing the holdout outcomes.

Historical adjudication:

```text
Q5-A6 SCALAR MARGIN CONSTRAINTS
= SOURCE QUALIFIED
= DEVELOPMENT GAIN REPRODUCED
= C2 TRANSFER = NONE AT DEVELOPMENT-SELECTED THRESHOLDS
= NO MONOTONIC RATIO/MARGIN THRESHOLD WITH C2 SAFE GAIN
= PRODUCT RULE NO-GO
```

Interpretation is bounded to the Q4 synthetic fixed-pool evidence. A6 does not prove that all set-aware selectors fail. It proves that **a monotonic guard built only from the individual reranker score of the counterpart versus the displaced item is insufficient on this frozen evidence**.

## 18. Q5-B real fixed-pool evidence entry design

Q5 has now exhausted the useful conclusions available from repeatedly tuning small heuristics on the 40-case Q4 synthetic fixture:

- A1 showed the failures are selection failures rather than top3 capacity or projection loss;
- A2 showed complementarity can improve Recall-all but can regress Recall-any;
- A5 supplied the missing real per-candidate rerank scores;
- A6 showed simple scalar score margins cannot resolve that tradeoff without losing C2 gain.

The next stage should therefore **not** add another heuristic to the same synthetic cases and should not jump directly to Statistical LTR.

Q5-B is an evidence-entry stage for a broader fixed-pool selection corpus. Before selecting a pair/set-aware algorithm, Q5-B should freeze a larger labeled population with:

- fixed candidate pools produced independently of evaluator labels;
- complete product-visible pre-rerank order and canonical projection identity;
- complete per-candidate rerank score/order using a frozen model/profile;
- final served top3;
- evaluator-only required-evidence mapping kept outside the product signal packet;
- explicit case-level split/isolation if any fitting or threshold selection will occur;
- enough non-synthetic or independently sourced cases to estimate whether redundancy/complementarity failures are material outside the Q4 synthetic families.

Existing LongMemEval/LoCoMo evidence may be used as controlled benchmark evidence where its provenance and gold boundaries satisfy the contract, but it must not be mislabeled as representative real-user traffic. Live/user-memory sampling is not authorized by this design.

Q5-B should answer two questions before any model-family decision:

1. Does the `RANK_SELECTION_ERROR` versus `REDUNDANT_SELECTION` split persist at materially larger scale?
2. Are product-visible pair/set signals sufficient to improve Recall-all without measurable Recall-any regression, or is supervised learning/set-aware scoring justified by the data?

Current boundary:

```text
Q5-A6 = CLOSED / SCALAR MARGIN NO-GO
Q5-B = REAL FIXED-POOL EVIDENCE ENTRY DESIGN
NEW PROVIDER EXECUTION = NOT AUTHORIZED
MODEL TRAINING = NOT AUTHORIZED
STATISTICAL LTR = NOT SELECTED
LIVE USER/MEMORY SAMPLING = NOT AUTHORIZED
RUNTIME = UNCHANGED
```


## 19. Q5-B0 LoCoMo fixed-pool evidence entry

Q5-B0 imports the preserved 1,970-case LoCoMo frozen candidate population without rerunning retrieval and without any provider call.

Qualified source:

```text
910afe16df59a4d77125384afe6ad2298947298c
```

Clean-source result:

```text
status = PASS
mode = Q5_B0_REAL_FIXED_POOL_EVIDENCE_ENTRY
worktree_clean = true
provider_requests = 0
model_training_runs = 0

manifest_sha256 =
f9262cd548c8a145da32da20f46a53872cab0310661d5b3a3055f5925ca9afe0
```

Frozen repository fixture:

```text
test/fixtures/q5-b0-real-fixed-pool-evidence-entry-v1.json

pretty-file sha256 =
c26f9a2feb69296f0cf6bcd48ae2c035abaf55550c153fe6a2597f314042fb05
```

The source material is bound to the historical frozen LoCoMo candidate artifacts:

```text
benchmark = LoCoMo
source_profile = q3_locomo_chunk_fts_only_v1
candidate_generation = frozen_fts_only_not_production_hybrid
production_equivalent_candidate_generation = false
candidateDepth = 20
topK = 3

candidate_manifest_sha256 =
47c7d5f601e5a7ac11efc26e5ac7a3f0b0b7b9082875377768b965e6a5dba789

overlay_sha256 =
608c7da6fb91e818628dea29669cd247c6c11666239c38f30dfa776af91a6567

control_score_sha256 =
4823571187ed8900ec3a089cc3a63edfdde1f61357cf6ff1fafdba8c71cb3f28
```

This boundary is important: B0 is a larger controlled fixed-pool benchmark, **not** evidence that the historical FTS-only candidate distribution is production-equivalent to the current hybrid/semantic product path.

### Sample-level split

Q5-B0 prevents conversation-level leakage by assigning whole LoCoMo `sample_id` groups rather than individual QA cases.

The 10 samples are deterministically split by SHA-256 into `6/2/2` sample groups:

```text
development:
6 samples / 1,156 cases

validation:
2 samples / 386 cases

final_evaluation:
2 samples / 428 cases
```

No sample crosses a split.

The final split is a benchmark final partition, not a fully blinded external test: B0 itself records diagnostic labels for governance. Any later threshold/model selection must therefore avoid using final outcomes until a one-shot evaluation stage and must not describe this partition as an untouched external holdout.

### Larger selection-failure population

Across all 1,970 cases:

```text
protect = 888
recoverable_rank_miss = 433
candidate_miss = 550
top3_budget_infeasible = 99
```

`recoverable_rank_miss` has the Q5-relevant structure:

```text
control Recall-all@3 = 0
gold evidence count <= 3
gold complete in top20 = true
```

so the fixed pool contains sufficient evidence and top3 has enough slots, yet the control top3 is incomplete.

By split:

```text
development recoverable_rank_miss = 257
validation recoverable_rank_miss = 90
final_evaluation recoverable_rank_miss = 86
```

B0 therefore expands the observable selection-failure population from Q4's small synthetic set to hundreds of benchmark-derived cases, while retaining the explicit caveat that candidate generation is historical FTS-only.

The frozen B0 manifest persists no raw query, no raw candidate text and no evidence IDs. It stores only bounded identities/hashes plus gold-derived aggregate classification required for offline population governance. `egress_decision=UNKNOWN`; B0 grants no provider authority.

## 20. Q5-B1 bounded score-capture population

Q5-B1 freezes a bounded population for a future Qwen3 score capture. It does not execute the provider.

Qualified source:

```text
933874cf934085be08d47e1a54283eb7c3f4e7d2
```

Clean-source result:

```text
status = PASS
mode = Q5_B1_SCORE_CAPTURE_MANIFEST
worktree_clean = true
provider_requests = 0
model_training_runs = 0

manifest_sha256 =
a4e3cadb8af68f2ec6a3016e42757a0025f6b1e81edf841aafff099a64d43d77
```

Frozen repository fixture:

```text
test/fixtures/q5-b1-score-capture-manifest-v1.json

pretty-file sha256 =
3bbb77c2d12e0f76cbffca650dcc5eb78dc630a59d74bd2822441ad8f316afa2
```

The capture population is:

```text
development = 256
  128 recoverable_rank_miss
  128 protect

validation = 128
  64 recoverable_rank_miss
  64 protect

final_evaluation = 128
  unconditional deterministic hash sample

TOTAL = 512 cases
```

Development and validation deliberately balance recoverable selection failures against protection cases. Candidate-miss and top3-budget-infeasible cases are excluded from these design populations because reranking cannot repair missing candidates or an insufficient serving budget.

Final selection is different: the 128 final cases are sampled by case-id hash without using diagnostic stratum, category, gold count or gold completeness. This prevents B1's final-case selection itself from being outcome-conditioned. The final partition remains `ONE_SHOT_BENCHMARK_FINAL / NOT_A_FULLY_BLINDED_EXTERNAL_TEST` because B0 diagnostic metadata already exists.

The B1 capture manifest intentionally removes all gold-derived fields from each provider-facing row. It includes only:

```text
case_id
sample_id
split
selection_reason
query_sha256
candidate_count
ordered_candidate_ids_sha256
canonical_texts_sha256
control_top3_sha256
```

It contains no raw query, candidate text, evidence IDs, diagnostic stratum, category, gold count or gold-completeness flag.

Future score-capture binding is frozen to:

```text
provider = siliconflow
model = Qwen/Qwen3-Reranker-0.6B
revision = null
candidateDepth <= 20
topK = 3
```

## 21. Q5-B2 score-capture source qualification

Q5-B2 now has a source-qualified, one-shot execution path, but no real provider execution has been authorized.

Qualified source:

```text
79cb320b13e5e43f0946969378e7d71e8c91efa1
```

The execution source binds the exact B1 manifest, reloads the historical frozen LoCoMo material, and fails closed before provider adapter creation unless every selected case reproduces:

```text
case_id / sample_id
query_sha256
candidate_count
ordered_candidate_ids_sha256
canonical_texts_sha256
control_top3_sha256
canonical reprojection identity
SiliconFlow Qwen3 token-limit preflight
```

The runner freezes:

```text
provider = siliconflow
model = Qwen/Qwen3-Reranker-0.6B
revision = null

planned provider attempts = 512
provider attempt cap = 512
retry policy = NO_RETRY_NO_RESUME_NO_REPLAY

deadline = 5000ms
candidateDepth <= 20
topK = 3

embedding calls = 0
candidate generation runs = 0
Hint producer calls = 0
model training runs = 0
runtime mutation = false
```

The 5000ms deadline and token eligibility use the existing C1A/Qwen3 provider contract rather than the shorter A5 transaction profile. Per-case local preflight enforces:

```text
maxQueryTokens = 4096
maxDocumentTokens = 8192
maxPairTokens = 12288
specialTokenReservePerPair = 256
```

### Clean-source zero-egress preflight

On clean source `79cb320b...`, B2 preflight returned:

```text
status = PASS
worktree_clean = true

source_b1_manifest_sha256 =
a4e3cadb8af68f2ec6a3016e42757a0025f6b1e81edf841aafff099a64d43d77

planned_provider_calls = 512
provider_attempt_cap = 512

split counts:
development = 256
validation = 128
final_evaluation = 128

candidate_count_total = 9,734

estimated_input_tokens_upper_bound =
17,162,046

credential_available = true
deadline_ms = 5000
```

`estimated_input_tokens_upper_bound` is the conservative UTF-8 byte-based Qwen3 request-token upper bound including repeated query/pair reserve accounting. It is **not** an expected billed-token count or cost estimate.

Preflight created no transaction evidence:

```text
attempt.json = absent
result.json = absent
stop.json = absent
```

The future executor is one-shot: the first real provider attempt would consume that source-bound transaction; any provider/capture failure would stop immediately, and no retry/resume/replay is permitted without a new Owner authorization.

B2 tests use only a fake adapter and establish exact 512-call behavior, first-failure stop semantics, pre-egress material/hash rejection, and bounded score packet output without raw query/candidate text or gold/evaluator fields.

### Current Q5-B boundary

```text
Q5-B0 = SOURCE QUALIFIED / 1,970 CASE EVIDENCE CORPUS FROZEN
Q5-B1 = SOURCE QUALIFIED / 512 CASE CAPTURE POPULATION FROZEN
Q5-B2 = SOURCE QUALIFIED / ZERO-EGRESS PREFLIGHT PASS
Q5-B2 REAL PROVIDER EXECUTION = AUTHORIZED / PREPARED / NOT YET EXECUTED

NEW PROVIDER CALLS = 0
MODEL TRAINING = NOT AUTHORIZED
STATISTICAL LTR = NOT SELECTED
LIVE USER/MEMORY SAMPLING = NOT AUTHORIZED
RUNTIME = UNCHANGED
```


## 22. Q5-B3-A fixed-pool analysis plan

Q5-B3-A source-qualifies the downstream analysis contract without fabricating or substituting a real B2 score packet.

Qualified source:

```text
57136f1920f416c2531078f3007adfaf368f95ac
```

Clean-source result:

```text
status = PASS
mode = Q5_B3_FIXED_POOL_ANALYSIS_PLAN
worktree_clean = true
provider_requests = 0
model_training_runs = 0

source_b0_manifest_sha256 =
f9262cd548c8a145da32da20f46a53872cab0310661d5b3a3055f5925ca9afe0

source_b1_manifest_sha256 =
a4e3cadb8af68f2ec6a3016e42757a0025f6b1e81edf841aafff099a64d43d77

plan_sha256 =
f5172f9c82e27b5e04654d16c1a3c913dcd5f91928ee04ad127c016a04467b15
```

The plan binds all `512` B1-selected cases back to B0 and fails closed unless each case preserves:

```text
case_id
sample_id
split
query_sha256
candidate_count
ordered_candidate_ids_sha256
canonical_texts_sha256
control_top3_sha256
```

Population:

```text
development = 256
validation = 128
final_evaluation = 128
unique LoCoMo samples = 10
```

### Final split sealing

B3-A makes `final_evaluation` sealed by default:

```text
exploration_splits = development + validation
final_outcomes_visible_by_default = false
final_consumption_requires_explicit_one_shot_authority = true
```

The source contract also rejects accidental result envelopes containing fields such as:

```text
final_metrics
final_outcomes
final_case_results
final_evaluation_results
```

before explicit final-consumption authority exists.

This is deliberately stricter than merely documenting that final should not be inspected. The default analysis path is machine-bound not to surface final outcomes.

### Evaluator boundary

LoCoMo evidence labels are turn-level while the fixed candidate pool contains chunk IDs. Therefore B3-A explicitly freezes:

```text
direct_candidate_id_equals_gold_id = false
```

and requires the existing evaluator mapping:

```text
scoreLocomoChunkCase
evaluateLocomoChunkEvidenceCoverage
```

The future B2 packet remains product-signal-only:

```text
contains_gold_fields = false
evaluator join key = case_id
gold source = historical LoCoMo material, evaluator-only
```

This prevents the Q4 direct-ID evidence assumption from being incorrectly reused for LoCoMo.

### Planned pre-final analysis outputs

Once a real B2 packet exists, B3-B may compute on development/validation only:

```text
rerank top3 Recall-any@3
rerank top3 Recall-all@3
rerank top3 evidence coverage@3
pool gold completeness
top3 budget feasibility
selection-failure counts
protect regressions
score/rank distributions
pair/set signal diagnostics
```

B3-A does not select a pair/set algorithm, threshold or model family.

### Qualification gates

```text
focused B0/B1/B2/B3 = 20/20 PASS
static check = 844 files PASS
test-integrity = 382 / 0 invalid
OpenSpec strict = 12/12 PASS
git diff --check = PASS
CodeGraph = one directly affected B3 test
code-review-graph = risk 0.00 / affected flows 0 / test gaps 0
```

### Current Q5-B boundary

```text
Q5-B0 = SOURCE QUALIFIED / 1,970 CASE EVIDENCE CORPUS FROZEN
Q5-B1 = SOURCE QUALIFIED / 512 CASE CAPTURE POPULATION FROZEN
Q5-B2 = SOURCE QUALIFIED / ZERO-EGRESS PREFLIGHT PASS
Q5-B2 REAL PROVIDER EXECUTION = AUTHORIZED / PREPARED / NOT YET EXECUTED
Q5-B3-A = SOURCE QUALIFIED / FINAL SPLIT SEALED
Q5-B3-B = NOT STARTED / WAITING FOR REAL B2 PACKET

NEW PROVIDER CALLS = 0
MODEL TRAINING = NOT AUTHORIZED
STATISTICAL LTR = NOT SELECTED
LIVE USER/MEMORY SAMPLING = NOT AUTHORIZED
RUNTIME = UNCHANGED
```


## 23. Q5-B2 real provider execution result

Owner authorized one Q5-B2 real provider execution transaction. It executed on clean source:

```text
9e6154e761a4d6301a021d8e785d20e144da6232
```

The clean zero-egress preflight bound:

```text
source_b1_manifest_sha256 =
a4e3cadb8af68f2ec6a3016e42757a0025f6b1e81edf841aafff099a64d43d77

planned_provider_calls = 512
provider_attempt_cap = 512

split counts:
development = 256
validation = 128
final_evaluation = 128

candidate_count_total = 9,734
estimated_input_tokens_upper_bound = 17,162,046

provider = siliconflow
model = Qwen/Qwen3-Reranker-0.6B
revision = null
deadline_ms = 5000
retry_policy = NO_RETRY_NO_RESUME_NO_REPLAY
```

The transaction completed successfully:

```text
status = PASS
mode = REAL_FIXED_POOL_RERANK_SCORE_CAPTURE

provider_attempts = 512
provider_successes = 512
provider_attempt_cap = 512

stop.json = absent
```

The bounded score packet contains:

```text
case_count = 512
unique_case_ids = 512

split counts:
development = 256
validation = 128
final_evaluation = 128

candidate_count_total = 9,734
candidate_count_min = 1
candidate_count_max = 20
all rerank scores finite = true
contains_gold_fields = false

packet_sha256 =
ebf1cadc0204fb2e81e2603f8d1027785446d03cafd64c1e3ad434b4c8fcd598
```

Transaction artifacts:

```text
/tmp/memory-engine-q5-b2-fixed-pool-score-capture-v1/
  9e6154e761a4d6301a021d8e785d20e144da6232/
    attempt.json
    result.json
```

No `stop.json` exists.

The transaction result file SHA-256 is:

```text
459ca83cfe33a3eaef099e68ffcb4509c61c5a986d59cafc338d8a747c5998b5
```

The bounded packet is frozen in-repository as:

```text
test/fixtures/q5-b2-real-score-capture-v1.json

pretty-file sha256 =
3f43e979901ee618d53cdbc577c498570b8451c1797da781992918cf04a8c9be
```

A recursive field audit found zero forbidden raw/evaluator fields:

```text
raw query = absent
raw candidate/memory text = absent
gold fields = absent
evaluator fields = absent
answer fields = absent
acceptance fields = absent
```

Reported real provider usage:

```text
input_tokens = 4,114,281
billed_input_tokens = 4,114,281
output_tokens = 0
billed_output_tokens = 0
```

Per-case bounded usage did not report a reliable aggregate `total_tokens`; therefore wrapper `total_tokens=0` must not be interpreted as zero total consumption. The authoritative available usage measure is the reported input/billed-input count above.

During orchestration, one additional runner invocation encountered the already-present attempt marker and was rejected with `Q5_B2_TRANSACTION_ALREADY_CONSUMED` before any provider call. Final provider attempts remained exactly `512`, confirming the guard prevented duplicate egress.

Historical adjudication:

```text
Q5-B2 REAL SCORE CAPTURE
= PASS
= 512 / 512 PROVIDER CALLS SUCCESSFUL
= NO RETRY USED
= BOUNDED REAL SCORE PACKET FROZEN
= RUNTIME UNCHANGED
```

The B2 packet now satisfies the B3-A required product-signal input. It does not unseal `final_evaluation` and does not itself authorize B3-B final consumption, model training, Statistical LTR, live user/memory sampling, runtime changes, or further provider execution.

Current boundary:

```text
Q5-B0 = SOURCE QUALIFIED / 1,970 CASE EVIDENCE CORPUS FROZEN
Q5-B1 = SOURCE QUALIFIED / 512 CASE CAPTURE POPULATION FROZEN
Q5-B2 = PASS / REAL SCORE PACKET FROZEN
Q5-B3-A = SOURCE QUALIFIED / FINAL SPLIT SEALED
Q5-B3-B = PASS_WITH_FINDINGS / DEVELOPMENT + VALIDATION OFFLINE ANALYSIS COMPLETE

FINAL_EVALUATION = SEALED / NOT CONSUMED
NEW PROVIDER EXECUTION = NOT AUTHORIZED
MODEL TRAINING = NOT AUTHORIZED
STATISTICAL LTR = NOT SELECTED
PAIR/SET ALGORITHM = NOT SELECTED
THRESHOLD = NOT SELECTED
LIVE USER/MEMORY SAMPLING = NOT AUTHORIZED
RUNTIME = UNCHANGED
```


## 24. Q5-B3-B development + validation offline analysis

Q5-B3-B executed the source-qualified B3-A analysis plan against the frozen B2 real score packet and the historical frozen LoCoMo evaluator material. The analysis consumed only the `development` and `validation` splits.

Source implementation:

```text
lib/benchmark/q5-b3-development-validation-analysis-v1.js
bin/run-q5-b3-development-validation-analysis-v1.mjs
test/q5-b3-development-validation-analysis-v1.test.js
```

Frozen input identities:

```text
B3-A plan_sha256 =
f5172f9c82e27b5e04654d16c1a3c913dcd5f91928ee04ad127c016a04467b15

B2 packet_sha256 =
ebf1cadc0204fb2e81e2603f8d1027785446d03cafd64c1e3ad434b4c8fcd598
```

Offline result identity:

```text
result_sha256 =
6faba982cc421742666c98be5380c665e5bae9b8157c75f17d9a913ebf9b2af0

provider_requests = 0
model_training_runs = 0
final_evaluation_consumed = false
threshold_selection_performed = false
pair_set_algorithm_selected = false
statistical_ltr_selected = false
runtime_mutation = false
```

The analysis recomputes LoCoMo evidence coverage through the existing source-offset evaluator semantics. Its bounded top3 oracle is cross-checked per case against the existing scorer on the observed control and rerank selections, and it fails closed on semantic drift.

### Development result

The selected development population is deliberately balanced rather than distribution-representative:

```text
cases = 256
recoverable_rank_miss = 128
protect = 128

control:
Recall-any@3 = 0.53515625
Recall-all@3 = 0.50000000
evidence coverage@3 = 0.51692708

Qwen3-0.6B rerank:
Recall-any@3 = 0.91796875
Recall-all@3 = 0.89453125
evidence coverage@3 = 0.90690104

recoverable fixed = 104 / 128
recoverable still incomplete = 24 / 128
protect preserved = 125 / 128
protect regressions = 3 / 128

pool gold complete = 256 / 256
actual top3 feasible = 256 / 256
residual selection failures = 27
```

For the 27 residual feasible selection failures:

```text
single-swap repairable = 25 / 27
requires at least two additions = 2 / 27
successful single-swap cases with a redundant displaced served item = 25 / 25

best repair candidate rerank rank:
4 = 8
5 = 5
6-10 = 11
11-20 = 1

best repair candidate score - weakest served score:
median = -0.00858808
p25 = -0.07564330
p75 = -0.00238174
```

### Validation result

The validation population is also deliberately balanced:

```text
cases = 128
recoverable_rank_miss = 64
protect = 64

control:
Recall-any@3 = 0.50781250
Recall-all@3 = 0.50000000
evidence coverage@3 = 0.50390625

Qwen3-0.6B rerank:
Recall-any@3 = 0.92968750
Recall-all@3 = 0.92187500
evidence coverage@3 = 0.92578125

recoverable fixed = 55 / 64
recoverable still incomplete = 9 / 64
protect preserved = 63 / 64
protect regressions = 1 / 64

pool gold complete = 128 / 128
actual top3 feasible = 128 / 128
residual selection failures = 10
```

For all 10 residual validation failures:

```text
single-swap repairable = 10 / 10
successful single-swap cases with a redundant displaced served item = 10 / 10

best repair candidate rerank rank:
4 = 2
5 = 1
6-10 = 4
11-20 = 3

best repair candidate score - weakest served score:
median = -0.05002818
p25 = -0.20642710
p75 = -0.02113002
```

### Representation and attribution findings

Across the analyzed development/validation population:

```text
candidate projection truncation cases = 0
served truncated candidates = 0
best single-swap repair candidates truncated = 0
```

Therefore the observed residual failure is not explained by the frozen projection truncation boundary.

The residual pattern does **not** support reducing the problem to one scalar-score calibration defect. In all 35 residual cases that are repairable with one replacement, a complete top3 can be obtained by replacing a served candidate that is redundant with respect to already-covered evaluator evidence, while the omitted complementary candidate is ranked below the weakest served item by the independent reranker score. The observed failure therefore contains both:

```text
independent relevance under-ranking
+
served-set complementarity / redundancy
```

This is an attribution finding, not authorization for a set-aware selector. B3-B selects no pair/set algorithm, score threshold, learned model, or Statistical LTR branch.

### B3-B adjudication

```text
Q5-B3-B =
PASS_WITH_FINDINGS
DEVELOPMENT + VALIDATION OFFLINE ANALYSIS COMPLETE

FINAL_EVALUATION =
SEALED / NOT CONSUMED

NEW PROVIDER EXECUTION = 0
MODEL TRAINING = 0
RUNTIME / CONFIG / DB / LANCEDB MUTATION = 0
STATISTICAL LTR = NOT SELECTED
PAIR/SET ALGORITHM = NOT SELECTED
THRESHOLD = NOT SELECTED
```

The aggregate Recall numbers above must not be presented as production-distribution estimates because development and validation were intentionally balanced between `recoverable_rank_miss` and `protect`. They are diagnostic selection-population results.

The next bounded step is a product interpretation/design decision using these findings. It must decide whether the evidence justifies a minimal product-visible complementarity experiment, a narrower reranker correction experiment, or closing the branch without another intervention. That decision occurs before any final-evaluation consumption. The sealed `final_evaluation` split still requires separate explicit one-shot authority.


## 25. Q5-B3-C product interpretation / intervention decision

B3-C reviews the frozen B3-B development/validation result together with the earlier Q5-A2/A6 intervention evidence. It is a product decision stage only. It does not consume `final_evaluation`, execute a provider, train a model, or change runtime behavior.

### Decision-critical evidence

B3-B establishes three facts on the balanced LoCoMo development/validation selection population:

```text
Qwen3-0.6B already repairs most recoverable rank misses:
development = 104 / 128
validation  = 55 / 64

protect regressions remain small:
development = 3 / 128
validation  = 1 / 64

residual feasible selection failures:
development = 27
validation  = 10

single-swap repairable:
development = 25 / 27
validation  = 10 / 10

successful single-swap cases where a served item
redundant with respect to already-covered evaluator evidence
can be displaced:
35 / 35
```

At the same time, every best single-swap repair candidate is scored below the weakest currently served candidate by the independent reranker. The validation median repair-score gap is approximately `-0.0500`, and some required complementary candidates are much farther below the cutoff.

Earlier Q5-A6 already established that a monotonic rule based only on counterpart/displaced reranker score ratio or additive score margin does not transfer safely across the frozen synthetic development/holdout evidence.

B3-B also found zero candidate projection truncation in the analyzed development/validation population, so projection truncation is not the current first observed loss.

### Route comparison

#### Broad reranker/profile correction — not selected

A broad reranker correction is not the next experiment.

The existing Qwen3-0.6B reranker already resolves most selected recoverable failures while preserving almost all protect cases. The remaining failures have a repeated set-level structure: a lower-scored complementary candidate can replace an evaluator-redundant served candidate.

Changing the reranker profile/model globally before testing whether product-visible set structure can identify those cases would target a broader component than the observed residual failure requires and risks disturbing the large already-correct population.

This does not prove the reranker is optimal. It means the present causal evidence does not justify making reranker/profile retuning the first next intervention.

#### Statistical LTR / learned set scorer — not selected

Statistical LTR remains premature.

B3-B supplies benchmark labels and per-candidate scores, but it has not yet shown that a stable product-visible feature family separates safe complementarity repairs from harmful replacements. Development and validation are deliberately outcome-balanced rather than representative traffic, and the historical FTS-only candidate path is explicitly not production-equivalent.

Training a learned ranker/set scorer now would therefore skip the simpler question of whether the residual failure is observable from deterministic product-visible signals.

#### Close Q5 without another intervention — not selected yet

Closing the selection branch immediately would discard a repeated residual structure seen independently in both development and validation.

Because one additional deterministic offline feasibility probe can test the missing product-observability question without provider calls, model training, final-split consumption, or runtime mutation, the evidence justifies that probe before closing Q5.

### Selected next branch

```text
Q5-B3-C =
PRODUCT INTERPRETATION CLOSED

SELECTED NEXT QUESTION =
CAN PRODUCT-VISIBLE PAIR/SET SIGNALS IDENTIFY
SAFE COMPLEMENTARITY REPAIRS?

NEXT BOUNDED WORK =
Q5-B3-D PRODUCT-VISIBLE PAIR/SET SIGNAL FEASIBILITY PROBE

NOT SELECTED =
BROAD RERANKER/PROFILE RETUNE
STATISTICAL LTR
LEARNED SET SCORER
FINAL-EVALUATION CONSUMPTION
RUNTIME ACTIVATION
```

B3-C selects only the question and experiment family. It does **not** select a production selector or a threshold.

### B3-D boundary

B3-D, if executed, remains offline and limited to the existing development/validation population.

Allowed selector-side inputs are product-visible signals already present in the frozen path, for example:

```text
canonical candidate text
query text
pre-rerank rank
rerank score / rerank rank
bounded candidate-source metadata only when it is already product-visible
```

Evaluator gold/evidence mappings may be used only for offline labels and scoring. They must not enter a selector feature or proposal.

The first probe should stay deterministic and small. It may test only these three predeclared signal families:

```text
1. candidate-to-candidate text redundancy / containment
2. incremental query-term coverage or novelty of an omitted candidate
3. rerank score/rank as a guard or diagnostic, not as the sole signal
```

No embedding call, LLM call, new reranker call, semantic model, learned feature, or open-ended feature search is part of B3-D. Development may freeze at most one deterministic combination of these families.

LoCoMo source-offset overlap may be reported as benchmark-specific diagnostic evidence, but it must not become the primary product rule because the frozen FTS chunk path is not production-equivalent.

Development may be used to freeze the threshold(s) for that one deterministic combination. The development objective is to maximize paired Recall-all improvement subject to zero paired Recall-any regression and zero protect regression versus the frozen Qwen3-0.6B rerank top3. Validation must then be evaluated once without validation-informed retuning.

The B3-D validation success condition, also paired against the frozen Qwen3-0.6B rerank top3, is:

```text
validation Recall-all improvements > 0
AND
validation Recall-any regressions = 0
AND
validation protect regressions = 0
```

If no bounded product-visible signal family reaches that condition, the default interpretation should be to close the deterministic complementarity branch rather than escalating automatically to Statistical LTR.

If a bounded signal family does reach that condition, B3-D still does not authorize production use. It only creates evidence for a later decision on whether the sealed one-shot `final_evaluation` split is worth consuming.

Current boundary:

```text
Q5-B3-B = PASS_WITH_FINDINGS / DEVELOPMENT + VALIDATION COMPLETE
Q5-B3-C = CLOSED / PRODUCT-VISIBLE PAIR/SET FEASIBILITY SELECTED
Q5-B3-D = NO-GO / CLOSED / NO SAFE DEVELOPMENT CONFIG

FINAL_EVALUATION = SEALED / NOT CONSUMED
NEW PROVIDER EXECUTION = NOT AUTHORIZED
MODEL TRAINING = NOT AUTHORIZED
STATISTICAL LTR = NOT SELECTED
RUNTIME / CONFIG / DB / LANCEDB = UNCHANGED
```


## 26. Q5-B3-D product-visible pair/set signal feasibility result

B3-D executed the single bounded deterministic swap family selected by B3-C. Selector-side features use only product-visible query/candidate text plus frozen rerank score/rank. Evaluator evidence remains outside the selector and is used only for offline scoring.

Frozen signal family:

```text
candidate-to-candidate signal =
Unicode-token overlap coefficient

omitted-candidate novelty signal =
incremental query terms versus the two kept served candidates

rerank guard =
candidate-minus-displaced score
+
candidate rerank rank
```

The finite development threshold grid was predeclared as:

```text
min redundancy gain = {0, 0.05, 0.10}
min candidate-minus-displaced score = {-0.05, -0.25, -1.0}
max omitted candidate rerank rank = {5, 10, 20}

total development configurations = 27
```

Candidates pools with fewer than three candidates are valid no-op cases rather than selector errors.

### Development safety gate

The development objective required:

```text
paired Recall-any regressions = 0
AND
protect regressions = 0
```

before any configuration could be frozen for validation.

Result:

```text
development configurations evaluated = 27
safe development configurations = 0
selected configuration = NONE
```

The best unsafe development configuration, retained only as a diagnostic, was:

```text
min redundancy gain = 0
min score gap = -0.05
max candidate rank = 10

applied = 93 / 256

paired Recall-any:
improved = 6
regressed = 19
unchanged = 231

paired Recall-all:
improved = 5
regressed = 19
unchanged = 232

protect regressions = 8
mean evidence coverage delta = -0.0533854167
```

This fails the B3-C development safety gate by a wide margin. The product-visible lexical complementarity signals tested here do not safely distinguish beneficial swaps from harmful replacement of already-useful evidence.

### Validation and final boundary

Because no development configuration satisfied the frozen safety gate, no configuration was eligible to be frozen. Therefore the qualified B3-D transaction does **not** execute an intervention on validation:

```text
validation intervention =
NOT RUN / NO SAFE DEVELOPMENT CONFIG

validation-informed retuning = false
final_evaluation = SEALED / NOT CONSUMED
```

During implementation verification, an earlier fallback defect temporarily selected the best unsafe development configuration when the safe set was empty and therefore produced one validation observation. That run is invalid and non-decision evidence: it violated the frozen development gate, was excluded from the qualified result, and no threshold or selector rule was changed based on its validation outcome. The corrected implementation fails closed when the safe development set is empty.

Qualified deterministic result:

```text
source B3-B result SHA256 =
6faba982cc421742666c98be5380c665e5bae9b8157c75f17d9a913ebf9b2af0

result SHA256 =
f224b4205526b89f059c28155add2317160a59ab4b40a5a22861ec181e813495

provider requests = 0
embedding requests = 0
reranker requests = 0
LLM requests = 0
model training runs = 0
runtime mutation = false
```

### B3-D adjudication

```text
Q5-B3-D =
NO-GO / CLOSED

DETERMINISTIC PRODUCT-VISIBLE COMPLEMENTARITY =
NO SAFE DEVELOPMENT CONFIG

VALIDATION INTERVENTION =
NOT RUN

FINAL_EVALUATION =
SEALED / NOT CONSUMED

STATISTICAL LTR =
NOT SELECTED
```

This result does not prove that every learned or semantic set-aware selector would fail. It establishes a narrower product conclusion: the bounded deterministic product-visible lexical complementarity family selected by B3-C does not meet the development safety gate, so this branch should close rather than expanding feature search, tuning against validation, consuming final, or escalating automatically to Statistical LTR.

This B3-D result supplied the final input to the Q5 closure/product adjudication recorded below. Broad reranker retuning remained unjustified, Statistical LTR remained unselected, and the bounded deterministic complementarity branch closed without consuming `final_evaluation`.


## 27. Q5 closure / product adjudication

Q5 is closed with findings and **no new product intervention selected**.

The stage answered the fixed-candidate question at three levels:

```text
1. Is top3 evidence loss materially attributable to ranking/selection
   after the required evidence is already present in the pool?
   YES.

2. Does the frozen Qwen3-0.6B reranker recover a large share of those
   rank misses while preserving most protect cases?
   YES.

3. Is there sufficient evidence for an additional bounded product rule
   beyond that reranker?
   NO.
```

### Evidence retained by the closure

B3-B showed that the frozen reranker repaired most selected recoverable rank misses:

```text
development = 104 / 128
validation  = 55 / 64
```

The residual feasible failures exhibited a repeated mixed structure:

```text
independent relevance under-ranking
+
served-set redundancy / missing complementarity
```

However, the subsequent intervention evidence did not justify another product selector:

```text
Q5-A6:
simple monotonic scalar score-margin guards = NO-GO

Q5-B3-D:
bounded deterministic product-visible lexical complementarity =
NO SAFE DEVELOPMENT CONFIG / NO-GO
```

The B3-D safety failure is decisive for this branch. All 27 predeclared development configurations failed the zero-Recall-any-regression / zero-protect-regression gate. No configuration was eligible for validation qualification.

### Why final_evaluation is not consumed

The sealed `final_evaluation` split exists to evaluate a frozen candidate intervention after development/validation selection. Q5 ends with **no candidate intervention that passed the development gate**.

Therefore consuming final now would answer no qualified product question and would only spend a one-shot benchmark partition. Q5 closes with:

```text
FINAL_EVALUATION =
SEALED / NOT CONSUMED
```

This is deliberate evidence conservation, not an incomplete Q5 acceptance run.

### Product decision

```text
Q5 =
PASS_WITH_FINDINGS / CLOSED

PRODUCT RESULT =
KEEP THE QUALIFIED FIXED-POOL RERANK EVIDENCE
NO ADDITIONAL FIXED-CANDIDATE SELECTION RULE SELECTED

BROAD RERANKER / PROFILE RETUNE =
NOT JUSTIFIED BY Q5 RESIDUAL EVIDENCE

DETERMINISTIC COMPLEMENTARITY SELECTOR =
NO-GO / CLOSED

STATISTICAL LTR =
NOT SELECTED

LEARNED SET SCORER =
NOT SELECTED

FINAL_EVALUATION =
SEALED / NOT CONSUMED

TOP_K =
UNCHANGED AT 3

RUNTIME / CONFIG / DB / LANCEDB =
UNCHANGED BY Q5
```

Q5 does not claim that Statistical LTR, another reranker, or a semantic set-aware model can never improve selection. It establishes that the evidence gathered in this stage does not justify escalating to those mechanisms now.

### Evidence limitations carried forward

The closure retains the following limits:

- the broader B-stage corpus is LoCoMo benchmark evidence, not live user traffic;
- development/validation diagnostic populations are deliberately balanced and are not distribution estimates;
- the preserved candidate path is historical FTS-only and is not production-equivalent hybrid retrieval;
- B3-D tested one bounded deterministic product-visible lexical complementarity family, not every possible set-aware method;
- the invalid early B3-D fallback validation observation remains non-decision evidence.

These limitations prevent Q5 findings from being generalized into a universal ranking claim.

### Next roadmap state

Q5 does not grant Q6 execution authority.

The next roadmap item is:

```text
Q6 SHADOW AUTORECALL =
NEXT DESIGN DECISION / NOT AUTHORIZED
```

Q6 entry should first define what "shadow" means under the current architecture, what data would be recorded, how candidate retrieval and injection decisions are separated, and what offline/runtime boundary is acceptable. It must account for the separately recorded pre-existing experimental AutoRecall state rather than assuming the historical default state still describes the live host.

No shadow recording, new telemetry persistence, AutoRecall/topK mutation, deployment, live user-memory sampling, or runtime activation is authorized by closing Q5.

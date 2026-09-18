# memory-engine Q5 — Fixed-Candidate Evidence Selection Attribution v1

Status: `Q5-A1 SOURCE QUALIFIED / Q5-A2 INTERVENTION COMPARISON SOURCE QUALIFIED / NO SIMPLE INTERVENTION SELECTED / COMPLEMENTARITY MECHANISM SUPPORTED WITH RECALL-ANY TRADEOFF / FIXED TOPK=3 / STATISTICAL LTR NOT SELECTED / NO MODEL TRAINING AUTHORIZED / NO PROVIDER EGRESS`

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

# memory-engine Q5 — Fixed-Candidate Evidence Selection Attribution v1

Status: `Q5-A ATTRIBUTION DESIGN / FIXED TOPK=3 / NO MODEL TRAINING AUTHORIZED / NO PROVIDER EGRESS`

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

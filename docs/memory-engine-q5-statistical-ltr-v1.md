# memory-engine Q5 Statistical LTR v1 — Entry Contract

Status: `Q5-A CONTRACT DESIGN / TRAINING NOT AUTHORIZED / PROVIDER EGRESS NONE`

## 1. Purpose

Q5 evaluates whether a learned ranking layer can improve top-3 evidence selection after candidate generation is already complete.

The target is not Recall@50. The product objective is a bounded served set of 3-5 items that is:

- relevant to the current query;
- complete enough to answer the query;
- current when recency matters;
- stable under fixed candidate inputs;
- safe from benchmark-gold leakage.

Q5 does not authorize any runtime policy, provider execution, model training, deployment, AutoRecall change, candidate-generation change, live DB/LanceDB mutation, push, or tag.

## 2. Entry assessment

Existing repository evidence is sufficient to design Q5, but not to begin training yet.

Available:

- LongMemEval and LoCoMo evaluation runners with evaluator-only gold boundaries;
- hundreds to thousands of labeled query/evidence cases;
- fixed-candidate rerank evidence showing material headroom at top-3;
- existing candidate/ranking metrics including Recall-any@3, Recall-all@3, NDCG and evidence coverage;
- existing holdout discipline from Q3/Q4.

Missing as one frozen LTR contract:

- disjoint train / validation / final-test assignment;
- a feature schema that forbids gold-derived or post-outcome features;
- a relevance-label schema suitable for pointwise/pairwise/listwise learning;
- a frozen optimization objective and model-selection rule;
- a benchmark-gold leakage verifier;
- a final-test one-shot consumption rule.

Therefore:

```text
Q5 TRAINING ENTRY = NOT READY
Q5-A CONTRACT DESIGN = AUTHORIZED BY ROADMAP CONTINUATION
```

## 3. Candidate population

Q5 must operate on frozen candidate sets produced without access to gold labels.

The initial contract should prefer already-materialized fixed candidate pools used by prior semantic/rerank experiments rather than generating new candidates during model fitting.

Each training/evaluation row must bind:

- dataset;
- case_id;
- query identity/hash;
- candidate_id;
- candidate rank before LTR;
- candidate-source/channel metadata allowed by the feature contract;
- evaluator-only relevance label.

Gold evidence IDs, answer text, acceptance labels, or evaluator annotations must never enter the feature path.

## 4. Split contract

Q5-A must freeze case-level disjoint splits before any fitting:

- train;
- validation;
- final test.

Requirements:

- no case_id overlap;
- no exact-query overlap across splits;
- no exact candidate-text leakage where the same benchmark memory/evidence item would trivially reveal test labels;
- split assignment frozen by manifest SHA-256;
- final test remains untouched until model family, features, hyperparameter search space, and selection rule are frozen.

Dataset-specific stratification may preserve relevant families/types, but cannot use final-test outcomes to revise the split.

## 5. Label contract

The initial label should be derived only by the evaluator from frozen benchmark relevance/evidence identities.

Recommended v1 ordinal label:

```text
2 = candidate is required/relevant gold evidence
1 = candidate is supportive but not required, only if the dataset supplies an independently frozen support relation
0 = candidate is not relevant evidence
```

If a dataset cannot support the middle class without heuristic inference, v1 must fall back to binary `1/0` rather than inventing weak labels.

Pairwise preferences may be generated only from different labels inside the same case.

Listwise groups are case-local candidate sets only.

## 6. Feature contract

Allowed features must be available at ranking time and independent of gold labels.

Candidate v1 feature families:

- semantic/vector score and pre-LTR semantic rank;
- FTS/lexical score and lexical rank;
- RRF/fusion score;
- source/channel indicators;
- confidence/category/recency features already available to normal ranking;
- bounded query-candidate lexical overlap features that do not use answer/gold text.

Forbidden:

- gold evidence ID membership;
- target label;
- answer text;
- evaluator-only evidence coverage;
- post-rerank rank/score from the label-generating model;
- final-test outcomes;
- acceptance-case metadata unavailable in production ranking.

Every feature must have a stable name, type, range/null policy, and provenance.

## 7. Objective and model-selection contract

Q5-A must freeze one primary objective before training.

Primary product objective:

```text
maximize validation evidence coverage / Recall-all at served topK=3
subject to bounded Recall-any regression
```

Secondary diagnostics may include NDCG@3 and family-level error concentration.

Model selection must use train + validation only.

The final test may be evaluated once after all of the following are frozen:

- model family;
- feature list;
- label mapping;
- training objective;
- hyperparameter search space;
- early-stopping rule;
- validation selection rule;
- topK.

## 8. Leakage gates

Q5-A must provide a machine-executable verifier that fails closed on:

- train/validation/test case overlap;
- exact query overlap where prohibited;
- gold/evaluator fields in feature rows;
- final-test rows entering fit/tune artifacts;
- feature names outside the frozen allowlist;
- split-manifest drift;
- label-derived feature values.

The verifier should emit bounded counts and hashes, never benchmark answers or full gold evidence content.

## 9. Acceptance boundary

Q5-A PASS means only:

```text
SPLIT CONTRACT FROZEN
LABEL CONTRACT FROZEN
FEATURE CONTRACT FROZEN
LEAKAGE VERIFIER SOURCE QUALIFIED
TRAINING PLAN FROZEN
```

It does not mean a trained LTR model exists.

Training remains a separate authorization boundary.

## 10. Current decision

Q5-A is the next bounded source/design stage.

No provider, GPU training, external service, live runtime, DB/LanceDB mutation, deployment, push, or tag is authorized by this document.

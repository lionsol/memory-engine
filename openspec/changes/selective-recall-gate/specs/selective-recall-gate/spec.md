## Purpose

Defines the v2-C1 selective abstention successor to the rejected full deterministic semantic recall-authority model.

## ADDED Requirements

### Requirement: Selective gate semantics

The C1 candidate gate SHALL return exactly one decision from `SAFE_SKIP` or `ABSTAIN`. `SAFE_SKIP` SHALL map to `should_recall=false`. `ABSTAIN` SHALL preserve the existing V1 `should_recall` decision exactly.

#### Scenario: Abstention preserves V1

- **WHEN** the gate does not have sufficient skip evidence
- **THEN** it returns `ABSTAIN` and the candidate decision equals V1

### Requirement: Narrow SAFE_SKIP authority

`SAFE_SKIP` MUST require absence of positive history-lookup evidence and absence of `history_reference` on the unmasked request surface. It MUST be supported by explicit current-input-only scope or by supplied/quoted current content with an observational task intent of translation, summarization, rewrite, or structured extraction.

Any `history_reference` that survives the existing request-scope masking MUST cause `ABSTAIN` before either SAFE_SKIP condition is considered. History vocabulary contained only in masked quoted/supplied content does not by itself block a current-text transformation SAFE_SKIP. This is a deliberately conservative C1 scope guard: it sacrifices skip coverage rather than attempting semantic scope resolution and does not repair or broaden the B4 classifier/evidence layer.

The gate MUST NOT use `recall_intent=["none"]` as skip authority. History suppression alone MUST NOT be sufficient for `SAFE_SKIP`.

#### Scenario: Current-only transformation can skip

- **WHEN** a request explicitly limits work to supplied current text and contains no positive history lookup
- **THEN** the candidate MAY return `SAFE_SKIP`

#### Scenario: Mixed-scope suppression abstains

- **WHEN** a request suppresses one historical source but asks for another historical fact
- **THEN** the gate MUST NOT use suppression alone to return `SAFE_SKIP`

#### Scenario: Unmasked history reference abstains

- **WHEN** a request contains a history reference on the unmasked request surface, even alongside current-input-only wording
- **THEN** the gate MUST return `ABSTAIN` and preserve V1 rather than infer that the historical clause is semantically out of scope

#### Scenario: Masked supplied history does not block transformation skip

- **WHEN** a current-text transformation quotes or supplies text containing historical vocabulary and the request surface itself has no history reference
- **THEN** the gate MAY return `SAFE_SKIP` when the other narrow transformation conditions hold

### Requirement: Offline isolation

C1 gate evaluation MUST remain source/offline only and MUST NOT change production `should_recall`, focused-query behavior, Hybrid retrieval, ranking, channels, topK, Card/Get behavior, AutoRecall enablement, runtime config, DB/data, or Gateway state.

#### Scenario: Offline evaluation has no side effects

- **WHEN** the C1 evaluator runs on a fixture
- **THEN** it performs no DB writes, memory-file mutation, retrieval, injection, LLM, network, runtime report-file creation, or runtime policy mutation

### Requirement: Known-corpus safety evaluation

The B1, B3, and B5 fixtures MAY be reused only as known design/regression corpora. Evaluation MUST report V1 and selective confusion matrices, false positives removed, introduced false negatives, and bounded gate-decision diagnostics.

The safety gate SHALL require `introduced_false_negative_count = 0`. False-positive reduction is a secondary utility objective and MUST NOT justify adding rules solely to fit known rows.

#### Scenario: Safety dominates coverage

- **WHEN** a candidate rule would remove additional V1 false positives but introduces a new false negative
- **THEN** the C1 safety gate fails and the rule MUST NOT be accepted on the basis of known-corpus utility

### Requirement: Independent authority boundary

Passing known-corpus regression MUST NOT be treated as independent readiness evidence or runtime authorization. A fresh independent holdout MUST be frozen before its first C1 evaluation and MUST pass a separately defined authority review before production coupling is considered.

#### Scenario: Known corpora do not authorize production

- **WHEN** B1/B3/B5 regression shows zero introduced false negatives and some false-positive reduction
- **THEN** the candidate remains `OFFLINE ONLY / NOT RUNTIME AUTHORIZED`

### Requirement: C2 behavioral holdout contract

C2-A MUST define a separate minimal behavioral schema containing `schema_version`, `turn_id`, `family`, `prompt`, boolean `expected_should_recall`, `label_confidence`, and `annotator`. A valid C2 row MUST use schema version `1`, `label_confidence="high"`, and `annotator="v2c2_planner_holdout"`. C2 validity MUST NOT require `task_intent` or `recall_intent` labels.

The default future C2 contract MUST require 48 rows, 24 expected recall-yes, 24 expected recall-no, 12 families, and four rows per family. A future holdout wrapper MUST be able to supply an explicit family allowlist; the contract evaluator MUST reject unknown or missing families when that allowlist is supplied.

#### Scenario: Behavioral rows do not require rejected semantic labels

- **WHEN** a C2 row contains only the behavioral fields and no `task_intent` or `recall_intent`
- **THEN** schema validation MAY accept it when all behavioral fields and dataset counts are valid

### Requirement: C2 selective safety and utility gates

The C2 evaluator MUST report V1 and selective confusion matrices; SAFE_SKIP, ABSTAIN, and override counts; SAFE_SKIP expected-no and expected-yes counts; unsafe SAFE_SKIP count; SAFE_SKIP precision; introduced false negatives; false positives reduced; V1/selective false positives; and false-positive reduction rate. `unsafe_safe_skip_count` MUST count every SAFE_SKIP with `expected_should_recall=true`, even when V1 was already false. Diagnostics MUST be bounded to `turn_id`, `family`, and `reason` and MUST NOT include prompt bodies.

The hard safety gates MUST be `dataset_contract_valid=true`, `unsafe_safe_skip_count=0`, `introduced_false_negative_count=0`, and SAFE_SKIP precision equal to `1.0` whenever SAFE_SKIP exists. Utility gates MUST require at least two false positives reduced and a false-positive reduction rate of at least `0.10`; safety MUST dominate utility.

#### Scenario: Unsafe SAFE_SKIP is independent of introduced FN

- **WHEN** V1 is already `false` for an expected-recall-yes row and C1 returns `SAFE_SKIP`
- **THEN** introduced FN MAY remain zero, but `unsafe_safe_skip_count` MUST increase and the hard safety gate MUST fail

#### Scenario: Abstention preserves V1

- **WHEN** C1 returns `ABSTAIN` on a C2 row
- **THEN** the selective decision MUST equal V1 exactly

### Requirement: C2 freeze and evidence boundary

C2-A MUST freeze the C1 candidate boundary before the future fixture is created. The future fixture MUST be committed before first evaluation, and the C1 gate MUST NOT be changed in the same independent qualification after fixture freeze. C2-A MUST create no fresh holdout and produce no independent evidence; known B1/B3/B5 corpora MUST NOT qualify C2. A fresh failure MUST NOT automatically authorize classifier fitting or retry.

The C2-A report MUST use `evidence_role=evaluation_contract_only`, `independent_readiness_evidence=false`, and `OFFLINE ONLY / NOT RUNTIME AUTHORIZED`. Runtime deployment, AutoRecall enablement, production hook coupling, and policy authority remain separately authorized decisions.

#### Scenario: Contract preparation is not holdout evidence

- **WHEN** C2-A tests run only on synthetic in-test rows before a Planner fixture exists
- **THEN** the result MUST remain contract-only and MUST NOT be labeled independent readiness evidence

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

# Memory Engine Q0 Failure Evaluation Contract v1

This document defines the repository-owned, pure adjudication contract for
Q0 recall-failure cases. It does not collect production evidence, open a
database, read a session, or add runtime telemetry.

## Contract identity

The case schema identifier is:

~~~~
memory_engine_q0_failure_evaluation_v1
~~~~

Each case contains only bounded, opaque locators and stage evidence. A case
does not require a raw query, transcript, memory text, or tool result:

~~~~json
{
  "schema": "memory_engine_q0_failure_evaluation_v1",
  "case_id": "q0-case-001",
  "provenance": "PRODUCTION_OBSERVED",
  "evaluation_scope": "END_TO_END_OBSERVED",
  "source_ref": "opaque-source-ref",
  "case_ref": "opaque-case-ref",
  "effective_top_k": 3,
  "stages": {
    "write": { "state": "PASS", "evidence_complete": true },
    "trigger": { "state": "PASS", "evidence_complete": true },
    "candidate": { "state": "PASS", "evidence_complete": true },
    "rank": { "state": "FAIL", "evidence_complete": true },
    "disclosure": { "state": "NOT_EVALUATED", "evidence_complete": null },
    "answer_use": { "state": "NOT_EVALUATED", "evidence_complete": null }
  }
}
~~~~

source_ref, case_ref, and turn_ref are optional bounded opaque references.
They are not a license to commit private evidence.

## Enumerations

### Provenance

* PRODUCTION_OBSERVED
* PRODUCTION_REPLAY
* BENCHMARK_DERIVED
* TARGETED_SYNTHETIC

### Evaluation scope

* END_TO_END_OBSERVED — write through answer-use can be evaluated.
* TRIGGER_ONLY — only trigger is in scope.
* RETRIEVAL_FROM_MATERIALIZED_MEMORY — write is
  BYPASSED_BY_FIXTURE, trigger is OUT_OF_SCOPE, and candidate/rank are
  evaluated.
* DISCLOSURE_ONLY — only disclosure is in scope.
* ANSWER_USE_ONLY — only answer-use is in scope.

### Ordered stages

The fixed stage order is:

~~~~
write → trigger → candidate → rank → disclosure → answer_use
~~~~

Every stage is an object with:

* state: PASS, FAIL, UNKNOWN, NOT_EVALUATED, OUT_OF_SCOPE, or
  BYPASSED_BY_FIXTURE;
* evidence_complete: true, false, or null.

UNKNOWN, NOT_EVALUATED, OUT_OF_SCOPE, and BYPASSED_BY_FIXTURE are explicit
non-boolean states. They never become false by implication.

## Adjudication

adjudicateQ0FailureEvaluationCase() validates the case before evaluating
stages. Invalid schema, enum, case identifier, stage, scope, or effective
top-k data is fail-closed as INSUFFICIENT_EVIDENCE.

A FAIL is classifiable only with evidence_complete: true. A PASS can
establish the required preceding condition only with the same complete
evidence. An unresolved earlier in-scope stage blocks any later failure from
being promoted to a first-loss claim.

The failure mapping is:

| Failed stage | Failure class | Additional field |
| --- | --- | --- |
| write | WRITE_MISS | — |
| trigger | TRIGGER_MISS | — |
| candidate | CANDIDATE_MISS | — |
| rank | RANK_MISS | — |
| disclosure | USE_MISS | use_loss_stage=DISCLOSURE |
| answer_use | USE_MISS | use_loss_stage=ANSWER_USE |

CANDIDATE_MISS requires an adapter to provide candidate.state=FAIL and
candidate.evidence_complete=true. For candidate absence, complete evidence
means an exact, collision-free candidate identity and a complete,
untruncated relevant candidate capture. A positive candidate observation does
not require proof of absence.

RANK_MISS is a Q0 classification only when effective_top_k === 3. For an
END_TO_END_OBSERVED case, a complete rank PASS also establishes the production
prefix only at effective_top_k === 3. A non-3 rank PASS therefore blocks later
disclosure/answer-use classification and blocks NO_LOSS as
INSUFFICIENT_EVIDENCE. Another effective top-k remains valid scoped diagnostic
evidence, including RETRIEVAL_FROM_MATERIALIZED_MEMORY; its rank failure is
returned as INSUFFICIENT_EVIDENCE without a Q0 failure class.

The result status is one of:

* CLASSIFIED
* NO_LOSS
* INSUFFICIENT_EVIDENCE

loss_authority is END_TO_END only for END_TO_END_OBSERVED cases whose
complete evidence establishes the required prefix from write through the
failed stage. Scoped evaluations receive SCOPED. It is null for unclassified
and no-loss results.

The disclosure and answer-use stages both map to USE_MISS because the frozen
Q0 taxonomy has no separate DISCLOSURE_MISS. The use_loss_stage field
preserves the distinction.

## Aggregation

aggregateQ0FailureEvaluationResults() returns separate count maps for:

* provenance;
* evaluation_scope;
* failure_class;
* adjudication_status.

It also returns
production_observed_end_to_end_first_loss_distribution. This distribution
includes only cases with all of:

~~~~
provenance       = PRODUCTION_OBSERVED
evaluation_scope = END_TO_END_OBSERVED
loss_authority   = END_TO_END
adjudication_status = CLASSIFIED
~~~~

Replay, benchmark, synthetic, and scoped cases are never combined into this
production end-to-end distribution. The contract deliberately exposes no
single mixed production failure-rate field.

## Privacy and adapter boundary

Adapters decide whether their evidence is complete. The pure module does not
invent candidate completeness, infer missing telemetry, or read additional
sources. Raw production evidence should remain in an owner-controlled,
short-lived evidence store; repository cases should contain only approved
bounded excerpts or opaque locators as required by the applicable evidence
process.

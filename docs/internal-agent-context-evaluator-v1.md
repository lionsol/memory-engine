# INTERNAL_AGENT_CONTEXT Evaluator v1

## Status

**PURE INDEPENDENT INTERNAL_AGENT_CONTEXT EVALUATOR IMPLEMENTED / FROZEN HOLDOUT NOT YET EXECUTED**

This is a pure offline evidence mechanism. It does not establish capability,
runtime, or production readiness.

## APIs

The module `lib/recall/disclosure/internal-agent-context-evaluator.js` exposes:

- `evaluateInternalAgentContextCase(row)` for one caller-supplied C.14-contract row;
- `evaluateInternalAgentContextCases(rows)` for arbitrary caller-supplied in-memory rows;
- `evaluateInternalAgentContextFixture(rows)` for a caller-supplied collection that first passes the complete C.14 fixture contract.

None of these APIs opens a fixture or reads storage. The evaluator accepts rows
from its caller and does not read `test/fixtures/internal-agent-context-holdout.v1.jsonl`.

## Measured axes

Each case independently measures projection success and actual projection
validity, contract-validity consistency, boundedness, source faithfulness,
answer-bearing semantic preservation, source-full-selection consistency,
risk-metadata preservation, canonical/provenance preservation, and absence of
capability or consumer-authority keys.

Instruction-like literals are measured only as representation-level
data-only evidence: the evaluator checks the `untrusted_evidence` marker,
literal preservation, and absence of authority keys. This does not prove
runtime prompt or instruction isolation.

`useful_internal_projection` is an answer-bearing representation metric. It is
not `INTERNAL_CONTEXT` capability, runtime injection authorization, selector
selection, or production readiness.

## Aggregate contract

Aggregate results use mode `offline_internal_agent_context_evaluation_v1`,
keep `runtime_authorized=false` and `capability_authorized=false`, expose
four-decimal bounded ratios, and provide the six-family breakdown from C.14.
No production PASS threshold is defined.

## Boundaries

The evaluator uses the existing C.13 adapter and ProjectionArtifact validator.
It has no filesystem, fixture, database, retrieval, network, LLM, runtime,
capability, selector, or AutoRecall dependency. It returns bounded case
evidence without full artifacts, payloads, segment text, canonical source, or
runtime inputs.

C.14 remains immutable at SHA-256
`bc0aaa7e5bca0cb7c77f057c56327250c90b48e652032782e1bdd279f8d11085` and has
not been evaluated. No formal holdout result exists yet.

## Next bounded candidate

D.3-C.16 is **INTERNAL_AGENT_CONTEXT HOLDOUT FIRST RUN — CANDIDATE / NOT
AUTHORIZED BY C.15**. It would be a separate one-shot execution and evidence
record. No such execution is part of C.15.

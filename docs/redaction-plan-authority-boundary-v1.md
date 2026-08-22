# Redaction Plan Authority Boundary v1

Status: `Accepted Design Direction`
Scope: docs/OpenSpec-only; no detector, resolver, or production wiring.

## Decision

C.8 is `PASS / FIRST-RUN EVIDENCE ACCEPTED` within the frozen 12-row synthetic
C.6 contract. It proves that an explicit, bounded, field-specific directive can
be transformed into a structurally compatible `REDACTED_CARD` candidate. It
does not prove who may generate that directive.

C.9 separates three responsibilities:

| Layer | Responsibility | Does not decide |
| --- | --- | --- |
| Risk Authority | whether a memory has object/policy-level disclosure risk | which exact literal to delete |
| Redaction Directive Authority | whether evidence is sufficient to delete an exact literal from a target field/surface | capability or lifecycle permission |
| Transformation | execute an already-authorized bounded directive set | discover secrets, infer sensitivity, or upgrade capability |

The current `projectRedactedCardCandidate()` is transformation only. A
successful redaction is not disclosure authorization.

## Current facts

- The current production canonical/projection path has no independently
  validated literal-level, field-specific redaction authority source.
- The C.5 caller-supplied `redaction_plan` is an offline prototype/evaluation
  input, not a production plan source.
- `risk_flags`, lifecycle, scope, and artifact state can justify withholding,
  review, or a lower capability, but cannot synthesize an exact
  `{ field, literal }` directive.
- `lib/runtime-authority/evidence.js::redactEvidenceText()` is a runtime
  evidence-capture sanitizer for bounded failure evidence. It is not Canonical
  Memory semantic authority, redaction directive authority, or
  `DISCLOSURE_CARD` policy, and is not reused by this boundary.

The runtime evidence sanitizer belongs to a different subsystem and input
contract, has different false-positive/false-negative consequences, and has
not been independently evaluated for memory semantic preservation.

## Authority layers

Risk evidence such as `raw_log_like`, `tool_output_like`,
`dreaming_artifact`, `sensitive_source`, `cross_agent_scope`, and
`conflict_flag` may restrict capability, trigger review, or withhold raw
content. None of those flags alone identifies a literal to remove.

Redaction Directive Authority must answer, for a specific target surface and
presentation field, which exact material has sufficient evidence for removal.
The resulting directive must be explicit, bounded, auditable, and identity
bound.

Transformation receives that directive set and performs the representation
change. It must not remove risk flags, alter lifecycle or scope, set
`safe_to_disclose`, or grant `CARD_DISCLOSABLE`.

## Accepted future authority classes

These are future candidates, not implemented authorities:

1. `STRUCTURED_SOURCE_ANNOTATION` — a trusted ingestion/annotation path
   explicitly identifies target material with source provenance and canonical
   binding. This is the strongest candidate.
2. `EXPLICIT_REDACTION_DIRECTIVE` — a trusted owner/operator or auditable
   annotation workflow submits an exact bounded directive. Arbitrary
   model-generated free text does not acquire this identity automatically.
3. `DETERMINISTIC_DETECTOR_EVIDENCE` — a separately implemented, frozen, and
   independently evaluated high-precision detector may later provide evidence.
   It is currently research-only and unauthorized.

No `LLM_AUTHORITY` or `RISK_FLAG_AUTHORITY` exists in this taxonomy.

## Non-authoritative evidence

The following cannot directly generate a production redaction directive:

- generic risk flags, source path alone, category alone;
- retrieval score or confidence score;
- LLM free-form judgment, generic regex hit, or keyword hit;
- evaluator gold labels, frozen `forbidden_literals`, or test canaries;
- selector decisions, capability results, or `redactEvidenceText()` output.

They may be candidate evidence or review triggers only. In particular,
`sensitive_source` does not mean “find a secret-looking string in summary and
delete it.”

## Identity and staleness binding

A future production-authoritative plan must bind to the representation it was
derived from with at least:

- `memory_id`
- `canonical_id`
- `source_content_hash`
- `surface = DISCLOSURE_CARD`

Each directive binds `field` and an exact `literal` to that baseline
representation. If source or content identity changes, the directive is stale
and must fail closed rather than silently applying to new canonical content.

## Surface and capability boundaries

This decision only discusses `DISCLOSURE_CARD` and its presentation fields:
`title`, `summary`, `salience_reason`, and `source_hint`. A card directive is
not automatically reusable for `VECTOR_INDEX`, `INTERNAL_AGENT_CONTEXT`, or
`RAW_REFERENCE`; each surface requires its own contract.

If object-level risk exists without sufficient authoritative literal-level
evidence, the system must not guess a plan. The system remains fail-closed:
capability may remain `INTERNAL_CONTEXT` or `RETRIEVAL_ONLY`, a
`REFERENCE_ONLY` projection strategy may be used where separately applicable,
and the selector may ultimately return `WITHHOLD`.

The exact fallback remains the responsibility of the existing projection,
capability, and selector layers; Redaction Directive Authority does not choose
or upgrade any of them.

Even when a transform is surface-safe and semantically preserved, risk remains
unchanged. Redaction does not remove `sensitive_source`, change lifecycle or
scope, set `safe_to_disclose=true`, or grant card authority.

## Future production envelope (design only)

The existing prototype schema remains unchanged:
`{ schema_version: 1, directives: [...] }`.

A future production envelope may be named `AuthorizedRedactionPlan` or
`RedactionDirectiveSet` and minimally bind:

- `schema_version`, `memory_id`, `canonical_id`, `source_content_hash`,
  `surface`;
- directives containing `field`, `literal`, `authority_kind`, and
  `evidence_ref`.

`evidence_ref` is a bounded provenance reference, not raw sensitive content.
The envelope must not contain capability, `safe_to_disclose`, selector result,
or lifecycle mutation. No module or schema is implemented by C.9.

## Future order

```text
Canonical Memory
      ↓
Baseline Surface Projection
      ↓
Redaction Evidence Resolution
      ↓
AuthorizedRedactionPlan
      ↓
REDACTED_CARD Transformation
      ↓
Projection Validation
      ↓
Capability Authorization
      ↓
Selector
```

Redaction evidence resolution cannot skip capability. Successful redaction is
not disclosure authorization.

## C.8 evidence boundary

C.8 supports exact directive execution across all six frozen transform
families, bounded surface-safety and semantic-preservation results, protected
metadata preservation, and no observed unplanned field drift. It does not
support detector correctness, redaction-plan source correctness, real-world
coverage completeness, capability relaxation, or production integration.

## Next bounded candidate

`D.3-C.10 Structured Redaction Evidence Contract` is
`NEXT / CANDIDATE / NOT AUTHORIZED BY C.9`. It may define a pure offline
authority/evidence envelope and validation contract. It must not implement a
detector, connect to production, or change capability/selector behavior.

# Redaction Evidence Resolution Semantics v1

Status: `REDACTION EVIDENCE RESOLUTION SEMANTICS DEFINED`

Scope: architecture decision only. No resolver, detector, authenticated
authority source, production redaction plan, capability, selector, or runtime
implementation is created by C.11.

## Decision

C.10 validates one `StructuredRedactionEvidence` envelope. C.11 defines how a
future resolution process must interpret multiple individually valid
envelopes. It freezes semantic boundaries, not an algorithm or output
structure.

`authority_kind` is an evidence-claim classification, not an authenticated
issuer identity. `evidence_ref` is a bounded opaque provenance reference; it
does not prove that an annotation issuer is trusted, an operator is
authenticated, a workflow is approved, or a detector is production-qualified.

`STRUCTURED_SOURCE_ANNOTATION` and `EXPLICIT_REDACTION_DIRECTIVE` are therefore
authority-eligible classes and future authority-bearing candidates, not
currently production-authorized authorities. `DETERMINISTIC_DETECTOR_EVIDENCE`
remains research-only and non-authoritative.

## Input preconditions

Every envelope in a future resolution set must first pass the C.10 validation
contract against the same:

- `memory_id`;
- `canonical_id`;
- `source_content_hash`;
- `surface`;
- `baseline_projection_hash`.

Malformed, stale, identity-mismatched, baseline-mismatched, or unsupported
evidence invalidates the entire set. A future resolver must not drop an
invalid claim, partially salvage the rest, or continue with best-effort
merging; silently changing the authority set would alter caller meaning.

## No implicit precedence

C.9 described structured source annotation as the strongest candidate. That is
not automatic precedence. C.11 defines no ordering such as
`STRUCTURED_SOURCE_ANNOTATION > EXPLICIT_REDACTION_DIRECTIVE`, and does not
assume that an owner directive always wins. Current evidence is insufficient
to establish production precedence or override semantics.

If otherwise eligible claims cannot safely coexist, the future result must
fail closed rather than select a stronger-looking claim.

## Positive-claim semantics

Each C.10 directive is positive evidence for deleting one exact literal from a
field. The schema has no `KEEP`, `ALLOW`, `SAFE`, `DO_NOT_REDACT`, or negative
evidence claim. Absence of a redaction claim is therefore not evidence that
the remaining content is safe, that coverage is complete, or that all
sensitive material was found.

## Detector isolation

Detector evidence may be structurally valid and may support research or human
review. It cannot independently contribute a production-authoritative
directive, make an otherwise non-authoritative target authoritative, or
upgrade capability. When an explicit or structured eligible claim is already
present, detector evidence may be retained as non-authoritative corroboration;
eligibility must not depend on it. A set containing only detector evidence is
`NON_AUTHORITATIVE_EVIDENCE_ONLY` / unresolved.

## Duplicate claims

Claims with the same `field + literal` are exact target duplicates, not
conflicts. They represent corroboration. A future resolver may deduplicate the
target while preserving every supporting `evidence_ref` and its provenance.
C.11 does not define that output structure and does not permit randomly
discarding supporting references.

Claims targeting different presentation fields (`title`, `summary`,
`salience_reason`, or `source_hint`) may coexist when all other conditions are
valid and no conflict exists.

## Conflict semantics

Different literals on the same field cannot be treated as an ordered string
list. A future resolution process must compare their occurrence spans in the
same bound baseline representation.

- Non-overlapping spans may be compatible when the resulting transformation
  semantics are order-independent.
- Intersecting spans are `OVERLAPPING_TARGET_CONFLICT` and must fail closed.
- No `longest wins`, `shortest wins`, `first wins`, or authority-kind wins rule
  is defined.
- If applying one directive can create, remove, or alter another directive's
  match semantics so the result depends on execution order, the set has
  `TRANSFORMATION_ORDER_CONFLICT` and must fail closed.

The inability to prove order-independent semantics is itself sufficient to
reject a redaction plan candidate. Any invalid evidence, stale evidence,
overlap conflict, or order conflict invalidates the whole set; unaffected
directives must not be applied partially.

## Resolution states

These are architecture taxonomy only, not implemented enums or APIs:

### `INVALID_EVIDENCE_SET`

At least one input fails C.10 validation, is stale, or is not bound to the
same identity/baseline.

### `CONFLICTING_EVIDENCE_SET`

All inputs are individually valid, but their target collection cannot form an
order-independent, non-conflicting resolution.

### `NON_AUTHORITATIVE_EVIDENCE_ONLY`

The set has no authority-eligible candidate claim, for example when it
contains only detector evidence.

### `CONSISTENT_AUTHORITY_ELIGIBLE_SET`

All inputs are structurally valid and consistently bound, at least one
authority-eligible class is present, and no target conflict is established.
This still is not an `AuthorizedRedactionPlan`,
`production_authorized`, `safe_to_disclose`, `CARD_DISCLOSABLE`, or selector
decision. Origin authentication remains unresolved.

## Completeness limitation

Even a consistent set proves only that its listed exact targets have
consistent evidence. It does not prove complete sensitive-content coverage,
that all secrets were discovered, or that the remaining representation is
safe. Resolution must not become a secret-coverage oracle.

## Relationship to transformation, capability, and selector

The future order remains:

```text
Canonical Memory
      ↓
Baseline Surface Projection
      ↓
Structured Evidence Validation
      ↓
Evidence Resolution
      ↓
Redaction Plan Candidate
      ↓
REDACTED_CARD Transformation
      ↓
Projection Validation
      ↓
Capability Authorization
      ↓
Selector
```

Resolution success is not transform success. Transform success is not proof
of projection safety completeness. Projection safety is not capability
authorization, and capability authorization is not selector selection.

Risk remains unchanged through resolution: `risk_flags`, including
`sensitive_source`, lifecycle, scope, and artifact state are not removed or
changed. Resolution does not set `safe_to_disclose`, grant
`CARD_DISCLOSABLE`, or choose a selector outcome.

## Implementation boundary

C.11 adds no resolver module and defines no `resolve`, `merge`, authority
precedence, conflict merger, plan builder, authorization, or redaction
application API. No authenticated evidence-origin authority is implemented,
and no production redaction-plan source exists.

## Next direction

The redaction architecture branch does not automatically create a C.12
resolver stage. The next bounded design direction is the separate
`INTERNAL_AGENT_CONTEXT` representation decision for `raw_log` / `tool_output`,
which remains unresolved from earlier evidence. Resolver and trusted-origin
production work belong to a future D.3-D product decision.

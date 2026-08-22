# Structured Redaction Evidence Contract v1

Status: `STRUCTURED REDACTION EVIDENCE CONTRACT IMPLEMENTED / OFFLINE ONLY / NOT PRODUCTION AUTHORITY`

## Decision

D.3-C.10 defines a pure, deterministic, identity-bound and surface-bound
evidence envelope for future Redaction Directive Authority review. A valid
envelope proves only that its claims satisfy this structural contract. It is
not an `AuthorizedRedactionPlan` and does not grant production authority.

The implementation is
`lib/recall/disclosure/redaction-evidence-contract.js`. It provides
validation, bounded reasons, and a deterministic baseline projection hash. It
does not resolve evidence, select authority, convert evidence to a redaction
plan, apply redaction, or call a projector with a runtime candidate.

## Schema v1

The envelope is closed and binds the evidence to one canonical identity and
one exact `DISCLOSURE_CARD` baseline:

```json
{
  "schema_version": 1,
  "memory_id": "...",
  "canonical_id": "...",
  "source_content_hash": "...",
  "surface": "DISCLOSURE_CARD",
  "baseline_projection_hash": "...",
  "directives": [
    {
      "field": "summary",
      "literal": "...",
      "authority_kind": "STRUCTURED_SOURCE_ANNOTATION",
      "evidence_ref": "annotation:..."
    }
  ]
}
```

Allowed directive fields are `title`, `summary`, `salience_reason`, and
`source_hint`. Exact `field + literal` duplicates are rejected. A directive
literal must be bounded and must exist in the bound baseline field; this is an
assertion about supplied evidence, not secret detection.

## Authority kinds

The accepted structural kinds are:

- `STRUCTURED_SOURCE_ANNOTATION`
- `EXPLICIT_REDACTION_DIRECTIVE`
- `DETERMINISTIC_DETECTOR_EVIDENCE`

The first two are accepted future authority classes. Detector evidence is
structurally representable research evidence only and remains independently
unevaluated and unauthorized. No validation result contains
`authorized`, `production_authorized`, `safe_to_disclose`, capability, or
selector authority.

`evidence_ref` is a bounded, printable, single-line opaque reference with a
kind-specific prefix (`annotation:`, `directive:`, or `detector:`). It must
not copy the target literal. This is a bounded hygiene rule, not a complete
claim that the referenced evidence is non-sensitive.

## Identity and baseline binding

The envelope must exactly match `memory_id`, `canonical_id`, and
`content_ref.content_hash` from the supplied Canonical Memory. The supplied
baseline artifact must first pass the existing ProjectionArtifact validation,
and its surface must be `DISCLOSURE_CARD`.

`computeDisclosureCardBaselineProjectionHash()` hashes a deterministic,
sorted-key representation containing projection schema/kind, canonical
identity/content hash, surface, and payload. Array order is preserved and
provenance is excluded. A changed presentation or risk metadata therefore
makes old evidence stale even when canonical identity is unchanged; a
provenance-only change does not.

Stale, mismatched, unsupported, malformed, duplicate, or target-absent
evidence fails closed with a bounded reason.

## Responsibility boundary

The contract does not implement a detector, resolver, authority precedence,
conflict merger, `AuthorizedRedactionPlan`, capability decision, selector
decision, or production redaction source. Structural validity is not
production authorization, and successful future redaction would not clear
risk or upgrade capability.

## Next bounded candidate

`D.3-C.11 Redaction Evidence Resolution Semantics` is
`NEXT / CANDIDATE / NOT AUTHORIZED BY C.10`. It may separately define
multiple-claim handling, conflicts, authority precedence, detector-evidence
isolation, and stale-evidence rejection. C.10 does not implement that
resolver.

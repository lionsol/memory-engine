## Status

Phase D.3-A architecture/design only.

This change defines the Memory Projection Architecture needed after Phase
D.2-C.11 demonstrated that a capability-constrained shadow path can reduce
unsafe card disclosure from 23 to 0 without reducing answer-bearing disclosure
recall. It does not treat the lower selected-card count as proof that the
capability boundary is too conservative, and it does not authorize production
or runtime integration.

## Problem

Canonical Memory is already the semantic authority, but current downstream
projection responsibilities are split inconsistently:

- `projectCanonicalMemoryToVectorProjection()` is a pure representation for a
  declared consumer and carries no disclosure authority;
- the existing Memory Card projector also derives risk flags, disclosure level,
  card-injection policy, full-content-get authority, and presentation fields;
- the retrieval-first disclosure controller applies a second admissibility/risk
  boundary to the projected card;
- the v1.1 shadow evaluator then adds a capability gate using synthetic
  `projection_valid` and `safe_to_disclose` inputs.

As a result, representation, projection validity, safety assessment, capability
permission, and selection are not yet cleanly separated.

The frozen D.2 v2 fixture is also not suitable for proving a sanitized or
alternative projection path. Its evaluation adapter constructs a fixed bounded
synthetic card rather than evaluating the actual projected payload. D.2-C.11
therefore supports the capability-boundary hypothesis, but it does not prove
that an unsafe canonical memory can be transformed into a safe useful card.

## Proposal

Define a first-class Memory Projection Architecture in which:

1. Canonical Memory remains the semantic authority for identity, source,
   classification, lifecycle, and canonical content.
2. A projector produces a deterministic `ProjectionArtifact` for an explicit
   consumer/surface. Projection is representation, not authorization.
3. Projection validation checks structural integrity, identity binding,
   surface-specific content bounds, and forbidden-field leakage.
4. Disclosure capability remains the permission boundary. For disclosure
   surfaces, capability calculation consumes canonical policy inputs together
   with the validated projection/surface assessment; projection does not create
   or upgrade capability.
5. A selector may choose or withhold only already-authorized projection
   artifacts. It cannot invent a projection, sanitize an unsafe artifact, or
   upgrade capability.

The initial surface taxonomy is intentionally small:

- `VECTOR_INDEX` — existing non-disclosure vector/index representation;
- `INTERNAL_AGENT_CONTEXT` — bounded non-user-facing context representation;
- `DISCLOSURE_CARD` — bounded user/agent-facing Memory Card representation;
- `RAW_REFERENCE` — reserved; no raw disclosure is enabled by this change.

D.3 does **not** add `SANITIZED_CARD`, `PROJECTABLE_CARD`, or a generic
`PROJECTABLE` capability state. A sanitizing transform, if later justified,
produces a new `DISCLOSURE_CARD` projection candidate that must independently
pass projection validation and `CARD_DISCLOSABLE` authorization.

## Evidence consequence

A later D.3 projection experiment must use a projection-aware evaluation
boundary containing the actual projected payload or bounded representation
features needed to judge it. The frozen D.2 v2 fixture remains immutable and
must not be retrofitted or tuned to support projection optimization.

## Non-goals

- No production projector, selector, admissibility, capability, AutoRecall,
  Hybrid, retrieval, ranking, Memory Card runtime, or `memory_engine_get`
  behavior change in D.3-A.
- No Gateway operation, plugin deployment, config mutation, database/data
  mutation, runtime activation, or AutoRecall enablement.
- No raw/full-content disclosure enablement.
- No new semantic memory store, Canonical Memory schema authority, ranking
  score, or retrieval eligibility field.
- No optimization against the frozen D.2 fixture and no holdout-driven
  heuristic tuning.

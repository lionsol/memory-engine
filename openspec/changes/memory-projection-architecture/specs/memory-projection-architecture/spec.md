## ADDED Requirements

### Requirement: Projection is representation, not authorization

A Memory Projection MUST be a deterministic derived representation for an
explicit consumer/surface. It MUST preserve exact canonical identity and MUST
NOT create lifecycle, scope, disclosure, raw-access, or capability authority.

#### Scenario: A projector cannot upgrade disclosure capability

- **WHEN** a projection is produced from a canonical memory whose current
  capability does not authorize the target disclosure surface
- **THEN** the projection itself does not grant that surface authority

### Requirement: Canonical Memory remains the semantic authority

Projection artifacts MUST bind exact `memory_id` and `canonical_id` and MUST
remain derived from Canonical Memory. Projection metadata or runtime retrieval
metadata MUST NOT replace Canonical Memory as the authority for source,
classification, lifecycle, or canonical content.

#### Scenario: Projection metadata conflicts with canonical identity

- **WHEN** a projection artifact does not bind the exact canonical identity
- **THEN** projection validation fails closed

### Requirement: Projection surfaces are explicit

D.3 MUST distinguish at least `VECTOR_INDEX`, `INTERNAL_AGENT_CONTEXT`,
`DISCLOSURE_CARD`, and reserved `RAW_REFERENCE` surfaces. Surface-specific
payload schemas and bounds MAY differ; a valid artifact for one surface MUST
NOT be treated as automatically valid or authorized for another.

#### Scenario: Internal context is not card authority

- **WHEN** a memory is usable on the `INTERNAL_AGENT_CONTEXT` surface but lacks
  `CARD_DISCLOSABLE`
- **THEN** it cannot be selected for the `DISCLOSURE_CARD` surface

### Requirement: Projection validation and capability authorization are separate

Projection validation MUST determine structural integrity, identity binding,
surface bounds, and forbidden-field leakage. Disclosure capability MUST remain
the permission decision for disclosure surfaces and MUST combine authorized
canonical policy context with the validated target-surface assessment.

#### Scenario: Structurally valid card remains unauthorized

- **WHEN** a `DISCLOSURE_CARD` projection is structurally valid but lifecycle,
  scope, risk, or `safe_to_disclose` does not authorize card disclosure
- **THEN** the card remains non-disclosable

### Requirement: Selector cannot project or sanitize

A disclosure selector MUST operate only on already-projected and
authorized artifacts. It MUST NOT generate a sanitized representation,
reinterpret canonical raw content, or promote `INTERNAL_CONTEXT` to
`CARD_DISCLOSABLE`.

#### Scenario: Selector convenience cannot recover withheld content

- **WHEN** an unauthorized candidate would improve answer utility if displayed
- **THEN** the selector still withholds it rather than constructing or
  authorizing a new projection

### Requirement: Sanitized projection is not a capability state

D.3 MUST NOT introduce `SANITIZED_CARD`, `PROJECTABLE_CARD`, or generic
`PROJECTABLE` solely to recover card coverage. A sanitizing transform MAY later
produce a `DISCLOSURE_CARD` projection candidate, but that candidate MUST pass
projection validation and independent `CARD_DISCLOSABLE` authorization.

#### Scenario: Sanitized output requires independent authorization

- **WHEN** a transform removes unsafe material from a source memory
- **THEN** the transformed card is not disclosable until its target-surface
  projection and capability checks pass

### Requirement: Projection-aware evidence is separate from D.2 evidence

The frozen D.2 v2 fixture MUST remain immutable and MUST NOT be treated as
proof of sanitized-projection safety because its adapter uses a fixed synthetic
bounded card rather than an actual target projection payload. A D.3 projection
experiment MUST use a separately frozen projection-aware evaluation boundary.

#### Scenario: D.2 capability success does not qualify D.3 projection

- **WHEN** D.2-C.11 reports unsafe disclosure reduction from 23 to 0
- **THEN** that result supports capability gating only and does not by itself
  qualify a safe projection transform

### Requirement: D.3-A remains non-runtime

D.3-A MUST be architecture/design only. It MUST NOT change production selector,
admissibility, capability, AutoRecall, Hybrid, Memory Card runtime,
`memory_engine_get`, configuration, database/data state, Gateway state, or
runtime deployment.

#### Scenario: Architecture acceptance does not enable runtime

- **WHEN** the D.3-A architecture contract is accepted
- **THEN** production and runtime behavior remain unchanged until separately
  authorized later stages

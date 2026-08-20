## Purpose

Defines the Phase A offline controller that separates retrieval evidence from
bounded Memory Card disclosure.

## ADDED Requirements

### Requirement: Canonical candidate envelope

The controller MUST build a versioned Recall Candidate Envelope from a
Canonical Memory Object, retrieval evidence, and a card projection. It MUST
preserve exact `memory_id` and `canonical_id`, omit the full canonical memory
body, and avoid persistence or mutation.

#### Scenario: Canonical identity is preserved

- **WHEN** a valid canonical memory is wrapped
- **THEN** the envelope exposes the canonical `memory_id` and `canonical_id`
  unchanged

#### Scenario: Full content is not copied into the envelope

- **WHEN** the canonical source contains full chunk text
- **THEN** the envelope omits that text and retains only bounded metadata and
  content-reference information

### Requirement: Bounded retrieval evidence

The envelope MUST allow only runtime retrieval evidence fields for rank,
sources, channel counts, retrieval scores, token coverage, exact match, and
channel agreement. It MUST NOT use or copy `task_intent`, `recall_intent`,
`history_reference`, or a semantic skip decision as disclosure authority.

#### Scenario: Semantic classifier fields are excluded

- **WHEN** retrieval input contains intent or history-classifier fields
- **THEN** those fields are absent from the envelope retrieval/evidence views

### Requirement: Conservative admissibility

The admissibility policy MUST return `ALLOW` or `DENY` deterministically. It
MUST deny invalid projections, non-active lifecycle states, scope violations,
unsafe artifacts, and blocking risk flags. It MUST NOT consult task/recall
intent classifiers or history semantics.

#### Scenario: Valid active memory is admissible

- **WHEN** canonical identity, lifecycle, scope, risk, and card projection
  checks are valid
- **THEN** admissibility returns `ALLOW`

#### Scenario: Unsafe or invalid memory is denied

- **WHEN** a candidate is archived, quarantined, cross-scope, unsafe, or has
  an invalid card projection
- **THEN** admissibility returns `DENY`

### Requirement: Card-only disclosure selection

The selector MUST support only `WITHHOLD` and `DISCLOSE_CARD`. It MUST
preserve candidate order, withhold candidates that fail admissibility or lack
sufficient retrieval evidence, and expose only the bounded Memory Card for a
disclosed candidate.

#### Scenario: Only an admissible evidence-backed card is disclosed

- **WHEN** one candidate is allowed with sufficient evidence, one is denied,
  and one lacks sufficient evidence
- **THEN** only the allowed candidate receives `DISCLOSE_CARD`; the others
  receive `WITHHOLD`

#### Scenario: Raw disclosure is unavailable

- **WHEN** a candidate is selected for disclosure
- **THEN** the result contains no raw body and does not automatically fetch
  full content

### Requirement: Offline-only boundary

Phase A MUST remain pure offline source and test functionality. It MUST have
zero production runtime callers and MUST NOT alter AutoRecall, hooks, Hybrid,
ranking, configuration, databases, data, Gateway state, or Memory Card runtime
behavior.

#### Scenario: Controller remains unintegrated

- **WHEN** Phase A is validated
- **THEN** only tests and offline tooling may call the controller; no runtime
  hook or production policy imports it

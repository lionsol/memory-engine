## Purpose

Defines the Phase 2.5 architecture boundary that lets memory-engine canonicalize one Core chunk once and project it safely across later read-only and persistent workflows.

## ADDED Requirements

### Requirement: Canonical Memory Object contract

The system SHALL define the Canonical Memory Object as a read-only semantic composition governed by `docs/canonical-memory-object-contract.md`. It MUST use the exact Core chunk id for `memory_id`, derive `canonical_id` as `"cmem:core:" + memory_id`, preserve Core source authority, keep Engine lifecycle authority distinct, and exclude runtime retrieval evidence from the canonical payload.

#### Scenario: Exact Core identity is stable across projections

- **WHEN** the same Core chunk is represented under a new canonical schema or card/vector projection version
- **THEN** its exact `memory_id` and derived `canonical_id` remain unchanged

#### Scenario: Missing exact identity fails closed

- **WHEN** a candidate cannot establish exactly one Core chunk id
- **THEN** the canonical object is not synthesized from path, span, text, rank, score, or projection inputs

#### Scenario: Contract preserves ownership boundaries

- **WHEN** a canonical object is composed
- **THEN** Core source facts remain read-only, Engine lifecycle state remains Engine-owned, Lance remains a derived projection, and query/turn/agent evidence remains outside the canonical payload

### Requirement: Read-only isolated Canonical Adapter

The Phase 2.5-B adapter MUST compose Core source facts and optional Engine lifecycle state through isolated readonly Core and Engine handles. It MUST perform exact-id lookup only, fail closed for missing, ambiguous, or malformed required Core data, represent a missing Engine row as a valid external object, and perform no implicit persistent repair or write.

#### Scenario: Managed object composition

- **WHEN** an exact Core chunk has a matching Engine `memory_confidence` category/lifecycle row
- **THEN** the adapter returns the Core facts plus Engine-owned lifecycle state without mutating either store

#### Scenario: External object composition

- **WHEN** an exact Core chunk has no matching Engine row
- **THEN** the adapter returns a valid external object with null Engine confidence/lifecycle/category state and does not fabricate managed ownership

#### Scenario: Isolated failure behavior

- **WHEN** Core identity or required source text is missing, ambiguous, or malformed
- **THEN** the adapter fails closed without opening a combined Core+Engine handle or repairing persistent state

### Requirement: Projection unification with parity gate

Phase 2.5-C SHALL migrate Recall, Memory Card, and vector-facing semantic normalization to consume the Canonical Memory Object only after parity with current behavior is demonstrated. Query scores, channel availability, current agent gates, disclosure decisions, and other runtime evidence MUST remain downstream projection data.

#### Scenario: Projection consumes canonical semantics

- **WHEN** a Recall, Memory Card, or vector projection is produced after migration
- **THEN** its semantic source, lifecycle, category, kind, temporal, and identity fields come from the Canonical Memory Object while request-time evidence remains in the projection envelope

#### Scenario: Removal follows parity

- **WHEN** duplicated semantic inference is considered for removal
- **THEN** removal is permitted only after compatibility/parity evidence covers the affected projection behavior

### Requirement: Separately authorized reconciliation integration

Phase 2.5-D SHALL define any persistent Core-to-Engine-to-Lance reconciliation integration around canonical identity, but this OpenSpec change MUST NOT authorize persistent writes, schema migration, runtime activation, or rollout. A later implementation requires explicit owner authorization appropriate to the persistent data mutation.

#### Scenario: Later reconciliation preserves identity

- **WHEN** a separately authorized reconciliation implementation consumes a Canonical Memory Object
- **THEN** Core, Engine, and Lance compatibility remains keyed by the exact Core chunk id and canonical identity does not become a new store

#### Scenario: OpenSpec is not write authorization

- **WHEN** this architecture change is reviewed or applied
- **THEN** it does not itself permit database writes, Core schema mutation, Engine schema migration in A/B, Lance authority, ranking changes in A/B, AutoRecall enablement, multi-agent ACL changes, or runtime deployment

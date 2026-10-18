# stable-memory-identity Specification

## ADDED Requirements

### Requirement: Stable migration and convergence preserve auditable identity state

The implementation MUST read the legacy JSONL manifest fields that are actually present, persist a deterministic mapping for each row, and treat Engine/Core identifiers as aliases for one stable entity rather than creating duplicate confidence associations. Recovered entities whose Core snapshots disappear MUST leave the active/recovered convergence set without guessed remapping.

#### Scenario: A mismatched legacy identifier is migrated twice

- **WHEN** a manifest row has different `engine_memory_id` and `core_chunk_id`
- **AND** migration is retried after a conflict or partial failure
- **THEN** the same auditable entity and mapping are reused
- **AND** index-sync creates no duplicate confidence row or embedding request

#### Scenario: A recovered Core snapshot disappears

- **WHEN** a migrated recovered entity is absent from the current Core snapshot
- **THEN** it transitions out of the active/recovered convergence set
- **AND** global maintenance reports no recurring backlog for that entity

### Requirement: Fingerprint verification is fail-closed and explicit

Global convergence MUST report fingerprint verification as `verified`, `unverified`, or `conflict`. Schema-read failures, query failures, missing fingerprint columns, and missing values MUST remain explicitly unverified. A mismatch between existing Engine and Lance fingerprints MUST not overwrite either value and MUST remain in the bounded backlog.

#### Scenario: Engine and Lance fingerprints conflict

- **WHEN** both stores contain fingerprints for one stable entity and the values differ
- **THEN** convergence reports `fingerprint_conflict`
- **AND** no metadata or vector value is overwritten

### Requirement: Stable writes use trusted Core content and old schemas are explicit

The add and index-sync paths MUST derive `content_hash` from trusted Core content when available. Before schema migration, legacy writes MAY continue, but stable identity operations MUST report `stable_identity_state: "unmigrated"` and MUST NOT claim stable association success or execute production DDL.

#### Scenario: Add retries after vector propagation is pending

- **WHEN** Core content is persisted and Engine metadata succeeds but Lance propagation is pending
- **AND** the add call is retried
- **THEN** the persisted content hash and stable entity remain unchanged
- **AND** no duplicate identity is created

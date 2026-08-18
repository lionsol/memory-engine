## Context

The current Core chunk, Engine `memory_confidence`, Lance projection, retrieval normalization, and P4 Memory Card object are separate authorities and projections. The finalized contract in `docs/canonical-memory-object-contract.md` defines their relationship without introducing a new store or runtime implementation.

## Goals / Non-Goals

**Goals:**

- Establish one exact-Core-id semantic object that can be read compositionally.
- Keep Phase 2.5-B isolated and read-only, with explicit managed/external and fail-closed behavior.
- Define parity-gated projection unification and a separately governed reconciliation boundary.

**Non-Goals:**

- No production consumer wiring or runtime activation in this change; the 2.5-B source adapter remains read-only and isolated.
- No third database, Core schema mutation, Engine schema migration in A/B, Lance authority, ranking change in A/B, AutoRecall enablement, or multi-agent ACL.
- No persistent write authorization from OpenSpec itself.

## Decisions

### 1. The contract document is the semantic authority

The implementation contract remains `docs/canonical-memory-object-contract.md`; this OpenSpec records the architecture and sequencing authority without duplicating its field matrix. Canonical v1 uses the exact Core chunk id and deterministic `cmem:core:` namespace. P4 object/card identifiers remain downstream projection identifiers.

### 2. A/B are read-only and isolated

The read-only adapter reads Core through a readonly isolated handle and Engine through an isolated readonly handle. It does not use combined Core+Engine SQL, infer an identity from path/span/text, repair persistent state, or emit `text_inference`. Missing Engine state produces an external object; missing or ambiguous Core identity fails closed.

### 3. Eligibility remains intentionally deferred

The current code has multiple policy boundaries: quality scope/path family, retrieval/channel thresholds and availability, AutoRecall gates, and Memory Card disclosure policy. Since they do not provide one unique query-independent and agent-independent canonical baseline, retrieval/vector/disclosure eligibility fields are deferred to 2.5-C rather than frozen spec fiction.

### 4. C requires parity before removal

Projection unification may reuse existing read-only helpers during migration, but duplicated semantic inference is removed only after behavior parity is demonstrated for managed, external, category, temporal, lifecycle, and disclosure boundaries. Runtime evidence remains outside the canonical object.

### 5. D is a separate persistent-write boundary

Reconciliation integration may later consume canonical identity, but any Core-to-Engine-to-Lance persistent write path is a new controlled decision. This change records the boundary and does not authorize execution, migration, installation, or rollout.

## Risks / Trade-offs

- [Risk] A/B consumers may accidentally reintroduce combined database access. → Require isolated handle tests and static boundary checks before adapter implementation is accepted.
- [Risk] A deferred eligibility field may be mistaken for a stable policy. → Keep the fields explicitly outside Canonical v1 until 2.5-C establishes one deterministic baseline rule.
- [Risk] Projection migration may change user-visible recall/card behavior. → Require parity evidence before deleting duplicated inference and keep ranking/runtime evidence downstream.
- [Risk] D could be treated as implicitly authorized by this architecture record. → Require separate owner authorization for every persistent write or runtime activation.

## Migration Plan

1. Close the 2.5-A contract and contract tests.
2. In this change, build the read-only isolated 2.5-B adapter and prove managed/external/failure parity without adding a production consumer.
3. C1 adds a source-only canonical-aware Memory Card/MemoryObject projection with explicit parity tests; later C2/C3 work migrates Hybrid and vector-facing consumers behind parity checks before removing duplicate semantics.
4. In a separately authorized 2.5-D change, design and qualify persistent reconciliation writes with rollback and DB-boundary evidence.

No runtime/config/database mutation is part of this change.

## Phase 2.5-C1 status

C1 is source implemented and test-verified for the Memory Card/MemoryObject projection. The legacy candidate-only APIs remain available, the AutoRecall runtime wiring is unchanged, and no Hybrid result or Lance path consumes the new projector. C2 Hybrid canonicalization and C3 vector-facing canonicalization remain incomplete.

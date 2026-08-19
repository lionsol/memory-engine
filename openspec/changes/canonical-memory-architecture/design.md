## Context

The current Core chunk, Engine `memory_confidence`, Lance projection, retrieval normalization, and P4 Memory Card object are separate authorities and projections. The finalized contract in `docs/canonical-memory-object-contract.md` defines their relationship without introducing a new store or runtime implementation.

## Goals / Non-Goals

**Goals:**

- Establish one exact-Core-id semantic object that can be read compositionally.
- Keep Phase 2.5-B isolated and read-only, with explicit managed/external and fail-closed behavior.
- Define parity-gated projection unification and a separately governed reconciliation boundary.

**Non-Goals:**

- No runtime deployment or activation, persistent database mutation, or runtime/config change in this change; source consumers remain read-only and isolated.
- No third database, Core schema mutation, Engine schema migration in A/B, Lance authority, ranking change in A/B, AutoRecall enablement, or multi-agent ACL.
- No persistent write authorization from OpenSpec itself.

## Decisions

### 1. The contract document is the semantic authority

The implementation contract remains `docs/canonical-memory-object-contract.md`; this OpenSpec records the architecture and sequencing authority without duplicating its field matrix. Canonical v1 uses the exact Core chunk id and deterministic `cmem:core:` namespace. P4 object/card identifiers remain downstream projection identifiers.

### 2. A/B are read-only and isolated

The read-only adapter reads Core through a readonly isolated handle and Engine through an isolated readonly handle. It does not use combined Core+Engine SQL, infer an identity from path/span/text, repair persistent state, or emit `text_inference`. Missing Engine state produces an external object; missing or ambiguous Core identity fails closed.

### 3. Eligibility remains intentionally deferred

The current code has multiple policy boundaries: quality scope/path family, retrieval/channel thresholds and availability, AutoRecall gates, and Memory Card disclosure policy. Since they do not provide one unique query-independent and agent-independent canonical baseline, eligibility remains downstream projection policy and Canonical v1 adds no eligibility fields.

### 4. C requires parity before removal

Projection unification may reuse existing read-only helpers during migration, but duplicated semantic inference is removed only after behavior parity is demonstrated for managed, external, category, temporal, lifecycle, and disclosure boundaries. Runtime evidence remains outside the canonical object.

### 5. D is a separate persistent-write boundary

Reconciliation integration may later consume canonical identity, but any Core-to-Engine-to-Lance persistent write path is a new controlled decision. This change records the boundary and does not authorize execution, migration, installation, or rollout.

## Risks / Trade-offs

- [Risk] A/B consumers may accidentally reintroduce combined database access. → Require isolated handle tests and static boundary checks before adapter implementation is accepted.
- [Risk] A deferred eligibility field may be mistaken for a stable policy. → Keep eligibility explicitly outside Canonical v1 and downstream after the C3 parity review.
- [Risk] Projection migration may change user-visible recall/card behavior. → Require parity evidence before deleting duplicated inference and keep ranking/runtime evidence downstream.
- [Risk] D could be treated as implicitly authorized by this architecture record. → Require separate owner authorization for every persistent write or runtime activation.

## Migration Plan

1. Close the 2.5-A contract and contract tests.
2. In this change, build the read-only isolated 2.5-B adapter and prove managed/external/failure parity without adding a production consumer.
3. C1 adds a source-only canonical-aware Memory Card/MemoryObject projection with explicit parity tests. C2 adds isolated top-K Hybrid result canonicalization and exact identity propagation behind batch-read and drift counters. C3 defines a pure canonical vector projection and Lance-row materializer with parity evidence; persistent Lance writer adoption remains a separately authorized 2.5-D decision.
4. Implement the 2.5-D source writer integration in this change; separately authorize and qualify any persistent runtime/data execution, deployment, migration, or rollout with rollback and DB-boundary evidence.

No runtime/config/database mutation is part of this change.

## Phase 2.5-C1 status

C1 is source implemented and test-verified for the Memory Card/MemoryObject projection. The legacy candidate-only APIs remain available, the AutoRecall runtime wiring is unchanged, and no Hybrid result or Lance path consumes the C1 projector. At C1 closeout, C2 Hybrid canonicalization and C3 vector-facing canonicalization remained incomplete.

## Phase 2.5-C2 status

C2 is source implemented and test-verified for isolated Hybrid result projection. After ranking, only served top-K candidates are batch-read through isolated readonly Core and Engine handles; public `id` remains the 16-character compatibility prefix while `memory_id` and `canonical_id` carry exact canonical identity. Legacy combined `withDb` callers retain their existing output contract, and ranking/channel selection is unchanged. At C2 closeout, C3 vector-facing canonicalization remained incomplete.

## Phase 2.5-C3 status and parity review

C3 is source implemented and test-verified as a pure Canonical Vector Projection v1. It preserves exact `memory_id`/`canonical_id`, carries the canonical content hash in the projection envelope, and uses the first 2000 characters of canonical `source.text` as both vector `text` and `embedding_input`. `materializeCanonicalLanceRow()` emits only the existing `{ id, text, vector, timestamp }` row shape. No `table.add()`/`lancedbTable.add()` call, embedding model, runtime configuration, database, or persistent consumer was changed.

Eligibility review result: eligibility remains downstream projection policy; Canonical v1 introduces no `vector_eligible`, `retrieval_eligible`, `disclosure_eligible`, or risk fields.

The following table records the C3 pre-D review baseline; the D source implementation below closes the add-path drift in repository code.

| C3 review baseline path | id parity | projection-text parity | embedding/text parity | canonical source authority |
|---|---|---|---|---|
| orphan/reconciliation | PASS | PASS | PASS | Core chunk text |
| legacy `memory_engine add` <=2000 chars | PASS | conditional | PASS | UNPROVEN/DRIFT: raw add input was not proven equal to final Core text |
| legacy `memory_engine add` >2000 chars | PASS | conditional | DRIFT | UNPROVEN/DRIFT: raw add input was not proven equal to final Core text |

Final C parity was `PASS_WITH_FINDINGS`: C1 card canonical projection parity PASS; C2 Hybrid result canonical projection parity PASS with mismatch counters retained; C3 vector projection contract PASS. The long-text add drift and unproven raw-input/Core-source authority were findings at C3 closeout and are now fixed in the D source implementation; no runtime qualification is implied.

## Phase 2.5-D source implementation status

The source implementation is `IMPLEMENTED / SOURCE VERIFIED` for the only three direct Lance writers: `memory_engine add`, scoped session-flush orphan reconciliation, and global orphan-vector repair. Each performs exact-id canonical read, canonical vector projection, embedding of `projection.embedding_input`, and `materializeCanonicalLanceRow()` before `table.add([row])`. Canonical lookup, projection, or embedding failure is fail-closed for the Lance write; no raw-input/Core-only/manual row fallback remains.

The add path keeps its existing one-new-chunk direct-write behavior; scoped reconciliation remains active-only, existing-ID aware, and capped at 10; global repair remains active-row, existing-ID aware, and batched at 10. Core reads and canonical Engine reads use distinct readonly isolated accessors, while existing Engine lifecycle inserts remain on the writable accessor. Lance schema, embedding model, ranking, AutoRecall, and eligibility policy are unchanged.

This source implementation fixes the previous long-text add-path vector/text drift in repository source. The later Owner-authorized runtime deployment and qualification are recorded in the Phase 2.5-D closeout below; this OpenSpec record does not itself create execution authority.

### Phase 2.5-D.1 add identity observation correction

The authorized D.1 source correction separates source identity observation from Engine lifecycle existence. `memory_engine add` derives the safe relative path and records an exact readonly Core `id` snapshot before `appendSmartAdd()`, keeps the existing append and sync flow, then records the same exact Core `id` query after a non-failing sync. `newCoreRows` is the ordered post-minus-pre Core delta; Engine `memory_confidence` rows are queried only afterward, with missing rows inserted and existing rows preserved. Therefore `chunks_added` counts exact new Core IDs, including IDs already created by sync backfill, and the direct Lance writer still processes only the deterministic first new Core row.

A successful sync with zero exact Core delta returns `pending_index` with `needs_reconcile=true` and `reconcile_reason=index_not_observed`; it does not fall back to Engine-row absence. Core snapshot failures fail closed before append or return the persisted-source `index_observation_failed` recovery state after append. Engine failures return `pending_engine` without a Lance write. Core snapshots, writable Engine lifecycle access, and canonical readonly reads remain separate accessors; no sync/backfill, reconciliation, Hybrid, AutoRecall, ranking, config, schema, or canonical vector contract changed.

The earlier Core observation-gap conclusion is corrected and withdrawn as `EVIDENCE ERROR`: verification read the legacy Core database rather than the authoritative main-agent Core database. Runtime path resolution has preferred the agent database when present since `eaf6993`, but the earlier verifier queried the legacy location. Reconstruction of marker `PHASE25D_CANONICAL_WRITER_SMOKE_20260819T1254_057f43e` proved exact Core ID `1a47d2e6a183a2c884ff85637a0bc66251288e60b57cc5d11df40a73d73bdd72` existed and that the product failure was Engine-row absence being used as Core identity discovery after sync backfill.

## Phase 2.5 runtime closeout

Phase 2.5-D runtime is `PASS / QUALIFIED`; Phase 2.5-D.1 source and deployment are `PASS / CLOSED`, with live writer qualification `PASS / QUALIFIED`; overall Phase 2.5 Canonical Memory Architecture is `PASS / CLOSED`. Active runtime source is `3ce61697ef2ef77b91b60e229b0924b074038d86`, Gateway `READY`, and `AutoRecall=false`.

Final marker `PHASE25D1_FINAL_WRITER_SMOKE_20260819T1521_3ce6169` produced exact Core ID `0c99335a14d6bb77d81e716dde49495b8d6552788b2a922976e2942738ad81eb`. Exact source/Core/Engine/event/Lance persistence was observed once; Lance id matched the Core id, Lance text matched the 526-character Core canonical projection, and event metadata recorded `category=temporary`, `confidence=0.4`, `tau=2`, `lance_written=1`, `derived_state=complete`, `needs_reconcile=false`, and `vector_error=null`. The later marker collision was a correct duplicate guard, not a failed qualification, and no reconciliation was required.

`ADD_SYNC_BACKFILL_SCOPE_FINDING` remains non-blocking: the first live add inserted `111` confidence rows through existing sync/backfill behavior, which D.1 did not modify. Final preflight showed eligible Core `815`, Engine confidence `815`, and missing confidence `0`. A single stale Engine row from Core rechunking remains a later lifecycle-maintenance finding; no cleanup was performed and Phase 2.5 was not reopened.

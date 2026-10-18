# Design — Stable Memory Identity (design gate)

## Contract
| key | identity semantics | survives rename/move | content edit | rechunk | model upgrade | archive/restore |
|---|---|---|---|---|---|---|
| `source_doc_id` (doc_uuid) | durable doc identity (opaque uuid) | YES | YES | YES | YES | YES |
| `entity_id` | durable per materialized memory chunk (opaque), NOT derived from mutable inputs | YES | NO -> new entity, old=superseded | NO -> supersede | YES | YES |
| `core_chunk_id` | volatile snapshot reference only | no | no | no | no | - |
| `content_hash` | fingerprint (detect change), NOT identity | - | changes | changes | same | - |
| `(doc_uuid, ordinal)` | ordering hint only, NOT identity | - | - | shifts | - | - |

Rule: `(doc_uuid, ordinal)` / content hash are **not** permanent chunk identity.
Rechunk creates a new `entity_id` and marks the previous one `superseded`.

## Persistence (Engine DB)
- `memory_source_docs(doc_uuid PK, source, canonical_path, created_at, updated_at, last_content_fingerprint)`.
- `memory_identity(entity_id PK, doc_uuid, core_chunk_id_snapshot, content_hash, embedding_model, embedding_fingerprint, state, created_at, updated_at)`.
  state ∈ {active, superseded, archived, unknown_legacy, recovered}.
- LanceDB row: `id = entity_id` (+ optional doc_uuid / fingerprint fields).
- `memory_identity_migration_map` persists deterministic manifest-key → identity
  assignments before recovery rows are applied; it is required when the legacy
  manifest does not contain `entity_id` or `doc_uuid`.
- The migration map also persists `lance_id`, `engine_memory_id`,
  `core_chunk_id`, `canonical_path`, and an applied status. A manifest row is
  therefore an auditable alias from the old vector ID to the recovered entity;
  `lance_id != core_chunk_id` is represented explicitly rather than treated as
  a missing vector.
- Active identity uniqueness is enforced by SQLite partial unique indexes on the
  live Core-chunk association and by the confidence-row entity index.

## Lifecycle (create/update/rechunk/move/archive/restore/delete)
- create: new entity_id + ensure doc registry (doc_uuid by source+canonical_path).
- update (same boundaries, new content): supersede old entity, new entity_id.
- rechunk: supersede affected entities; new entities; doc_uuid unchanged.
- move/rename: doc_uuid unchanged; canonical_path updated.
- A move requires the existing entity/doc_uuid (or an explicit doc_uuid). A
  path hash is only a deterministic migration seed; it is never used as a
  cross-rename identity proof.
- model upgrade: embedding_fingerprint updated; entity_id unchanged (re-embed, no duplicate).
- archive/restore: state transitions; entity_id preserved.
- delete: state=archived (no physical delete); doc link preserved.

## Dedup / stale
- Dedup: skip write if an active identity row already exists for the entity (idempotent).
- Stale: active entity whose content_hash != current, or whose doc no longer current -> mark only.

## Migration (offline, not applied)
- Additive: `CREATE TABLE IF NOT EXISTS` for the two tables; `ALTER TABLE memory_confidence ADD COLUMN` guarded by PRAGMA table_info (idempotent).
- Legacy rows -> state=`unknown_legacy` unless identity is deterministic.
- The actual 129-row legacy manifest shape is accepted without `entity_id` or
  `doc_uuid`; JSONL rows are read directly, and deterministic mapping rows are
  persisted and reused on retry. Existing Lance aliases are counted as
  present, so migration does not re-embed the 129 vectors.
- 129 manifest rows become state=`recovered`; 613/36 remain `unknown_legacy`.
- Stable write/lifecycle operations fail closed with an explicit unmigrated
  schema state until the additive migration has run. They do not infer stable
  association from the legacy `chunk_id` alone.
- The legacy add, confidence-writer, index-sync, and session-flush paths use
  schema readiness (not API shape) and retain legacy writes while reporting
  `stable_identity_state: "unmigrated"`.
- Rollback: additive-only -> `DROP TABLE`/ignore columns.

## Global convergence

- Session flush runs only the bounded `scope=session_flush` reconciliation.
- Global convergence is reachable only through the deliberate
  `runGlobalIdentityMaintenance` entry point, which is authorization-gated and
  remains disabled for production callers pending separate authorization.
- Lance enumeration discovers the existing table schema before selecting
  optional columns. Checkpoints bind to both Lance dataset identity and the
  active Engine identity set; a changed dataset invalidates the checkpoint.
- Every invocation is bounded by page and write limits and returns
  `completion_state`, `complete`, and `remaining_backlog`.
- Dataset identity includes the actual Lance member IDs as well as schema
  metadata, so same-count membership changes invalidate recovery. Stable
  Lance IDs are normalized through `memory_identity.core_chunk_id_snapshot`
  before canonical read/projection; the candidate keeps the stable ID as
  metadata while exposing the current Core ID to downstream consumers.
- A Core reindex never guesses a new-to-old chunk mapping from path, ordinal,
  or non-unique content. Missing old snapshots become `unknown_legacy` and are
  excluded from active convergence until an explicit mapping is supplied.

## Compatibility
- Core stays read-only; only Engine DB evolves. Existing confidence/decay semantics unchanged.

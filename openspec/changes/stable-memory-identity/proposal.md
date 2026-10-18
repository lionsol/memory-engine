# Stable Memory Identity — Proposal

## Why
Engine `memory_confidence.chunk_id` is copied from the volatile Core chunk id
(`hashText(source:path:startLine:endLine:chunkHash:model)`), so any content / line /
path / embedding-model change regenerates the Core chunk id and orphans the Engine
memory + its LanceDB vector. Forensics: LanceDB 742 vectors; only 128 equal a current
Core chunk id; 614 orphans; 1083 active memories lack vectors; path recovery 17.4%.

## What Changes
- Introduce an opaque, stable `entity_id` for each Engine memory row and a durable
  `source_doc_id` (doc_uuid) for source documents, persisted in the Engine DB.
- Store `core_chunk_id_snapshot`, `content_hash`, `embedding_model`,
  `embedding_fingerprint`, and `state` alongside; LanceDB vector rows key on `entity_id`.
- Derive `path` from the source-document registry (doc_uuid), never from the volatile Core chunk id.
- Add an idempotent, offline-tested schema migration (NOT applied to production).
- Add a bounded, paged, idempotent global convergence path (replacing the
  `count > 1000` zero-vector scan); real embeddings only.

## Non-goals
- No production data migration, no vector backfill, no index rebuild, no prune.
- No relink/delete of the 613 unknown historical vectors or 36 no-source memories.
- No change to the existing recall fix or audit fix in the main worktree.
- No provider calls in this phase; no Recall@3/latency claims.

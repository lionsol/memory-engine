# Phase 2.5-A — Canonical Memory Object Contract

> Status: `Phase 2.5-A contract finalized; OpenSpec architecture change active`
>
> Scope: Phase 2.5-A only. This document defines semantic ownership and projection boundaries. It does not authorize runtime mutation, DB migration, write-path changes, or rollout.

## 1. Decision

memory-engine will use one versioned **Canonical Memory Object** as the stable semantic read model between OpenClaw Core and downstream memory-engine projections.

The governing rule is:

> **Canonicalize once, project many.**

The Canonical Memory Object is **not another database** and is not a replacement for OpenClaw Core, the Engine database, LanceDB, or the existing Memory Card. In Phase 2.5-A/B it is an in-memory, read-only composition of authoritative source facts plus Engine-owned lifecycle state and deterministic derived projections.

## 2. Why this layer exists

Today the same memory is reconstructed differently by hybrid retrieval, lifecycle code, reconciliation, AutoRecall Memory Card projection, quality tooling, and vector code. This creates several forms of semantic drift:

- Core chunk identity and Engine `memory_confidence.chunk_id` are related implicitly rather than through one object contract.
- Managed and external memories are normalized differently by retrieval code.
- Category, source type, lifecycle, eligibility, risk, and content references are inferred in multiple places.
- Lance rows carry a vector projection but do not state which semantic object they project.
- the existing P4 `MemoryObject` contains query-time fields such as retrieval rank, retrieval score, trace id, and salience reason, so it cannot be the canonical semantic object.
- P4 `stableObjectId()` / `object_id` is not canonical identity: its exact-id path truncates the underlying id to 32 characters, while its id-less fallback identity mixes `projectionVersion` with path/span/text inputs.
- P4 `memoryId()` may synthesize fallback identity when no exact Core id exists. Canonical v1 does neither: it requires the exact Core chunk id and fails closed when that id cannot be established.

Phase 2.5 creates a stable semantic boundary before later ranking, vector, AutoRecall, lifecycle, and multi-agent work builds more policy on top of the same memory.

## 3. Non-goals

Phase 2.5-A does not:

- create a canonical-memory table or a third durable store;
- change OpenClaw Core storage or indexing;
- change Engine DB schema;
- change LanceDB schema or write behavior;
- change retrieval ranking, RRF, thresholds, fallback, or AutoRecall behavior;
- merge multiple chunks into one new logical-memory entity;
- invent a stable logical identity across source edits or Core rechunking when no such source identity currently exists;
- move lifecycle ownership out of the Engine database;
- make LanceDB authoritative for text, category, confidence, lifecycle, or provenance;
- make Memory Cards canonical storage;
- add runtime canaries.

## 4. Authoritative layers

The canonical layer composes existing authorities; it does not replace them.

```text
Workspace/source files
        |
        v
OpenClaw Core index
  - chunk id
  - path / source
  - line span
  - chunk text
  - content/index hash metadata
  - updated_at
        |
        | read-only
        v
Canonical Memory Adapter
        +----------------------+
        |                      |
        v                      v
Engine DB                Derived projections
  - confidence             - classification kind
  - category authority     - temporal relation
  - hit count              - category/kind basis
  - archive/protect        - content projection basis
  - conflict state
        |
        v
Canonical Memory Object
        |
        +----------+-----------+----------------+
        |          |                            |
        v          v                            v
Recall candidate  Memory Card / disclosure     Lance vector row
projection        projection                   projection
```

Ownership invariant:

```text
Core source facts are read-only to normal memory-engine runtime.
Engine owns mutable lifecycle/confidence state.
Lance is a derived vector projection only.
Runtime retrieval evidence is never canonical state.
```

## 5. Field ownership classes

Every field exposed by the Canonical Memory Object belongs to exactly one semantic class.

### 5.1 `source_fact`

A value copied from an authoritative source record without semantic reinterpretation.

`source_fact` names the value's authority and ownership; the canonical JSON key does not need to have the same name as the Core column. Renaming `start_line` to `line_start`, for example, is a field mapping, not semantic inference.

Examples:

- Core chunk id;
- path;
- source label;
- line span;
- full chunk text;
- Core hash/index metadata;
- Core `updated_at`.

A canonical adapter must not silently synthesize a missing source fact.

### 5.2 `lifecycle_state`

Mutable state owned by memory-engine's Engine database.

Examples:

- managed vs external status;
- initial confidence;
- current/reinforced confidence;
- last confidence update;
- base tau;
- hit count;
- archived;
- protected;
- conflict flag;
- Engine-authoritative category when a `memory_confidence` row exists.

If no Engine row exists, the object is `external`; the adapter must not fabricate Engine confidence, lifecycle, or managed category values.

### 5.3 `derived_projection`

A deterministic value derived from source facts and/or lifecycle state under a named contract version.

Examples:

- canonical id namespace;
- normalized source path;
- category fallback when no Engine category authority exists;
- memory kind;
- episode/date relation;
- deterministic projection basis;
- content hash used by projections.

Derived fields must not be mistaken for storage authority. Where ambiguity matters, the object carries the derivation authority/basis explicitly.

### 5.4 `runtime_only_evidence`

Query-, turn-, channel-, or trace-specific observations.

Examples:

- retrieval rank;
- FTS/vector/KG score;
- RRF/final score;
- channel membership;
- trace id;
- query-specific salience reason;
- AutoRecall injection decision;
- cited-in-current-turn status;
- latency and candidate counts.

These values are forbidden from the canonical semantic payload. They belong to recall/debug/event envelopes that reference the canonical memory id.

## 6. Canonical identity

### 6.1 V1 identity rule

For Phase 2.5 v1, one Canonical Memory Object represents one OpenClaw Core chunk.

```text
memory_id    = exact Core chunk id
canonical_id = "cmem:core:" + memory_id
```

`memory_id` remains the compatibility id used by current Engine rows, Lance rows, events, retrieval, and `memory_engine_get`.

`canonical_id` is a semantic namespace wrapper. It must be independent of Canonical Memory Object schema version, Recall/Memory Card projection version, retrieval rank, category, confidence, or runtime configuration.

### 6.2 Stability boundary

V1 guarantees stable identity only while the underlying Core chunk identity is stable.

A source edit or Core rechunking may produce a new chunk id and therefore a new v1 canonical id. Phase 2.5-A deliberately does not invent a logical lineage id that the existing source system cannot prove.

Cross-version rule:

```text
same Core chunk id + new canonical schema version => same canonical_id
```

Projection-version rule:

```text
same canonical_id + new card/recall/vector projection version => same canonical_id
```

## 7. Canonical object v1

The v1 semantic envelope is:

```json
{
  "schema_version": 1,
  "canonical_id": "cmem:core:<chunk-id>",
  "memory_id": "<exact-core-chunk-id>",
  "source": {
    "system": "openclaw_core",
    "record_type": "chunk",
    "record_id": "<exact-core-chunk-id>",
    "path": "memory/projects/example.md",
    "core_source": "memory",
    "line_start": 10,
    "line_end": 24,
    "text": "<full core chunk text>",
    "core_hash": "<core hash or null>",
    "updated_at": "<exact Core.updated_at value or null>"
  },
  "classification": {
    "category": "project",
    "category_authority": "engine",
    "kind": "project_state",
    "kind_basis": "category"
  },
  "temporal": {
    "episode_date": "2026-08-17",
    "episode_date_basis": "source_path"
  },
  "lifecycle": {
    "management": "managed",
    "category": "project",
    "initial_confidence": 0.7,
    "confidence": 0.7,
    "last_confidence_update": 1780000000,
    "base_tau_days": 30,
    "hit_count": 4,
    "archived": false,
    "protected": false,
    "conflict": false
  },
  "content_ref": {
    "mode": "core_chunk",
    "content_hash": "sha256:<hash>"
  }
}
```

This is a semantic contract. Phase 2.5-A does not require this exact JSON to be persisted anywhere.

### 7.1 Field ownership matrix

The contract assigns every v1 field to one semantic class. Effective classification may reference Engine state, but the classification itself remains a derived projection with explicit authority.

| Field | Semantic class | Authority / basis |
|---|---|---|
| `schema_version` | `derived_projection` | Canonical contract version |
| `canonical_id` | `derived_projection` | Deterministic namespace over `memory_id` |
| `memory_id` | `source_fact` | Exact Core chunk id |
| `source.system` | `derived_projection` | Canonical adapter source-system descriptor |
| `source.record_type` | `derived_projection` | Canonical adapter record-type descriptor |
| `source.record_id` | `source_fact` | Exact Core chunk id |
| `source.path` | `source_fact` | Core chunk path |
| `source.core_source` | `source_fact` | Core chunk `source` field |
| `source.line_start` | `source_fact` | Core chunk span |
| `source.line_end` | `source_fact` | Core chunk span |
| `source.text` | `source_fact` | Exact full Core chunk text |
| `source.core_hash` | `source_fact` | Core chunk hash when present |
| `source.updated_at` | `source_fact` | Core chunk timestamp when present |
| `classification.category` | `derived_projection` | Effective category selected from Engine authority or deterministic fallback |
| `classification.category_authority` | `derived_projection` | Describes where effective category came from |
| `classification.kind` | `derived_projection` | Deterministic semantic classification |
| `classification.kind_basis` | `derived_projection` | Basis for kind derivation |
| `temporal.episode_date` | `derived_projection` | Unambiguous supported source metadata/path relation only |
| `temporal.episode_date_basis` | `derived_projection` | Basis for episode-date derivation |
| `lifecycle.management` | `derived_projection` | Presence/absence of matching Engine lifecycle row |
| `lifecycle.category` | `lifecycle_state` | Engine `memory_confidence.category`, or `null` for external |
| `lifecycle.initial_confidence` | `lifecycle_state` | Engine row, or `null` for external |
| `lifecycle.confidence` | `lifecycle_state` | Engine row, or `null` for external |
| `lifecycle.last_confidence_update` | `lifecycle_state` | Engine row, or `null` for external |
| `lifecycle.base_tau_days` | `lifecycle_state` | Engine row, or `null` for external |
| `lifecycle.hit_count` | `lifecycle_state` | Engine row, or `null` for external |
| `lifecycle.archived` | `lifecycle_state` | Engine row, or `null` for external |
| `lifecycle.protected` | `lifecycle_state` | Engine row, or `null` for external |
| `lifecycle.conflict` | `lifecycle_state` | Engine row, or `null` for external |
| `content_ref.mode` | `derived_projection` | Canonical source-reference contract |
| `content_ref.content_hash` | `derived_projection` | SHA-256 of exact canonical source text |

The following are intentionally absent from the matrix because they are `runtime_only_evidence` and therefore are **not fields of Canonical Memory Object v1**: retrieval/channel scores, RRF/final score, retrieval rank, trace id, query-specific salience, injection decision, current-turn citation status, latency, and candidate counts.

## 8. Required semantics by field

### 8.1 `source`

`source` is Core-owned evidence.

The current Core chunk schema is:

```text
id, path, source, start_line, end_line, hash, model, text,
embedding, updated_at
```

Canonical v1 uses this exact mapping:

```text
Core.id         -> canonical memory_id and source.record_id
Core.path       -> canonical source.path
Core.start_line -> canonical source.line_start
Core.end_line   -> canonical source.line_end
Core.source     -> canonical source.core_source
Core.hash       -> canonical source.core_hash
Core.text       -> canonical source.text
Core.updated_at -> canonical source.updated_at
```

`Core.model` and `Core.embedding` are excluded from the Canonical Memory Object v1 semantic payload. They are Core indexing/vector implementation metadata, not canonical memory semantic authority.

Rules:

- `record_id` and `memory_id` are the exact Core chunk id.
- `text` is the full Core chunk text, not the 600-character retrieval preview and not the 2000-character Lance projection text.
- `Core.start_line -> source.line_start`, `Core.end_line -> source.line_end`, `Core.source -> source.core_source`, and `Core.hash -> source.core_hash` are exact source facts; the key renames do not add semantic inference.
- `updated_at` preserves the exact raw value from `Core.updated_at` when present. The canonical adapter does not convert it to ISO, reinterpret it, or replace it with adapter execution time.
- path normalization may be exposed as a derived helper, but must not erase the original source fact when the distinction matters.
- the adapter must fail closed for a requested id that cannot be resolved to exactly one Core chunk.

### 8.2 `classification`

Category has explicit authority.

Allowed `category_authority` values:

```text
engine
source_metadata
path_inference
unknown
text_inference   # future-reserved; MUST NOT be emitted by 2.5-B v1
```

Rules:

- Canonical v1 resolves category through this frozen authority chain, in order:
  1. matching Engine `memory_confidence.category` -> `authority=engine`;
  2. no Engine row plus explicit supported `Category:` metadata in source text -> `authority=source_metadata`;
  3. supported deterministic path mapping from `category-inference.js` -> `authority=path_inference`;
  4. otherwise `category=unknown` -> `authority=unknown`.
- `autoRouteCategory()` is forbidden for Canonical v1. The adapter must not use unrestricted text heuristics.
- `text_inference` is retained only as a future-reserved authority value; 2.5-B v1 MUST NOT emit it.
- Supported `Category:` metadata must use the adapter's explicit supported category vocabulary. An arbitrary source-text label is not sufficient authority.
- If no Engine row exists, `lifecycle.category` is `null`; fallback inference does not convert an external Core item into an Engine-managed item.
- `kind` is a derived semantic projection. It does not replace category and does not own lifecycle state.

Initial kind vocabulary remains compatible with the P4 Memory Card model:

```text
preference
decision
task_state
project_state
workflow_rule
fact
summary
episode
quality_signal
diagnostic
```

### 8.2.1 `classification.kind`

Canonical v1 freezes the following compatibility mapping. The adapter must not call an LLM or invent a free-form kind:

| Authoritative category | Canonical kind |
|---|---|
| `preference` / `user_identity` | `preference` |
| `project` | `project_state` |
| `episodic` | `episode` |
| `raw_log` | `diagnostic` |
| `workflow` / `workflow_rule` | `workflow_rule` |
| `stats` | `quality_signal` |
| otherwise | `fact` |

An additional explicit kind is accepted only when an authoritative source contract explicitly supplies and explains that kind. P4 presentation behavior is not itself canonical authority.

### 8.3 `temporal`

Temporal fields distinguish observed source time from inferred episode relation.

Rules:

- source update time remains the Core-owned `source.updated_at` fact and is not duplicated as a second temporal authority;
- the only currently supported path/date relation is `memory/episodes/YYYY-MM-DD.md` produced by the canonical episode writer; its basename date may populate `episode_date` with `episode_date_basis="source_path"`;
- an episode path without that exact date-shaped basename, or metadata without a supported canonical date relation, leaves `episode_date=null`;
- natural-language dates found in text are not promoted to canonical episode dates in v1;
- missing temporal facts remain `null` rather than being replaced with adapter execution time.

### 8.4 `lifecycle`

Lifecycle is Engine-owned mutable state.

Managed object:

```text
lifecycle.management = managed
```

External object with no Engine row:

```text
lifecycle.management = external
```

For external objects:

- `lifecycle.category` is `null`;
- Engine confidence/lifecycle values are `null`;
- confidence fields are `null`;
- `base_tau_days` is `null`;
- Engine hit/archive/protect/conflict values are not fabricated;
- decay and archive policy cannot be inferred from a nonexistent Engine row.

This preserves the current managed/external safety distinction in hybrid retrieval.

### 8.5 Eligibility contract

Canonical Memory Object v1 does not freeze retrieval, vector, or disclosure eligibility values. Those are downstream projection/policy concerns until a single deterministic, query-independent, agent-independent source/lifecycle rule is established.

```text
ELIGIBILITY_CONTRACT=
- frozen fields: none in the Canonical Memory Object v1 baseline;
- deferred fields: eligibility.retrieval.*, eligibility.vector.*, eligibility.disclosure.*;
- reason: current semantics are split across quality-scope/path-family rules,
  retrieval/channel availability and thresholds, AutoRecall gates, and
  Memory Card disclosure policy; no unique canonical baseline rule exists.
```

The following remain canonical source/lifecycle facts and may be consumed by a later projection policy: path family, `lifecycle.archived`, `lifecycle.protected`, `lifecycle.conflict`, and the managed/external distinction.

The following are explicitly deferred or runtime-only and must not be copied into a canonical baseline risk/eligibility field:

- query threshold, lexical confidence, RRF score, channel availability, or vector-skip decision;
- current agent/chat gate, current-turn citation, or reinforcement status;
- `cross_agent_scope`, which is runtime context rather than canonical baseline risk;
- card disclosure decisions derived by `resolveDisclosurePolicy()`.

### 8.6 `content_ref`

The canonical object may expose full content internally because it is the semantic read model, but downstream disclosure projections must still be able to reference content without embedding it.

`content_hash` is a derived SHA-256 over the exact canonical source text used for the object. It is projection/staleness evidence, not a replacement for Core identity.

## 9. What is explicitly not canonical

The following existing P4 MemoryObject fields are downstream projection/runtime data and must not become source-of-truth canonical state:

```text
card.title
card.summary
card.salience_reason
card.evidence_hint
policy.can_inject_card
policy.can_reinforce_on_citation
debug.retrieval_rank
debug.retrieval_score
debug.trace_id
confidence.signals derived from retrieval channels
```

The existing P4 MemoryObject remains useful as a Recall/Memory Card projection envelope. It should eventually be produced **from** Canonical Memory Object + runtime retrieval evidence rather than treated as the canonical object itself.

## 10. Projection contracts

### 10.1 Engine lifecycle projection

Authority direction:

```text
Engine row -> Canonical lifecycle state
```

Not:

```text
Canonical adapter -> implicit Engine write
```

Phase 2.5-B is read-only. Phase 2.5-D may later define reconciliation writes, but only under explicit persistent-write governance.

### 10.2 Recall candidate projection

A recall candidate is:

```text
Canonical Memory Object
+ query/channel scores
+ request-time thresholds
+ runtime eligibility/gates
= Recall Candidate Projection
```

Query scores never mutate the canonical object.

### 10.3 Memory Card projection

A Memory Card is:

```text
Canonical Memory Object
+ runtime disclosure context
+ optional compact presentation fields
= Memory Card Projection
```

The P4 rule remains:

```text
card rendered != cited
card injected != cited
search result != cited
```

Only explicit cited memory ids from the current turn may enter reinforcement.

### 10.4 Lance vector projection

Lance is a disposable/rebuildable projection keyed by canonical memory identity compatibility.

V1 mapping:

```text
Lance.id        = memory_id (exact Core chunk id)
Lance.text      = projection text derived from canonical source.text
Lance.vector    = embedding(Lance.text)
Lance.timestamp = projection metadata, not canonical source time
```

LanceDB must not become authority for:

- canonical text;
- category;
- confidence;
- lifecycle;
- source provenance;
- disclosure policy.

A missing or stale Lance row is a projection/reconciliation problem, not evidence that the canonical memory does not exist.

## 11. Relationship to current Core / Engine / Lance reconciliation

The current reconciliation line already relies on a useful identity invariant:

```text
Core chunk id == Engine memory_confidence.chunk_id == Lance row id
```

Phase 2.5 keeps that compatibility invariant for v1 but makes its semantics explicit through `memory_id` and `canonical_id`.

Later 2.5-D may make reconciliation consume Canonical Memory Objects so that eligibility, category authority, path/provenance, and vector projection all derive from the same object contract. Phase 2.5-A does not modify those writes.

## 12. Relationship to database-boundary work

The Canonical Memory Adapter must be compatible with isolated database handles:

```text
Core: readonly handle
Engine: readonly handle during 2.5-B
no generic combined Core+Engine SQL required by the canonical contract
```

This deliberately avoids baking transitional `withLegacyDb` / attached-Core assumptions into the new abstraction.

Existing legacy/combined read paths may continue until separately migrated; their existence does not weaken the new contract or authorize new combined access.

## 13. Failure behavior

The read-only 2.5-B adapter must use exact Core id lookup only and fail closed when it cannot establish the minimum object contract.

Examples:

- exact Core id is missing from the request;
- requested Core chunk id does not exist;
- Core id lookup is ambiguous;
- required Core fields, including source text, are malformed or unavailable;
- Engine row cannot be interpreted safely;
- source text is unavailable when a projection requires canonical text.

Non-fatal absence:

- no Engine row => valid external object, not an error;
- missing optional Core timestamp/hash => preserve `null`;
- unknown category => `category="unknown"` with `category_authority="unknown"`.

The adapter must not synthesize identity from path/span/text, repair persistent state, or write any database as a side effect of reading.

## 14. Versioning

Canonical schema version and projection versions are independent.

```text
canonical schema version != Memory Card schema version
canonical schema version != Recall Candidate projection version
canonical schema version != Lance embedding/model version
```

A canonical schema-version change must not change `canonical_id` for the same source chunk.

A projection may add its own version and cache/rebuild policy without changing canonical identity.

## 15. Phase sequence

### 2.5-A — Canonical Object Contract

- define semantic object and field ownership;
- static review against current Core/Engine/Lance/P4 code;
- contract tests;
- no runtime canary by default.

### 2.5-B — Read-only Canonical Adapter

- implement Core + Engine read composition;
- use isolated handles;
- no storage ownership or write-path changes;
- prove managed and external behavior with fixtures/contract tests.

### 2.5-C — Projection Unification

- migrate Recall/Memory Card/vector-facing normalization to consume the canonical object;
- remove duplicated semantic inference only after parity is proven;
- keep ranking/runtime evidence outside canonical state.

### 2.5-D — Reconciliation Integration

- make persistent Core -> Engine -> Lance reconciliation canonical-identity-based;
- treat this as a separate higher-risk persistent-write change;
- require explicit owner authorization appropriate to the runtime/data mutation.

## 16. Static review findings against current source

### Finding A — P4 MemoryObject is a projection, not the canonical object

Current `lib/recall/auto-recall-memory-card.js` is intentionally read-only and remains useful, but its envelope mixes semantic fields with card presentation, disclosure policy, retrieval rank/score, and trace id. Its `stableObjectId()` / `object_id` is not canonical identity: the exact-id path truncates the underlying id to 32 characters, and the id-less fallback mixes `projectionVersion` with path/span/text inputs. Its `memoryId()` helper may synthesize fallback identity when no exact Core id exists. It should remain downstream of the new canonical contract.

### Finding B — Core/Engine identity is already suitable for v1 compatibility

Current Engine `memory_confidence.chunk_id` maps 1:1 to Core chunk ids, and reconciliation uses exact ids. No new identity table is justified for 2.5-A/B.

### Finding C — full canonical text must come from Core, not retrieval/Lance previews

Current retrieval normalization truncates candidate text and current Lance writes may use a bounded text projection. Neither is suitable as canonical content authority. The adapter must read the exact Core chunk text.

### Finding D — managed/external distinction must remain explicit

Current hybrid normalization correctly treats Core rows without Engine confidence as external and does not fabricate managed confidence semantics. The canonical contract preserves that behavior as an ownership rule rather than a retrieval-only convention.

### Finding E — new canonical code must not depend on transitional combined DB access

Current isolated Core and Engine accessors already exist, while some legacy hybrid paths still retain `withLegacyDb`. The canonical adapter should begin on the isolated side of that boundary instead of becoming another consumer of the transitional combined path.

## 17. Acceptance criteria for 2.5-A

2.5-A is ready to close when all of the following are true:

1. the contract distinguishes Canonical Memory Object from Memory Card, Engine lifecycle row, Lance vector row, and runtime retrieval evidence;
2. every canonical field is assigned to `source_fact`, `lifecycle_state`, `derived_projection`, or is explicitly excluded as `runtime_only_evidence`;
3. canonical identity is stable across canonical/projection schema version changes for the same Core chunk;
4. managed and external ownership semantics are explicit and fail closed against fabricated Engine state;
5. canonical content authority is the exact Core chunk text, not a retrieval or Lance preview;
6. Phase 2.5-B is read-only and uses isolated Core/Engine handles;
7. no new persistent store, DB migration, runtime canary, ranking change, or write-path change is required by 2.5-A;
8. category authority and compatibility kind mappings are deterministic and fail closed against unrestricted text heuristics;
9. eligibility retrieval/vector/disclosure policy remains explicitly deferred until a unique deterministic baseline exists.

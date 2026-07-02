# AutoRecall Memory Card / Memory Object Model

## Status

Design-only P4 contract.

This document defines the first memory card and memory object abstraction for memory-engine autoRecall. It does not introduce a DB migration, runtime injection change, storage rewrite, automatic summarization, or UI implementation by itself.

## Goal

P1-P3 made autoRecall safe, replayable, and observable. P4 adds a stable presentation and object boundary between retrieval candidates and injected memory content.

The goal is to stop treating every recall hit as raw text and instead expose a compact, auditable memory card first. Full content remains available only through an explicit get/read path.

## Non-goals

- Do not change the canonical storage schema in this phase.
- Do not migrate existing memory rows.
- Do not change retrieval ranking, RRF, KG/FTS/vector fusion, or eligibility scoring.
- Do not enable automatic reinforcement from card rendering.
- Do not inject full memory content by default.
- Do not expose private/raw logs or dreaming artifacts through cards.
- Do not make memory-engine impersonate OpenClaw memory-core.
- Do not enable active-memory.
- Do not add ML/classifier behavior.

## Current boundary

Current autoRecall has four relevant stages:

```text
prompt
  -> runtime gate
  -> intent / focused query
  -> hybrid retrieval + eligibility
  -> injection
```

P4 inserts a projection layer after retrieval/eligibility and before injection:

```text
retrieval candidate
  -> memory object projection
  -> memory card projection
  -> card-first injection or get-on-demand
```

The projection layer is read-only. It must not mutate memory rows, confidence records, event rows, or source files.

## Terminology

### Memory object

A memory object is the normalized internal representation of one recallable memory item. It may contain provenance, lifecycle, evidence, confidence, risk, and content references. It is not necessarily safe to inject directly.

### Memory card

A memory card is the compact user/agent-facing projection of a memory object. It is safe for first-pass disclosure. It contains enough information to decide whether the full object should be read, but not enough raw content to leak large logs, tool output, or sensitive source text.

### Memory content

Memory content is the full original or reconstructed memory body. It is only exposed by an explicit get/read path when the disclosure policy permits it.

## Object model

A memory object is represented as a versioned envelope:

```json
{
  "schema_version": 1,
  "object_id": "memobj_<stable-or-source-id>",
  "memory_id": "<engine-memory-id>",
  "source": {
    "path": "memory/projects/example.md",
    "line_start": 10,
    "line_end": 24,
    "source_type": "smart_add",
    "bucket": "projects",
    "created_at": "2026-07-01T00:00:00.000Z",
    "updated_at": "2026-07-01T00:00:00.000Z"
  },
  "classification": {
    "category": "project",
    "kind": "decision",
    "scope": "project_state",
    "agent_scope": "edi",
    "lifecycle_state": "active"
  },
  "content_ref": {
    "mode": "source_span",
    "available": true,
    "content_hash": "sha256:<hash>",
    "full_content_on_get": true
  },
  "card": {
    "title": "Short stable title",
    "summary": "One or two sentence card summary.",
    "salience_reason": "Why this memory is relevant to the current query.",
    "evidence_hint": "source path + compact provenance",
    "risk_flags": []
  },
  "confidence": {
    "score": 0.82,
    "signals": ["fts", "kg", "recency", "reinforcement"],
    "last_reinforced_at": null
  },
  "policy": {
    "disclosure_level": "memory_card",
    "can_inject_card": true,
    "can_get_full_content": true,
    "can_reinforce_on_citation": true
  },
  "debug": {
    "retrieval_rank": 1,
    "retrieval_score": 0.74,
    "trace_id": "<turn-trace-id>"
  }
}
```

## Required object fields

- `schema_version`: version of the memory object envelope.
- `object_id`: projection-layer id. It must be deterministic for the same underlying memory and projection version.
- `memory_id`: canonical engine memory id or source id used by `memory_engine_get`.
- `source`: provenance. Cards must always preserve enough source metadata to audit origin.
- `classification`: high-level semantic and lifecycle classification.
- `content_ref`: pointer to full content. It must avoid embedding full raw content in the card layer.
- `card`: card-safe projection.
- `confidence`: compact retrieval/quality/confidence summary.
- `policy`: disclosure and reinforcement policy.
- `debug`: optional trace metadata for Console/debug output.

## Memory card schema

A memory card is a strict subset of the memory object:

```json
{
  "schema_version": 1,
  "card_id": "memcard_<object-id>",
  "memory_id": "<engine-memory-id>",
  "title": "Short stable title",
  "summary": "One or two sentence card summary.",
  "salience_reason": "Why this memory is relevant now.",
  "source_hint": "memory/projects/example.md:10-24",
  "category": "project",
  "kind": "decision",
  "confidence_score": 0.82,
  "risk_flags": [],
  "disclosure_level": "memory_card",
  "get_token": "memory_engine_get:<memory-id>"
}
```

Cards must be compact, source-aware, and safe for first-pass disclosure.

## Card rules

Cards must:

- include `memory_id` and a get token/reference;
- include source hint or provenance hint;
- include category/kind/scope enough to interpret the memory;
- include confidence or rank signal;
- include risk flags when relevant;
- be short enough for progressive disclosure.

Cards must not:

- include full raw content by default;
- include raw tool output, stack traces, raw logs, or large pasted text;
- include dreaming artifact body text;
- include rejected autoRecall candidates;
- include archived/quarantined memories unless an explicit maintenance/debug path asks for them;
- trigger reinforcement merely because the card was shown.

## Disclosure levels

P4 uses the existing turn-level gold-set disclosure vocabulary:

```text
none
memory_card
short_summary
full_content_on_get
```

Interpretation:

- `none`: do not disclose memory.
- `memory_card`: disclose only the compact card.
- `short_summary`: disclose a short synthesized summary if card-only is insufficient.
- `full_content_on_get`: full content can be fetched by explicit get/read action, not injected automatically.

The default for autoRecall should be `memory_card` when recall is allowed. Full content should be get-on-demand.

## Progressive disclosure flow

Default flow:

```text
1. Retrieve eligible candidates.
2. Convert candidates to memory objects.
3. Convert objects to memory cards.
4. Inject only cards into the prompt supplement.
5. If the assistant actually cites a memory id, reinforcement may use cited ids only.
6. If the user or agent asks for details, call memory_engine_get for full content.
```

This preserves P1-P3 safety:

- search does not reinforce;
- injected card does not reinforce;
- rejected candidate does not reinforce;
- only cited memory ids can reinforce;
- long-input generic tasks still skip recall;
- runtime gate still runs before all recall logic.

## Risk flags

Initial risk flags:

```text
raw_log_like
tool_output_like
dreaming_artifact
low_confidence
archived
quarantined
stale_index_candidate
conflict_flag
cross_agent_scope
sensitive_source
```

Risk flags do not automatically delete or mutate memory. They control disclosure and review behavior.

## Lifecycle states

Initial lifecycle states:

```text
active
candidate
needs_review
archived
quarantined
deleted_shadow
stale_index_candidate
```

Only `active` should be eligible for default card injection. `needs_review` may appear in Console/debug reports but not ordinary autoRecall injection. `archived`, `quarantined`, and `deleted_shadow` are excluded by default.

## Object kinds

Initial object kinds:

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

Kinds are descriptive and do not replace retrieval scoring. They help card display, review, and progressive disclosure.

## Agent scope

A memory object must carry an agent scope:

```text
edi
task-planner
shared
unknown
```

Default autoRecall injection should require agent scope compatibility. Cross-agent scope cards must be treated as risk-flagged unless the runtime context explicitly allows shared/project recall.

This preserves the current separation goal:

- OpenClaw/main memory-engine serves edi by default.
- Planner memory is not automatically injected into edi unless explicitly shared.
- Codex CLI remains outside memory-engine autoRecall.

## Reinforcement rule

P4 keeps the P1-P3 reinforcement invariant:

```text
card rendered != cited
card injected != cited
search result != cited
```

Only explicit cited memory ids from the current turn may reinforce.

If the system later supports card UI clicks, a card click still should not reinforce unless it becomes an actual cited memory id in the assistant response or an explicit user-confirmed reference.

## Console view

Initial Console support should be read-only:

- show memory cards from replay/debug reports;
- show risk flags;
- show source hints;
- show disclosure level;
- show get token/reference;
- show whether full content is available;
- no apply/archive/quarantine/reinforce buttons in the first phase.

## Migration plan

P4 should be implemented in phases:

### P4.1 Design freeze

- Keep this document and static tests.
- No runtime behavior change.
- No DB migration.

### P4.2 Projection helpers

- Add pure functions for candidate -> memory object and memory object -> memory card.
- Use synthetic fixtures only.
- Keep helpers read-only.

### P4.3 Replay integration

- Extend turn-level replay reports to include expected disclosure/card fields.
- Do not inject cards into runtime yet.

### P4.4 Console preview

- Show cards in Console reports/read-only preview.
- No destructive controls.

### P4.5 Runtime card-first experiment

- Behind explicit config flag.
- edi-only.
- Requires P1 runtime gate and P3 replay stability.
- Must keep full content get-on-demand.

## Open questions

- Should card titles be deterministic extractive titles or LLM-generated only during offline maintenance?
- Should confidence score in cards use retrieval score, quality score, or a combined presentation score?
- How should cross-agent `shared` memories be approved?
- Should `short_summary` be generated at write time, checkpoint time, or projection time?
- How should memory cards represent multiple source spans merged into one logical object?

## Acceptance criteria for P4 design

- A card-first contract exists and is tested.
- The design states that cards are projections, not canonical storage.
- The design preserves memory-core / memory-engine separation.
- The design preserves runtime gate before recall.
- The design preserves cited-id-only reinforcement.
- The design says full content is get-on-demand, not injected by default.
- The design says first phase is read-only and no DB migration.
- The design uses the existing `disclosure_level` vocabulary from turn-level gold set.

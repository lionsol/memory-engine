# Hybrid Observation Provenance Contract

> **Status: Current contract**
>
> Applies to production Hybrid Search observation metrics, scoped-canary evidence, full fail-closed rollout evidence, evidence windows, tool-surface audits, and legacy fallback removal decisions.

## Purpose

A row that contains plausible Hybrid metadata is not automatically production evidence.

Production rollout decisions must distinguish:

1. a canonical observation emitted by a real memory-engine runtime path;
2. a metadata-only replay used for tests or review;
3. a manually inserted or partially constructed row;
4. an unsupported or malformed observation.

Only the first category may enter production evidence denominators.

## Canonical Envelope

Every production Hybrid observation must satisfy:

```text
event_type = hybrid_search_observation
metadata_json.schema_version = 1
metadata_json.surface = one of the three production surfaces
metadata_json.search_executed = true
metadata_json.completed_at = canonical UTC ISO timestamp
source = hybrid.<metadata_json.surface>
trace_id = non-empty
```

The production surfaces are:

```text
auto_recall
memory_engine_action_search
memory_engine_search
```

A canonical UTC ISO timestamp is the exact `Date.prototype.toISOString()` representation, for example:

```text
2026-07-18T16:15:27.266Z
```

## Surface-Specific Requirements

### AutoRecall

AutoRecall must additionally contain:

```text
session_id = non-empty
source = hybrid.auto_recall
```

This proves that the observation came through a real OpenClaw agent/session runtime path. A direct SQL insert, a manually written event, a wrapper call labelled as AutoRecall, or a metadata replay cannot satisfy this requirement.

### Tool Search Surfaces

The two tool surfaces must contain a non-empty `trace_id` and the exact source:

```text
memory_engine_search:
  source = hybrid.memory_engine_search

memory_engine_action_search:
  source = hybrid.memory_engine_action_search
```

A session ID is optional for gateway `tools.invoke` evidence because the official gateway RPC execution path may not serialize a session ID into the observation envelope.

## Invalid Provenance Handling

Invalid observations are not deleted automatically.

They remain available as historical telemetry and audit evidence, but they are:

- excluded from `observed_hybrid_events` and production surface denominators;
- excluded from fallback, rollout-mode, canary, and full-mode counts;
- reported through an invalid provenance count;
- reported with event IDs when IDs are available;
- reported with a reason distribution;
- treated as a blocker for scoped-canary decisions, full-rollout evidence, evidence-window readiness, and legacy fallback removal.

Canonical report fields are:

```text
invalid_provenance_observation_count
invalid_provenance_observation_ids
invalid_provenance_reason_distribution
```

The fallback evidence window also exposes the same information under `counts` for detailed diagnostics.

## Reason Codes

The shared validator may report:

```text
invalid_row
invalid_event_type
invalid_metadata_json
unknown_production_surface
source_mismatch
missing_schema_version
unsupported_schema_version
search_not_executed
invalid_completed_at
missing_trace_id
missing_auto_recall_session_id
```

Multiple reasons may apply to one row.

## Decision Integration

The shared validator is used by:

- `console/services/metrics-service.js`;
- `lib/recall/hybrid/scoped-fail-closed-canary-evidence.js`;
- `lib/recall/hybrid/fallback-evidence-window.js`;
- `lib/recall/hybrid/full-fail-closed-rollout-evidence.js`;
- `lib/recall/hybrid/tool-surface-runtime-access-audit.js`;
- `lib/recall/hybrid/legacy-fallback-removal-gate.js` through the production rollout report.

The implementation is:

```text
lib/recall/hybrid/hybrid-observation-provenance.js
```

No downstream evaluator may reconstruct production provenance from metadata fields alone.

## Historical Stage 2 Contamination

The first F1-D-B8-A6 Stage 2 attempt produced a manually inserted AutoRecall-shaped event with ID `11087`. It lacked:

```text
source
session_id
trace_id
metadata.completed_at
```

That event is not authoritative Stage 2 evidence. It remains in historical telemetry but must be automatically excluded by this contract.

The corrected Stage 2 retry used real `opencode/deepseek-v4-flash` agent turns and produced canonical `hybrid.auto_recall` observations with complete session, trace, and completion provenance.

## Safety Boundary

This contract does not authorize:

- deleting or rewriting historical telemetry;
- inserting synthetic production observations;
- modifying Core DB;
- changing memory content, confidence, reinforcement, or vector state;
- enabling Recent full rollout;
- removing legacy fallback code.

B8-B removal remains gated by completed KG and Recent rollout, the required production window and sample volume, zero fallback events, zero invalid provenance observations, tested post-removal rollback, complete code inventory, and explicit removal-gate approval.

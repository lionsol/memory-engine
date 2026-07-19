# F1-D-B8-A6 Controlled Full Fail-Closed Runtime Rollout

> **Status: Current runtime runbook**

## Purpose

This runbook moves Hybrid Search from synthetic A5 validation into a controlled real-runtime rollout and production evidence window.

It does not remove legacy SQL, delete `withLegacyDb`, mutate memory contents, or satisfy the B8-A removal gate by itself.

## Preconditions

Before any runtime change:

1. `npm run smoke:full-fail-closed` passes.
2. Focused fail-closed tests pass.
3. `npm run check` passes.
4. The repository working tree is clean.
5. The plugin configuration has a recoverable backup.
6. `active-memory` is not enabled together with memory-engine AutoRecall.
7. The operator can reinstall or reload the plugin and restore `legacy_fallback` immediately.
8. The real Engine DB is accessed read-only for observation export only.

## Official Configuration Contract

The rollout controls are top-level memory-engine plugin config fields because they affect every Hybrid Search production surface, not only AutoRecall:

```json
{
  "plugins": {
    "entries": {
      "memory-engine": {
        "config": {
          "kgFailClosedMode": "legacy_fallback",
          "kgFailClosedCanary": {
            "enabled": false,
            "agentIds": [],
            "sessionIds": []
          },
          "recentFailClosedMode": "legacy_fallback",
          "recentFailClosedCanary": {
            "enabled": false,
            "agentIds": [],
            "sessionIds": []
          },
          "autoRecall": {
            "enabled": false,
            "topK": 3,
            "timeoutMs": 8000,
            "agentAllowlist": ["edi"],
            "chatTypeAllowlist": ["interactive_user_chat"],
            "messageRoleAllowlist": ["user"]
          }
        }
      }
    }
  }
}
```

Allowed mode values:

```text
legacy_fallback
shadow_fail_closed
fail_closed_canary
full_fail_closed
```

Both channel defaults remain `legacy_fallback`.

The AutoRecall runtime-gate allowlists are official schema fields under `autoRecall`. Their defaults remain strict:

```text
agentAllowlist=["edi"]
chatTypeAllowlist=["interactive_user_chat"]
messageRoleAllowlist=["user"]
```

A controlled runtime verification may temporarily expand an allowlist through validated OpenClaw configuration, provided the original values are backed up and restored. This is not permission to edit gate source, disable a gate dimension, or broaden production defaults.

Unknown values must fail safe to legacy behavior in runtime policy code, but the manifest schema should reject them before reload.

## Production Surfaces

The evidence window must include all three canonical production surfaces:

```text
auto_recall
memory_engine_action_search
memory_engine_search
```

The two tool surfaces do not accept caller-supplied agent or session identity as trusted canary scope. During `fail_closed_canary`, a trusted AutoRecall request can match scope, while tool searches without trusted runtime scope must continue to legacy fallback. This is intentional and prevents query parameters or tool-call ids from enabling canary behavior.

`full_fail_closed` does not use scope and therefore applies to all three surfaces.

## Canonical Observation Provenance

Production evidence must satisfy [`../hybrid-observation-provenance.md`](../hybrid-observation-provenance.md).

Every counted row requires:

```text
event_type=hybrid_search_observation
source=hybrid.<surface>
schema_version=1
search_executed=true
completed_at=canonical UTC ISO
trace_id=present
```

AutoRecall additionally requires a non-empty `session_id`. Tool surfaces may omit `session_id` when executed through official gateway `tools.invoke`, but they must retain a non-empty trace ID and exact source.

A manually inserted row, metadata-only replay, direct wrapper call, or CLI result labelled as a production surface is not production evidence. Invalid rows remain auditable but are excluded from production denominators and must produce `invalid_provenance_observation_count > 0`, which blocks rollout and removal decisions.

## Stage 0: Baseline Install

Keep both channels explicitly in legacy mode:

```json
{
  "kgFailClosedMode": "legacy_fallback",
  "recentFailClosedMode": "legacy_fallback"
}
```

Install the current checkout and inspect runtime registration:

```bash
cd ~/.openclaw/workspace/plugins/memory-engine
openclaw plugins install . --force
openclaw doctor
openclaw plugins inspect memory-engine --runtime --json
```

Confirm:

- the plugin loads without schema errors;
- `memory_engine`, `memory_engine_search`, and `memory_engine_get` remain registered;
- `memory_search` and `memory_get` remain owned by memory-core;
- no new Hybrid channel errors appear;
- source and runtime copies match according to `docs/runtime-sync.md`.

Do not continue if the manifest schema or runtime config is rejected.

## Stage 1: Scoped Canary

Canary only one channel at a time. Start with KG:

```json
{
  "kgFailClosedMode": "fail_closed_canary",
  "kgFailClosedCanary": {
    "enabled": true,
    "agentIds": ["edi"],
    "sessionIds": ["<controlled-session-id>"]
  },
  "recentFailClosedMode": "legacy_fallback"
}
```

Reload the plugin, then generate controlled traffic from the allowlisted AutoRecall session plus both tool-search surfaces.

Expected behavior:

- allowlisted AutoRecall observations use `kg_runtime_mode=fail_closed_canary`;
- scope hit suppresses KG fallback only;
- tool surfaces without trusted scope remain legacy and must not claim a scope match;
- Recent, FTS, and vector continue;
- full-mode metrics remain zero.

Repeat for Recent only after KG canary is clean:

```json
{
  "kgFailClosedMode": "legacy_fallback",
  "recentFailClosedMode": "fail_closed_canary",
  "recentFailClosedCanary": {
    "enabled": true,
    "agentIds": ["edi"],
    "sessionIds": ["<controlled-session-id>"]
  }
}
```

### Stage 1 Evidence Classification

Evaluate the exported Stage 1 observations with the report-only scoped-canary CLI:

```bash
~/.local/node24/bin/node \
  bin/audit-scoped-fail-closed-canary-evidence.js \
  --observations /tmp/memory-engine-auto-recall-canary-observations.jsonl \
  --observations /tmp/memory-engine-tool-surface-observations.jsonl \
  --channel kg \
  --expected-agent edi \
  --pretty
```

`--observations` is repeatable so independently exported AutoRecall and tool-surface windows can be evaluated without hand-editing or synthesizing a combined report.

The evaluator produces one of four statuses:

```text
canary_suppression_confirmed
canary_scope_confirmed_no_fallback_opportunity
canary_scope_not_confirmed
canary_safety_violation
```

`canary_scope_confirmed_no_fallback_opportunity` is a valid healthy-topology outcome. KG fallback is selected by isolated capability, TEXT-ID invariant, and isolated SQL safety, not by choosing a query that exists only in the legacy database. Do not mutate a production DB, insert non-TEXT IDs, disable isolated capability, or inject SQL failures merely to manufacture a fallback opportunity.

The deterministic A5 synthetic smoke remains authoritative for exercising the suppression branch. A naturally observed real fallback opportunity strengthens Stage 1 evidence but is not mandatory for Stage 2 review when all three production surfaces are observed, scope isolation is correct, and no safety violation exists.

The evaluator keeps the following evidence dimensions separate:

```text
scope_status
suppression_status
surface_coverage_status
isolation_status
```

Tool surfaces must be executed through the real registered OpenClaw tools. A CLI call that labels itself as `memory_engine_search` or `memory_engine_action_search`, a manually written observation, or a direct wrapper call is not production tool-surface evidence. Use the controlled registry/effective-policy and `tools.invoke` procedure in [`tool-surface-runtime-access-audit.md`](tool-surface-runtime-access-audit.md).

The `--expected-agent` value is an operator-supplied run label. The current observation schema proves trusted scope match through the canary markers but does not independently serialize the agent identity.

Stage 2 may enter operator review only when:

- A5 synthetic safety smoke still passes;
- Stage 1 scope status is confirmed;
- all three production surfaces are observed with `search_executed=true`;
- tool surfaces do not claim canary scope;
- the other channel stays unchanged;
- full-mode markers and channel errors remain zero;
- the evaluator reports `stage2_review_eligible=true`.

`stage2_review_eligible` is observation-evidence-only. The report does not verify the A5 smoke result, runtime baseline restoration, or operator approval.

This is permission for a fresh Stage 2 review, not automatic authorization and not evidence for legacy code removal.

## Stage 2: KG Full Rollout

After explicit operator approval based on the Stage 1 evaluator, set only KG to full mode:

```json
{
  "kgFailClosedMode": "full_fail_closed",
  "recentFailClosedMode": "legacy_fallback"
}
```

After reload, exercise all three production surfaces.

Required evidence:

- `kg_runtime_mode=full_fail_closed`;
- `kg_rollout_scope=full`;
- `kg_scope_required=false`;
- `kg_fail_closed_scope_match=null`;
- no KG legacy fallback event;
- Recent remains unchanged;
- FTS and vector remain operational;
- full KG events do not increment KG canary metrics.

## Stage 3: KG Rollback Validation

Restore KG immediately:

```json
{
  "kgFailClosedMode": "legacy_fallback",
  "recentFailClosedMode": "legacy_fallback"
}
```

Reload and verify:

- runtime mode no longer reports KG full rollout;
- the legacy KG fallback remains reachable when its guard requires it;
- tool registration and other channels remain intact;
- no config residue keeps full mode active.

A rollback that changes only the source checkout but does not reinstall or reload the runtime is not valid.

## Stage 4: Recent Full Rollout

After KG rollback validation, restore KG full mode and enable Recent full mode:

```json
{
  "kgFailClosedMode": "full_fail_closed",
  "recentFailClosedMode": "full_fail_closed"
}
```

Exercise all three surfaces again.

The repository checkout and installed runtime source must remain byte-for-byte unchanged throughout the Stage 4 evidence window. Only reviewed, schema-valid configuration changes are allowed. A temporary `autoRecall.agentAllowlist` expansion is permitted when the reviewed manifest exposes the field, the original value is backed up, chat-type and role gates remain enabled, and the value is restored afterward. Do not edit gate source, Hybrid policies, wrappers, observation writers, or installed runtime files to make a surface execute. Post-run parity after reverting a temporary source change does not establish runtime provenance for observations produced while that change was active.

Required Recent evidence:

- `recent_runtime_mode=full_fail_closed`;
- `recent_rollout_scope=full`;
- `recent_scope_required=false`;
- `recent_fail_closed_scope_match=null`;
- no Recent legacy fallback event;
- KG, FTS, and vector continue;
- full Recent events do not increment Recent canary metrics.

## Immediate Stop Conditions

Rollback both channels to `legacy_fallback` if any of the following occurs:

- plugin manifest or config validation fails;
- plugin registration changes unexpectedly;
- `kg_error`, `recent_error`, `fts_error`, or `vector_error` newly appears because of rollout;
- a full-mode channel emits a legacy fallback event;
- a full-mode observation lacks explicit full rollout markers;
- full events increment scoped-canary metrics;
- one channel changes another channel's configured behavior;
- unknown production surfaces, unsupported observation schema versions, or invalid observation provenance appear;
- runtime source differs from the reviewed checkout at any point in the evidence window;
- repository or installed-runtime source is modified to bypass agent, chat-type, role, or other execution gates;
- post-run parity is offered as a substitute for proving code parity during the evidence window;
- controlled searches fail or return structurally invalid results.

## Read-Only Observation Export

Export only canonical Hybrid observations from the real Engine DB:

```bash
~/.local/node24/bin/node \
  bin/export-hybrid-search-observations.js \
  --db ~/.openclaw/memory/memory-engine/memory-engine.sqlite \
  --since <full-rollout-start-iso> \
  --format jsonl \
  --out /tmp/memory-engine-full-fail-closed-observations.jsonl
```

The exporter:

- requires an explicit DB path;
- opens SQLite read-only with file-must-exist mode;
- reads only `hybrid_search_observation` events;
- does not change rollout config or runtime state;
- writes only the explicitly requested report path.

Do not write production evidence into the repository.

## Evidence Evaluation

Generate the canonical metrics summary directly from JSON or JSONL instead of using an ad hoc stdin script:

```bash
~/.local/node24/bin/node \
  bin/summarize-hybrid-search-observations.js \
  --observations /tmp/memory-engine-full-fail-closed-observations.jsonl \
  --window-days 30 \
  --pretty
```

The summary CLI invokes the same `buildHybridFallbackObservabilitySummary` used by the Console metrics service. It reads report files only and does not open SQLite or contact the runtime.

Before accepting a window, confirm:

```text
invalid_provenance_observation_count=0
invalid_provenance_observation_ids=[]
invalid_provenance_reason_distribution={}
```

Any non-zero invalid provenance count is a blocker, even when rollout markers otherwise look correct.

Evaluate the full-rollout observations:

```bash
~/.local/node24/bin/node \
  bin/audit-full-fail-closed-rollout-evidence.js \
  --observations /tmp/memory-engine-full-fail-closed-observations.jsonl \
  --pretty
```

Default confirmation thresholds remain:

```text
minimum_window_days: 30
minimum_observations: 500
minimum_surface_observations: 100
require_full_surface_coverage: true
require_zero_fallback_events: true
require_zero_scope_mismatch: true
require_full_observation: true
require_supported_schema_only: true
```

A short controlled smoke can validate runtime wiring, but it cannot satisfy the production evidence window.

## Removal Boundary

Even after a successful real rollout:

- do not delete legacy query definitions;
- do not delete legacy query call sites;
- do not remove `withLegacyDb` reachability;
- do not reinterpret A5 or a short runtime smoke as production evidence;
- do not authorize B8-B until the B8-A removal gate evaluates the complete production, rollback, inventory, and schema evidence.

The next decision after a sufficiently long evidence window is a fresh removal-gate audit, not direct code deletion.

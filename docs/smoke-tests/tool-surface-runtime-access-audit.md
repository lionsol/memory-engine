# F1-D-B8-A6.2 Tool-Surface Runtime Access Audit

> **Status: Current runtime audit contract**

## Purpose

This runbook verifies the two Hybrid Search tool surfaces through the real OpenClaw gateway tool registry:

```text
memory_engine_search         -> memory_engine_search
memory_engine action=search  -> memory_engine_action_search
```

It separates three different claims:

1. the plugin registered the tools in `tools.catalog`;
2. the tools are visible to a model session in `tools.effective`;
3. the real registered tool executors ran and emitted canonical Hybrid observations.

These claims are not interchangeable.

## Safety Boundary

This audit:

- keeps KG and Recent in `legacy_fallback`;
- keeps AutoRecall disabled unless a separate scoped-canary stage explicitly enables it;
- invokes search only;
- does not call `memory_engine_get`;
- does not call add, cite, update, archive, detect-conflicts, or reinforcement paths;
- does not modify memory contents, confidence, Core DB, indexes, or LanceDB;
- permits ordinary telemetry writes produced by the real tool wrappers;
- reads Engine observation rows only through the explicit read-only exporter;
- writes temporary reports only under `/tmp`;
- does not authorize Stage 2 or B8-B by itself.

## Node Runtime Preflight

The OpenClaw launcher uses:

```text
#!/usr/bin/env node
```

Therefore the shell `PATH` selects the Node ABI used by the CLI. The installed memory-engine native dependencies must match that ABI.

Verify:

```bash
command -v node
node -v
node -p 'process.versions.modules'

~/.local/node24/bin/node -v
~/.local/node24/bin/node -p 'process.versions.modules'
```

For this repository, run OpenClaw audit commands with Node 24 explicitly:

```bash
PATH="$HOME/.local/node24/bin:$PATH" openclaw ...
```

Do not interpret a native-addon ABI error from a different CLI Node version as a Hybrid Search failure.

## Registry Versus Effective Tool Set

Capture the complete plugin-aware catalog:

```bash
PATH="$HOME/.local/node24/bin:$PATH" \
openclaw gateway call tools.catalog \
  --params '{"agentId":"main","includePlugins":true}' \
  --json \
  > /tmp/memory-engine-tools-catalog.json
```

Expected catalog entries:

```text
memory_engine
memory_engine_search
memory_engine_get
```

Capture the actual tools visible to the main EDi session:

```bash
PATH="$HOME/.local/node24/bin:$PATH" \
openclaw gateway call tools.effective \
  --params '{"agentId":"main","sessionKey":"agent:main:main"}' \
  --json \
  > /tmp/memory-engine-tools-effective.json
```

`tools.catalog` proves registration. `tools.effective` proves model visibility after profile, agent, provider, channel, sender, sandbox, and inherited policy filtering.

A tool can be registered but absent from the effective model tool set.

## Coding Profile Finding

A global configuration such as:

```json
{
  "tools": {
    "profile": "coding"
  }
}
```

selects an explicit core-tool allowlist. In the audited OpenClaw runtime, the three memory-engine plugin tools appeared in `tools.catalog` but not in the main session `tools.effective` result.

Do not switch the global profile to `full` merely to run this smoke.

Do not add broad `tools.alsoAllow` entries without reviewing effective policy semantics. In current OpenClaw policy handling, an `alsoAllow`-only section can carry default non-optional plugin-tool semantics beyond the named entry. Prefer no persistent policy change for this audit.

## Controlled Gateway Invocation

The `tools.invoke` RPC:

- resolves the tool through the gateway-visible registry;
- applies scoped tool policy;
- executes `before_tool_call` hooks;
- calls the real registered tool `execute` function;
- reports whether the tool source is `plugin`.

For non-core tools, the requested tool name is supplied as a one-shot gateway request. This permits an operator-controlled smoke without permanently widening the main agent model tool set.

Record the start time:

```bash
START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

Invoke the narrow search tool once:

```bash
PATH="$HOME/.local/node24/bin:$PATH" \
openclaw gateway call tools.invoke \
  --params '{
    "name":"memory_engine_search",
    "args":{
      "query":"memory-engine F1-D B8 current stage",
      "top_k":3
    },
    "agentId":"main",
    "idempotencyKey":"f1d-b8-a6-tool-search"
  }' \
  --json
```

Invoke the multi-action tool in search mode once:

```bash
PATH="$HOME/.local/node24/bin:$PATH" \
openclaw gateway call tools.invoke \
  --params '{
    "name":"memory_engine",
    "args":{
      "action":"search",
      "text":"memory-engine F1-D B8 current stage",
      "top_k":3
    },
    "agentId":"main",
    "idempotencyKey":"f1d-b8-a6-tool-action-search"
  }' \
  --json
```

Required invocation evidence:

```text
ok=true
source=plugin
toolName=memory_engine_search or memory_engine
result structure contains pool/channels/channel_sizes/debug/results
```

Do not copy result text into the audit report.

`tools.invoke` proves real gateway tool execution. It does not prove that the model sees or can autonomously select the tool. Only `tools.effective` or a real model-selected tool call proves model visibility.

## Canonical Observation Export

Record the end time:

```bash
END_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

Export the two tool surfaces:

```bash
~/.local/node24/bin/node \
  bin/export-hybrid-search-observations.js \
  --db ~/.openclaw/memory/memory-engine/memory-engine.sqlite \
  --since "$START_ISO" \
  --until "$END_ISO" \
  --surface memory_engine_search \
  --surface memory_engine_action_search \
  --format jsonl \
  --out /tmp/memory-engine-tool-surface-observations.jsonl
```

Required rows:

```text
surface=memory_engine_search
surface=memory_engine_action_search
search_executed=true
channel_error_count=0
```

A manually written row, a CLI result labelled with a production surface, or a direct wrapper call is not canonical production evidence.

## Tool-Surface Access Evaluation

Evaluate registration, effective visibility, and real execution together:

```bash
~/.local/node24/bin/node \
  bin/audit-tool-surface-runtime-access.js \
  --catalog /tmp/memory-engine-tools-catalog.json \
  --effective /tmp/memory-engine-tools-effective.json \
  --observations /tmp/memory-engine-tool-surface-observations.jsonl \
  --invocation-mode gateway_rpc \
  --pretty
```

Possible statuses:

```text
tool_surface_runtime_confirmed_model_visible
tool_surface_runtime_confirmed_effective_filtered
tool_surface_registered_not_fully_executed
tool_surface_runtime_blocked
```

`tool_surface_runtime_confirmed_effective_filtered` means:

- registration is complete;
- both real production tool wrappers executed;
- model visibility remains filtered by effective policy;
- Stage 1 tool-surface coverage is complete;
- model-autonomous tool access is not proven.

## Multi-Window Canary Evaluation

Canary AutoRecall and tool-surface traffic may be collected in separate files. Pass both reports directly; do not hand-edit or synthesize a combined observation:

```bash
~/.local/node24/bin/node \
  bin/audit-scoped-fail-closed-canary-evidence.js \
  --observations /tmp/memory-engine-auto-recall-canary-observations.jsonl \
  --observations /tmp/memory-engine-tool-surface-observations.jsonl \
  --channel kg \
  --expected-agent edi \
  --pretty
```

The metrics summary CLI accepts the same repeatable form:

```bash
~/.local/node24/bin/node \
  bin/summarize-hybrid-search-observations.js \
  --observations /tmp/memory-engine-auto-recall-canary-observations.jsonl \
  --observations /tmp/memory-engine-tool-surface-observations.jsonl \
  --window-days 1 \
  --pretty
```

Always use canonical exporter rows containing the event envelope, including:

```text
event_type
source
created_at
metadata_json
```

A metadata-only redacted replay can be useful for evaluator tests, but the Console metrics builder requires canonical `event_type=hybrid_search_observation` rows.

## Pass Criteria

The B8-A6.2 runtime audit passes when:

- all three memory-engine tools appear in `tools.catalog`;
- `tools.effective` is captured and its visibility result is reported honestly;
- both tool invocations return `ok=true` and `source=plugin`;
- both canonical production surfaces are exported;
- both observations have `search_executed=true`;
- channel errors are zero;
- no memory mutation action is executed;
- source/runtime copies remain aligned;
- the repository working tree remains clean.

Model visibility may remain filtered. That is a separate product-policy decision and does not invalidate real gateway tool-surface execution evidence.

## Current Audited Result

The 2026-07-18 audit established:

```text
registry_status=complete
effective_profile=coding
effective_visibility_status=missing
invocation_mode=gateway_rpc
invocation_status=complete
production_surface_execution_confirmed=true
model_visibility_confirmed=false
status=tool_surface_runtime_confirmed_effective_filtered
```

The canonical combined scoped-canary evidence contained:

```text
auto_recall=6
memory_engine_action_search=1
memory_engine_search=1
stage2_review_eligible=true
```

This makes Stage 1 observation evidence eligible for a fresh Stage 2 review. It does not automatically authorize Stage 2 and does not authorize legacy fallback removal.

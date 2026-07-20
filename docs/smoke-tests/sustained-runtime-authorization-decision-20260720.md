# B8-A7 Sustained Runtime Authorization Decision — 2026-07-20

> **Decision: AUTHORIZATION WITHHELD / REMEDIATION REQUIRED**
>
> `B8-A7.4=CLOSED`
>
> `B8-A7 sustained runtime window=NOT AUTHORIZED`
>
> `B8-B removal=NOT AUTHORIZED`

## Scope

This record captures the first real-environment, read-only authorization review after A7.4 artifact review closure. It evaluates whether the current installed OpenClaw runtime is ready to construct and apply a sustained-runtime authorization plan.

The review did not install or reload the plugin, edit OpenClaw configuration, create a config backup, enable AutoRecall, change KG/Recent modes, create an evidence epoch, create a scheduler, execute rollback, mutate memory data, push, tag, or release.

Reviewed source checkpoint:

```text
repository=/home/lionsol/.openclaw/workspace/plugins/memory-engine
branch=main
head=e8140c2
```

Observed host/runtime identity:

```text
OpenClaw=2026.6.9 (c645ec4)
installed plugin root=/home/lionsol/.openclaw/extensions/memory-engine
installed plugin version=0.8.22
active config file=/home/lionsol/.openclaw/openclaw.json
```

## Decision Summary

Authorization is withheld because the currently loaded runtime cannot produce the A7.4 runtime-owned preflight, source/runtime parity is not clean, active-memory resolves enabled, historical observations do not establish qualifying natural traffic, and AutoRecall product health is not evaluable under the reviewed thresholds.

No authorization plan, active baseline, evidence epoch, or runtime mutation may be produced from this state.

## Blocking Findings

### 1. Source/runtime parity drift

The reviewed repository and installed extension are not the same runtime build:

```text
source_runtime_equal=false
difference_count=25
source_file_count=146
runtime_file_count=128
source_build_identity=3a3dc27777c03b0922fb0a829958590bdc49b33c84528c4160fbda56fd2f54cf
runtime_build_identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
```

The installed runtime is missing the A7.4 authorization, preflight, healthcheck, activation, monitor, rollback, effective-config, natural-traffic, and runtime-identity modules. `index.js` and `openclaw.plugin.json` also differ.

Consequences:

- `memoryEngine.sustainedRuntimePreflight` is unavailable;
- `memoryEngine.productionEvidenceHealthcheck` is unavailable;
- a fresh runtime-owned preflight cannot be captured;
- the authorization-plan builder cannot receive acceptable installed-runtime evidence.

### 2. OpenClaw CLI/native-module ABI mismatch

`openclaw plugins inspect memory-engine --runtime --json` reported:

```text
installed better-sqlite3 NODE_MODULE_VERSION=137
OpenClaw CLI required NODE_MODULE_VERSION=127
```

The plugin remained discoverable as loaded, but confidence-table initialization failed during inspection. The supported OpenClaw launch/runtime Node path and native dependency ABI must be reconciled before any install/reload or sustained-runtime decision can be trusted.

No rebuild or reinstall was executed during this review.

### 3. Active-memory boundary conflict

The live config has no explicit `plugins.entries.active-memory` entry. Under OpenClaw active-memory default-enabled semantics, the boundary report resolved:

```text
status=conflict
active_memory_enabled=true
active_memory_resolution=enabled_by_active_memory_runtime_default
blocker=active_memory_enabled
```

A sustained memory-engine AutoRecall window cannot be authorized while active-memory is effectively enabled because the dual automatic-memory paths would create duplicate injection and attribution ambiguity.

### 4. Natural traffic forecast blocked

A read-only export of the preceding 30 days produced 35 Hybrid Search observation rows. None qualified as canonical natural traffic:

```text
natural_observation_count=0
projected_natural_observation_count=0
history_days=0
invalid_provenance_count=1
invalid_origin_evidence_count=34
unknown_origin_count=34
```

Both required tool surfaces had zero qualifying observations, zero active days, and a 720-hour maximum gap. The forecast therefore failed the reviewed minimum history, volume, per-surface, active-day, and gap thresholds.

The review must not manufacture traffic or modify tool-selection prompts to satisfy these thresholds.

### 5. AutoRecall product health not established

The latest 24-hour telemetry report returned:

```text
status=not_evaluated
event_count=65
recall_started_count=5
recall_completed_count=30
injected_count=0
p95_auto_recall_latency_ms=4094
max_auto_recall_latency_ms=7300
quality_review_missing=true
```

The reviewed latency thresholds are 3000 ms for p95 and 4000 ms for maximum latency. Both were exceeded, and no exact-key human quality review exists. Product health therefore cannot default to healthy.

### 6. Runtime preflight and artifact chain unavailable

Because the installed runtime predates A7.4, no valid loaded-runtime preflight exists. The review intentionally did not create an exact config backup manifest, authorization plan, operator-approval artifact, post-apply preflight, or activation baseline after the upstream runtime and traffic gates failed.

## Current Config State

The live effective Hybrid configuration is valid and remains in the pre-activation state:

```text
autoRecall.enabled=false
autoRecall.agentAllowlist=[edi]
autoRecall.topK=3
autoRecall.timeoutMs=8000
kgFailClosedMode=legacy_fallback
recentFailClosedMode=legacy_fallback
productionEvidenceWindow.enabled=false
productionEvidenceWindow.epochId=null
rollout_config_fingerprint=502802868b51ee459691729b99c00a94d2c91081334952f32a743dbd18e1c79f
```

These disabled/legacy values are not a request to activate. They correctly remain unchanged while authorization is withheld.

## Required Remediation Sequence

A future authorization review may begin only after all of the following are completed through separately approved operator actions:

1. Resolve the OpenClaw runtime Node/native-module ABI contract without an unreviewed rebuild.
2. Explicitly disable active-memory in the live OpenClaw configuration and validate the boundary as clean.
3. Install/reload the reviewed memory-engine runtime through the verified OpenClaw path.
4. Re-run source/runtime parity and require `difference_count=0`.
5. Capture a fresh plugin-owned `memoryEngine.sustainedRuntimePreflight` report from the loaded runtime.
6. Accumulate canonical natural traffic without probes, scheduled healthchecks, prompt manipulation, or manufactured calls until the forecast is ready.
7. Re-evaluate AutoRecall latency and complete the exact `trace_id:memory_id` quality review required by product-health policy when qualifying injections exist.
8. Only then create the independent exact config backup and build a fresh dry-run authorization plan for explicit operator approval.

Installation, reload, configuration mutation, and traffic collection are outside this decision record and remain unauthorized until separately approved.

## Final State

```text
B8-A7.4=CLOSED
B8-A7 sustained runtime authorization=WITHHELD / REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

# Hybrid Fail-Closed Rollout Status

> **Status: Current rollout ledger**
>
> Last updated: 2026-07-19, after F1-D-B8-A6 Stage 2 KG full rollout and Stage 3 rollback validation.
>
> This document records current rollout state and evidence. It does not replace the runtime runbook, safety smoke, removal gate, code, or tests.

## Scope

This ledger tracks `F1-D-B8` migration from Hybrid Search legacy database fallback toward explicit fail-closed runtime behavior.

The authoritative operating procedures remain:

- [`smoke-tests/full-fail-closed-safety-smoke.md`](smoke-tests/full-fail-closed-safety-smoke.md)
- [`smoke-tests/full-fail-closed-runtime-rollout.md`](smoke-tests/full-fail-closed-runtime-rollout.md)
- [`smoke-tests/tool-surface-runtime-access-audit.md`](smoke-tests/tool-surface-runtime-access-audit.md)
- [`legacy-fallback-code-inventory.md`](legacy-fallback-code-inventory.md)

## Current Stage Ledger

| Stage | Status | Evidence / decision |
| --- | --- | --- |
| B8-A5 deterministic full fail-closed safety smoke | CLOSED | Synthetic matrix covers KG and Recent suppression, rollback, three production surfaces, observation markers, and channel isolation. |
| B8-A6 Stage 0 baseline install | CLOSED | Current plugin installed and reloaded with KG/Recent `legacy_fallback`; manifest, tool registration, runtime copy, and rollback baseline verified. |
| B8-A6 Stage 1 KG scoped-canary scope wiring | VERIFIED | Six canonical `auto_recall` observations matched trusted scope; no channel errors, Recent rollout, or full-mode leakage. |
| B8-A6 Stage 1 real fallback opportunity | NOT OBSERVED | Healthy isolated KG topology produced no natural fallback opportunity. This is a warning, not a requirement to damage production topology. A5 remains authoritative for deterministic suppression behavior. |
| B8-A6.1 scoped-canary evidence tooling | CLOSED | Added report-only evaluator and canonical JSON/JSONL metrics summary; evidence dimensions and Stage 2 review eligibility are machine-readable. |
| B8-A6.2 tool-surface runtime access audit | CLOSED | Registry complete; `coding` profile filters memory-engine tools from the model-visible set; official gateway `tools.invoke` executed both production search wrappers and produced canonical observations. |
| B8-A6 Stage 1 observation evidence | COMPLETE | `auto_recall=6`, `memory_engine_action_search=1`, `memory_engine_search=1`; no violations or evidence gaps; `stage2_review_eligible=true`. |
| B8-A6 Stage 2 KG full rollout | CLOSED / PASS | Corrected retry produced four canonical runtime observations: `auto_recall=2`, `memory_engine_search=1`, `memory_engine_action_search=1`. All carried KG full markers, Recent remained `legacy_fallback`, and channel/fallback/schema violations were zero. |
| B8-A6 Stage 3 KG rollback validation | CLOSED / PASS | Original configuration and `agent:main` model were restored; gateway reloaded; rollback search observation contained no KG full residue; post-rollback A5 smoke passed 10/10. |
| B8-A6.3 observation provenance hardening | REQUIRED NEXT | The first Stage 2 attempt inserted one synthetic `auto_recall` telemetry row (`id=11087`) without canonical source/session/trace/completed-at provenance. It is excluded from authoritative retry evidence but must not enter long-window metrics or removal evidence. |
| B8-A6 Stage 4 Recent full rollout | REVIEW ELIGIBLE / NOT AUTHORIZED | KG wiring and rollback are verified, but Stage 4 execution requires a separate operator decision after provenance hardening and runbook review. |
| B8-B legacy fallback removal | NOT AUTHORIZED | Requires completed full rollout, production evidence window, zero fallback events, tested replacement rollback, complete inventory, and removal-gate approval. |

## Stage 1 Canonical Evidence

The canonical combined evidence contains eight production observations:

```text
auto_recall=6
memory_engine_action_search=1
memory_engine_search=1
```

Scoped-canary evaluator result:

```text
status=canary_scope_confirmed_no_fallback_opportunity
scope_status=confirmed
suppression_status=no_opportunity
surface_coverage_status=complete
isolation_status=clean
violations=0
evidence_gaps=0
stage2_review_eligible=true
```

Canonical metrics summary:

```text
observed_hybrid_events=8
kg_fail_closed_canary.enabled_events=6
kg_full_fail_closed_events=0
recent_full_fail_closed_events=0
recent_fail_closed_canary_runtime.enabled_events=0
unknown_surface_events=0
unsupported_schema_version_events=0
```

## Tool-Surface Access Finding

OpenClaw exposes two distinct facts:

1. `tools.catalog` proves that the plugin registered `memory_engine`, `memory_engine_search`, and `memory_engine_get`.
2. `tools.effective` proves that the current `main` agent with `tools.profile=coding` does not expose those tools to the model.

The controlled gateway `tools.invoke` path resolves the official gateway registry, applies policy and `before_tool_call` hooks, and executes the actual plugin `execute` function. It therefore proves production wrapper execution, but it does not prove model-autonomous tool visibility.

Current audit result:

```text
status=tool_surface_runtime_confirmed_effective_filtered
registry_status=complete
effective_profile=coding
effective_visibility_status=missing
invocation_mode=gateway_rpc
invocation_status=complete
production_surface_execution_confirmed=true
model_visibility_confirmed=false
stage1_tool_surface_coverage_ready=true
```

No global `full` profile or persistent `alsoAllow` expansion was introduced.

## Runtime Environment Constraint

The installed native `better-sqlite3` binary currently targets Node ABI 137, corresponding to the project Node 24 runtime. Running OpenClaw directly under the default Node 22 shell uses ABI 127 and can produce a native module mismatch during plugin initialization.

For controlled rollout commands, use the Node 24 PATH explicitly:

```bash
PATH="$HOME/.local/node24/bin:$PATH" openclaw <command>
```

Do not interpret a Node 22 CLI initialization failure as evidence that the Node 24 gateway runtime is unhealthy.

## Stage 2 and Stage 3 Closeout

The authoritative corrected retry evidence is:

```text
auto_recall=2
memory_engine_search=1
memory_engine_action_search=1
kg_runtime_mode=full_fail_closed on all 4 observations
kg_rollout_scope=full on all 4 observations
kg_scope_required=false on all 4 observations
kg_fail_closed_scope_match=null on all 4 observations
recent_runtime_mode=legacy_fallback on all 4 observations
legacy KG fallback events=0
channel errors=0
unknown or unsupported schemas=0
```

Both AutoRecall rows were produced by the real OpenClaw runtime and contain:

```text
source=hybrid.auto_recall
session_id=present
trace_id=present
metadata.completed_at=present
```

The temporary `agent:main` model override used `opencode/deepseek-v4-flash` because the configured `deepseek/deepseek-v4-flash` route had insufficient credits. Agent result metadata confirmed `provider=opencode`, the AutoRecall turns completed successfully, and the original `agent:main` model was restored afterward.

The first attempt's synthetic row `id=11087` is not part of the corrected retry evidence. It lacks `source`, `session_id`, `trace_id`, and `metadata.completed_at`, so it must not be counted as production AutoRecall evidence.

Stage 3 restored:

```text
agent:main model=deepseek/deepseek-v4-flash
autoRecall.enabled=false
kgFailClosedMode=legacy_fallback
kgFailClosedCanary.enabled=false
recentFailClosedMode=legacy_fallback
recentFailClosedCanary.enabled=false
```

The runtime install path reported by `openclaw plugins inspect memory-engine --runtime --json` is:

```text
~/.openclaw/extensions/memory-engine
```

The reviewed checkout and runtime copy had zero source differences, the repository was clean, and the post-rollback A5 smoke passed 10/10.

## Continuing Safety Boundary

Stage 2/3 closeout does not authorize:

- Recent full rollout without a separate operator decision;
- memory mutation, `cite`, reinforcement, add, update, archive, or delete;
- intentional corruption of capability, topology, TEXT-ID invariants, or production data;
- removal of legacy SQL, query definitions, call sites, or `withLegacyDb` reachability;
- push or release publication.

Even a successful Stage 2/3 result does not authorize B8-B removal.

## Relevant Commits

```text
e8e4eec feat(recall): add full fail closed safety smoke
a0d1bb9 feat(recall): prepare controlled full fail closed rollout
17a90a3 feat(recall): add scoped canary evidence tooling
4a8d7a5 feat(recall): audit runtime tool surface access
```

## Next Decision

Complete B8-A6.3 observation provenance hardening before Stage 4 execution. The hardening must ensure that long-window metrics and rollout/removal evaluators reject or explicitly exclude rows whose canonical envelope does not match the claimed production surface.

After that change is reviewed, Stage 4 may enter a separate operator decision for Recent full rollout. Stage 4 must not be inferred from `REVIEW ELIGIBLE`, and B8-B removal remains unauthorized until the production evidence window and removal gate are independently satisfied.

Even the successful Stage 2/3 result does not authorize B8-B removal.

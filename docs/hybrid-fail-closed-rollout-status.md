# Hybrid Fail-Closed Rollout Status

> **Status: Current rollout ledger**
>
> Last updated: 2026-07-18, before F1-D-B8-A6 Stage 2 execution.
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
| B8-A6 Stage 2 KG full rollout | OPERATOR AUTHORIZED / PENDING EXECUTION | Execute only KG `full_fail_closed`; keep Recent `legacy_fallback`; cover all production surfaces; then perform Stage 3 real rollback. |
| B8-A6 Stage 3 KG rollback validation | PENDING | Must restore KG to `legacy_fallback`, reload the runtime, and verify full-mode residue is absent. |
| B8-A6 Stage 4 Recent full rollout | NOT AUTHORIZED | Requires a separate decision after KG full rollout and rollback evidence are reviewed. |
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

## Stage 2 Authorization Boundary

The operator has authorized proceeding to Stage 2 after this documentation update. That authorization is limited to:

- setting KG to `full_fail_closed`;
- keeping Recent at `legacy_fallback`;
- temporarily generating the minimum traffic required for all three production surfaces;
- readonly export of canonical Hybrid observations;
- immediate stop and rollback on any runbook violation;
- mandatory Stage 3 restoration to KG `legacy_fallback` after evidence collection.

It does not authorize:

- Recent full rollout;
- removal of legacy SQL, query definitions, call sites, or `withLegacyDb` reachability;
- memory mutation, cite, reinforcement, add, update, archive, or delete;
- intentional corruption of capability, topology, TEXT-ID invariants, or production data;
- push or release publication.

## Relevant Commits

```text
e8e4eec feat(recall): add full fail closed safety smoke
a0d1bb9 feat(recall): prepare controlled full fail closed rollout
17a90a3 feat(recall): add scoped canary evidence tooling
4a8d7a5 feat(recall): audit runtime tool surface access
```

## Next Decision

Execute Stage 2 KG full rollout and Stage 3 rollback according to the runbook. After the runtime report is reviewed, update this ledger with:

- full-mode markers across all three production surfaces;
- fallback and channel-error counts;
- Recent isolation result;
- real rollback result;
- whether Stage 4 may enter review.

Even a successful Stage 2/3 result does not authorize B8-B removal.

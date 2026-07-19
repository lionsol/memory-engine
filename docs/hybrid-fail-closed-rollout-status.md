# Hybrid Fail-Closed Rollout Status

> **Status: Current rollout ledger**
>
> Last updated: 2026-07-19, after the final config-only Stage 4 rerun exposed the AutoRecall hook-contract mismatch.
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
| B8-A6.3 observation provenance hardening | CLOSED | Shared validator now enforces canonical event/source/schema/search/completion/trace provenance and AutoRecall session provenance. Invalid rows remain auditable but are excluded from production denominators and block canary, rollout, evidence-window, and removal decisions. |
| B8-A6 Stage 4 Recent full rollout | FINAL CONFIG-ONLY RERUN INCONCLUSIVE / AUTO_RECALL HOST-CONTRACT MISMATCH | The reviewed runtime verified KG and Recent full markers on both tool surfaces, zero fallback/error/provenance violations, and successful rollback. `auto_recall` remained zero because `before_prompt_build` exposes `prompt/messages` plus agent context but no `chatType` or `messageRole`, while the plugin gate requires both fields. Stage 4 remains open. |
| B8-A6.4 AutoRecall runtime-gate config contract | CLOSED / INSUFFICIENT | The existing runtime allowlists are now schema-valid configuration, and `agentAllowlist=["edi","main"]` loaded successfully. This could not solve the missing `chatType/messageRole` dimensions because those values do not exist in the host hook contract. |
| B8-A6.5 hook-contract-compatible AutoRecall gate | IMPLEMENTED / RERUN REQUIRED | The gate now uses trusted `ctx.agentId` and `ctx.trigger` for default-deny decisions. `chatType` and `messageRole` remain optional supplementary constraints when explicitly supplied. The manifest exposes `triggerAllowlist=["user"]`, and the controlled-run evidence report now explicitly marks missing canonical surfaces such as `auto_recall` as closeout-ineligible. A new edi runtime rerun is still required; this change does not close Stage 4. |
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

## B8-A6.3 Provenance Hardening

The shared contract is documented in [`hybrid-observation-provenance.md`](hybrid-observation-provenance.md) and implemented by:

```text
lib/recall/hybrid/hybrid-observation-provenance.js
```

A production observation now requires:

```text
event_type=hybrid_search_observation
source=hybrid.<surface>
schema_version=1
search_executed=true
completed_at=canonical UTC ISO
trace_id=present
AutoRecall session_id=present
```

The validator is integrated into:

- Console Hybrid fallback metrics;
- scoped-canary evidence;
- fallback evidence windows;
- full fail-closed rollout evidence;
- tool-surface runtime audit;
- legacy fallback removal gate through the production rollout report.

Invalid observations expose:

```text
invalid_provenance_observation_count
invalid_provenance_observation_ids
invalid_provenance_reason_distribution
```

The Stage 2 synthetic row `id=11087` is therefore retained as historical telemetry but automatically excluded from production counts and reported as invalid provenance. It cannot satisfy Stage 4 or B8-B evidence.

Validation completed under Node 24:

```text
focused provenance and decision-chain tests=101/101
provenance and rollout documentation tests=31/31
static-check files=444
A5 safety smoke=10/10
full suite=1476 passed, 0 failed, 8 skipped
```

## Stage 4 Authorization Review

The operator explicitly approved continuation on 2026-07-19 after reviewing the relationship between B8 and P0-A. Stage 4 is therefore authorized for controlled runtime execution, but it is not yet closed or passed.

Authorization basis:

```text
B8-A5 safety smoke=CLOSED
B8-A6 Stage 1 scoped canary=CLOSED
B8-A6 Stage 2 KG full rollout=CLOSED / PASS
B8-A6 Stage 3 KG rollback=CLOSED / PASS
B8-A6.3 provenance hardening=CLOSED
Stage 4 targeted authorization review tests=103/103 passed
```

The review covered:

- explicit KG and Recent `full_fail_closed` configuration;
- channel isolation and scoped-canary metric separation;
- three-surface production evidence requirements;
- canonical provenance enforcement;
- immediate stop conditions;
- Recent rollback validation;
- continued B8-B removal blocking.

Stage 4 execution must:

1. save the current OpenClaw configuration and runtime identity;
2. verify source/runtime parity and A5 10/10 immediately before rollout;
3. set both KG and Recent to `full_fail_closed`;
4. execute real `auto_recall`, `memory_engine_search`, and `memory_engine_action_search` surfaces;
5. export only canonical observations from the real Engine DB;
6. require zero fallback, channel-error, schema, marker, and provenance violations;
7. restore both channels to `legacy_fallback` and verify rollback with fresh runtime evidence;
8. leave B8-B removal unauthorized.

## Stage 4 First Runtime Attempt Review

The first Stage 4 runtime attempt produced five canonical observations:

```text
auto_recall=3
memory_engine_search=1
memory_engine_action_search=1
```

All five observations carried explicit KG and Recent full markers, zero legacy fallback, zero channel errors, and valid event-level provenance. The subsequent rollback restored both channels to `legacy_fallback`, produced a fresh rollback observation without full markers, and passed A5 10/10.

However, the runtime source tree was not identical to the reviewed commit during the evidence window. `auto-recall-runtime-gate.js` was temporarily modified to expand the agent allowlist and disable chat-type and role checks. The file was later reverted and source/runtime parity was restored, but post-run parity cannot prove that the rollout observations were generated by the reviewed runtime.

Decision:

```text
Stage 4 functional wiring observed=true
Stage 4 canonical event provenance=true
Stage 4 reviewed-runtime provenance=false
Stage 4 closeout=not accepted
Stage 4 clean rerun required=true
Stage 4 rollback=PASS
B8-B removal=NOT AUTHORIZED
```

## B8-A6.5 Hook Contract and Controlled-Run Correction

The previous `denied_missing_chat_type` result was caused by a plugin/host contract mismatch, not by missing external chat infrastructure. The current `before_prompt_build` event guarantees `prompt` and `messages`; trusted context supplies `agentId`, `sessionId`, and `trigger`. Normal user turns use `trigger=user`, while heartbeat, cron, memory, budget, manual, timeout-recovery, and overflow turns remain denied by the trigger allowlist.

The runtime gate therefore preserves default-deny without requiring host fields that are not part of the hook contract. Explicit chat type and message role values are still validated when present, but their absence is compatible with the current host. The Stage 4 controlled-run contract independently requires at least one observation for each of `auto_recall`, `memory_engine_action_search`, and `memory_engine_search`; zero AutoRecall observations cannot be interpreted as closeout-ready.

Stage 4 remains open until edi reruns the controlled runtime procedure and produces valid three-surface evidence. B8-B remains unauthorized.

The clean rerun must use the reviewed runtime unchanged. AutoRecall must be triggered through an already-authorized `edi` interactive user session, or another configuration-only route explicitly allowed by the reviewed code. Source edits, runtime-file edits, direct telemetry writes, and temporary gate bypasses are prohibited.

## Stage 4 Clean Rerun Review

The clean rerun kept repository and installed-runtime source unchanged and produced three canonical tool-surface observations:

```text
memory_engine_search=2
memory_engine_action_search=1
auto_recall=0
KG full markers=3/3
Recent full markers=3/3
fallback events=0
channel errors=0
invalid provenance=0
rollback=PASS
post-rollback A5=10/10
```

The first clean run was `INCONCLUSIVE`, not failed: the full KG/Recent wiring was healthy on both registered tool surfaces, but no available session creation path satisfied all reviewed default AutoRecall gate dimensions simultaneously.

B8-A6.4 then exposed the existing allowlists as schema-valid configuration:

```text
autoRecall.agentAllowlist default=["edi"]
autoRecall.chatTypeAllowlist default=["interactive_user_chat"]
autoRecall.messageRoleAllowlist default=["user"]
```

The final config-only rerun successfully loaded `agentAllowlist=["edi","main"]`, but `auto_recall` remained zero. Local OpenClaw type definitions and the actual harness invocation confirm:

```text
PluginHookBeforePromptBuildEvent={prompt,messages}
PluginHookAgentContext includes agentId, sessionId, messageProvider, channel, senderId, trigger
PluginHookBeforePromptBuildEvent does not include chatType or messageRole
PluginHookAgentContext does not include chatType or messageRole
```

The harness constructs the event as:

```text
promptEvent={prompt:params.prompt,messages:params.messages}
```

Normal user runs carry `ctx.trigger="user"`; heartbeat, cron, memory, budget, and other non-user paths use distinct trigger values. Therefore the blocker is not a missing external chat integration. It is a plugin/host contract mismatch: the gate treats fields absent from its selected hook as mandatory.

Final config-only rerun result:

```text
auto_recall=0
memory_engine_search=2
memory_engine_action_search=1
KG full markers=3/3
Recent full markers=3/3
fallback events=0
channel errors=0
invalid provenance=0
rollback=PASS
post-rollback A5=10/10
Stage 4=INCONCLUSIVE
```

B8-A6.5 must replace the impossible gate dimensions with a hook-contract-compatible default-deny policy. The implementation should use trusted host fields such as `ctx.agentId` and `ctx.trigger`, preserve explicit denial of non-user execution paths, and retain compatibility handling for explicit chat/role fields only when a future host provides them.

## Continuing Safety Boundary

Stage 4 authorization does not authorize:

- memory mutation, `cite`, reinforcement, add, update, archive, or delete;
- intentional corruption of capability, topology, TEXT-ID invariants, or production data;
- synthetic or manually inserted production observations;
- any source or installed-runtime code modification during the rollout evidence window;
- temporary bypass of AutoRecall agent, chat-type, role, or other runtime gates;
- treating post-rollback source/runtime parity as proof of runtime provenance during the rollout window;
- removal of legacy SQL, query definitions, call sites, or `withLegacyDb` reachability;
- push or release publication.

Stage 4 is authorized only for the controlled rollout and rollback procedure. It does not authorize B8-B removal.

## Relevant Commits

```text
e8e4eec feat(recall): add full fail closed safety smoke
a0d1bb9 feat(recall): prepare controlled full fail closed rollout
17a90a3 feat(recall): add scoped canary evidence tooling
4a8d7a5 feat(recall): audit runtime tool surface access
```

## Next Decision

Implement and review B8-A6.5 before any further Stage 4 runtime attempt. The gate must be tested against the actual local OpenClaw `before_prompt_build` contract rather than synthetic `chat_type/message_role` fields. The full-rollout controlled-run audit must also make missing canonical surface coverage explicit so `auto_recall=0` cannot be mistaken for a closeout-ready run merely because the long-window evaluator reports only threshold gaps.

A passing clean rerun must show both KG and Recent explicit full markers, zero fallback events, zero invalid provenance observations, no channel or schema errors, no scoped-canary metric leakage, and unchanged reviewed source/runtime code throughout the evidence window. After evidence export, both channels must be restored to `legacy_fallback` and the rollback must be verified in the real runtime.

B8-B removal remains unauthorized until the required production evidence window, zero fallback and invalid-provenance counts, tested post-removal rollback strategy, complete inventory, and removal gate are independently satisfied.

# Hybrid Fail-Closed Rollout Status

> **Status: Current rollout ledger**
>
> Last updated: 2026-07-21, after B8-A7-R6 adopted the personal-deployment safety profile and retained R4/R5 as strict-profile references.
>
> This document records current rollout state and evidence. It does not replace the runtime runbook, safety smoke, removal gate, code, or tests.

## Scope

This ledger tracks `F1-D-B8` migration from Hybrid Search legacy database fallback toward explicit fail-closed runtime behavior.

The authoritative operating procedures remain:

- [`smoke-tests/full-fail-closed-safety-smoke.md`](smoke-tests/full-fail-closed-safety-smoke.md)
- [`smoke-tests/full-fail-closed-runtime-rollout.md`](smoke-tests/full-fail-closed-runtime-rollout.md)
- [`smoke-tests/full-fail-closed-production-evidence-window.md`](smoke-tests/full-fail-closed-production-evidence-window.md)
- [`smoke-tests/personal-deployment-sustained-runtime-remediation.md`](smoke-tests/personal-deployment-sustained-runtime-remediation.md)
- [`smoke-tests/tool-surface-runtime-access-audit.md`](smoke-tests/tool-surface-runtime-access-audit.md)
- [`legacy-fallback-code-inventory.md`](legacy-fallback-code-inventory.md)

## Current Stage Ledger

The historical strict B8-A7-R1 remediation runbook is [sustained-runtime-remediation.md](smoke-tests/sustained-runtime-remediation.md).
The active personal-deployment remediation runbook is [personal-deployment-sustained-runtime-remediation.md](smoke-tests/personal-deployment-sustained-runtime-remediation.md).
The B8-A7-R2A metadata-source audit is [openclaw-no-load-plugin-metadata-audit.md](smoke-tests/openclaw-no-load-plugin-metadata-audit.md).
The B8-A7-R3B host publisher source audit is [openclaw-host-metadata-publisher-source-audit.md](smoke-tests/openclaw-host-metadata-publisher-source-audit.md).
The strict-profile B8-A7-R4 metadata ownership decision is [host-plugin-metadata-ownership.md](adr/host-plugin-metadata-ownership.md).
The strict-profile B8-A7-R5 host publisher integration design is [openclaw-host-plugin-metadata-publisher-integration-design.md](openclaw-host-plugin-metadata-publisher-integration-design.md).
The current B8-A7-R6 personal deployment decision is [personal-deployment-safety-profile.md](adr/personal-deployment-safety-profile.md).
The B8-A7-R6.1 read-only baseline audit is [personal-deployment-read-only-baseline.md](smoke-tests/personal-deployment-read-only-baseline.md), with the real-environment decision at [personal-deployment-read-only-baseline-decision-20260721.md](smoke-tests/personal-deployment-read-only-baseline-decision-20260721.md).
The B8-A7-R6.2 host activation boundary compatibility contract is [host-activation-boundary-compatibility.md](smoke-tests/host-activation-boundary-compatibility.md).
The B8-A7-R6.3 personal runtime remediation authorization design is [personal-runtime-remediation-authorization.md](smoke-tests/personal-runtime-remediation-authorization.md).
The B8-A7-R6.4 offline candidate and rollback rehearsal decision is [personal-runtime-candidate-rehearsal-decision-20260721.md](smoke-tests/personal-runtime-candidate-rehearsal-decision-20260721.md).
The B8-A7-R6.5 live remediation authorization packet is [personal-runtime-live-remediation-authorization-20260721.md](smoke-tests/personal-runtime-live-remediation-authorization-20260721.md).
The B8-A7-R6.5 live execution decision is [personal-runtime-live-remediation-decision-20260721.md](smoke-tests/personal-runtime-live-remediation-decision-20260721.md).
The B8-A7-R6.5.2 live retry authorization packet is [personal-runtime-live-remediation-retry-authorization-20260721.md](smoke-tests/personal-runtime-live-remediation-retry-authorization-20260721.md).
The B8-A7-R6.5.2 live retry execution decision is [personal-runtime-live-remediation-retry-decision-20260721.md](smoke-tests/personal-runtime-live-remediation-retry-decision-20260721.md).
The B8-A7-R6.5.3 persistent artifact rebuild and recovery-source rebase design is [personal-runtime-persistent-artifact-rebase-design-20260721.md](smoke-tests/personal-runtime-persistent-artifact-rebase-design-20260721.md).

Current remediation boundary:

    B8-A7-R1 strict no-load remediation=HISTORICAL / SUPERSEDED FOR PERSONAL DEPLOYMENT
    B8-A7-R4 strict host ownership architecture=PASSED / CLOSED / REFERENCE ONLY
    B8-A7-R5 strict host publisher integration design=PASSED / CLOSED / REFERENCE ONLY
    B8-A7-R6 personal deployment safety profile=PASSED / CLOSED
    B8-A7-R6 personal deployment remediation=VERIFIED / CURRENT
    B8-A7-R6.1 read-only baseline execution=PASSED / BASELINE BLOCKED
    B8-A7-R6.2 host activation boundary compatibility=PASSED / CLOSED
    B8-A7-R6.3 runtime-remediation authorization design=PASSED / CLOSED
    B8-A7-R6.4 offline candidate and rollback rehearsal=PASSED / CLOSED
    B8-A7-R6.5 live remediation execution authorization packet=PASSED / CLOSED
    B8-A7-R6.5 live remediation execution=ROLLED BACK / SAFE
    candidate Gateway activation=NOT REACHED
    old runtime restored=TRUE
    B8-A7-R6.5.1 config semantic equivalence repair=PASSED / CLOSED
    B8-A7-R6.5.2 live remediation retry authorization packet=PASSED / CLOSED
    B8-A7-R6.5.2 live retry execution=BLOCKED / NO MUTATION
    R6.5.2 retry authorization=CONSUMED / NOT REUSABLE
    fresh R6.5.2 C0/R0/H0/D0=NOT CREATED
    current recovery transaction root=ABSENT / REBASE REQUIRED
    offline candidate artifact=ABSENT / REBUILD REQUIRED
    installed-plugin recovery sourcePath=DANGLING
    B8-A7-R6.5.3 persistent artifact rebuild/recovery-source rebase design=IMPLEMENTED / EDI VERIFICATION PENDING
    R6.5.3A persistent artifact preparation=NOT AUTHORIZED
    R6.5.3B recovery-source rebase execution=NOT AUTHORIZED
    R6.5.3 candidate activation=NOT AUTHORIZED
    persistent authority root=NOT CREATED
    persistent candidate=NOT CREATED
    persistent R0=NOT CREATED
    OpenClaw upstream pull request=NOT REQUIRED / NOT PLANNED
    B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
    B8-A7 sustained runtime window=NOT AUTHORIZED
    B8-B removal=NOT AUTHORIZED

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
| B8-A6 Stage 4 Recent full rollout | CLOSED / PASS | Final unchanged-runtime rerun produced four canonical observations in one evidence window: `auto_recall=2`, `memory_engine_search=1`, and `memory_engine_action_search=1`. All carried exact KG and Recent full markers, explicit `scope_match=null`, zero fallback/error/provenance/schema/canary violations, and `controlled_run_closeout_eligible=true`. Both channels were then restored to legacy mode and a fresh rollback observation plus A5 10/10 confirmed rollback. |
| B8-A6.4 AutoRecall runtime-gate config contract | CLOSED / INSUFFICIENT | The existing runtime allowlists are now schema-valid configuration, and `agentAllowlist=["edi","main"]` loaded successfully. This could not solve the missing `chatType/messageRole` dimensions because those values do not exist in the host hook contract. |
| B8-A6.5 hook-contract-compatible AutoRecall gate | CLOSED / RUNTIME VERIFIED | The gate uses trusted `ctx.agentId` and `ctx.trigger` for default-deny decisions; `chatType` and `messageRole` remain optional supplementary constraints. Required allowlists fail closed when empty; full markers require explicit `scope_match=null`; unified fallback markers and all safety blockers disable controlled-run closeout. The final Stage 4 rerun produced two valid AutoRecall observations through the reviewed hook contract. |
| B8-A7.1 evidence epoch and deployment identity | CLOSED / READY FOR A7.2 | Final review accepted implementation checkpoint `caf4373`. Runtime identity covers the reviewed local dependency closure and fails closed on missing, symlinked, duplicated, or undeclared runtime paths. The rollout fingerprint uses one normalized effective AutoRecall/KG/Recent/retrieval configuration, includes non-secret effective environment thresholds, preserves supported compatibility aliases, and invalidates malformed inputs. |
| B8-A7.2 continuity and traffic-origin evidence | CLOSED / READY FOR A7.3 | Final review accepted implementation checkpoint `47389d3`. Origin classification follows the typed host hook contract; registration-owned origin contexts are TTL/collision/capacity guarded; origin evidence and three-surface structural readiness are fail closed; per-surface leading, trailing, and internal gaps are enforced; and CLI/evaluator threshold validation shares one contract that rejects primitive, unknown, and malformed inputs. |
| B8-A7.3 read-only health monitor and stop contract | CLOSED / READY FOR A7 RUNTIME AUTHORIZATION REVIEW | Final review accepted implementation checkpoint `cc88825`. Scheduled healthchecks are restricted to tool production surfaces, canonical UTC timestamps are exact, authorized time bounds feed every child evaluator, and parity/product-health states are separated from freshness with internally consistent removal-readiness invariants. |
| B8-A7 sustained production evidence window | WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED | The evidence-window contract remains `DESIGN AUTHORIZED / RUNTIME NOT AUTHORIZED`. The 2026-07-21 R6.5 attempt installed the candidate while stopped and passed the data/runtime gates, but the exact-byte config gate detected OpenClaw's `meta.lastTouchedAt` update and invoked the authorized rollback before candidate Gateway activation. The old runtime, exact C0, memory-data identities, safe feature state, and A5 10/10 were restored. The active extension still has 28 source/runtime differences and lacks installed A7.4 methods. |
| B8-A7-R2A existing OpenClaw metadata API audit | VERIFIED / CLOSED | The current OpenClaw 2026.6.9 installed-plugin index is persisted in shared state SQLite; its helper opens the database without a read-only contract and the snapshot loader falls back to discovery. Existing API remains blocked for Phase 0. |
| B8-A7-R2B synthetic read-only state-DB feasibility harness | PASSED / CLOSED | Synthetic verification is complete. The live state-DB reader remains blocked because WAL/SHM filesystem changes violate zero-write evidence and immutable reading retained the checkpointed revision. No syscall trace is required for the feasibility decision. |
| B8-A7-R3A host-published metadata manifest synthetic contract | PASSED / CLOSED | Synthetic canonical JSON, duplicate-key rejection, BOM/NUL rejection, permission rejection, atomic old/new generation assertions, tombstone handling, symlink/hardlink rejection, and zero-consumer-write evidence passed focused tests and the 16-scenario synthetic smoke. This does not authorize host integration or production consumption. |
| B8-A7-R3B host metadata publisher integration-point source audit | NOT FOUND / BLOCKED | Install/update/uninstall lifecycle owners and the shared SQLite index writer exist, but no no-load R3A manifest publisher, startup reconciliation hook, or atomic ordinary-file publication boundary was found. |
| B8-A7-R4 strict metadata ownership decision | PASSED / CLOSED / REFERENCE ONLY | For a strict no-load authority profile, OpenClaw host core is the single valid publisher owner. The package audit, shadow-publisher rejection, and direct-SQLite rejection remain valid, but absence of a publisher is not a blocker for the current personal deployment. |
| B8-A7-R5 strict OpenClaw host publisher integration design | PASSED / CLOSED / REFERENCE ONLY | Retains the durable publication and startup-barrier design for a future platform deployment. Upstream implementation, PR, private fork, real publisher, and production consumer are not planned for the current personal route. |
| B8-A7-R6 personal deployment safety profile | PASSED / CLOSED | Accepts operator-controlled plugin inspection and already-running Gateway evidence, while preserving core-DB read-only, exact runtime parity, explicit effective host-policy disablement of active-memory, ABI checks, tests, backups, rollback, and feature-level fail-closed behavior. Repository verification closed at commit `555d131` with 1727 passed, 0 failed, and 8 skipped. |
| B8-A7-R6.1 personal deployment read-only baseline | PASSED / BASELINE BLOCKED | Clean window `2026-07-21T07:54:43.635Z`–`07:55:54.668Z` preserved Gateway and memory-store identities. Gateway health, host allowlist disablement, safe Hybrid config, repository tests, and A5 smoke passed. Runtime parity remained false with 28 differences, A7.4 methods were absent, and the boundary resolver produced a false conflict because it ignores `plugins.allow`. |
| B8-A7-R6.2 host activation boundary compatibility | PASSED / CLOSED | Commit `9e60531` closed the resolver change after 67/67 focused/downstream tests, static check over 519 files, the full suite with 1737 passed and 8 skipped, and A5 smoke 10/10. Live config read-only verification returned `clean / disabled_by_plugins_allowlist`; the installed extension was not changed. |
| B8-A7-R6.3 runtime-remediation authorization design | PASSED / CLOSED | Commit `9b6b734` closed the design after 39/39 focused tests, static check over 520 files, the full suite with 1746 passed and 8 skipped, and A5 smoke 10/10. It rejects direct workspace copy, direct archive native install, linked source, and CLI-local runtime inspection; selects a Node 24 dependency-complete candidate plus C0/R0/H0/D0 and explicit rollback. |
| B8-A7-R6.4 offline candidate and rollback rehearsal | PASSED / CLOSED | Commit `59278a6` closed the independently verified rehearsal. Candidate runtime identity `dc459f5…d718`, native smokes, parity zero, independent C0/R0, and isolated candidate → R0 → candidate installation all passed; real config and Gateway remained unchanged. |
| B8-A7-R6.5 live remediation execution authorization packet | PASSED / CLOSED | Binds candidate artifact identity `0490e607…44f42`, canonical artifact manifests, fresh C0/R0/D0, stable cwd, explicit Node 24 stop/install/start, install-time data identity gates, Gateway method/tool verification, and bounded rollback. |
| B8-A7-R6.5 live remediation execution | ROLLED BACK / SAFE | Candidate install, source/installed parity, native dependency checks, and data identities passed. Exact config bytes differed only at host `meta.lastTouchedAt`; the defined stop condition prevented candidate Gateway start. Fresh R0 and exact C0 were restored, Gateway PID `275493` became healthy under Node 24, final data identities matched D_PRE_INSTALL, and A5 smoke passed 10/10. |
| B8-A7-R6.5.1 config semantic equivalence repair | PASSED / CLOSED | Adds `memory-engine-config-semantic-equivalence-v1`, which allows only a canonical monotonic `meta.lastTouchedAt` update and fails closed on every other JSON path without exposing raw config values. Independent EDI verification passed. |
| B8-A7-R6.5.2 live remediation retry authorization packet | PASSED / CLOSED | Binds the unchanged candidate and current recovery R0, requires a new transaction root with fresh C0/R0/H0/D0, uses the closed semantic-config policy, preserves the existing recovery root, and requires a new exact operator approval. Independent EDI verification passed. |
| B8-A7-R6.5.2 live remediation retry execution | BLOCKED / NO MUTATION | Final preflight found the candidate and current recovery transaction root absent from `/tmp`; the installed sourcePath is dangling. Gateway, config, runtime, and data were not mutated. The supplied authorization is consumed and cannot be reused. |
| B8-A7-R6.5.3 persistent artifact rebuild/recovery-source rebase design | IMPLEMENTED / EDI VERIFICATION PENDING | Restores a durable owner-only authority under `$HOME/.openclaw/backups`; separates offline candidate/R0 preparation, live same-runtime sourcePath rebase, and later candidate activation. No preparation or live mutation is authorized. |
| B8-B legacy fallback removal | NOT AUTHORIZED | Requires completed A7 production evidence window, zero fallback events, tested replacement rollback, complete inventory, and removal-gate approval. |

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

The runtime gate therefore preserves default-deny without requiring host fields that are not part of the hook contract. Explicit chat type and message role values are still validated when present, but their absence is compatible with the current host. The Stage 4 controlled-run contract independently requires at least one observation for each of `auto_recall`, `memory_engine_action_search`, and `memory_engine_search`; missing canonical surfaces such as `auto_recall` block controlled-run closeout, and zero AutoRecall observations cannot be interpreted as closeout-ready.

Stage 4 remains open until edi reruns the controlled runtime procedure and produces valid three-surface evidence. B8-B remains unauthorized.

Review hardening also requires explicit safety facts: empty `agentAllowlist` or `triggerAllowlist` values fail closed. Specifically, empty `agentAllowlist` fails with `denied_by_agent_allowlist`, while empty `triggerAllowlist` fails with `denied_by_trigger_allowlist`. Full KG/Recent markers must contain `scope_match=null` as an explicit field; canonical legacy fallback markers override access-mode summaries. Any fallback, scope mismatch, incomplete full marker, channel error, provenance/schema issue, or canary leakage forces `controlled_run_closeout_eligible=false`. A short evidence window may remain insufficient for the 30-day decision while controlled eligibility is true only when these safety facts are clean.

The final rerun must use the reviewed runtime unchanged. AutoRecall may be triggered by a normal user turn whose agent is admitted through schema-valid `agentAllowlist` configuration and whose trusted hook context reports `trigger=user`. Source edits, runtime-file edits, direct telemetry writes, and temporary gate bypasses are prohibited.

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

B8-A6.5 is now implemented and review-accepted. Commits `202c9b2` and `899edce` align the gate with trusted `ctx.agentId` and `ctx.trigger`, preserve explicit denial of non-user execution paths, retain optional compatibility checks for explicit chat/role fields, and harden controlled-run evidence against empty required allowlists, incomplete full markers, canonical fallback markers, and inconsistent safety eligibility.

## Stage 4 Final Runtime Rerun Closeout

The final rerun used reviewed commit `6aa26e4` with repository and installed-runtime source unchanged throughout the evidence window. Four canonical production observations were exported:

```text
auto_recall=2
memory_engine_search=1
memory_engine_action_search=1
```

All four observations satisfied:

```text
KG runtime_mode=full_fail_closed
KG rollout_scope=full
KG scope_required=false
KG scope_match=null
Recent runtime_mode=full_fail_closed
Recent rollout_scope=full
Recent scope_required=false
Recent scope_match=null
legacy_db_fallback_used=false
legacy_db_fallback_channels=[]
channel_error_count=0
invalid provenance=0
```

The controlled-run evaluator reported:

```text
status=insufficient_evidence
controlled_run_surface_coverage_status=complete
missing_controlled_run_surfaces=[]
controlled_run_closeout_eligible=true
controlled_run_blockers=[]
blockers=[]
```

`status=insufficient_evidence` reflects only the separate 30-day, 500-observation, and 100-per-surface production-window thresholds. It does not block Stage 4 controlled-run closeout.

Both channels were restored to legacy configuration. A fresh `memory_engine_search` rollback observation contained no full-mode residue, source/runtime parity remained clean, and post-rollback A5 passed 10/10.

Decision:

```text
B8-A6 Stage 4=CLOSED / PASS
B8-A6.5=CLOSED / RUNTIME VERIFIED
B8-B removal=NOT AUTHORIZED
```

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

Stage 4 closeout confirms the controlled rollout and rollback wiring only. It does not authorize B8-B removal or substitute for the required sustained production evidence window.

## Relevant Commits

```text
e8e4eec feat(recall): add full fail closed safety smoke
a0d1bb9 feat(recall): prepare controlled full fail closed rollout
17a90a3 feat(recall): add scoped canary evidence tooling
4a8d7a5 feat(recall): audit runtime tool surface access
202c9b2 feat(recall): align AutoRecall gate with host hook contract
899edce fix(recall): harden AutoRecall gate and rollout evidence
6aa26e4 docs(recall): close A6.5 implementation review
```

## B8-A7 Sustained Production Evidence Authorization Review

The operator approved continuation after Stage 4 closeout, which authorizes design and implementation of A7 evidence-governance tooling. It does not authorize keeping KG/Recent in `full_fail_closed` or AutoRecall enabled for 30 days.

A7.3 closed the read-only health status and stop/rollback contract. The subsequent runtime authorization review withheld real runtime authorization until parity generation, product-health generation, plugin-owned scheduled healthchecks, epoch projection, natural-traffic forecasting, authorization-plan validation, and read-only monitor orchestration were implemented and reviewed.

The required implementation sequence is:

```text
B8-A7.1 evidence epoch and deployment identity
B8-A7.2 continuity and traffic-origin evidence
B8-A7.3 read-only health monitor and stop contract
B8-A7 runtime authorization review
B8-A7.4 sustained runtime authorization tooling
B8-A7.4 implementation review
B8-A7 sustained production evidence window
B8-B removal-gate review
```

The authoritative design boundary is [`smoke-tests/full-fail-closed-production-evidence-window.md`](smoke-tests/full-fail-closed-production-evidence-window.md).

## Next Decision

B8-A7.1 is closed after final review of implementation checkpoint `caf4373`. The accepted contract binds observations to one explicit evidence epoch, reviewed runtime dependency identity, and normalized effective rollout/retrieval configuration. Higher-priority malformed `autoRecall` values fail closed, Recent single-token canary compatibility is preserved, and dependency-closure validation requires every declared local runtime dependency. B8-A7.2 is closed after final review of implementation checkpoint `47389d3`. Stage 4's temporary `autoRecall.enabled=true`, `agentAllowlist=["edi","main"]`, and dual `full_fail_closed` configuration still do not authorize sustained production use or any long-running runtime configuration change.

Current implementation state: `B8-A7.2 CLOSED / READY FOR A7.3`; sustained runtime window and B8-B remain unauthorized. Final review verified host-shaped natural/probe origin classification, strict origin-evidence validation, three-surface structural readiness, per-surface leading/trailing continuity, post-TTL `toolCallId` reuse, same-lifetime collision fail-closed behavior, scheduled-healthcheck collision handling, capacity eviction, and shared threshold validation. Independent Node 24 validation passed 41 focused tests, static-check, A5 10/10, and the full 1574-test suite with 1566 passed, 0 failed, and 8 skipped.

Current A7.3 implementation state: `B8-A7.3 IMPLEMENTED / REVIEW CHANGES REQUIRED`. The report-only composition architecture is sound, but final review of implementation checkpoint `b725dd5` found four evidence-boundary defects. `baseline.authorized_at` is validated but never used to exclude or block observations before authorization; a 31-day pre-authorization history plus a few fresh post-authorization rows can therefore return `ready_for_removal_gate`. Observation, parity, product-health, and healthcheck timestamps after `asOf` produce negative ages and are treated as fresh. Baseline/report/CLI timestamps accept any `Date.parse()` value rather than canonical UTC ISO, including natural-language dates and normalized impossible dates. Finally, a scheduled-healthcheck row with `traffic_origin_valid=true` and `source=scheduled_healthcheck_wrapper` can satisfy freshness even when all agent/session/tool-call presence fields are false, although the trusted registry could never emit that row as valid. `B8-A7 sustained runtime window NOT AUTHORIZED`; `B8-B removal NOT AUTHORIZED`.

Checkpoint `3dcd55c` implements the A7.3 temporal review fixes: `authorized_at` bounds one shared observation input for identity, continuity, fallback, and full-rollout evaluation; pre-authorization and post-`asOf` rows create stop conditions; future evidence is no longer fresh; and incomplete scheduled-healthcheck identity evidence is rejected. Final review nevertheless remains open. The shared origin validator does not require scheduled healthchecks to use a tool surface, so an impossible `auto_recall + scheduled_healthcheck` row can still satisfy freshness and return `ready_for_removal_gate`. The canonical-time helper accepts surrounding whitespace despite the exact-format contract. In addition, `monitor_freshness_status` can remain `fresh` while a surface is stale, and `runtime_parity_status` can remain `fresh` while source/runtime parity has drifted. Current state: `B8-A7.3 REVIEW FIXES IMPLEMENTED / FINAL REVIEW CHANGES REQUIRED`; the sustained runtime window and B8-B remain unauthorized.

Checkpoint `3dcd55c` final review fixes were completed by implementation checkpoint `cc88825`: scheduled healthchecks are restricted to tool surfaces, canonical timestamps reject surrounding whitespace, runtime parity health is separated from parity freshness, product-health freshness is explicit, and monitor freshness includes every production surface.

Final review accepted `cc88825`. Independent adversarial checks confirmed that a forged `auto_recall` scheduled healthcheck is rejected, a single stale production surface makes `monitor_freshness_status` non-fresh, runtime/source drift reports `runtime_parity_status=drift` while preserving separate freshness, and canonical timestamps reject surrounding whitespace. Node 24 validation passed 57 focused tests, static-check for 467 files, A5 safety smoke 10/10, and the full 1597-test suite with 1589 passed, 0 failed, and 8 skipped. `code-review-graph 2.3.7` reported risk 0.55, zero affected stored flows, and five helper-level test-gap hints that were covered by direct tests or adversarial review.

Historical state: `B8-A7.3 CLOSED / READY FOR A7 RUNTIME AUTHORIZATION REVIEW`. The runtime authorization review was completed and withheld real activation pending A7.4 tooling.

A7.4 artifact review additionally closed three artifact-chain defects. Activation now rejects authorization plans older than one hour or internally inconsistent plans, and the post-apply preflight must read the same live OpenClaw config path bound by the pre-activation backup. The active evidence lower bound is the finalizer-owned `activated_at`, so observations between operator approval and activation finalization are blocked and excluded from DB export, epoch projection, continuity, identity, fallback, full-rollout, parity/product freshness, and healthcheck freshness. Rollback verification now requires the finalized activation-baseline report and cannot certify a legacy state when no active epoch was proven. Adversarial tests cover stale/tampered plans, wrong live-config paths, hand-written baselines, pre-activation rows, and missing activation artifacts.

Current state: `B8-A7.4 CLOSED / READY FOR SEPARATE SUSTAINED RUNTIME AUTHORIZATION DECISION`. The final implementation review closed after 171/171 focused tests, static check across 506 files, A5 safety smoke 10/10, and the full 1675-test suite with 1667 passed, 0 failed, and 8 skipped. Host-SDK registration integration verified both operator-read gateway methods through the installed OpenClaw SDK. A full code-review-graph snapshot using tree-sitter-javascript 0.25.0 covered 406 files, 146 flows, and 11 communities; it reported heuristic risk 0.85, 110 helper-level gap hints, and zero affected stored flows. Review hardening binds authorization to a loaded-runtime preflight no more than one hour old, exact live config-file path/SHA-256/byte count, an independent byte-identical owner-only backup, source/runtime parity, a 30-day natural-traffic forecast, auditable recent injection samples, and explicit approvals. Scheduled healthcheck freshness requires both tool surfaces under one run identity. The plan exposes a manifest-valid config patch and only an inactive baseline template; the separate read-only post-apply finalizer is the sole path that can emit an active baseline. Continuous monitoring and rollback verification revalidate the same identities. No real configuration, install/reload, scheduler, epoch, rollback, push, tag, or release was executed. `B8-A7 sustained runtime window NOT AUTHORIZED`; `B8-B removal NOT AUTHORIZED`.

The first real-environment sustained-runtime authorization decision was completed on 2026-07-20 and authorization was withheld. The installed runtime differs from reviewed source by 25 files and lacks the A7.4 preflight/healthcheck gateway methods; OpenClaw inspection also exposed a `better-sqlite3` Node ABI mismatch. Active-memory resolves enabled by default because no explicit disable entry exists. The preceding 30-day export contained 35 Hybrid Search observations but zero qualifying natural observations, with 34 invalid origin-evidence rows and one invalid-provenance row. AutoRecall product health returned `not_evaluated`, with p95 latency 4094 ms, maximum latency 7300 ms, zero injections, and no quality review. No config backup, authorization plan, install/reload, config mutation, scheduler, evidence epoch, activation baseline, rollback, push, tag, or release was performed. See [`smoke-tests/sustained-runtime-authorization-decision-20260720.md`](smoke-tests/sustained-runtime-authorization-decision-20260720.md).

Current authorization state: `B8-A7 sustained runtime authorization WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED`; `B8-A7 sustained runtime window NOT AUTHORIZED`; `B8-B removal NOT AUTHORIZED`.

## B8-A7-R4 Metadata Ownership Decision

The accepted R4 ADR is [`adr/host-plugin-metadata-ownership.md`](adr/host-plugin-metadata-ownership.md). It remains the correct ownership model for the strict platform-grade no-load authority profile: OpenClaw host core is the only acceptable owner of authoritative plugin-install metadata and any derived ordinary-file publication. A memory-engine shadow publisher and direct SQLite/index consumption remain rejected.

R6 changed applicability, not the technical finding. The current single-operator personal deployment no longer requires a host-published authority proof before plugin loading, so absence of the publisher is not a current authorization blocker.

The R4 package re-audit inspected the official `openclaw@2026.7.1-2` npm tarball statically without installing it or starting OpenClaw. The package still uses the shared SQLite `installed_plugin_index` as its canonical install ledger. Its install-record commit path writes the index before the matching config commit and rolls back on commit failure, so the low-level SQLite writer is not a complete semantic publication boundary. Registry refresh remains warning-only and can enter discovery or dynamically import the plugin loader. Gateway startup still reaches plugin lookup and `loadGatewayStartupPluginRuntime` without an R3A reconciliation barrier. No ordinary-file publisher, durable publication revision, or pre-runtime publication gate was found.

Production metadata must separate `authority_state`, `installation_state`, and `policy_state`. In particular, `disabled-by-host-policy` means installed plus disabled, not authoritative absence. Uninstall and a host-reconciled missing install record require explicit tombstones; unavailable or malformed authority must fail closed rather than masquerade as absence.

Required ownership and ordering are:

```text
manifest path/schema/generation/publication identity=OpenClaw host-owned
authoritative mutation and durable publication intent=host semantic commit
atomic ordinary-file replacement=host publisher
startup reconciliation=before plugin lookup, discovery-driven activation, and runtime loading
read-only validation and fail-closed reporting=memory-engine consumer only
```

Current R4 state: `B8-A7-R4 strict host ownership architecture PASSED / CLOSED / REFERENCE ONLY`; `OpenClaw upstream host publisher REQUIRED ONLY FOR STRICT PLATFORM PROFILE`; `real host publisher NOT REQUIRED FOR PERSONAL PROFILE`; `production manifest consumer NOT REQUIRED FOR PERSONAL PROFILE`. R3A remains closed for the synthetic file algorithm only, and R3B remains complete with `host publisher source NOT FOUND / BLOCKED`.

## B8-A7-R5 OpenClaw Host Publisher Integration Design

The accepted R5 design is [`openclaw-host-plugin-metadata-publisher-integration-design.md`](openclaw-host-plugin-metadata-publisher-integration-design.md). It converts the strict R4 ownership decision into an upstream implementation reference without modifying OpenClaw. It is dormant under the current personal-deployment profile.

The design selects:

```text
publication targets=host-configured required plugin ids
install authority=durable installed-plugin records
policy authority=committed host-owned plugin policy
cross-storage recovery=SQLite durable publication outbox
manifest contract=canonical openclaw.host-plugin-install-metadata/v2
publication path=<stateDir>/plugins/host-metadata/v2/<plugin-id-sha256>.json
startup barrier=before resolvePluginMetadataSnapshot, derived discovery, lookup, or runtime loading
```

The current Gateway config path may resolve plugin metadata and fall back to discovery during `readConfigFileSnapshotWithPluginMetadata`, before `prepareGatewayPluginBootstrap`. R5 therefore requires a no-plugin-metadata host-policy snapshot phase using the same captured config bytes and hash, followed by publication reconciliation, then plugin-metadata-dependent config completion.

The durable protocol uses a semantic commit journal plus immutable per-plugin generation rows with `prepared`, `committed`, `published`, and `aborted` phases. A prepared generation never overwrites the previous published generation. Startup compares the actual captured config hash with the journal's previous and expected hashes to finalize, restore, or fail closed; exact committed canonical bytes remain stable across retries and post-rename recovery.

Production v2 keeps `installation_state`, `policy_state`, and `publication.state` independent. A disabled plugin remains installed; required absence uses `uninstalled` or `install-record-missing`; removing a required id produces a terminal `publication.state=retired` generation rather than deleting the final file.

Current R5 state: `B8-A7-R5 strict host publisher integration design PASSED / CLOSED / REFERENCE ONLY`; `OpenClaw fork/worktree NOT REQUIRED / NOT PLANNED`; `OpenClaw source modification NOT AUTHORIZED`; `upstream pull request NOT REQUIRED / NOT PLANNED`; `real host publisher NOT REQUIRED FOR PERSONAL PROFILE`; `production manifest consumer NOT REQUIRED FOR PERSONAL PROFILE`.

## B8-A7-R6 Personal Deployment Safety Profile

The accepted current profile is [`adr/personal-deployment-safety-profile.md`](adr/personal-deployment-safety-profile.md), with the active operator runbook at [`smoke-tests/personal-deployment-sustained-runtime-remediation.md`](smoke-tests/personal-deployment-sustained-runtime-remediation.md).

The personal profile preserves the high-value hard boundaries:

```text
core DB read-only
separate memory-engine DB
reviewed source and installed runtime parity
Gateway Node/native ABI compatibility
active-memory explicitly disabled
required tools and Gateway methods registered
safe initial config with AutoRecall/full/evidence inactive
tests and A5 safety smoke green
independently verified config and runtime rollback sources
```

It relaxes the disproportionate platform requirements:

```text
no OpenClaw upstream PR
no private OpenClaw fork
no host metadata publisher
no cross-storage publication journal
no pre-discovery authority barrier
```

Operator-controlled cold plugin inspection, exact installed-runtime identity, and post-load Gateway evidence must agree. Uncertainty disables AutoRecall, automatic reinforcement, full modes, evidence collection, and any sustained epoch; it does not require blocking all plugin management or diagnostic loading.

Current R6 state: `B8-A7-R6 personal deployment safety profile PASSED / CLOSED`; `personal deployment remediation runbook VERIFIED / CURRENT`; `B8-A7-R6.1 read-only baseline execution PASSED / BASELINE BLOCKED`; `B8-A7-R6.2 host activation boundary compatibility PASSED / CLOSED`; `B8-A7-R6.3 runtime-remediation authorization design PASSED / CLOSED`; `B8-A7-R6.4 offline candidate and rollback rehearsal PASSED / CLOSED`; `offline candidate artifact VALIDATED / FROZEN / EPHEMERAL`; `B8-A7-R6.5 authorization packet PASSED / CLOSED`; `B8-A7-R6.5 live remediation execution ROLLED BACK / SAFE`; `candidate Gateway activation NOT REACHED`; `old runtime restored TRUE`; `B8-A7-R6.5.1 config semantic equivalence repair PASSED / CLOSED`; `B8-A7-R6.5.2 live remediation retry authorization packet PASSED / CLOSED`; `R6.5.2 live retry execution NOT AUTHORIZED`; `explicit R6.5.2 retry approval NOT RECEIVED`; `current recovery transaction root REQUIRED / MUST REMAIN`; `B8-A7 sustained runtime authorization WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED`; `B8-A7 sustained runtime window NOT AUTHORIZED`; `B8-B removal NOT AUTHORIZED`.

## B8-A7-R6.1 Personal Deployment Read-Only Baseline

The active R6.1 audit is [`smoke-tests/personal-deployment-read-only-baseline.md`](smoke-tests/personal-deployment-read-only-baseline.md). It is the first executable evidence step under the personal profile, but it remains read-only with respect to OpenClaw configuration, installed plugin files, Gateway process state, native dependencies, databases, and activation state.

R6.1 correlates:

```text
reviewed repository identity
OpenClaw CLI and live Gateway process identity
cold memory-engine and active-memory inspection
current installed runtime root
source/runtime parity and build identity
Gateway Node/native module ABI compatibility
live effective Hybrid configuration
active-memory effective state
current loaded Gateway method registration
runtime preflight when already available
tests and A5 fail-closed smoke
```

The allowed decision is only `BASELINE READY FOR SEPARATE MUTATION AUTHORIZATION` or `BASELINE BLOCKED`. Readiness does not authorize a config patch, backup, install/synchronization, native rebuild, plugin reload, Gateway restart, AutoRecall activation, production evidence, or an evidence epoch.

Current R6.1 state: `B8-A7-R6.1 read-only baseline execution PASSED`; `B8-A7-R6.1 baseline decision BASELINE BLOCKED`; `B8-A7-R6.2 host activation boundary compatibility PASSED / CLOSED`; `B8-A7-R6.3 runtime-remediation authorization design PASSED / CLOSED`; `B8-A7-R6.4 offline candidate and rollback rehearsal PASSED / CLOSED`; `B8-A7-R6.5 authorization packet PASSED / CLOSED`; `B8-A7-R6.5 live remediation execution ROLLED BACK / SAFE`; `B8-A7-R6.5.1 config semantic equivalence repair PASSED / CLOSED`; `B8-A7-R6.5.2 live remediation retry authorization packet PASSED / CLOSED`; `R6.5.2 live retry execution NOT AUTHORIZED`; `current recovery transaction root REQUIRED / MUST REMAIN`; `B8-A7 sustained runtime authorization WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED`; `B8-B removal NOT AUTHORIZED`.

## B8-A7-R6.3 Personal Runtime Remediation Authorization Design

The active R6.3 contract is [`smoke-tests/personal-runtime-remediation-authorization.md`](smoke-tests/personal-runtime-remediation-authorization.md), with the current synchronization boundary summarized in [`runtime-sync.md`](runtime-sync.md).

R6.3 rejects four unsafe shortcuts:

```text
direct openclaw plugins install . --force from the 938 MB development tree
direct npm archive install under OpenClaw --ignore-scripts dependency handling
linked source runtime
CLI-local plugins inspect --runtime
```

The selected deployment model is:

```text
npm-pack source archive
+ exact reviewed package-lock.json
+ isolated Node 24 npm ci --omit=dev with reviewed lifecycle scripts
+ native :memory:/disposable smoke
+ source/candidate parity=0
+ dependency-complete local candidate
+ separately authorized stopped-Gateway install
```

The later transaction must bind C0 exact config, R0 exact current runtime, H0 host state, and D0 quiesced memory-engine/LanceDB snapshots. Post-start acceptance requires installed parity zero, Gateway Node 24 / ABI 137, clean runtime preflight, registered operator methods and three memory-engine tools, active-memory disabled by effective host policy, safe Hybrid configuration, full tests, and A5 smoke 10/10.

R6.3 did not authorize live mutation. R6.4 subsequently exercised the build and rollback contract only under `/tmp` and an isolated OpenClaw state. R6.5 remains the separate live execution authorization.

Current R6.3 state: `B8-A7-R6.2 host activation boundary compatibility PASSED / CLOSED`; `B8-A7-R6.3 runtime-remediation authorization design PASSED / CLOSED`; `B8-A7-R6.4 offline candidate and rollback rehearsal PASSED / CLOSED`; `B8-A7-R6.5 authorization packet PASSED / CLOSED`; `B8-A7-R6.5 live remediation execution ROLLED BACK / SAFE`; `B8-A7-R6.5.1 config semantic equivalence repair PASSED / CLOSED`; `B8-A7-R6.5.2 live remediation retry authorization packet PASSED / CLOSED`; `R6.5.2 live retry execution NOT AUTHORIZED`; `offline candidate artifact VALIDATED / FROZEN / EPHEMERAL`; `current recovery transaction root REQUIRED / MUST REMAIN`; `B8-A7 sustained runtime authorization WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED`; `B8-B removal NOT AUTHORIZED`.

## B8-A7-R6.4 Offline Candidate and Rollback Rehearsal

The R6.4 decision is [`smoke-tests/personal-runtime-candidate-rehearsal-decision-20260721.md`](smoke-tests/personal-runtime-candidate-rehearsal-decision-20260721.md).

The artifact root `/tmp/memory-engine-r6.4-9b6b734` was mode `0700` and contained a Node 24 dependency-complete candidate, independent C0 and R0 rehearsal copies, reduced parity evidence, and an isolated OpenClaw state. The source archive excluded `.git` and inherited `node_modules`; the exact reviewed lockfile was restored before `npm ci`.

Canonical candidate evidence:

```text
reviewed_head=9b6b734f321b5708e621cdd7a6dba92a5dd0e036
archive_sha256=acbc27b55d0863fbff5dada85eec40993186012802eaba1a1291e132d194697b
candidate_build_identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
candidate_tree_sha256=5692d954c92b3dc3f10c0c645b14e71632abfe4346120461c409ad6c70bdb224
source_runtime_equal=true
difference_count=0
Node=v24.8.0
NODE_MODULE_VERSION=137
better-sqlite3=11.10.0
@lancedb/lancedb=0.29.0
SQLite native smoke=pass
LanceDB disposable smoke=pass
candidate writable files=0
candidate writable directories=0
```

C0 and R0 rehearsal evidence:

```text
C0 byte equality=true
C0 separate inode=true
C0 sha256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a
R0 source/backup shared regular-file inodes=0
R0 full-tree diff=none
R0 tree sha256=6da85f45dc433fe2874a8eaf0299643886d5825ff64910af9367195da3d1cdc9
R0 runtime identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
R0 Node 24 native smoke=pass
```

An isolated OpenClaw `2026.6.9` transaction proved candidate install, R0 rollback install, and frozen-candidate reinstallation with parity zero after each transition. Real configuration hash `da9e443…6f2a`, Gateway PID `676`, and Gateway start timestamp remained unchanged.

R6.4 added two live-execution constraints. First, `plugins install` imports memory-engine during validation and can initialize the selected state directory's engine SQLite and LanceDB; R6.5 must create D0 before install and compare pre/post-install data identities before Gateway start. Second, install and verification must run from a stable cwd outside any replaced runtime; otherwise a successful replacement can leave the next CLI process with `uv_cwd ENOENT`.

The `/tmp` candidate is ephemeral. Its path or filename alone is never sufficient evidence. R6.5 must reverify every hash and identity or rebuild the artifact under the same contract.

Current R6.4 state: `B8-A7-R6.4 offline candidate and rollback rehearsal PASSED / CLOSED`; `offline candidate artifact VALIDATED / FROZEN / EPHEMERAL`; `B8-A7-R6.5 authorization packet PASSED / CLOSED`; `B8-A7-R6.5 live remediation execution ROLLED BACK / SAFE`; `candidate Gateway activation NOT REACHED`; `fresh R0/C0 rollback PASS`; `D0 restoration NOT REQUIRED`; `B8-A7-R6.5.1 config semantic equivalence repair PASSED / CLOSED`; `B8-A7-R6.5.2 live remediation retry authorization packet PASSED / CLOSED`; `R6.5.2 live retry execution NOT AUTHORIZED`; `current recovery transaction root REQUIRED / MUST REMAIN`; `B8-A7 sustained runtime authorization WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED`; `B8-B removal NOT AUTHORIZED`.

## B8-A7-R6.5 Live Runtime Remediation Authorization Packet

The R6.5 packet is [`smoke-tests/personal-runtime-live-remediation-authorization-20260721.md`](smoke-tests/personal-runtime-live-remediation-authorization-20260721.md).

It replaces the undocumented historical candidate tree hash with a reproducible artifact contract:

```text
serialization=memory-engine-runtime-artifact-manifest-v1
candidate artifact identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42
candidate runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
R0 rehearsal artifact identity=bf0e9b53ce7e712d2a34f2ffc3584aa86c55f8c8a9e6a90e5160e9d5f3cde78e
```

The packet requires fresh C0 and R0 before stop, a quiesced D0 after stop, stable-cwd Node 24 commands, pre/post-install memory-data manifest equality, installed parity zero, native ABI verification, Gateway runtime preflight, the two operator methods, the three memory-engine tools, full tests, and A5 smoke 10/10.

The exact operator authorization was received and the live transaction executed. The canonical decision is [`smoke-tests/personal-runtime-live-remediation-decision-20260721.md`](smoke-tests/personal-runtime-live-remediation-decision-20260721.md).

Candidate installation, source/installed parity, Node 24 native dependency checks, and the engine/LanceDB D_PRE/D_POST identity gates passed while the Gateway was stopped. The exact-byte config gate then detected OpenClaw's host bookkeeping update at `meta.lastTouchedAt` and invoked rollback before candidate Gateway activation.

Rollback reinstalled fresh R0, restored exact C0, preserved engine and LanceDB identities without D0 restoration, and restarted the old runtime as Gateway PID `275493`. RPC health, active-memory disablement, safe Hybrid state, and A5 smoke 10/10 passed.

R6.5.1 adds `memory-engine-config-semantic-equivalence-v1`. It approves only a canonical, monotonic `meta.lastTouchedAt` update when that is the sole changed JSON path; every other config difference remains fail closed and raw config values are not emitted. Independent EDI verification passed with 52/52 focused tests, static check over 529 files, the full suite at 1781 passed / 0 failed / 8 skipped, A5 smoke 10/10, and a clean worktree. No retry is authorized.

Current R6.5 state: `B8-A7-R6.5 authorization packet PASSED / CLOSED`; `B8-A7-R6.5 live remediation execution ROLLED BACK / SAFE`; `candidate Gateway activation NOT REACHED`; `old runtime restored TRUE`; `configuration restored to exact C0 TRUE`; `memory data restored from D0 FALSE / NOT REQUIRED`; `B8-A7-R6.5.1 config semantic equivalence repair PASSED / CLOSED`; `B8-A7-R6.5.2 live remediation retry authorization packet PASSED / CLOSED`; `R6.5.2 live retry execution NOT AUTHORIZED`; `explicit R6.5.2 retry approval NOT RECEIVED`; `fresh R6.5.2 C0/R0/H0/D0 NOT CREATED`; `current recovery transaction root REQUIRED / MUST REMAIN`; `B8-A7 sustained runtime authorization WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED`; `B8-B removal NOT AUTHORIZED`.

## B8-A7-R6.5.2 Live Runtime Remediation Retry Authorization

The retry packet is [`smoke-tests/personal-runtime-live-remediation-retry-authorization-20260721.md`](smoke-tests/personal-runtime-live-remediation-retry-authorization-20260721.md).

Read-only revalidation after commit `6310673` confirmed source/candidate parity zero at runtime identity `dc459f5…d718`, candidate artifact identity `0490e607…44f42`, active runtime/current recovery R0 parity zero at identity `86d04dd7…f1f1`, and a healthy Node 24 Gateway. The current install record still points to `/tmp/memory-engine-r6.5-live-2415dfe/runtime/r0`, so that transaction root remains required recovery authority.

The packet requires a new retry transaction root, fresh C0/R0/H0/D0, `memory-engine-config-semantic-equivalence-v1`, install-time data identity equality, bounded Gateway readiness, loaded A7.4 methods, all three memory-engine tools, full tests, A5 smoke 10/10, and retry-specific rollback. The original R6.5 approval and prior transaction artifacts cannot authorize the retry.

Current R6.5.2 state: `B8-A7-R6.5.2 live remediation retry authorization packet PASSED / CLOSED`; `B8-A7-R6.5.2 live retry execution BLOCKED / NO MUTATION`; `R6.5.2 retry authorization CONSUMED / NOT REUSABLE`; `fresh R6.5.2 C0/R0/H0/D0 NOT CREATED`; `current recovery transaction root ABSENT / REBASE REQUIRED`; `offline candidate artifact ABSENT / REBUILD REQUIRED`; `installed-plugin recovery sourcePath DANGLING`; `B8-A7-R6.5.3 persistent artifact rebuild/recovery-source rebase design IMPLEMENTED / EDI VERIFICATION PENDING`; `R6.5.3A persistent artifact preparation NOT AUTHORIZED`; `R6.5.3B recovery-source rebase execution NOT AUTHORIZED`; `R6.5.3 candidate activation NOT AUTHORIZED`; `persistent authority root NOT CREATED`; `B8-A7 sustained runtime authorization WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED`; `B8-B removal NOT AUTHORIZED`.

## B8-A7-R6.5.3 Persistent Artifact Rebuild and Recovery-Source Rebase Design

The design is [`smoke-tests/personal-runtime-persistent-artifact-rebase-design-20260721.md`](smoke-tests/personal-runtime-persistent-artifact-rebase-design-20260721.md).

It restores the R6.3 durable-root principle under `$HOME/.openclaw/backups/memory-engine/r6.5.3/<UTC-run-id>`, rejects recreating or symlinking the vanished `/tmp` paths, and requires atomic publication with canonical candidate and R0 manifests. R6.5.3A may later build a persistent candidate and an exact active-runtime R0 without touching the Gateway. R6.5.3B is a separate live transaction that installs only the identical persistent R0 to repair the installed sourcePath. Candidate activation remains a later independently authorized stage.

Current R6.5.3 state: `B8-A7-R6.5.3 persistent artifact rebuild/recovery-source rebase design IMPLEMENTED / EDI VERIFICATION PENDING`; `R6.5.3A persistent artifact preparation NOT AUTHORIZED`; `R6.5.3B recovery-source rebase execution NOT AUTHORIZED`; `R6.5.3 candidate activation NOT AUTHORIZED`; `persistent authority root NOT CREATED`; `persistent candidate NOT CREATED`; `persistent R0 NOT CREATED`; `Gateway stop/start/restart NOT AUTHORIZED`; `B8-A7 sustained runtime authorization WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED`; `B8-B removal NOT AUTHORIZED`.

Historical A7.2 review state: implementation checkpoint `59a4f3e` was `IMPLEMENTED / REVIEW CHANGES REQUIRED`; checkpoint `eec0f91` closed the four main origin/continuity findings but remained review-pending for TTL cleanup ordering and primitive thresholds JSON. Checkpoint `47389d3` closed those final findings.

The historical reviews required that zero threshold overrides could not bypass readiness and that post-TTL identifier reuse could not be mislabeled as collision; both requirements are now satisfied.

Historical ledger states `REVIEW FIXES IMPLEMENTED / THIRD REVIEW CHANGES REQUIRED`, `B8-A7.1 third review changes required`, and `FINAL REVIEW FIXES IMPLEMENTED / REVIEW PENDING` remain review history rather than current authorization state.

Do not remove legacy fallback code or start B8-B merely because the controlled Stage 4 rerun passed. B8-B remains unauthorized until one governed evidence epoch reaches the approved continuity and origin requirements, at least 30 days, 500 canonical production observations, and 100 qualifying observations per production surface with zero fallback, invalid-provenance, schema, channel, identity, origin, and marker violations, plus a tested post-removal rollback strategy, complete legacy code inventory, and explicit removal-gate approval.

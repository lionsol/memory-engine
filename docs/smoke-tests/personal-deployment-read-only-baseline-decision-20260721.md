# B8-A7-R6.1 Personal Deployment Read-Only Baseline Decision — 2026-07-21

> **Decision: BASELINE BLOCKED**
>
> Clean evidence window: `2026-07-21T07:54:43.635Z` through `2026-07-21T07:55:54.668Z`
>
> Reviewed source: `16b912fb89a742f702a1912bd6cdbf5eff0c7194`

## Scope

This decision applies the current personal-deployment safety profile and the R6.1 read-only baseline contract.

It does not authorize or perform:

```text
OpenClaw configuration mutation
configuration backup or restoration
plugin installation, synchronization, update, or reload
Gateway restart
native dependency rebuild
AutoRecall activation
automatic reinforcement activation
KG or Recent full-mode activation
production evidence activation
scheduler or cron creation
sustained runtime epoch creation
rollback execution
B8-B removal
push, tag, or release
```

## Decision Summary

The current environment is not ready for a separate mutation-authorization decision.

The Gateway is healthy, memory-engine is loaded by the live Node 24 Gateway, active-memory is disabled by the host plugin allowlist, the effective Hybrid configuration is safe, repository verification is green, and the clean R6.1 evidence window produced no observable core DB, engine DB, WAL/SHM, LanceDB, Gateway-process, config-file, or installed-runtime mutation.

Authorization remains blocked because:

```text
source/runtime parity=false with 28 differences
installed runtime lacks the A7.4 Gateway methods
memory-engine active-memory boundary tooling does not model plugins.allow
cold host activation and local boundary-report evidence disagree
loaded Gateway tool registration was not independently enumerated
```

The active-memory disagreement is a memory-engine audit-tool defect, not evidence that active-memory is currently running. OpenClaw 2026.6.9 cold inspection reports `active-memory` disabled with reason `not in allowlist`, and the live configuration has a non-empty `plugins.allow` that excludes `active-memory`.

## Repository Identity

```text
reviewed_head=16b912fb89a742f702a1912bd6cdbf5eff0c7194
reviewed_worktree_clean=true
branch=main
branch_ahead_of_origin=126
repository_node_version=v24.8.0
repository_node_module_version=137
```

The reviewed worktree remained clean throughout the clean evidence window.

## OpenClaw CLI and Gateway Identity

```text
openclaw_version=2026.6.9
openclaw_build=c645ec4
cli_entrypoint=/home/lionsol/.local/bin/openclaw
cli_node=/usr/bin/node
cli_node_version=v22.22.2
cli_node_module_version=127

gateway_service=openclaw-gateway.service
gateway_pid=676
gateway_node=/home/lionsol/.local/node24/bin/node
gateway_node_version=v24.8.0
gateway_node_module_version=137
gateway_openclaw_entry=/home/lionsol/.local/lib/node_modules/openclaw/dist/index.js
gateway_port=18789
gateway_health=healthy
gateway_rpc=connected
gateway_version=2026.6.9
```

The Gateway PID, start timestamp, active state, and command were unchanged across the clean evidence window.

The CLI and Gateway intentionally use different Node runtimes. This makes `openclaw plugins inspect memory-engine --runtime` unsuitable for this baseline because it imports the plugin into the Node 22 CLI process rather than querying the already-running Node 24 Gateway.

A pre-window exploratory call to that command attempted memory-engine initialization in the CLI process and failed because the installed native module was compiled for ABI 137 while the CLI required ABI 127. That exploratory call is excluded from the clean evidence window. R6.1 must not use `plugins inspect --runtime` in future runs.

## Configuration Identity

```text
config_path=/home/lionsol/.openclaw/openclaw.json
config_exists=true
config_valid=true
config_bytes=22802
config_mode=600
config_sha256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a
rollout_config_fingerprint=502802868b51ee459691729b99c00a94d2c91081334952f32a743dbd18e1c79f
```

No raw configuration contents, secrets, tokens, or unrelated environment values are recorded in this decision.

## Cold Plugin Evidence

### memory-engine

```text
id=memory-engine
version=0.8.22
root=/home/lionsol/.openclaw/extensions/memory-engine
source=/home/lionsol/.openclaw/extensions/memory-engine/index.js
origin=global
enabled=true
explicitly_enabled=true
activated=true
activation_source=explicit
activation_reason=enabled in config
status=loaded
cold_contract_tools=memory_engine,memory_engine_search,memory_engine_get
```

### active-memory

```text
id=active-memory
version=2026.6.9
origin=bundled
enabled=false
explicitly_enabled=false
activated=false
activation_source=disabled
activation_reason=not in allowlist
status=disabled
```

The live configuration has a non-empty `plugins.allow` containing `memory-engine` and excluding `active-memory`.

OpenClaw 2026.6.9 resolves activation in this order:

```text
global plugin disable
denylist
entry enabled=false
workspace defaults and selected slots
non-empty allowlist exclusion
explicit activation
auto/default activation
```

A bundled plugin excluded from a non-empty allowlist is disabled before bundled default enablement is considered.

## Loaded Gateway Evidence

The live Gateway log records:

```text
runtime=node v24.8.0
memory-engine included in the 10 loaded Gateway plugins
memory-engine LanceDB initialization completed during Gateway startup
```

This proves that the current Node 24 Gateway loaded the installed memory-engine runtime.

The installed runtime does not contain any `memoryEngine.*` Gateway method registration source. A direct operator-read RPC call returned:

```text
memoryEngine.sustainedRuntimePreflight=unknown method
```

The scheduled `memoryEngine.productionEvidenceHealthcheck` method was not invoked. Its installed source is also absent.

The OpenClaw `tools.catalog` RPC could not be used in this execution environment because the platform safety layer blocked the call. Cold contracts list the three expected memory-engine tools, but their actual loaded Gateway registration was not independently enumerated during R6.1. This remains an evidence gap.

## Runtime/Source Parity

```text
source_runtime_equal=false
difference_count=28
source_file_count=148
runtime_file_count=128
source_identity_valid=true
runtime_identity_valid=true
source_build_identity=603166468aa31c673b998278212590dbe8fc0bf863f8d09124a484513010ea27
runtime_build_identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
```

The differences include:

```text
index.js content mismatch
openclaw.plugin.json content mismatch
package.json content mismatch
Hybrid Search and observation code mismatches
missing effective runtime config module
missing runtime build identity and parity modules
missing sustained-runtime preflight and healthcheck modules
missing continuity, epoch, health-monitor, authorization, backup, and rollback modules
```

This is a hard blocker. The installed runtime is not the reviewed source closure.

## Native ABI Evidence

```text
installed_better_sqlite3_version=11.10.0
installed_native_binary_path=/home/lionsol/.openclaw/extensions/memory-engine/node_modules/better-sqlite3/build/Release/better_sqlite3.node
installed_native_binary_expected_abi=137
gateway_node_module_version=137
cli_node_module_version=127
```

The expected ABI 137 is established by the Node 22 loader error, which reports that the installed binary was compiled for `NODE_MODULE_VERSION 137`. The live Gateway uses ABI 137 and loaded memory-engine without an extension-native ABI error during startup.

Interpretation:

```text
gateway_native_abi_compatible=supported by correlated evidence
cli_local_runtime_inspect_compatible=false
direct_native_binary_probe=not recorded because the platform safety layer blocked it
```

The Node 22 CLI mismatch is not a Gateway ABI blocker. It is a reason not to use CLI-local runtime import as Gateway evidence.

A separate `Memory Daily Stats` cron failure referenced a different workspace-level `better-sqlite3` path. That is outside the installed memory-engine extension ABI decision and requires separate operator review; it is not evidence that the Gateway extension binary is incompatible.

## Effective Hybrid Configuration

```text
effective_config_valid=true
auto_recall_enabled=false
auto_recall_top_k=3
auto_recall_timeout_ms=8000
kg_fail_closed_mode=legacy_fallback
recent_fail_closed_mode=legacy_fallback
production_evidence_enabled=false
evidence_epoch_present=false
```

The high-risk feature state is safe.

## Active-Memory Boundary Disagreement

The current repository boundary report returned:

```text
status=conflict
active_memory_enabled=true
resolution=enabled_by_active_memory_runtime_default
entry_present=false
blocker=active_memory_enabled
```

That result is inconsistent with current OpenClaw 2026.6.9 activation behavior because the resolver examines only `plugins.entries.active-memory` and ignores:

```text
plugins.enabled
plugins.allow
plugins.deny
bundled origin and default enablement ordering
```

The authoritative operator-facing cold result is:

```text
active_memory_enabled=false
activation_reason=not in allowlist
```

R6.1 therefore records:

```text
active_memory_actual_host_state=disabled
active_memory_boundary_report=invalid for current host semantics
cold_boundary_evidence_consistent=false
```

No configuration patch is justified merely to satisfy the outdated resolver. The resolver contract must be repaired first.

## Clean Evidence Window Integrity

The clean evidence window began after the rejected CLI-local runtime-inspection route had been excluded.

During the clean window, R6.1 executed only:

```text
Gateway status
cold plugin inspection without --runtime
source/runtime parity hashing
reduced effective-config report
reduced active-memory boundary report
operator-read preflight RPC
filesystem metadata comparison
```

The following remained unchanged before and after:

```text
Gateway PID and start timestamp
OpenClaw core SQLite file size, mtime, inode, and mode
OpenClaw core WAL/SHM size, mtime, inode, and mode
memory-engine SQLite file size, mtime, inode, and mode
memory-engine WAL/SHM size, mtime, inode, and mode
LanceDB file count=2842
LanceDB total bytes=71486017
LanceDB latest file identities and mtimes
reviewed Git worktree
```

Result:

```text
clean_window_observable_memory_mutation=false
clean_window_gateway_restart=false
clean_window_config_mutation=false
clean_window_runtime_mutation=false
```

## Repository Verification

```text
static_check=pass
static_check_file_count=519
full_suite=pass
full_suite_failures=0
full_fail_closed_safety_smoke=10/10 pass
```

The A5 smoke used synthetic in-memory SQLite only and did not access the real databases, reload the plugin, modify config, use the network, write runtime reports, or remove legacy code.

## Blocking Findings

### B1: Installed runtime drift

```text
source_runtime_equal=false
difference_count=28
```

The runtime cannot be authorized until an exact reviewed installation produces zero differences.

### B2: Missing loaded-runtime operator methods

```text
memoryEngine.sustainedRuntimePreflight=missing
memoryEngine.productionEvidenceHealthcheck=missing from installed source
```

The installed runtime predates the reviewed A7.4 implementation.

### B3: Active-memory boundary resolver is stale

The repository resolver does not model the current OpenClaw plugin allowlist and denylist activation contract. It emits a false conflict for the current configuration.

### B4: Loaded tool registration evidence incomplete

The Gateway log proves memory-engine loaded, and cold contracts list the expected tools, but the actual loaded tool catalog was not independently captured in this environment.

## Non-Blocking Findings

```text
Gateway health=pass
Gateway ABI alignment=supported by correlated evidence
memory-engine Gateway load=pass
active-memory host activation=disabled by non-empty allowlist
AutoRecall=disabled
KG/Recent=legacy_fallback
production evidence=disabled
evidence epoch=absent
repository verification=pass
A5 smoke=pass
clean-window observable mutation=none
```

## Required Next Sequence

### R6.2: Repair host activation boundary compatibility

Before any runtime mutation authorization:

```text
model plugins.enabled
model plugins.deny
model non-empty plugins.allow exclusion
preserve explicit entry enabled=false
preserve active-memory plugin config enabled=false where supported
apply bundled default enablement only after allowlist exclusion
return an auditable activation reason
add tests for current OpenClaw 2026.6.9 semantics
update personal profile wording to accept explicit host-policy disablement
```

R6.2 is a source and test change only. It must not modify the active OpenClaw environment.

### R6.3: Separate runtime-remediation authorization

Only after R6.2 is reviewed and committed may a later decision prepare:

```text
exact config and runtime recovery artifacts
exact reviewed source commit
Gateway Node 24 installation path
supported plugin installation/synchronization command
reload or restart procedure
post-install parity=zero requirement
loaded preflight and healthcheck method verification
loaded tool catalog verification
rollback procedure
```

That later decision remains separate from execution.

## Final Decision

```text
B8-A7-R6 personal deployment safety profile=PASSED / CLOSED
B8-A7-R6.1 read-only baseline execution=PASSED
B8-A7-R6.1 baseline decision=BASELINE BLOCKED
B8-A7-R6.2 host activation boundary compatibility=REQUIRED / NOT STARTED
configuration mutation=NOT AUTHORIZED
plugin install/reload=NOT AUTHORIZED
Gateway restart=NOT AUTHORIZED
native dependency rebuild=NOT AUTHORIZED
AutoRecall activation=NOT AUTHORIZED
production evidence activation=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

## Post-Decision R6.2 Follow-Up

The baseline decision above remains the historical R6.1 result. R6.2 was subsequently implemented in reviewed source without changing the active OpenClaw environment.

At `2026-07-21T08:10:56.000Z`, the updated read-only resolver returned:

```text
status=clean
active_memory_enabled=false
active_memory_resolution=disabled_by_plugins_allowlist
active_memory_allowlist_configured=true
active_memory_allowlisted=false
blockers=[]
```

Current follow-up state:

```text
B8-A7-R6.2 host activation boundary compatibility=PASSED / CLOSED
B8-A7-R6.3 runtime-remediation authorization design=PASSED / CLOSED
B8-A7-R6.4 offline candidate and rollback rehearsal=PASSED / CLOSED
B8-A7-R6.5 live remediation execution authorization packet=PASSED / CLOSED
B8-A7-R6.5 live remediation execution=ROLLED BACK / SAFE
candidate Gateway activation=NOT REACHED
old runtime restored=TRUE
configuration restored to exact C0=TRUE
memory data restored from D0=FALSE / NOT REQUIRED
B8-A7-R6.5.1 config semantic equivalence repair=PASSED / CLOSED
R6.5 live retry=NOT AUTHORIZED
explicit retry approval=NOT RECEIVED
offline candidate artifact=VALIDATED / FROZEN / EPHEMERAL
live retry configuration mutation=NOT AUTHORIZED
live retry plugin install/reload=NOT AUTHORIZED
live retry Gateway stop/start/restart=NOT AUTHORIZED
fresh retry D0 snapshot=NOT CREATED
```

The R6.3 design is [`personal-runtime-remediation-authorization.md`](personal-runtime-remediation-authorization.md). The completed R6.4 rehearsal is [`personal-runtime-candidate-rehearsal-decision-20260721.md`](personal-runtime-candidate-rehearsal-decision-20260721.md). The R6.5 execution and safe rollback are recorded in [`personal-runtime-live-remediation-decision-20260721.md`](personal-runtime-live-remediation-decision-20260721.md); candidate Gateway activation was not reached, so the installed-runtime blockers remain unresolved.

R6.1 remains `BASELINE BLOCKED` because installed runtime parity and loaded A7.4 method blockers remain unresolved.

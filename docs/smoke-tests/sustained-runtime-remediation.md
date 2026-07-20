# B8-A7-R1 Sustained Runtime Remediation

> **B8-A7-R1 remediation procedure=FINAL REVIEW FIX IMPLEMENTED / EDI VERIFICATION PENDING**
>
> **B8-A7 sustained runtime authorization=WITHHELD / REMEDIATION REQUIRED**
>
> **B8-A7 sustained runtime window=NOT AUTHORIZED**
>
> **B8-B removal=NOT AUTHORIZED**

## Purpose and Boundary

This is the operator-owned remediation plan for the 2026-07-20 sustained-runtime authorization findings. It defines read-only checks, separately approved host actions, and fail-closed verification gates. It is not an authorization to activate A7.

This phase does not change OpenClaw configuration, install or reload the plugin, rebuild native dependencies, access either database, create a scheduler, enable an evidence epoch, generate production traffic, or remove legacy fallback code. No step is complete until EDI verifies the resulting evidence.

Known blockers are recorded in [the 2026-07-20 authorization decision](sustained-runtime-authorization-decision-20260720.md): source/runtime parity is non-zero, A7.4 methods are missing from the installed runtime, CLI and native dependency ABIs differ, `active-memory` is effectively enabled, the natural traffic forecast is not ready, and AutoRecall product health is not evaluated.

## Phase 0: Capture Baseline

Run these commands read-only from the reviewed checkout in the original operator environment. Do not modify `PATH` before collecting the CLI identity, and do not infer gateway identity from the interactive shell's `node --version`.

```bash
cd /home/lionsol/.openclaw/workspace/plugins/memory-engine
git rev-parse HEAD
git status --short --branch
git rev-parse --show-toplevel
command -v openclaw
readlink -f "$(command -v openclaw)"
openclaw plugins inspect memory-engine --runtime --json
openclaw config file
```

Record separately, with provenance and timestamps:

* reviewed source root and fixed reviewed commit;
* installed runtime root from `openclaw plugins inspect memory-engine --runtime --json`;
* the resolved `openclaw` executable, its startup method, and the CLI Node executable, Node version, and `process.versions.modules`;
* gateway/service executable, startup method, Node executable, Node version, and ABI from the actual service process or service definition;
* installed `better-sqlite3` ABI;
* source/runtime parity, source and runtime build identities, and file counts;
* effective memory-engine configuration and the active-memory boundary report;
* whether AutoRecall, KG/Recent full mode, production evidence, an epoch, or a scheduler is active.

Do not put raw configuration, secrets, database contents, prompts, or full process environments into the repository or an audit report. The original shell's `node` identity is not evidence for either the CLI or gateway.

## Phase 1: ABI Decision Gate

Identify all three independent identities before choosing a remediation method:

```text
OpenClaw CLI Node/ABI
OpenClaw gateway Node/ABI
installed native dependency Node/ABI
```

The only supported state is:

```text
CLI ABI = gateway ABI = installed native dependency ABI
```

Do not preselect Node 22 or Node 24. Only after the three identities are captured may the operator select the Node executable actually used by the gateway for an approved installation from the fixed reviewed source commit. `npm rebuild` and `npm install` are not default fixes; do not rebuild in place in the installed runtime.

Any exceptional rebuild requires separate written authorization naming the target directory, Node executable, ABI, lockfile/dependency integrity checks, proof that artifacts came from reviewed source, and rollback. An ABI mismatch is an immediate stop.

## Phase 2: C0 Original Configuration Checkpoint

Obtain and record the authoritative live-config path identity from OpenClaw:

```bash
CONFIG_PATH="$(openclaw config file)"
```

C0 is the independent checkpoint of the original pre-remediation configuration. Before any approved configuration action, create an independent ordinary-file backup at a distinct backup path. The live config, C0, and later C1 paths must all be different, and their inodes must all be different. C0 must not be a symlink or hardlink, must be owner-only readable, and must preserve the exact original bytes. Record only the authoritative live path identity, backup path, SHA-256, byte count, permissions, inode identity, and UTC timestamp. Do not overwrite the live config to create a backup, and do not copy configuration contents or secrets into this repository.

The gate is not satisfied by a path-only snapshot or a generated merge patch. Verify separate regular-file identity, distinct path and inode, link count, ownership, byte hash, size, and permissions. C0 must continue to match the original pre-remediation live configuration and remain available until remediation is closed or explicitly abandoned.

## Phase 3: C1 Safe Configuration Checkpoint

Confirm the effective configuration path and schema semantics for `active-memory` before preparing a minimal patch; the runbook must not guess the configuration path. Apply no other configuration change. C1 is an independent backup of the post-patch live configuration. It is bound to the same authoritative live-config path identity, but it must be stored at a distinct backup path with an inode distinct from both the live file and C0. The live config, C0, and C1 paths must remain different. C1 must not be a symlink or hardlink and must record its path, SHA-256, byte count, permissions, inode identity, and UTC timestamp with the same ownership and byte-identity checks as C0.

The only intended semantic difference between C0 and C1 is:

```text
active-memory effective enabled=false
```

Use a reduced/sanitized semantic diff to prove that C0 and C1 differ only in the explicit active-memory disablement. It must not include raw configuration contents, secrets, tokens, environment variables, or unrelated values. It may contain normalized configuration paths, boolean states, change counts, and verification results. The effective configuration path and semantics must be confirmed from the OpenClaw schema/runtime before execution, not guessed by this runbook. The minimum evidence is:

```text
changed_semantic_path_count=1
active_memory_effective_enabled_before=true
active_memory_effective_enabled_after=false
unrelated_semantic_change_count=0
```

C1 must exactly match the live configuration after the approved active-memory disable patch; C0 must continue to exactly match the original pre-remediation configuration.

After approved application, the boundary report must prove:

```text
status=clean
active_memory_enabled=false
blockers=[]
```

If active-memory remains enabled or unrelated configuration changes appear, stop before installation and restore C0. Restoring C0 may return active-memory to its original enabled state; that is a configuration-remediation failure, not a clean boundary, and `B8-A7 authorization remains WITHHELD`.

## Phase 4: Prior Runtime Recovery Gate

Before installing or reloading reviewed source, establish one recoverable source for the currently installed runtime. One of the following must be proven:

### Immutable source recovery

* a historical Git commit matches the installed runtime build identity;
* the commit, runtime build identity, lockfile identity, and supported installation method are recorded;
* the old runtime can be regenerated through the supported installation path.

### Independent runtime rollback artifact

* the artifact is created outside the repository and bound to the original install path;
* archive/hash, file count, runtime build identity, Node ABI, and package/lock identity are recorded;
* it excludes configuration, databases, logs, and secrets;
* reviewed restore and integrity-verification steps exist;
* recovery does not rely on the current installed directory continuing to exist in place.

If neither recovery source is valid:

```text
install/reload=NOT AUTHORIZED
```

## Phase 5: Install the Reviewed Source

The reviewed source is the fixed commit captured in Phase 0. Use the supported OpenClaw/plugin installation path under the selected gateway Node runtime; do not hand-copy files or mix source and installed-runtime trees. This runbook does not perform installation or reload.

After separately authorized install/reload, require:

```text
source_runtime_equal=true
difference_count=0
source_build_identity=runtime_build_identity
```

The installed runtime must include the A7.4 preflight and scheduled-healthcheck gateway methods. Any missing method, unexpected file, parity difference, or identity mismatch is a stop condition.

## Phase 6: Preserve the Safe Initial Configuration

The effective configuration must remain:

```text
autoRecall.enabled=false
kgFailClosedMode=legacy_fallback
recentFailClosedMode=legacy_fallback
productionEvidenceWindow disabled or absent
no evidence epoch
no scheduler or cron
```

Full fail-closed, sustained AutoRecall, production evidence, an epoch, or scheduled healthcheck must not be enabled as remediation. Unexpected activation requires immediate stop and backup restore.

## Phase 7: Loaded-Runtime Preflight Only

After reviewed install, verify these operator-read gateway methods are registered:

```text
memoryEngine.sustainedRuntimePreflight
memoryEngine.productionEvidenceHealthcheck
```

Only the preflight method may be called in this phase. Do not call the scheduled healthcheck because sustained configuration is not enabled and no traffic should be manufactured.

Preflight is responsible for proving only the loaded-host facts: actual OpenClaw runtime version, live config file path/SHA-256/byte count, installed runtime build identity, effective rollout configuration fingerprint, safe effective configuration, active-memory boundary, AutoRecall disabled, KG/Recent legacy modes, production evidence disabled with no epoch, and no activation state. A method catalog alone is insufficient. Preflight does not independently prove source/runtime parity or host scheduler state.

## Runtime/Source Parity Evidence

The separate runtime/source parity report is responsible for:

```text
source_runtime_equal=true
difference_count=0
source_build_identity=runtime_build_identity
reviewed dependency closure matches
```

Do not claim these facts from preflight alone. The parity report must use the reviewed dependency closure and the same source/runtime identity contract used by the authorization review.

## Host Scheduler Inventory Evidence

The separate host scheduler inventory is responsible for proving that no A7 health monitor, production-evidence scheduler, or related new scheduler/cron is active. It must use controlled read-only checks of:

* the actual OpenClaw scheduler inventory;
* the user systemd timer inventory;
* the user crontab.

The inventory must omit unrelated task bodies, environment variables, prompts, and secrets. Absence of a scheduler is not inferred from preflight or an interactive shell. This remediation phase does not create or invoke any scheduler.

## Phase 8: Rollback and Stop Conditions

Stop if ABI mismatch, plugin initialization/gateway failure, non-zero parity, missing gateway method, active-memory enabled, unapproved config change, unexpected AutoRecall/full/evidence/epoch/scheduler activation, or unhealthy gateway occurs.

### Configuration remediation failure

Restore C0 byte-for-byte. Active-memory may return to its original effective enabled state, but the boundary is not clean and:

```text
B8-A7 authorization remains WITHHELD
```

### Plugin installation or reload failure

Restore the old plugin runtime from the prior runtime recovery source, and retain or restore C1 so active-memory remains explicitly disabled. Verify gateway health and the safe configuration.

### Complete abandonment

If remediation is abandoned, restore C0 and the old plugin runtime. Record that active-memory has returned to its original effective state if applicable; sustained runtime authorization remains withheld.

For every branch:

1. Record the stop reason without secrets.
2. Perform only the branch-specific C0/C1 and runtime restoration described above under operator approval.
3. Verify restored configuration bytes, gateway health, memory-engine tool registration, runtime identity, and the applicable active-memory state.
4. Verify no evidence epoch, full fail-closed activation, sustained runtime, scheduler, or B8-B transition occurred.
5. Record that sustained runtime remains withheld and B8-B remains unauthorized.

Rollback is recovery, not authorization to retry activation.

## Go/No-Go Matrix

| Gate | Required evidence | No-go condition |
|:---|:---|:---|
| Runtime identity | CLI, gateway, and native dependency ABI are equal | Any mismatch or unknown gateway runtime |
| C0/C1 configuration checkpoints | Independent regular owner-only files with exact hash, size, permissions, and reduced diff showing only active-memory disablement | Missing checkpoint, byte mismatch, unsafe link, or unrelated diff |
| Prior runtime recovery | Immutable source recovery or independent rollback artifact with identity, ABI, lock, hash, and restore proof | No valid recovery source; install/reload not authorized |
| Active-memory boundary | `status=clean`, `active_memory_enabled=false`, `blockers=[]` | Enabled or unverified |
| Loaded preflight | Actual host runtime, live config path/hash/bytes, build identity, effective fingerprint, and safe config | Missing, stale, or contradictory report |
| Runtime/source parity | Separate parity report with `source_runtime_equal=true`, `difference_count=0`, matching identity, and dependency closure | Any difference or missing report |
| Host scheduler inventory | Controlled read-only OpenClaw/systemd-user/crontab inventory with no A7 scheduler | Missing, stale, or active scheduler |
| Safe initial config | AutoRecall off, KG/Recent legacy, evidence off/absent, no epoch/scheduler | Any unexpected activation |

All gates are necessary, but passing them does not authorize the sustained window. That requires a separate reviewed decision.

## EDI Handoff

EDI should receive the sanitized baseline manifest, parity report, ABI triad, active-memory boundary report, preflight report, and rollback artifacts. Reports must contain hashes, counts, versions, and statuses, not raw configuration, secrets, database contents, prompts, or manufactured observations.

Repository-only contract check:

```bash
node --test test/sustained-runtime-remediation-contract.test.js
```

## Current Authorization Boundary

```text
B8-A7-R1 remediation procedure=FINAL REVIEW FIX IMPLEMENTED / EDI VERIFICATION PENDING
B8-A7 sustained runtime authorization=WITHHELD / REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

No runbook step changes these states. Do not enable an evidence epoch, sustained AutoRecall, full fail-closed, scheduler, or healthcheck until a later authorization decision explicitly permits it.

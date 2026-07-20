# B8-A7-R1 Sustained Runtime Remediation

> **B8-A7-R1 remediation procedure=IMPLEMENTED / EDI VERIFICATION PENDING**
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

Run these commands read-only from the reviewed checkout. Do not infer gateway identity from the interactive shell's `node --version`.

```bash
export PATH="$HOME/.local/node24/bin:$PATH"
cd /home/lionsol/.openclaw/workspace/plugins/memory-engine
git rev-parse HEAD
git status --short --branch
git rev-parse --show-toplevel
openclaw plugins inspect memory-engine --runtime --json
openclaw config file
```

Record separately, with provenance and timestamps:

* reviewed source root and fixed reviewed commit;
* installed runtime root from `openclaw plugins inspect memory-engine --runtime --json`;
* OpenClaw CLI executable, Node executable, Node version, and `process.versions.modules`;
* gateway/service executable, Node version, and ABI from the actual service process or service definition;
* installed `better-sqlite3` ABI;
* source/runtime parity, source and runtime build identities, and file counts;
* effective memory-engine configuration and the active-memory boundary report;
* whether AutoRecall, KG/Recent full mode, production evidence, an epoch, or a scheduler is active.

Do not put raw configuration, secrets, database contents, prompts, or full process environments into the repository or an audit report.

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

Do not preselect Node 22 or Node 24. Select the Node executable actually used by the gateway, then use that same runtime for an approved installation from the fixed reviewed source commit. `npm rebuild` and `npm install` are not default fixes; do not rebuild in place in the installed runtime.

Any exceptional rebuild requires separate written authorization naming the target directory, Node executable, ABI, lockfile/dependency integrity checks, proof that artifacts came from reviewed source, and rollback. An ABI mismatch is an immediate stop.

## Phase 2: Independent Configuration Backup

Obtain the live path from OpenClaw:

```bash
CONFIG_PATH="$(openclaw config file)"
```

Before any approved configuration action, create an independent ordinary-file backup. It must not be a symlink, hardlink, or alias of the live file, must be owner-only readable, and must preserve the exact original bytes. Record only the live path, backup path, SHA-256, byte count, and UTC timestamp. Do not copy configuration contents or secrets into this repository.

The gate is not satisfied by a path-only snapshot or a generated merge patch. Verify separate regular-file identity, link count, ownership, byte hash, and size. Restoration must copy the exact backup bytes to the original path under operator approval, then recheck hash and gateway health.

## Phase 3: Disable Active-Memory Explicitly

Confirm the effective configuration path and schema semantics for `active-memory` before preparing a patch. The only intended semantic change is:

```text
active-memory effective enabled=false
```

Do not change other plugins, memory slots, tools policy, agents, AutoRecall, KG/Recent modes, canary scopes, evidence settings, or scheduler settings. After approved application, the boundary report must prove:

```text
status=clean
active_memory_enabled=false
blockers=[]
```

If active-memory remains enabled or unrelated configuration changes, stop and restore the independent backup.

## Phase 4: Install the Reviewed Source

The reviewed source is the fixed commit captured in Phase 0. Use the supported OpenClaw/plugin installation path under the selected gateway Node runtime; do not hand-copy files or mix source and installed-runtime trees. This runbook does not perform installation or reload.

After separately authorized install/reload, require:

```text
source_runtime_equal=true
difference_count=0
source_build_identity=runtime_build_identity
```

The installed runtime must include the A7.4 preflight and scheduled-healthcheck gateway methods. Any missing method, unexpected file, parity difference, or identity mismatch is a stop condition.

## Phase 5: Preserve the Safe Initial Configuration

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

## Phase 6: Loaded-Runtime Preflight Only

After reviewed install and clean parity, verify these operator-read gateway methods are registered:

```text
memoryEngine.sustainedRuntimePreflight
memoryEngine.productionEvidenceHealthcheck
```

Only the preflight method may be called in this phase. Do not call the scheduled healthcheck because sustained configuration is not enabled and no traffic should be manufactured.

Preflight must prove actual OpenClaw runtime version, live config file path/hash/byte count, installed plugin build identity, source/runtime parity, active-memory disabled, AutoRecall disabled, KG/Recent legacy modes, production evidence disabled with no epoch, and no scheduler or activation state. A method catalog alone is insufficient.

## Phase 7: Rollback and Stop Conditions

Stop if ABI mismatch, plugin initialization/gateway failure, non-zero parity, missing gateway method, active-memory enabled, unapproved config change, unexpected AutoRecall/full/evidence/epoch/scheduler activation, or unhealthy gateway occurs.

Rollback sequence:

1. Record the stop reason without secrets.
2. Under approval, restore the independent backup byte-for-byte and verify SHA-256 and byte count.
3. Restore the prior reviewed plugin runtime through the approved installation/reload path; do not use an unreviewed in-place rebuild.
4. Verify gateway health, memory-engine tool registration, source/runtime boundary, active-memory disabled, safe initial modes, no evidence epoch, and no scheduler.
5. Record that sustained runtime remains withheld and B8-B remains unauthorized.

Rollback is recovery, not authorization to retry activation.

## Go/No-Go Matrix

| Gate | Required evidence | No-go condition |
|:---|:---|:---|
| Runtime identity | CLI, gateway, and native dependency ABI are equal | Any mismatch or unknown gateway runtime |
| Configuration backup | Independent regular owner-only file with exact hash and size | Symlink/hardlink, byte mismatch, or missing restore evidence |
| Active-memory boundary | `status=clean`, `active_memory_enabled=false`, `blockers=[]` | Enabled or unverified |
| Reviewed runtime parity | `source_runtime_equal=true`, `difference_count=0`, matching build identity | Any difference or missing A7.4 method |
| Safe initial config | AutoRecall off, KG/Recent legacy, evidence off/absent, no epoch/scheduler | Any unexpected activation |
| Loaded preflight | Actual host path, hash, build, parity, and safe-state facts | Missing, stale, or contradictory report |

All gates are necessary, but passing them does not authorize the sustained window. That requires a separate reviewed decision.

## EDI Handoff

EDI should receive the sanitized baseline manifest, parity report, ABI triad, active-memory boundary report, preflight report, and rollback artifacts. Reports must contain hashes, counts, versions, and statuses, not raw configuration, secrets, database contents, prompts, or manufactured observations.

Repository-only contract check:

```bash
node --test test/sustained-runtime-remediation-contract.test.js
```

## Current Authorization Boundary

```text
B8-A7-R1 remediation procedure=IMPLEMENTED / EDI VERIFICATION PENDING
B8-A7 sustained runtime authorization=WITHHELD / REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

No runbook step changes these states. Do not enable an evidence epoch, sustained AutoRecall, full fail-closed, scheduler, or healthcheck until a later authorization decision explicitly permits it.

# B8-A7-R6.1 Personal Deployment Read-Only Baseline

> **Status: Design-only read-only audit / no mutation authorization**
>
> Date: 2026-07-21
>
> Governing profile: [`../adr/personal-deployment-safety-profile.md`](../adr/personal-deployment-safety-profile.md)

## Purpose

This audit converts the accepted personal deployment safety profile into one bounded read-only evidence collection step.

It answers only:

```text
What is installed and currently loaded?
Does the installed runtime match the reviewed source?
Which Node and native ABI does the live Gateway use?
Is active-memory effectively disabled?
Are the expected memory-engine operator methods registered?
Are high-risk features currently disabled?
Which concrete blockers remain before any approved remediation mutation?
```

It does not authorize or perform:

```text
OpenClaw configuration changes
config backup or restoration
plugin installation or reload
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

Writing reduced reports under `/tmp/memory-engine-personal-baseline/` is allowed. Those reports are evidence artifacts, not configuration backups or production state.

## Relationship to Prior Work

The 2026-07-20 authorization decision remains the prior factual baseline. It found:

```text
source_runtime_equal=false
difference_count=25
installed A7.4 operator methods unavailable
Gateway/native ABI mismatch
active_memory_enabled=true
natural_observation_count=0
AutoRecall product health status=not_evaluated
```

R6 changed the applicable safety profile, not those facts. R6.1 must re-measure the current environment rather than assume the old findings still hold.

The strict no-load host publisher work remains reference-only. R6.1 may use supported OpenClaw cold inspection and loaded Gateway inspection because this is a single-operator personal deployment.

## Evidence Rules

Every command must record:

```text
command
working directory
started_at UTC
finished_at UTC
exit code
stdout artifact path
stderr artifact path
```

Raw outputs may contain local paths and should remain outside the repository. Reports committed to the repository must be reduced and secret-free.

Do not infer:

```text
Gateway Node identity from the interactive shell
installed runtime path from the source checkout
plugin enablement from file presence alone
loaded runtime identity from cold inspection alone
active-memory disabled state from a missing config key
runtime health from method names without a successful operator call
```

Conflicting evidence is a blocker. Do not select the most convenient result.

## Phase A: Repository Identity

Record from the reviewed checkout:

```bash
cd /home/lionsol/.openclaw/workspace/plugins/memory-engine

git status --short --branch
git rev-parse HEAD
git describe --tags --always --dirty
~/.local/node24/bin/node --version
~/.local/node24/bin/node -p 'process.versions.modules'
```

Required interpretation:

```text
reviewed_head=<exact commit>
reviewed_worktree_clean=true
repository_node_version=v24.8.0
```

A dirty reviewed worktree blocks source/runtime parity evidence.

## Phase B: OpenClaw CLI and Gateway Identity

Use the installed OpenClaw operator environment without changing `PATH` first.

Record:

```text
command -v openclaw
resolved OpenClaw executable path
OpenClaw CLI version
CLI Node executable and NODE_MODULE_VERSION
Gateway service definition or startup command
actual running Gateway process executable
actual Gateway Node executable and NODE_MODULE_VERSION
Gateway health result
```

The exact commands depend on the installed OpenClaw service mode and must be recorded in the evidence report. A shell `node --version` value is not Gateway evidence.

Required result:

```text
openclaw_cli_identity=known
gateway_process_identity=known
gateway_health=healthy
```

Unknown Gateway identity or an unhealthy Gateway stops R6.1.

## Phase C: Cold Plugin Inspection

Use supported operator commands from the installed OpenClaw version, for example:

```bash
openclaw plugins list --json
openclaw plugins inspect memory-engine --json
openclaw plugins inspect active-memory --json
```

Record command availability and actual output rather than assuming flags exist.

Required reduced fields:

```text
memory_engine_cold_visible
memory_engine_cold_enabled
memory_engine_reported_version
memory_engine_install_path
memory_engine_install_source
active_memory_cold_visible
active_memory_cold_enabled
cold_evidence_source
cold_evidence_diagnostics
```

Cold inspection may use persisted metadata or discovery. Under the personal profile that is acceptable only as one correlated signal. It is not sufficient by itself.

## Phase D: Installed Runtime Parity

The runtime root must come from the current operator inspection result, not from a guessed default path.

Run:

```bash
~/.local/node24/bin/node \
  bin/build-runtime-source-parity-report.js \
  --source-root /home/lionsol/.openclaw/workspace/plugins/memory-engine \
  --runtime-root <current-inspected-runtime-root> \
  --checked-at <canonical-UTC-ISO> \
  --out /tmp/memory-engine-personal-baseline/runtime-parity.json \
  --pretty
```

Record:

```text
source_runtime_equal
runtime_build_identity
difference_count
missing_runtime_file_count
unexpected_runtime_file_count
runtime_path_violation_count
duplicate_runtime_path_violation_count
```

Healthy target:

```text
source_runtime_equal=true
difference_count=0
missing_runtime_file_count=0
unexpected_runtime_file_count=0
runtime_path_violation_count=0
duplicate_runtime_path_violation_count=0
```

A failed result is a remediation blocker, not permission to install or synchronize the plugin.

## Phase E: Native ABI Identity

Determine the native ABI required by the actual Gateway Node runtime and the ABI of the installed memory-engine native dependencies.

At minimum record:

```text
gateway_node_executable
gateway_node_version
gateway_node_module_version
installed_native_module_path
installed_native_module_identity
installed_native_module_version
installed_native_module_abi
native_module_load_probe_exit_code
```

The load probe must use a read-only operation and the same Node executable used by the Gateway. Do not run `npm install`, `npm rebuild`, or an in-place rebuild.

Healthy target:

```text
gateway_native_abi_compatible=true
native_module_load_probe=pass
```

## Phase F: Effective Config and Conflict Boundary

Resolve the actual OpenClaw config path through the installed OpenClaw runtime or service definition. Do not guess it.

Run the existing reduced, secret-free reports directly against the live config path:

```bash
~/.local/node24/bin/node \
  bin/build-effective-hybrid-runtime-config-report.js \
  --config <actual-live-openclaw-config-path> \
  --checked-at <canonical-UTC-ISO> \
  --out /tmp/memory-engine-personal-baseline/effective-config.json \
  --pretty

~/.local/node24/bin/node \
  bin/build-sustained-runtime-boundary-report.js \
  --config <actual-live-openclaw-config-path> \
  --checked-at <canonical-UTC-ISO> \
  --out /tmp/memory-engine-personal-baseline/runtime-boundary.json \
  --pretty
```

Required reduced fields:

```text
config_path
config_sha256
config_byte_count
effective_config_valid
active_memory_enabled
active_memory_resolution
auto_recall_enabled
kg_fail_closed_mode
recent_fail_closed_mode
production_evidence_enabled
evidence_epoch_present
```

Healthy target before mutation authorization:

```text
effective_config_valid=true
active_memory_enabled=false
auto_recall_enabled=false
kg_fail_closed_mode=legacy_fallback
recent_fail_closed_mode=legacy_fallback
production_evidence_enabled=false
evidence_epoch_present=false
```

Under the OpenClaw active-memory semantics already audited by the repository, an absent or unspecified enabled field must not be treated as disabled.

## Phase G: Loaded Gateway Evidence

Use current Gateway runtime inspection without reloading or restarting it.

Record whether these methods are currently registered:

```text
memoryEngine.sustainedRuntimePreflight
memoryEngine.productionEvidenceHealthcheck
```

When `memoryEngine.sustainedRuntimePreflight` is available, invoke only that operator-read method:

```bash
openclaw gateway call memoryEngine.sustainedRuntimePreflight \
  --params '{}' \
  --json
```

Do not call the scheduled healthcheck during R6.1.

Required reduced fields:

```text
runtime_inspection_available
memory_engine_runtime_loaded
sustained_runtime_preflight_registered
production_evidence_healthcheck_registered
runtime_preflight_call_status
loaded_runtime_build_identity
loaded_openclaw_version
loaded_config_path
loaded_config_sha256
loaded_effective_config_fingerprint
loaded_active_memory_enabled
loaded_auto_recall_enabled
loaded_production_evidence_enabled
```

The cold inspection path, installed runtime parity, and loaded Gateway evidence must refer to the same installed runtime. Disagreement blocks remediation authorization.

## Phase H: Existing Test and Smoke Evidence

Use the already reviewed Node 24 baseline for repository validation:

```bash
PATH="$HOME/.local/node24/bin:$PATH" npm run check
PATH="$HOME/.local/node24/bin:$PATH" npm test
PATH="$HOME/.local/node24/bin:$PATH" npm run smoke:full-fail-closed
```

Required result:

```text
static_check=pass
full_suite_failures=0
full_fail_closed_safety_smoke=10/10 pass
```

R6.1 does not require manufacturing natural production traffic or completing AutoRecall quality review. Those are later sustained-window readiness inputs, not prerequisites for deciding whether the known deployment defects may be remediated.

## Canonical Reduced Summary

EDI should produce one reduced summary with this shape:

```text
reviewed_head
reviewed_worktree_clean
openclaw_cli_identity_status
gateway_process_identity_status
gateway_health
memory_engine_cold_visible
memory_engine_cold_enabled
memory_engine_install_path
source_runtime_equal
difference_count
gateway_native_abi_compatible
native_module_load_probe
active_memory_enabled
auto_recall_enabled
kg_fail_closed_mode
recent_fail_closed_mode
production_evidence_enabled
evidence_epoch_present
memory_engine_runtime_loaded
sustained_runtime_preflight_registered
production_evidence_healthcheck_registered
runtime_preflight_call_status
cold_installed_loaded_identity_consistent
static_check
full_suite_failures
full_fail_closed_safety_smoke
blockers
recommendation
```

Do not include raw config contents, secrets, environment values, tokens, database rows, or memory contents.

## Decision States

R6.1 may return only one of:

```text
BASELINE READY FOR SEPARATE MUTATION AUTHORIZATION
  identities are known
  Gateway is healthy
  evidence sources are internally consistent
  tests and safety smoke pass
  remaining defects are concrete and remediable
  no mutation has occurred

BASELINE BLOCKED
  identity is unknown or contradictory
  Gateway is unhealthy
  source/runtime path cannot be bounded
  ABI cannot be measured safely
  live config path cannot be established
  tests or safety smoke fail
  evidence collection caused an unexpected mutation
```

`BASELINE READY FOR SEPARATE MUTATION AUTHORIZATION` does not authorize the mutation. A later decision must separately approve the exact config patch, installation/synchronization action, reload/restart path, backups, and rollback procedure.

## Stop Conditions

Stop immediately on:

```text
unexpected config or runtime mutation
Gateway restart or process replacement
plugin install, update, uninstall, or reload
native dependency write or rebuild
core DB or engine DB write caused by an inspection command
unknown runtime path
symlink or duplicate runtime path ambiguity
Gateway health failure
secret exposure in a reduced report
cold, installed, and loaded evidence disagreement
```

## Current Boundary

```text
B8-A7-R6 personal deployment safety profile=PASSED / CLOSED
personal deployment remediation runbook=VERIFIED / CURRENT
B8-A7-R6.1 read-only baseline audit=IMPLEMENTED / EDI VERIFICATION PENDING
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

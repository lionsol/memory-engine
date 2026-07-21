# B8-A7-R6 Personal Deployment Sustained Runtime Remediation

> **Status: Design-only operator runbook / no runtime authorization**
>
> Date: 2026-07-21
>
> Safety profile: single operator, local OpenClaw deployment

## Purpose

This runbook replaces the strict no-load host-authority remediation path for the current personal deployment. It uses operator-controlled cold inspection, exact installed-runtime identity, post-load Gateway inspection, tests, backups, and feature-level fail-closed behavior.

It does not authorize configuration changes, installation, reload, Gateway restart, AutoRecall activation, production evidence collection, a sustained runtime epoch, or B8-B removal. Each mutation phase still requires explicit operator approval.

The historical 2026-07-20 findings remain the starting blockers:

```text
reviewed source and installed runtime differ
installed runtime lacks reviewed A7.4 methods
OpenClaw CLI and native dependency ABI differ
active-memory is effectively enabled
natural-traffic readiness is incomplete
AutoRecall product health is not evaluated
```

## Governing Rule

The plugin may load for management, diagnostics, and safe manual operations before full authorization. High-risk automation remains disabled until every required preflight item is green.

```text
uncertain deployment identity -> AutoRecall disabled
uncertain conflict state -> AutoRecall and reinforcement disabled
uncertain runtime registration -> full modes and evidence disabled
failed smoke or rollback check -> authorization withheld
```

## Phase 0: Record the Existing Environment

Read-only evidence must record:

```text
OpenClaw CLI version and executable path
Gateway process identity and Node runtime identity
effective OpenClaw config path, byte count, SHA-256, mode, and inode
reviewed memory-engine source commit
currently installed memory-engine runtime path and inventory
current plugin cold-inspection output
current Gateway runtime-inspection output when available
active-memory effective configuration
AutoRecall, KG, Recent, evidence, scheduler, and epoch state
```

Use supported OpenClaw operator commands from the installed version. Record the exact command and raw output location. Cold inspection may use plugin list or inspect output. Runtime inspection may be collected only after the current Gateway is confirmed healthy.

Do not treat discovery output alone as authoritative. Correlate it with the installed runtime closure, effective config, and Gateway registrations.

Phase 0 is read-only and must not alter config, install packages, rebuild native modules, reload plugins, restart the Gateway, or create an epoch.

## Phase 1: Prepare Independent Recovery Sources

Before any approved mutation, create and verify:

```text
C0 = exact pre-change OpenClaw config backup
R0 = exact pre-change installed memory-engine runtime recovery source
S0 = reviewed source commit and dependency-lock identity
```

Each artifact must have:

```text
absolute path
SHA-256 or deterministic inventory identity
byte count where applicable
permissions
inode identity
UTC timestamp
non-symlink and non-hardlink verification
```

C0 must be separate from the live config. R0 must be usable without fetching new network content.

## Phase 2: Resolve Runtime and ABI Identity

Determine the actual Node runtime used by the Gateway. Do not infer it from the interactive shell.

An approved installation plan must bind:

```text
reviewed source commit
installed runtime destination
Gateway Node executable and ABI
native dependency build identity
OpenClaw runtime version
rollback source R0
```

Do not rebuild native dependencies in the existing production runtime in place. Build or install from the reviewed source into a separately controlled candidate location, then compare the candidate closure before deployment.

Stop if the candidate contains unexplained source/runtime drift, duplicate paths, unexpected generated files, symlinks, or incompatible native modules.

## Phase 3: Explicitly Disable the Conflicting Memory Plugin

Confirm the installed OpenClaw version's actual configuration semantics for `active-memory`. Do not guess a key path.

Prepare the smallest config patch that makes the effective state explicitly disabled. Create a post-change backup C1 after the approved patch.

Verify:

```text
active-memory effective enabled=false
C0 remains an exact pre-change backup
C1 exactly matches the live post-change config
C0 and C1 differ only in the reviewed active-memory change
no AutoRecall/full/evidence/scheduler/epoch setting changed
```

If unrelated config changes appear, restore C0 and stop.

## Phase 4: Install or Synchronize the Reviewed Runtime

Only after separate approval:

```text
install the exact reviewed memory-engine source
use the Gateway-compatible Node/native dependency environment
reload or restart through the supported OpenClaw operator path
retain C1 and R0 for rollback
```

This phase must not enable AutoRecall, KG full, Recent full, production evidence, a scheduler, or an evidence epoch.

After reload, verify Gateway health before invoking memory-engine-specific methods.

## Phase 5: Correlate Cold and Runtime State

Collect three independent evidence groups.

### Cold operator evidence

Record a supported OpenClaw plugin list or inspect result showing memory-engine installed and enabled under the current config.

### Installed-runtime evidence

Run the existing source/runtime parity and build-identity tooling. Required result:

```text
unexplained drift=0
missing reviewed files=0
unexpected runtime files=0
symlink violations=0
duplicate runtime path violations=0
```

### Loaded Gateway evidence

Use runtime inspection and the memory-engine operator-read preflight to confirm:

```text
expected Gateway methods are registered
expected tools are registered
installed build identity matches the reviewed source
live config hash matches C1
active-memory effective enabled=false
AutoRecall disabled
KG mode=legacy_fallback
Recent mode=legacy_fallback
production evidence disabled
scheduler absent or inactive
no evidence epoch active
```

A method catalog alone is insufficient. A plugin self-report alone is insufficient. The three evidence groups must agree.

## Phase 6: Verification

Run with the repository Node 24 baseline unless a test explicitly requires the Gateway runtime:

```bash
PATH="$HOME/.local/node24/bin:$PATH" node --test <focused authorization and runtime tests>
PATH="$HOME/.local/node24/bin:$PATH" npm run check
PATH="$HOME/.local/node24/bin:$PATH" npm test
PATH="$HOME/.local/node24/bin:$PATH" node bin/run-full-fail-closed-safety-smoke.js
```

Required result:

```text
focused tests=PASS
static check=PASS
full suite=0 failures
A5 fail-closed safety smoke=10/10 PASS
```

If a Gateway-runtime smoke is required, run it separately and record the exact Gateway identity.

## Phase 7: Rollback Verification

Before requesting sustained-runtime authorization, prove that rollback instructions are complete.

Rollback must restore:

```text
R0 when the reviewed runtime must be removed
C1 when retaining explicit active-memory disablement
C0 only when abandoning the entire remediation and accepting the original conflict state
```

After rollback, confirm Gateway health, loaded plugin identity, safe feature state, and A5 smoke.

Do not claim rollback is safe merely because backup files exist.

## Phase 8: Separate Authorization Decision

A later decision may authorize a bounded personal sustained-runtime window only when all prior phases are independently verified.

The decision must bind:

```text
OpenClaw CLI and Gateway identities
reviewed source commit
installed runtime identity
C1 config identity
effective active-memory=false
initial AutoRecall/KG/Recent/evidence state
rollback identities
verification results
approved activation scope and stop conditions
```

The first activation remains a separate controlled action. This runbook does not perform it.

## Stop Conditions

Stop and keep high-risk features disabled on any of:

```text
source/runtime drift
ABI mismatch
Gateway unhealthy
missing expected method or tool
active-memory enabled or ambiguous
unexpected config mutation
AutoRecall/full/evidence/scheduler/epoch already active
focused or full test failure
A5 smoke failure
rollback evidence incomplete
cold, installed-runtime, and Gateway evidence disagree
```

## Current Boundary

```text
B8-A7-R6 personal deployment safety profile=PASSED / CLOSED
personal deployment remediation runbook=VERIFIED / CURRENT
B8-A7-R6.1 read-only baseline audit=IMPLEMENTED / EDI VERIFICATION PENDING
OpenClaw upstream pull request=NOT REQUIRED / NOT PLANNED
OpenClaw private fork=NOT REQUIRED / NOT PLANNED
OpenClaw source modification=NOT AUTHORIZED
configuration mutation=NOT AUTHORIZED
plugin install/reload=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

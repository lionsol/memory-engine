# B8-A7-R6.5 Personal Runtime Live Remediation Authorization Packet

> **Status: PASSED / CLOSED**
>
> **Live execution: NOT AUTHORIZED**
>
> Date: 2026-07-21

## Purpose

This packet defines one bounded live remediation transaction for the personal memory-engine deployment.

The transaction may replace the stale installed extension with the already validated Node 24 candidate, prove the loaded Gateway identity and registrations, and roll back to an exact pre-change runtime when any gate fails.

This packet does not authorize execution by itself. Live mutation requires all of:

```text
this packet committed
EDI verification green
source worktree clean
candidate and recovery identities freshly reverified
current host state still matches the approved pre-state
explicit operator approval naming the candidate artifact identity
```

It does not authorize:

```text
AutoRecall activation
automatic reinforcement activation
KG or Recent full_fail_closed activation
production evidence activation
scheduler creation
evidence epoch creation
B8-A7 sustained runtime authorization
B8-B removal
OpenClaw source modification
push, tag, or release
```

## Governing Documents

```text
docs/adr/personal-deployment-safety-profile.md
docs/smoke-tests/personal-runtime-remediation-authorization.md
docs/smoke-tests/personal-runtime-candidate-rehearsal-decision-20260721.md
docs/runtime-sync.md
```

R6.4 is closed by independent verification of commit `59278a6`. Its `/tmp` artifacts remain ephemeral and must be reverified immediately before live execution.

## Exact Candidate Binding

Candidate root:

```text
/tmp/memory-engine-r6.4-9b6b734/candidate
```

The candidate was built from reviewed runtime closure `dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718`. The later documentation-only commit `59278a6` preserves the same runtime closure.

Required immutable identities:

```text
package name=memory-engine-plugin
package version=0.8.22
package.json SHA-256=752f46d03f7fe87f744e4441a9f79fccae3d4e09ece129ee60a0ad19abcdf47a
package-lock.json SHA-256=8ee89a15cc54eb532618cf011a30f5684cedf0aa0c026cb69378bc025ec58718
source archive SHA-256=acbc27b55d0863fbff5dada85eec40993186012802eaba1a1291e132d194697b
runtime build identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
artifact manifest serialization=memory-engine-runtime-artifact-manifest-v1
artifact manifest identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42
candidate root mode=0500
candidate writable files=0
candidate writable directories=0
candidate external symlinks=0
candidate external hardlink references=0
```

Dependency and native identities:

```text
Node=v24.8.0
NODE_MODULE_VERSION=137
better-sqlite3=11.10.0
@lancedb/lancedb=0.29.0
better_sqlite3.node SHA-256=be4109c5b07514ade1a2e1452cbed9fca25cbb8d025b76fa2a81e21a91286a05
lancedb linux-x64-gnu SHA-256=9f0261d60d1181023d4ea48c5b871d19e9af010748ddbde057b94188f97921fd
lancedb linux-x64-musl SHA-256=46e66227ff52d6a37a626019b5ffb583d99e0103039dad298c56d91b98bc1c5b
SQLite :memory: smoke=pass
LanceDB disposable create/read/remove smoke=pass
```

The historical R6.4 `candidate_tree_sha256` is retained as audit history but is not the R6.5 authority because its serialization was not recorded. R6.5 uses the reproducible `memory-engine-runtime-artifact-manifest-v1` identity instead.

## Canonical Artifact Manifest Tool

R6.5 uses:

```bash
$HOME/.local/node24/bin/node \
  bin/build-runtime-artifact-manifest.js \
  --root <artifact-root> \
  --checked-at <canonical-UTC-ISO> \
  --out <manifest.json> \
  --pretty
```

The manifest identity covers:

```text
relative path
entry type
permission mode
file byte count and SHA-256
symlink target and within-root resolution
internal hardlink group membership
```

It rejects:

```text
symlink artifact root
unreadable entries
special files
external or broken symlinks
hardlink references not fully contained in the artifact root
```

The tool is report-only. It does not modify the inspected artifact, active extension, configuration, Gateway, databases, or OpenClaw state.

## Current Pre-Authorization State

Read-only checks on 2026-07-21 established:

```text
OpenClaw version=2026.6.9
Gateway Node=/home/lionsol/.local/node24/bin/node
Gateway Node version=v24.8.0
Gateway ABI=137
Gateway PID=676 at pre-authorization observation
Gateway RPC=healthy
Gateway port=18789
memory-engine enabled=true
memory-engine installed version=0.8.22
memory-engine installPath=/home/lionsol/.openclaw/extensions/memory-engine
active-memory enabled=false
active-memory activation reason=not in allowlist
plugin registry state=fresh
config SHA-256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a
rollout config fingerprint=502802868b51ee459691729b99c00a94d2c91081334952f32a743dbd18e1c79f
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
production evidence=false
evidence epoch=null
runtime boundary=clean / disabled_by_plugins_allowlist
```

Current stale runtime evidence:

```text
active runtime build identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
candidate runtime build identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
source/current-runtime difference_count=28
memoryEngine.sustainedRuntimePreflight unavailable in active runtime
memoryEngine.productionEvidenceHealthcheck unavailable in active runtime
```

Every current-state value must be refreshed before execution. PID `676` is observational evidence, not a future authorization constant.

## Stable Command Environment

Every command in the live transaction must run from:

```text
/home/lionsol/.openclaw/workspace/plugins/memory-engine
```

or the execution artifact root.

Never run install, rollback, inspect, parity, native smoke, or Gateway verification from:

```text
/home/lionsol/.openclaw/extensions/memory-engine
/tmp/memory-engine-r6.4-9b6b734/candidate
any runtime target that the install command may replace
```

All OpenClaw commands must use:

```bash
$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  <command>
```

Do not rely on the default `openclaw` shebang or shell Node selection.

## Required Execution Artifact Root

Create a new root for the live transaction. Do not reuse rehearsal C0/R0 as live recovery authority.

Canonical shape:

```text
/tmp/memory-engine-r6.5-<UTC>-<short-random>/
  candidate-manifest.json
  config/
    openclaw.json.c0
  runtime/
    r0/
  data/
    d0-memory-engine/
    d0-lancedb/
  evidence/
    preflight/
    stopped/
    post-install/
    post-start/
    rollback/
```

Requirements:

```text
artifact root mode=0700
manifest and reduced evidence files mode=0600
no artifact root symlink
no backup hardlink or reflink to a production file
sufficient free disk for candidate, R0, D0, failed target retention, and rollback
```

## Phase 0: Final No-Mutation Preflight

Before requesting operator approval, verify:

```text
repository worktree clean
current runtime closure identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
candidate runtime closure identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
candidate artifact identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42
candidate native smokes=pass
active runtime identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
active runtime still equals the rehearsal R0 identity
Gateway healthy under Node 24 / ABI 137
active-memory disabled by effective host policy
AutoRecall/full/evidence inactive
no evidence epoch
config SHA-256 unchanged or explicitly reviewed
```

Any mismatch returns:

```text
R6.5 AUTHORIZATION BLOCKED / REBUILD OR REBASE REQUIRED
```

## Phase 1: Fresh C0 and R0

### C0

Create a byte-exact independent copy of:

```text
/home/lionsol/.openclaw/openclaw.json
```

Required proof:

```text
byte equality
matching SHA-256 and byte count
mode=0600
separate inode
link count=1
not symlink
not reflink where the platform can prove it
```

### R0

Create a fresh exact copy of:

```text
/home/lionsol/.openclaw/extensions/memory-engine
```

outside the extension install base.

Required proof:

```text
full-tree diff=none
runtime build identity matches active runtime
artifact manifest valid=true
no external symlink or hardlink references
Node 24 better-sqlite3 :memory: smoke=pass
cold installed runtime path still equals the copied source path
```

R0 must be created immediately before the transaction. The R6.4 rehearsal R0 remains evidence only.

## Phase 2: Fresh H0

Capture without `plugins inspect --runtime`:

```text
memory-engine cold inspect
active-memory cold inspect
plugin registry
Gateway status and service definition
Gateway PID and start timestamp
Gateway Node executable/version/ABI
config SHA-256
runtime parity
candidate artifact manifest
current engine SQLite/LanceDB metadata
```

Required pre-state:

```text
memory-engine enabled=true
active-memory enabled=false / not in allowlist
registry=fresh
Gateway RPC healthy
config valid
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
productionEvidenceWindow.enabled=false
epochId=null
```

## Phase 3: Explicit Operator Approval

Live execution may begin only after the operator explicitly authorizes the exact artifact identity.

Required approval text:

```text
AUTHORIZE B8-A7-R6.5 LIVE REMEDIATION
candidate artifact identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42
candidate runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
conditional rollback to fresh R0 and exact pre-start D0 is authorized on any defined stop condition
```

A generic “continue” is not sufficient for this phase.

## Phase 4: Stop and Quiesce

From the stable source root:

```bash
$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  gateway stop --json
```

Verify:

```text
systemd service inactive
port 18789 not listening
previous Gateway PID exited
no memory-engine process holds engine SQLite or LanceDB
```

Do not proceed while any condition is uncertain.

## Phase 5: D0 Quiesced Data Snapshot

After the Gateway is stopped, snapshot only:

```text
/home/lionsol/.openclaw/memory/memory-engine
/home/lionsol/.openclaw/memory/lancedb
```

Do not copy, restore, vacuum, checkpoint, or otherwise manipulate:

```text
/home/lionsol/.openclaw/memory/main.sqlite
```

For each live source and D0 copy, create a canonical artifact manifest. Required result:

```text
source manifest valid=true
D0 manifest valid=true
source identity=D0 identity
separate inode trees
no external symlink or hardlink references
```

Record the stopped live data identities as `D_PRE_INSTALL`.

## Phase 6: Install Candidate While Gateway Is Stopped

From the stable source root:

```bash
$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  plugins install /tmp/memory-engine-r6.4-9b6b734/candidate --force
```

The command is expected to update the installed-plugin record and replace the extension directory. It may import memory-engine in the CLI process and touch the selected memory-engine state.

Immediately after the install, before starting the Gateway:

```text
recompute engine SQLite/LanceDB manifests as D_POST_INSTALL
compare D_POST_INSTALL to D_PRE_INSTALL
```

Required result:

```text
D_POST_INSTALL identities=D_PRE_INSTALL identities
```

Any data identity difference is a stop condition. Do not start the Gateway.

## Phase 7: Pre-Start Disk Acceptance

Before Gateway start, require:

```text
cold inspect installPath=/home/lionsol/.openclaw/extensions/memory-engine
cold inspect version=0.8.22
cold install sourcePath=/tmp/memory-engine-r6.4-9b6b734/candidate
installed runtime build identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
source/installed difference_count=0
installed better-sqlite3=11.10.0
installed @lancedb/lancedb=0.29.0
installed Node 24 SQLite :memory: smoke=pass
config bytes and SHA-256=C0
active-memory boundary=clean / disabled_by_plugins_allowlist
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
production evidence=false
evidence epoch=null
```

Failure invokes rollback while the Gateway remains stopped.

## Phase 8: Start Gateway

```bash
$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  gateway start --json
```

Require:

```text
service active/running
new Gateway PID
Gateway executable=/home/lionsol/.local/node24/bin/node
Gateway Node=v24.8.0
Gateway ABI=137
RPC healthy
OpenClaw version=2026.6.9
no memory-engine startup exception
```

## Phase 9: Loaded Runtime Acceptance

### Runtime preflight

```bash
$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  gateway call memoryEngine.sustainedRuntimePreflight \
  --params '{}' \
  --json
```

Require:

```text
status=clean
runtime_build_identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
active_memory_enabled=false
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
production evidence=false
config path=/home/lionsol/.openclaw/openclaw.json
config SHA-256=C0
```

### Tool catalog

```bash
$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  gateway call tools.catalog \
  --params '{"agentId":"edi","includePlugins":true}' \
  --json
```

Require registration of:

```text
memory_engine
memory_engine_search
memory_engine_get
```

### Healthcheck method registration

Do not run a production evidence healthcheck search while the evidence window is inactive.

Method registration may be proven by calling `memoryEngine.productionEvidenceHealthcheck` and receiving the reviewed domain failure:

```text
PRODUCTION_EVIDENCE_HEALTHCHECK_FAILED
production evidence window is not active with a valid epoch
```

`unknown method` is a failure.

## Phase 10: Post-Start Validation

Run under Node 24:

```text
focused Gateway registration tests
static check
full repository suite
A5 full fail-closed safety smoke
post-start source/installed parity
post-start cold inspect and registry
post-start Gateway status
```

Required result:

```text
focused tests pass
static check pass
full suite failures=0
A5 smoke=10/10 pass
source/installed difference_count=0
Gateway healthy
safe feature state unchanged
```

Do not manufacture user memory traffic merely to validate registration.

## Rollback Authorization

The explicit R6.5 operator approval authorizes rollback only within this transaction and only to the fresh R0/C0/D0 produced for it.

### Install or pre-start failure

While Gateway remains stopped:

```bash
$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  plugins install <fresh-R0-path> --force
```

Then verify old runtime identity and Node 24 native smoke.

If data identities differ from `D_PRE_INSTALL`, restore exact D0 before starting the old runtime. Preserve the changed stores as failure evidence first.

### Gateway start or post-start failure

```text
stop the failed Gateway
reinstall fresh R0
restore C0 only if config bytes changed
restore D0 only when data identity changed during this bounded transaction
start Gateway through Node 24
verify old runtime identity, active-memory disabled, safe Hybrid state, and A5 10/10
```

The rollback install record may name the fresh R0 path rather than the historical workspace sourcePath. Record that state accurately.

## Stop Conditions

Abort before stop on:

```text
worktree dirty
candidate manifest invalid or identity mismatch
candidate writable bit appears
candidate runtime identity mismatch
native smoke failure
active runtime no longer equals fresh R0 source
Gateway unhealthy
active-memory enabled or ambiguous
AutoRecall/full/evidence active
config or rollout fingerprint changed without review
insufficient disk
```

Abort before Gateway start on:

```text
install command failure
installed parity non-zero
installed native smoke failure
config change
active-memory boundary failure
D_POST_INSTALL differs from D_PRE_INSTALL
cold install record incoherent
```

Roll back after Gateway start on:

```text
Gateway wrong Node or ABI
Gateway unhealthy
memory-engine startup exception
preflight missing or non-clean
healthcheck method unknown
required tools absent
post-start parity drift
tests or A5 smoke fail
unexpected data mutation
```

## Acceptance Outcome

Successful execution yields only:

```text
B8-A7-R6.5 live runtime remediation=PASS
installed runtime synchronized to reviewed runtime closure
A7.4 methods and tools loaded
safe feature state preserved
```

It does not yield:

```text
B8-A7 sustained runtime authorization
production evidence window activation
B8-B removal authorization
```

A fresh post-remediation authorization review remains required.

## Repository Preflight

After implementing this packet and the canonical artifact manifest tooling:

```text
focused R6.3-R6.5 and authorization-chain tests=55/55 pass
artifact manifest unit/CLI tests=4/4 pass
static check=525 files pass
full suite=1767 pass / 0 fail / 8 skip
A5 full fail-closed safety smoke=10/10 pass
git diff --check=pass
current source/candidate runtime parity=0
candidate artifact manifest identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42
live runtime/config/Gateway mutation=none
```

These repository and read-only artifact prechecks were independently verified before the packet closed at commit `0665de6`; the status-only closeout was committed at `2415dfe`.

## Post-Execution Decision

The exact operator authorization was later received and the live transaction executed. The canonical decision is [`personal-runtime-live-remediation-decision-20260721.md`](personal-runtime-live-remediation-decision-20260721.md).

```text
candidate install=pass
D_POST_INSTALL identities=D_PRE_INSTALL identities
installed candidate parity=0
installed native checks=pass
candidate Gateway activation=not reached
exact-byte config gate=failed
changed JSON paths=[meta.lastTouchedAt]
authorized rollback=pass
old runtime restored=true
exact C0 restored=true
D0 restoration=false / not required
final Gateway healthy=true
A5 smoke=10/10 pass
```

R6.5.1 introduces `memory-engine-config-semantic-equivalence-v1`, which permits only a canonical monotonic `meta.lastTouchedAt` update as the sole changed JSON path. Independent EDI verification passed and the repair is closed. A retry is not authorized by the original execution approval.

## Current Boundary

```text
B8-A7-R6.3 runtime-remediation authorization design=PASSED / CLOSED
B8-A7-R6.4 offline candidate and rollback rehearsal=PASSED / CLOSED
B8-A7-R6.5 live remediation execution authorization packet=PASSED / CLOSED
B8-A7-R6.5 live remediation execution=ROLLED BACK / SAFE
candidate Gateway activation=NOT REACHED
candidate currently active=FALSE
old runtime restored=TRUE
configuration restored to exact C0=TRUE
memory data restored from D0=FALSE / NOT REQUIRED
B8-A7-R6.5.1 config semantic equivalence repair=PASSED / CLOSED
R6.5 live retry=NOT AUTHORIZED
explicit retry approval=NOT RECEIVED
candidate artifact=VALIDATED / FROZEN / EPHEMERAL
fresh retry C0/R0/D0=NOT CREATED
live retry plugin install/reload=NOT AUTHORIZED
live retry Gateway stop/start/restart=NOT AUTHORIZED
AutoRecall activation=NOT AUTHORIZED
production evidence activation=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

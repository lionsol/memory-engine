# B8-A7-R6.5.2 Personal Runtime Live Remediation Retry Authorization

> **Status: IMPLEMENTED / EDI VERIFICATION PENDING**
>
> **Execution status: NOT AUTHORIZED**

## Purpose

This packet defines one bounded retry of the R6.5 live runtime remediation after the first authorized transaction stopped at the pre-start exact-byte configuration gate and rolled back safely.

It does not reuse the first R6.5 operator approval. It does not authorize the retry merely because R6.5.1 passed. It does not create fresh retry backups, stop the Gateway, install the candidate, restore data, activate AutoRecall, activate a production evidence window, or authorize B8-B removal.

## Prior Transaction State

The first live transaction is recorded in [`personal-runtime-live-remediation-decision-20260721.md`](personal-runtime-live-remediation-decision-20260721.md).

```text
B8-A7-R6.5 authorization packet=PASSED / CLOSED
B8-A7-R6.5 live remediation execution=ROLLED BACK / SAFE
candidate Gateway activation=NOT REACHED
old runtime restored=true
configuration restored to exact C0=true
memory data restored from D0=false / NOT REQUIRED
B8-A7-R6.5.1 config semantic equivalence repair=PASSED / CLOSED
```

The current installed-plugin record points to the fresh R0 produced by that completed rollback transaction:

```text
installPath=/home/lionsol/.openclaw/extensions/memory-engine
sourcePath=/tmp/memory-engine-r6.5-live-2415dfe/runtime/r0
active runtime identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
active runtime/current recovery R0 difference_count=0
```

The existing transaction root is current recovery authority and must remain intact until a later retry succeeds, the installed-plugin record no longer depends on it, and a separate cleanup review closes.

## Exact Candidate Binding

The retry binds the same validated dependency-complete candidate only while all identities remain unchanged:

```text
candidate path=/tmp/memory-engine-r6.4-9b6b734/candidate
candidate artifact serialization=memory-engine-runtime-artifact-manifest-v1
candidate artifact identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42
candidate runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
source/candidate difference_count=0
candidate root mode=0500
candidate writable files=0
candidate writable directories=0
candidate external symlinks=0
candidate external hardlink references=0
Node=v24.8.0
NODE_MODULE_VERSION=137
better-sqlite3=11.10.0
@lancedb/lancedb=0.29.0
```

Any candidate identity, permission, dependency, native-smoke, path, or source/runtime-closure drift invalidates this packet.

## Config Semantic Gate

The retry replaces only the rejected exact-byte acceptance test with the closed R6.5.1 policy:

```text
policy=memory-engine-config-semantic-equivalence-v1
```

Allowed post-install outcomes are exactly:

```text
status=exact_equal
valid=true
canonical_semantic_equal=true
unexpected_changed_paths=[]
```

or:

```text
status=approved_host_metadata_change
valid=true
canonical_semantic_equal=true
changed_paths=[meta.lastTouchedAt]
unexpected_changed_paths=[]
last_touched_at.before_valid=true
last_touched_at.after_valid=true
last_touched_at.monotonic=true
```

The following remain stop conditions:

```text
any other changed JSON path
malformed or backward meta.lastTouchedAt
semantic hash mismatch
symlink config input
JSON parse failure
missing report fields
report status other than exact_equal or approved_host_metadata_change
```

The semantic policy is an acceptance gate only. Fresh C0 remains the exact rollback authority. Any rollback restores exact C0 bytes even when the candidate install changed only `meta.lastTouchedAt`.

## No-Mutation Packet Preflight

Before this packet may close, verify without live mutation:

```text
repository worktree clean
R6.5.1=PASSED / CLOSED
current Gateway healthy under Node 24 / ABI 137
current active runtime=current recovery R0
current recovery sourcePath exists
current recovery transaction root exists and remains protected
candidate runtime identity unchanged
candidate artifact identity unchanged
source/candidate parity=0
candidate native smokes pass
active-memory disabled by effective host policy
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
productionEvidenceWindow.enabled=false
epochId=null
A5 smoke=10/10
```

Failure returns:

```text
R6.5.2 RETRY AUTHORIZATION BLOCKED / REBUILD OR REBASE REQUIRED
```

## Required New Retry Artifact Root

The retry must create a new independent root after exact retry authorization. It must not reuse the first transaction C0, R0, H0, or D0 as fresh retry authority.

Canonical shape:

```text
/tmp/memory-engine-r6.5.2-retry-<UTC>-<short-random>/
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

Required properties:

```text
root mode=0700
reduced evidence mode=0600
not a symlink
fresh C0 byte-exact and separate inode
fresh R0 full-tree exact and separate inode tree
fresh H0 captured after R0 creation
fresh D0 captured only after Gateway quiesce
sufficient disk for candidate, fresh R0, fresh D0, failed target retention, and rollback
```

The previous `/tmp/memory-engine-r6.5-live-2415dfe` root remains read-only recovery evidence throughout the retry. It is not overwritten, moved, or deleted.

## Retry Transaction

### Phase 1: Fresh C0, R0, and H0

After exact retry approval, but before Gateway stop:

```text
create fresh retry C0 from /home/lionsol/.openclaw/openclaw.json
create fresh retry R0 from /home/lionsol/.openclaw/extensions/memory-engine
prove active runtime/fresh R0 parity=0
prove fresh R0 runtime identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
prove fresh R0 Node 24 SQLite native smoke=pass
capture fresh H0 cold inspect, registry, Gateway, config, boundary, parity, and candidate evidence
```

Fresh H0 must prove the installed record still has a coherent existing `sourcePath` and the running extension equals the copied fresh R0.

### Phase 2: Stop and Quiesce

From the stable repository root, using the explicit Node 24 OpenClaw entrypoint:

```bash
$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  gateway stop --json
```

Require:

```text
service inactive
old Gateway PID exited
port 18789 not listening
no process holds memory-engine SQLite or LanceDB
```

### Phase 3: Fresh D0 and D_PRE_RETRY

After quiesce, snapshot only:

```text
/home/lionsol/.openclaw/memory/memory-engine
/home/lionsol/.openclaw/memory/lancedb
```

Do not copy, open, checkpoint, vacuum, or restore:

```text
/home/lionsol/.openclaw/memory/main.sqlite
```

Require live-source and fresh-D0 canonical artifact identities to match with zero shared regular-file inodes. Record stopped live identities as `D_PRE_RETRY`.

### Phase 4: Candidate Install

From the stable repository root:

```bash
$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  plugins install /tmp/memory-engine-r6.4-9b6b734/candidate --force
```

Before Gateway start:

```text
D_POST_INSTALL=D_PRE_RETRY
installed runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
source/installed difference_count=0
installed Node 24 native smoke=pass
active-memory boundary=clean / disabled_by_plugins_allowlist
safe feature state unchanged
config semantic report valid=true
config semantic report status=exact_equal OR approved_host_metadata_change
```

Any failed condition invokes rollback while the Gateway remains stopped.

### Phase 5: Candidate Gateway Start

```bash
$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  gateway start --json
```

Allow a bounded startup-readiness interval. A transient first probe before `[gateway] ready` is not itself failure. Require eventual:

```text
service active/running
new Gateway PID
port 18789 listening
RPC healthy
Gateway Node=v24.8.0
Gateway ABI=137
OpenClaw version=2026.6.9
no memory-engine startup exception
```

### Phase 6: Loaded Runtime Acceptance

Require:

```text
memoryEngine.sustainedRuntimePreflight registered
preflight status=clean
preflight runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
memoryEngine.productionEvidenceHealthcheck registered
inactive-window call returns reviewed domain failure, not unknown method
tools.catalog includes memory_engine
tools.catalog includes memory_engine_search
tools.catalog includes memory_engine_get
active-memory=false
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
production evidence=false
epochId=null
```

Do not activate the evidence window or manufacture user memory traffic.

### Phase 7: Post-Start Validation

Run under Node 24:

```text
focused retry and Gateway-registration tests
static check
full repository suite
A5 full fail-closed safety smoke
post-start source/installed parity
post-start cold inspect and registry
post-start Gateway status
post-start engine/LanceDB identity review
```

Required:

```text
failures=0
A5=10/10
source/installed difference_count=0
Gateway healthy
safe feature state unchanged
no unexpected data mutation
```

## Rollback Authorization Boundary

The exact retry approval authorizes rollback only inside the one R6.5.2 transaction and only to its fresh retry C0/R0/D0.

On any pre-start failure:

```text
preserve failed installed target and changed config as evidence
reinstall fresh retry R0 while Gateway remains stopped
restore exact retry C0
restore fresh retry D0 only if data identities changed
start old runtime with Node 24
verify old runtime identity, RPC health, safe feature state, and A5 10/10
```

On any post-start failure:

```text
stop failed candidate Gateway
preserve evidence
reinstall fresh retry R0
restore exact retry C0
restore fresh retry D0 only if transaction data identities changed
restart old runtime with Node 24
verify rollback acceptance
```

The pre-existing R6.5 transaction root remains fallback evidence, but it is not the primary rollback authority for the retry.

## Success Outcome

A successful retry yields only:

```text
B8-A7-R6.5.2 live remediation retry=PASS
installed runtime synchronized to candidate runtime identity
A7.4 methods loaded
three memory-engine tools registered
safe feature state preserved
```

It does not yield:

```text
B8-A7 sustained runtime authorization
production evidence activation
B8-B removal authorization
permission to delete either transaction root
```

A fresh post-remediation authorization review and a separate recovery-artifact cleanup decision remain required.

## Exact Retry Approval

Execution may begin only after the operator sends exactly the following identity-bearing authorization:

```text
AUTHORIZE B8-A7-R6.5.2 LIVE REMEDIATION RETRY
candidate artifact identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42
candidate runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
config semantic policy=memory-engine-config-semantic-equivalence-v1
fresh retry C0/R0/H0/D0 creation and Gateway stop/install/start are authorized
conditional rollback to fresh retry R0, exact retry C0, and exact pre-start retry D0 is authorized on any defined stop condition
```

The original R6.5 approval, a generic “continue,” or an approval missing any line above is insufficient.

## Repository Preflight

After implementing this packet without live mutation:

```text
focused R6.3-R6.5.2, semantic-config, artifact, ledger, and authorization tests=64/64 pass
static check=530 files pass
git diff --check=pass
source/candidate difference_count=0
candidate runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
candidate artifact identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42
active runtime/current recovery R0 difference_count=0
active runtime identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
Gateway stop/start/restart=not performed
candidate install=not performed
fresh retry artifacts=not created
```

Independent EDI closeout passed the requested nine-test scope at 64/64, static check over 530 files, the full suite at 1789 passed / 0 failed / 8 skipped, A5 smoke 10/10, `git diff --check`, and repository status review. The packet is therefore passed and closed; retry execution remains separately unauthorized.

## Current Boundary

```text
B8-A7-R6.5 authorization packet=PASSED / CLOSED
B8-A7-R6.5 live remediation execution=ROLLED BACK / SAFE
B8-A7-R6.5.1 config semantic equivalence repair=PASSED / CLOSED
B8-A7-R6.5.2 live remediation retry authorization packet=PASSED / CLOSED
R6.5.2 live retry execution=NOT AUTHORIZED
explicit R6.5.2 retry approval=NOT RECEIVED
fresh R6.5.2 C0/R0/H0/D0=NOT CREATED
current recovery transaction root=REQUIRED / MUST REMAIN
AutoRecall activation=NOT AUTHORIZED
production evidence activation=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

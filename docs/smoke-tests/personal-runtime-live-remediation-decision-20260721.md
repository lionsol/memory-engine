# B8-A7-R6.5 Live Runtime Remediation Execution Decision

> **Execution result: ROLLED BACK / SAFE**
>
> Candidate activation: **NOT REACHED**
>
> Date: 2026-07-21
>
> Authorization packet: [`personal-runtime-live-remediation-authorization-20260721.md`](personal-runtime-live-remediation-authorization-20260721.md)

## Decision

The exact R6.5 operator authorization was received for:

```text
candidate artifact identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42
candidate runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
conditional rollback to fresh R0 and exact pre-start D0=AUTHORIZED
```

The candidate install command succeeded while the Gateway was stopped, and the install-time engine SQLite/LanceDB identity gate passed. Pre-start runtime parity and native dependency checks also passed.

The transaction then hit the packet's exact-byte configuration stop condition:

```text
C0 config SHA-256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a
post-install config SHA-256=e6fcbb6ec1eb8a339b6b1dc7614435c3a69358b1d4403f2381cc215d2ec0e2a9
exact byte equality=false
```

The Gateway was never started with the candidate. The authorized rollback branch reinstalled fresh R0, restored exact C0, preserved all memory-data identities, restarted the old runtime under Node 24, and passed the A5 safety smoke 10/10.

Canonical outcome:

```text
B8-A7-R6.5 live runtime remediation=ROLLED BACK / SAFE
candidate Gateway activation=NOT REACHED
candidate runtime currently active=false
old runtime restored=true
configuration restored to exact C0=true
D0 restoration required=false
Gateway healthy=true
safe feature state preserved=true
A5 smoke=10/10 pass
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
```

## Transaction Root

All transaction-local recovery and reduced evidence artifacts are under:

```text
/tmp/memory-engine-r6.5-live-2415dfe
```

The root was created mode `0700` and contains:

```text
config/openclaw.json.c0
runtime/r0
data/d0-memory-engine
data/d0-lancedb
evidence/*
failure/openclaw.json.after-candidate-install
failure/openclaw.json.after-r0-install
```

Do not delete or partially clean this root yet. The final OpenClaw install record accurately names the fresh R0 path under this transaction root as its source path.

```text
final install sourcePath=/tmp/memory-engine-r6.5-live-2415dfe/runtime/r0
final installPath=/home/lionsol/.openclaw/extensions/memory-engine
```

The active extension is independent of the source path, but deleting the recorded source prematurely would create avoidable registry drift.

## Phase 0–3: Final Preflight and Recovery Artifacts

The following gates passed before Gateway stop:

```text
repository worktree clean=true
candidate artifact valid=true
candidate artifact identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42
candidate writable files=0
candidate writable directories=0
source/candidate difference_count=0
candidate runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
candidate SQLite native smoke=pass
candidate LanceDB disposable smoke=pass
active runtime identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
active runtime/rehearsal R0 difference_count=0
Gateway PID=676
Gateway RPC healthy=true
Gateway Node=/home/lionsol/.local/node24/bin/node
OpenClaw version=2026.6.9
active-memory=false / disabled_by_plugins_allowlist
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
production evidence=false
evidence epoch=null
```

Fresh C0:

```text
path=/tmp/memory-engine-r6.5-live-2415dfe/config/openclaw.json.c0
mode=0600
byte_count=22802
SHA-256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a
byte_equal_to_live_pre_transaction=true
separate_inode=true
link_count=1
```

Fresh R0:

```text
path=/tmp/memory-engine-r6.5-live-2415dfe/runtime/r0
runtime identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
active/R0 difference_count=0
artifact identity=bf0e9b53ce7e712d2a34f2ffc3584aa86c55f8c8a9e6a90e5160e9d5f3cde78e
artifact valid=true
external symlinks=0
external hardlink references=0
Node 24 SQLite native smoke=pass
```

## Phase 4: Stop and Quiesce

The Gateway stopped successfully:

```text
old Gateway PID=676
service state=inactive
old PID exited=true
port 18789 listening=false
memory-store holders=none
```

No install or data snapshot occurred until quiescence was proven.

## Phase 5: D0 Snapshot

Only the memory-engine-owned stores were copied:

```text
/home/lionsol/.openclaw/memory/memory-engine
/home/lionsol/.openclaw/memory/lancedb
```

The core DB was not copied, opened, checkpointed, vacuumed, restored, or otherwise manipulated.

```text
core DB metadata recorded only=true
core DB path=/home/lionsol/.openclaw/memory/main.sqlite
```

Engine SQLite directory:

```text
D_PRE_INSTALL identity=3de94ff539e9fd1758bb6bd4c6aeb1168ba3a9993a64262d11581ee2d6eedda3
D0 identity=3de94ff539e9fd1758bb6bd4c6aeb1168ba3a9993a64262d11581ee2d6eedda3
manifest valid=true
shared file inodes=0
```

LanceDB:

```text
D_PRE_INSTALL identity=8b09acea01890e3d3470bde8d9139cb547f0a43410b4c8804087daeb215e8044
D0 identity=8b09acea01890e3d3470bde8d9139cb547f0a43410b4c8804087daeb215e8044
manifest valid=true
shared file inodes=0
```

## Phase 6: Candidate Install and Data Gate

The exact Node 24 install command succeeded:

```text
plugins install /tmp/memory-engine-r6.4-9b6b734/candidate --force=pass
```

The OpenClaw installer imported memory-engine and logged LanceDB initialization, as predicted by R6.4. The mandatory data gate nevertheless showed byte/structure identity preservation:

```text
engine D_POST_INSTALL identity=3de94ff539e9fd1758bb6bd4c6aeb1168ba3a9993a64262d11581ee2d6eedda3
engine D_POST_INSTALL=D_PRE_INSTALL=true
LanceDB D_POST_INSTALL identity=8b09acea01890e3d3470bde8d9139cb547f0a43410b4c8804087daeb215e8044
LanceDB D_POST_INSTALL=D_PRE_INSTALL=true
```

## Phase 7: Pre-Start Acceptance

The candidate disk/runtime checks passed:

```text
installPath=/home/lionsol/.openclaw/extensions/memory-engine
install sourcePath=/tmp/memory-engine-r6.4-9b6b734/candidate
version=0.8.22
registry state=fresh
source/installed difference_count=0
installed runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
installed better-sqlite3=11.10.0
installed @lancedb/lancedb=0.29.0
installed Node=v24.8.0
installed ABI=137
installed SQLite native smoke=pass
```

The exact-byte config gate failed before Gateway start:

```text
C0 SHA-256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a
post-install SHA-256=e6fcbb6ec1eb8a339b6b1dc7614435c3a69358b1d4403f2381cc215d2ec0e2a9
C0 byte_count=22802
post-install byte_count=22803
exact byte equality=false
```

This was a defined stop condition, so the candidate Gateway was not started.

## Configuration Difference Analysis

A correct recursive JSON comparison found exactly one changed path:

```text
changed_path_count=1
changed_paths=[meta.lastTouchedAt]
unexpected_changed_paths=[]
```

Values:

```text
before=2026-07-19T08:01:53.000Z
after=2026-07-21T11:55:54.599Z
canonical UTC before=true
canonical UTC after=true
monotonic=true
```

No operational, plugin, model, channel, tool, security, AutoRecall, Hybrid, evidence, or allowlist value changed.

The new report-only policy produced:

```text
policy=memory-engine-config-semantic-equivalence-v1
status=approved_host_metadata_change
valid=true
exact_byte_equal=false
canonical_semantic_equal=true
errors=[]
```

This analysis does not retroactively convert the failed exact-byte gate into a successful transaction. The original authorization contract was followed as written and rollback remained mandatory.

## Authorized Rollback

While the Gateway remained stopped:

```text
fresh R0 reinstall=pass
```

The rollback install again imported memory-engine, but both store identities remained unchanged:

```text
engine post-rollback identity=3de94ff539e9fd1758bb6bd4c6aeb1168ba3a9993a64262d11581ee2d6eedda3
engine post-rollback=D_PRE_INSTALL=true
LanceDB post-rollback identity=8b09acea01890e3d3470bde8d9139cb547f0a43410b4c8804087daeb215e8044
LanceDB post-rollback=D_PRE_INSTALL=true
```

Therefore D0 restoration was not required.

Exact C0 was restored:

```text
final config SHA-256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a
final config=C0 bytes=true
```

Old runtime acceptance before start:

```text
fresh R0/installed difference_count=0
installed old runtime identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
Node=v24.8.0
ABI=137
SQLite native smoke=pass
active-memory boundary=clean / disabled_by_plugins_allowlist
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
production evidence=false
evidence epoch=null
```

## Final Runtime State

The old Gateway restarted successfully after its normal startup interval:

```text
Gateway PID=275493
service=active/running
port 18789=busy
RPC healthy=true
OpenClaw version=2026.6.9
Gateway Node=/home/lionsol/.local/node24/bin/node
Gateway ABI=137
memory-engine startup exception=none observed
```

The initial three-second probe returned RPC not ready while the service was still starting. A later probe showed the Gateway ready and healthy; this was startup latency, not a final failure.

Final safety validation:

```text
old runtime/R0 difference_count=0
final config=C0 exact bytes=true
active-memory=false / disabled_by_plugins_allowlist
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
production evidence=false
evidence epoch=null
A5 full fail-closed smoke=10/10 pass
```

Final memory-data identities still equal D_PRE_INSTALL even after rollback Gateway startup:

```text
final engine identity=3de94ff539e9fd1758bb6bd4c6aeb1168ba3a9993a64262d11581ee2d6eedda3
final engine=D_PRE_INSTALL=true
final LanceDB identity=8b09acea01890e3d3470bde8d9139cb547f0a43410b4c8804087daeb215e8044
final LanceDB=D_PRE_INSTALL=true
```

## Root Cause

The R6.5 packet treated any config-byte change as a stop condition. OpenClaw `plugins install` updates host bookkeeping field:

```text
meta.lastTouchedAt
```

That timestamp is not part of memory-engine's operational or safety configuration, but it necessarily changes the file hash and byte count. The exact-byte gate was therefore conservative but too strict for this host operation.

The safe replacement is not a broad semantic-equivalence exception. It is one versioned policy that:

```text
ignores only meta.lastTouchedAt for canonical semantic hashing
requires that path to be the only changed JSON path
requires canonical UTC before and after timestamps
requires after >= before
emits changed paths but no raw config or secret values
fails closed on every other path change
rejects symlink config inputs
```

## Follow-Up Gate

Implemented source-only tooling:

```text
bin/config-semantic-equivalence-lib.js
bin/build-config-semantic-equivalence-report.js
test/config-semantic-equivalence.test.js
```

Current source-level result:

```text
B8-A7-R6.5 live remediation attempt=ROLLED BACK / SAFE
B8-A7-R6.5.1 config semantic equivalence repair=PASSED / CLOSED
memory-engine-config-semantic-equivalence-v1 real preserved-config check=PASS
B8-A7-R6.5.2 live remediation retry authorization packet=PASSED / CLOSED
B8-A7-R6.5.2 live retry execution=BLOCKED / NO MUTATION
R6.5.2 retry authorization=CONSUMED / NOT REUSABLE
current recovery transaction root=ABSENT / REBASE REQUIRED
candidate artifact=ABSENT / REBUILD REQUIRED
B8-A7-R6.5.3 persistent artifact rebuild/recovery-source rebase design=PASSED / CLOSED
B8-A7-R6.5.3A persistent artifact preparation authorization packet=PASSED / CLOSED
B8-A7-R6.5.3A persistent artifact preparation execution=BLOCKED / NO PUBLICATION
R6.5.3A authorization=CONSUMED / NOT REUSABLE
persistent authority root=NOT PUBLISHED
B8-A7-R6.5.3A.1 freeze-model repair=NOT STARTED
R6.5.3B recovery-source rebase execution=NOT AUTHORIZED
R6.5.3 candidate activation=NOT AUTHORIZED
```

Repository closeout preflight after the safe rollback and R6.5.1 implementation:

```text
focused execution/authorization/config tests=56/56 pass
config semantic equivalence unit/CLI tests=7/7 pass
static check=529 files pass
full suite=1781 pass / 0 fail / 8 skip
A5 full fail-closed safety smoke=10/10 pass
git diff --check=pass
Gateway RPC=healthy
old installed runtime equals fresh R0=true
exact C0 restored=true
final engine and LanceDB identities equal D_PRE_INSTALL=true
```

A retry requires:

```text
closed R6.5.1 implementation and independent verification
clean repository worktree
revalidation of the same candidate identities
fresh C0 and R0
fresh H0
new Gateway stop/quiesce
fresh D0
new exact operator retry authorization
```

The C0/R0/D0 artifacts from this completed rollback transaction are evidence and emergency recovery artifacts only. They are not fresh authorization inputs for a later retry.

The independent retry contract is [`personal-runtime-live-remediation-retry-authorization-20260721.md`](personal-runtime-live-remediation-retry-authorization-20260721.md). It binds the unchanged candidate identities, preserves the current recovery transaction root, requires a new transaction root with fresh C0/R0/H0/D0, applies `memory-engine-config-semantic-equivalence-v1`, and requires a new exact R6.5.2 operator approval. It does not authorize retry execution.

## Repository and Final Runtime Verification

After recording the safe rollback and implementing the source-only R6.5.1 repair:

```text
focused R6.1-R6.5.1 and authorization-chain tests=70/70 pass
config semantic equivalence unit/CLI tests=7/7 pass
static check=529 files pass
full suite=1781 pass / 0 fail / 8 skip
A5 full fail-closed safety smoke=10/10 pass
git diff --check=pass
```

Final read-only production verification:

```text
Gateway PID=275493
Gateway service=active/running
Gateway RPC healthy=true
Gateway Node=/home/lionsol/.local/node24/bin/node
OpenClaw version=2026.6.9
final config=C0 exact bytes=true
active runtime/R0 difference_count=0
active runtime identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
source/candidate difference_count=0
candidate runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
final engine identity=D_PRE_INSTALL identity
final LanceDB identity=D_PRE_INSTALL identity
final install sourcePath=/tmp/memory-engine-r6.5-live-2415dfe/runtime/r0
```

The transaction root must remain available until a later reviewed operation replaces the rollback install record with another durable source. Do not delete `/tmp/memory-engine-r6.5-live-2415dfe` merely because the Gateway is healthy.

## Current Boundary

```text
B8-A7-R6.5 authorization packet=PASSED / CLOSED
B8-A7-R6.5 live remediation execution=ROLLED BACK / SAFE
candidate Gateway activation=NOT REACHED
candidate currently active=false
old runtime restored=true
configuration restored to exact C0=true
memory data restored from D0=false / NOT REQUIRED
B8-A7-R6.5.1 config semantic equivalence repair=PASSED / CLOSED
B8-A7-R6.5.2 live remediation retry authorization packet=PASSED / CLOSED
B8-A7-R6.5.2 live retry execution=BLOCKED / NO MUTATION
R6.5.2 retry authorization=CONSUMED / NOT REUSABLE
fresh R6.5.2 C0/R0/H0/D0=NOT CREATED
current recovery transaction root=ABSENT / REBASE REQUIRED
candidate artifact=ABSENT / REBUILD REQUIRED
installed-plugin recovery sourcePath=DANGLING
B8-A7-R6.5.3 persistent artifact rebuild/recovery-source rebase design=PASSED / CLOSED
B8-A7-R6.5.3A persistent artifact preparation authorization packet=PASSED / CLOSED
B8-A7-R6.5.3A persistent artifact preparation execution=BLOCKED / NO PUBLICATION
R6.5.3A authorization=CONSUMED / NOT REUSABLE
persistent authority root=NOT PUBLISHED
B8-A7-R6.5.3A.1 freeze-model repair=NOT STARTED
R6.5.3B recovery-source rebase execution=NOT AUTHORIZED
R6.5.3 candidate activation=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

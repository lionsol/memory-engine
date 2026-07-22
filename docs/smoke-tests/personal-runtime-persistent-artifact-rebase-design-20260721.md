# B8-A7-R6.5.3 Persistent Artifact Rebuild and Recovery-Source Rebase Design

> **Status: PASSED / CLOSED**
>
> Date: 2026-07-21
>
> Design only. Persistent artifact preparation, installed-plugin sourcePath repair, Gateway mutation, and candidate activation are not authorized.

## Purpose

R6.5.2 was blocked before mutation because both filesystem authorities named by its packet were gone:

```text
candidate=/tmp/memory-engine-r6.4-9b6b734/candidate=ABSENT
current recovery root=/tmp/memory-engine-r6.5-live-2415dfe=ABSENT
installed sourcePath=/tmp/memory-engine-r6.5-live-2415dfe/runtime/r0=DANGLING
```

The active extension remains operational, but its install record no longer names an existing recovery source. R6.5.3 defines how to rebuild durable authorities and repair that record without combining rollback repair with reviewed-source activation.

## Governing Decision

Use a persistent owner-only artifact root under the OpenClaw backup tree:

```text
PERSISTENT_ROOT=$HOME/.openclaw/backups/memory-engine/r6.5.3/<UTC-run-id>
```

The root must be on the durable WSL home filesystem and must not resolve beneath:

```text
/tmp
/run
/dev/shm
```

It must not be a symlink, bind to an ephemeral filesystem, or depend on a path that normal temporary-file cleanup may remove.

R6.5.3 separates three responsibilities:

```text
R6.5.3A=offline persistent candidate and R0 preparation
R6.5.3B=live recovery-source rebase to persistent R0
later candidate activation=separate stage and separate authorization
```

The rebase transaction installs only an exact copy of the current active runtime. It does not install the reviewed candidate.

## Rejected Repairs

Never repair the dangling record by recreating the old path:

```text
/tmp/memory-engine-r6.5-live-2415dfe/runtime/r0
```

A path with the same name is not the same authority. Recreating it could silently bind the install record to unreviewed bytes.

Also forbidden:

```text
symlink old /tmp path to a new persistent root
bind-mount a replacement over the old /tmp path
manually edit OpenClaw config or registry sourcePath
copy the repository directly into the active extension
install the reviewed candidate during the recovery-source rebase
reuse the consumed R6.5.2 authorization
trust an artifact by path or filename without fresh manifests
```

## Persistent Root Layout

Build in a sibling staging directory and publish by same-filesystem atomic rename only after all manifests pass:

```text
$HOME/.openclaw/backups/memory-engine/r6.5.3/
  .staging-<UTC-run-id>/
  <UTC-run-id>/
    authority.json
    source/
      reviewed-head.txt
      source-archive.tgz
      source-archive.sha256
      package-lock.json
      package-lock.sha256
    candidate/
    recovery/
      r0/
    config/
      preparation-config.sha256
    evidence/
      filesystem.json
      repository.json
      candidate-artifact-manifest.json
      candidate-parity.json
      candidate-native-smoke.json
      r0-artifact-manifest.json
      r0-active-parity.json
      r0-native-smoke.json
      authority-verification.json
```

Requirements:

```text
persistent parent mode=0700
run root mode=0700
authority and evidence files mode=0600
no root or parent symlink
no hardlink or reflink to active runtime, config, or memory data
candidate and R0 remain separate directory trees
all copy operations use independent bytes
all identities are reverified immediately before any later live transaction
```

The tree may preserve runtime file modes. Durability is established by the persistent filesystem, owner-only parent, canonical manifests, no shared inodes, and mandatory revalidation rather than by path trust.

## Authority Manifest

`authority.json` is a non-secret, mode-0600 index with at least:

```text
schema=memory-engine-persistent-runtime-authority-v1
run_id
created_at
published_at
repository_head
repository_clean=true
persistent_root
filesystem_source
filesystem_type
candidate_artifact_identity
candidate_runtime_identity
r0_artifact_identity
r0_runtime_identity
active_runtime_identity_at_preparation
candidate_source_parity_zero
r0_active_parity_zero
candidate_native_smoke_pass
r0_native_smoke_pass
published=true
```

It must not contain configuration contents, credentials, API keys, database rows, or memory text.

The final run directory is not an authority until `published=true` and every referenced evidence file exists and verifies.

## R6.5.3A Offline Persistent Preparation

This phase may be authorized separately without Gateway mutation.

### Repository gate

```text
worktree clean
reviewed HEAD recorded and reachable
package lock exact
Node=v24.8.0
ABI=137
focused tests pass
static check passes
full suite failures=0
A5 smoke=10/10
```

Documentation-only commits may leave the runtime closure unchanged, but no identity may be assumed. Recalculate both the runtime identity and full artifact identity.

The historical candidate identity `0490e607…44f42` is evidence only. A rebuilt candidate receives a new artifact identity even if its runtime closure remains `dc459f5…d718`.

### Candidate rebuild

Use the R6.3 selected model under the persistent staging root:

```text
clean source
-> npm pack archive
-> extract candidate
-> exact package-lock
-> Node 24 npm ci --omit=dev with lifecycle scripts enabled
-> native SQLite and LanceDB smoke
-> source/candidate runtime parity=0
-> canonical artifact manifest
```

The candidate must not be installed into the active OpenClaw environment during preparation.

### Persistent R0 creation

Create `recovery/r0` from the current active extension using an archive-preserving copy with reflinks disabled.

Required evidence:

```text
active runtime readable
active runtime build identity valid
active artifact identity before copy=active artifact identity after copy
r0 artifact identity=stable active artifact identity
r0 runtime identity=active runtime identity
active/r0 difference_count=0
shared file inode count=0
external symlink count=0
external hardlink reference count=0
R0 Node 24 native smoke=pass
R0 canonical artifact manifest=valid
```

If the active artifact identity changes during the copy window, discard the staging R0 and restart preparation. R0 is an exact runtime recovery source, not a candidate and not a repository checkout.

### Atomic publication

Publication is allowed only after all preparation gates pass:

```text
staging root and final root share filesystem
final root does not already exist
all manifests valid
all referenced files present
candidate/source parity=0
R0/active parity=0
native smokes pass
no shared inodes
```

Rename `.staging-<run-id>` to `<run-id>` atomically. Failed staging roots are not install authorities and must be clearly marked failed before later cleanup.

## R6.5.3B Recovery-Source Rebase

This is a later live transaction with a new exact authorization. It repairs the installed-plugin sourcePath while preserving the current runtime bytes.

### Required preflight

```text
R6.5.3A persistent preparation=PASSED / CLOSED
persistent authority root exists
persistent authority manifest valid
prepared R0 runtime identity=current active runtime identity
prepared R0/active difference_count=0
prepared candidate remains unused
Gateway healthy under Node 24 / ABI 137
active-memory disabled by effective host policy
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
production evidence=false
worktree clean
```

Any drift in active runtime requires a new R0. Do not rebase using a stale R0.

### Fresh transaction evidence

Before live mutation create a separate transaction root under the same persistent backup base:

```text
$HOME/.openclaw/backups/memory-engine/r6.5.3-rebase/<UTC-run-id>/
  config/c0/
  host/h0/
  data/d0/
  evidence/
```

C0 is exact config rollback authority. H0 records Gateway, OpenClaw, registry, active runtime, and safe feature state. D0 is created only after Gateway stop and quiescence and covers memory-engine SQLite plus LanceDB, never the core DB.

### Rebase operation

After exact authorization:

```text
stop Gateway through explicit Node 24 OpenClaw entrypoint
prove service inactive, port closed, old PID exited, no memory-store holder
create fresh D0
record D_PRE_REBASE identities
plugins install <persistent-root>/recovery/r0 --force
record D_POST_INSTALL identities
require D_POST_INSTALL=D_PRE_REBASE
require installed runtime/persistent R0 parity=0
require installed runtime identity unchanged
apply memory-engine-config-semantic-equivalence-v1
require sourcePath=<persistent-root>/recovery/r0
run Node 24 native smokes
start Gateway
wait bounded readiness interval
verify Gateway health and safe feature state
run focused tests, full suite, and A5 10/10
```

The reviewed candidate must remain unused throughout this transaction.

### Rebase rollback

The persistent R0 is both the forward content and the runtime recovery source because it equals the pre-transaction active runtime.

On any stop condition:

```text
keep Gateway stopped
reinstall the same persistent R0 if target replacement is incomplete
restore exact C0 if config differs
restore D0 only if data identities changed
prove installed runtime identity equals pre-transaction active runtime
start old runtime and verify Gateway health
```

A failed rebase does not authorize candidate activation.

## Post-Rebase Acceptance

Success requires:

```text
active runtime identity unchanged
active runtime/persistent R0 difference_count=0
installed sourcePath exists
installed sourcePath=<persistent-root>/recovery/r0
config semantic status=exact_equal or approved_host_metadata_change
data identities unchanged
Gateway Node=v24.8.0
Gateway ABI=137
Gateway RPC healthy
active-memory=false
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
production evidence=false
A5=10/10
```

Only after this succeeds may the old dangling sourcePath defect close.

## Later Candidate Activation

Candidate activation is a later stage with a fresh exact authorization binding:

```text
persistent candidate artifact identity
persistent candidate runtime identity
persistent R0 artifact identity
persistent R0 runtime identity
config semantic policy
fresh C0/H0/D0 and bounded rollback
```

It must not reuse R6.5, R6.5.2, or recovery-source rebase authorization.

## Retention and Cleanup

```text
persistent R0 must remain while installed sourcePath points to it
persistent candidate remains until activation and rollback closeout
transaction D0/C0 evidence remains through independent closeout
cleanup requires a separate reviewed decision
no automatic temporary-file cleanup applies
```

Deleting or modifying an active authority invalidates future execution and blocks mutation.

## Repository Preflight

After implementing this design without live mutation:

```text
focused R6.3-R6.5.3, artifact, parity, config, ledger, and authorization tests=54/54 pass
static check=532 files pass
git diff --check=pass
Gateway service=active
Gateway PID=344
persistent authority root=not created
candidate install=not performed
Gateway stop/start/restart=not performed
configuration mutation=not performed
memory-data restoration=not performed
```

Independent verification completed successfully after commit `048ab0d`; the design is passed and closed. R6.5.3A execution remains separately unauthorized.

## Current Boundary

```text
B8-A7-R6.5.2 live retry execution=BLOCKED / NO MUTATION
R6.5.2 retry authorization=CONSUMED / NOT REUSABLE
candidate artifact=ABSENT / REBUILD REQUIRED
current recovery transaction root=ABSENT / REBASE REQUIRED
installed-plugin recovery sourcePath=DANGLING
B8-A7-R6.5.3 persistent artifact rebuild/recovery-source rebase design=PASSED / CLOSED
B8-A7-R6.5.3A persistent artifact preparation authorization packet=PASSED / CLOSED
R6.5.3A persistent artifact preparation execution=NOT AUTHORIZED
R6.5.3B recovery-source rebase execution=NOT AUTHORIZED
R6.5.3 candidate activation=NOT AUTHORIZED
persistent authority root=NOT CREATED
persistent candidate=NOT CREATED
persistent R0=NOT CREATED
Gateway stop/start/restart=NOT AUTHORIZED
configuration mutation=NOT AUTHORIZED
memory-data restoration=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
B8-B removal=NOT AUTHORIZED
```

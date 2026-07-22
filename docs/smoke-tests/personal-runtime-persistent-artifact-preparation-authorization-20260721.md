# B8-A7-R6.5.3A Offline Persistent Artifact Preparation Authorization

> **Status: PASSED / CLOSED**
>
> Date: 2026-07-21
>
> Governing design: [`personal-runtime-persistent-artifact-rebase-design-20260721.md`](personal-runtime-persistent-artifact-rebase-design-20260721.md)
>
> This packet authorizes nothing by itself. It defines a future offline preparation transaction only.

## Purpose

R6.5.3A rebuilds two durable, independently verified authorities under a persistent owner-only root:

```text
persistent candidate = reviewed committed source plus exact Node 24 runtime dependencies
persistent R0        = exact stable copy of the currently active installed runtime
```

The stage does not install either tree into OpenClaw. It does not change the installed-plugin record, stop or restart the Gateway, change configuration, open databases, restore data, activate AutoRecall, enable production evidence, or authorize candidate activation.

## Required Persistent Parent

The only allowed parent is:

```text
$HOME/.openclaw/backups/memory-engine/r6.5.3
```

The execution run uses:

```text
PERSISTENT_PARENT=$HOME/.openclaw/backups/memory-engine/r6.5.3
STAGING_ROOT=$PERSISTENT_PARENT/.staging-<UTC-run-id>-<random>
FINAL_ROOT=$PERSISTENT_PARENT/<UTC-run-id>-<random>
```

Requirements:

```text
PERSISTENT_PARENT mode=0700
STAGING_ROOT mode=0700
FINAL_ROOT mode=0700
STAGING_ROOT and FINAL_ROOT on the same filesystem
FINAL_ROOT absent before publication
no path component is a symlink
no artifact path is under /tmp, /run, /dev/shm, the repository, or the active extension
```

Do not recreate a historical `/tmp` pathname, use a symlink or bind mount to resurrect it, or modify OpenClaw metadata to point to an incomplete staging tree.

## Execution-Time Identity Binding

The exact authorization must bind values refreshed immediately before preparation:

```text
reviewed source HEAD=<clean committed HEAD>
active runtime identity=<current runtime build identity>
persistent parent=$HOME/.openclaw/backups/memory-engine/r6.5.3
Gateway PID=<current PID>
Gateway Node=<current Node 24 executable>
```

The reviewed source HEAD must be reachable in Git, with a clean index and worktree. The active runtime identity must be computed from `/home/lionsol/.openclaw/extensions/memory-engine` using the reviewed runtime dependency closure.

The packet does not pre-authorize a different HEAD or runtime identity. Any mismatch requires a new exact authorization.

## No-Mutation Preflight

Before creating `STAGING_ROOT`, verify:

```text
R6.5.3 design=PASSED / CLOSED
repository worktree clean
repository index clean
reviewed HEAD equals authorized HEAD
Gateway active and healthy under Node 24 / ABI 137
active extension root exists and is not a symlink
active runtime identity equals authorized identity
installed-plugin sourcePath may be dangling but installPath remains the active extension
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
production evidence=false
persistent final root does not already exist
core DB is not opened or copied
```

A failure returns:

```text
R6.5.3A PREPARATION BLOCKED / NEW AUTHORIZATION REQUIRED
```

No partial authority may be published.

## Staging Layout

```text
STAGING_ROOT/
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
    openclaw.json.identity.json
  evidence/
    source-state.json
    active-runtime-before.json
    active-runtime-after.json
    active-r0-parity.json
    candidate-runtime-parity.json
    candidate-artifact-manifest.json
    r0-artifact-manifest.json
    candidate-native-smoke.json
    r0-native-smoke.json
    publication-preflight.json
```

Files containing local paths or identities are mode `0600`. Candidate and R0 directories become read-only after verification. No file is a hardlink, reflink, or symlink to production configuration, runtime, or data.

## Persistent Candidate Preparation

Use the reviewed committed source, not the active runtime and not a workspace directory install.

Required flow:

```text
record exact reviewed HEAD
npm pack reviewed source under Node 24
verify archive hash and package metadata
extract archive into STAGING_ROOT/candidate
copy exact reviewed package-lock.json
run Node 24 npm ci --omit=dev with lifecycle scripts enabled
verify resolved dependency versions
run better-sqlite3 native smoke under Node 24 / ABI 137
run LanceDB native smoke against a disposable directory under STAGING_ROOT
compute source/candidate runtime parity
require source/candidate difference_count=0
compute canonical full-tree candidate artifact manifest
require no writable files or directories after freeze
require no external symlink or hardlink references
```

The candidate runtime identity is an output of R6.5.3A. It must not be assumed from the deleted R6.4 `/tmp` candidate merely because the source runtime closure is expected to match.

## Persistent R0 Preparation

R0 is copied from the current active extension and must remain byte-for-byte and structure-for-structure identical to one stable active runtime state.

Required flow:

```text
compute active full-tree artifact identity before copy
copy active extension to STAGING_ROOT/recovery/r0 without links or reflinks
compute active full-tree artifact identity after copy
compute R0 full-tree artifact identity
require active-before identity=active-after identity
require R0 identity=stable active identity
compute active/R0 runtime parity
require difference_count=0
run Node 24 SQLite and LanceDB native smokes from R0
freeze R0 read-only
```

If active identity changes during the copy window, discard the staging R0 and restart preparation. Do not stop the Gateway under this authorization.

## Configuration Identity

R6.5.3A records only a non-secret identity summary for the current configuration:

```text
path identity
file type
mode
byte count
SHA-256
```

It must not copy `openclaw.json` into the authority root and must not emit configuration values.

## Authority Manifest

`authority.json` is mode `0600` and contains only non-secret metadata:

```text
schema_version
created_at
reviewed_head
source_archive_sha256
package_lock_sha256
candidate_runtime_identity
candidate_artifact_identity
r0_runtime_identity
r0_artifact_identity
active_runtime_identity_before
active_runtime_identity_after
node_version
node_module_version
persistent_root
published
```

Before publication:

```text
published=false
```

After every gate passes, write the final manifest in staging with:

```text
published=true
```

Then publish only through a same-filesystem atomic rename from `STAGING_ROOT` to `FINAL_ROOT`.

## Failure and Cleanup

On any failure:

```text
never rename staging to final
delete only the newly created staging root
leave the active extension untouched
leave OpenClaw configuration and registry untouched
leave Gateway running
leave engine SQLite, LanceDB, and core DB untouched
record a repository decision only after inspection
```

Do not delete an existing published authority root under this authorization.

## Required Success Evidence

R6.5.3A succeeds only if all are true:

```text
FINAL_ROOT exists and mode=0700
authority.json published=true
reviewed HEAD equals authorized HEAD
candidate source/runtime parity=0
candidate native smokes pass under Node 24 / ABI 137
candidate artifact manifest valid
candidate tree frozen and self-contained
active-before artifact identity=active-after artifact identity
R0 artifact identity=stable active artifact identity
active/R0 runtime parity=0
R0 native smokes pass under Node 24 / ABI 137
R0 tree frozen and self-contained
Gateway PID unchanged
Gateway remained healthy
config identity unchanged
installed-plugin sourcePath unchanged and still dangling
memory data identities unchanged by observation-only checks or not opened
```

R6.5.3A success does not repair `sourcePath`. It produces the durable inputs required for a later R6.5.3B authorization packet.

## Exact Preparation Approval

Execution may begin only after the operator sends exactly this identity-bearing form with current values substituted:

```text
AUTHORIZE B8-A7-R6.5.3A OFFLINE PERSISTENT ARTIFACT PREPARATION
reviewed source HEAD=<exact clean committed HEAD>
active runtime identity=<exact current active runtime identity>
persistent parent=/home/lionsol/.openclaw/backups/memory-engine/r6.5.3
Gateway PID=<exact current PID>
offline candidate and exact active-runtime R0 staging, validation, freeze, and atomic publication are authorized
Gateway stop/start/restart, OpenClaw install/reload, sourcePath mutation, candidate activation, configuration mutation, and memory-data mutation are not authorized
```

A generic “continue,” the consumed R6.5.2 authorization, or an approval with missing or stale values is insufficient.

## Current Boundary

```text
B8-A7-R6.5.3 persistent artifact rebuild/recovery-source rebase design=PASSED / CLOSED
B8-A7-R6.5.3A persistent artifact preparation authorization packet=PASSED / CLOSED
R6.5.3A persistent artifact preparation execution=NOT AUTHORIZED
explicit R6.5.3A preparation approval=NOT RECEIVED
persistent authority root=NOT CREATED
persistent candidate=NOT CREATED
persistent R0=NOT CREATED
R6.5.3B recovery-source rebase execution=NOT AUTHORIZED
R6.5.3 candidate activation=NOT AUTHORIZED
Gateway stop/start/restart=NOT AUTHORIZED
OpenClaw install/reload=NOT AUTHORIZED
configuration mutation=NOT AUTHORIZED
memory-data mutation=NOT AUTHORIZED
AutoRecall activation=NOT AUTHORIZED
production evidence activation=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
B8-B removal=NOT AUTHORIZED
```

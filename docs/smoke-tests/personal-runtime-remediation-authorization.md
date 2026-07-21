# B8-A7-R6.3 Personal Runtime Remediation Authorization Design

> **Status: Design-only authorization contract / execution not authorized**
>
> Date: 2026-07-21
>
> Governing profile: [`../adr/personal-deployment-safety-profile.md`](../adr/personal-deployment-safety-profile.md)
>
> Preceding decisions:
>
> - [`personal-deployment-read-only-baseline-decision-20260721.md`](personal-deployment-read-only-baseline-decision-20260721.md)
> - [`host-activation-boundary-compatibility.md`](host-activation-boundary-compatibility.md)

## Purpose

R6.3 defines the exact personal-deployment transaction needed to replace the stale installed memory-engine runtime with the reviewed source while preserving a usable rollback path.

It is a design and authorization packet only. It does not create backups, build a candidate, install a plugin, stop or restart the Gateway, rebuild native dependencies in the live runtime, change configuration, open an evidence epoch, or enable AutoRecall.

The target defect is narrow:

```text
reviewed source and installed runtime differ by 28 dependency-closure files
installed runtime lacks memoryEngine.sustainedRuntimePreflight
installed runtime lacks memoryEngine.productionEvidenceHealthcheck
loaded Gateway cannot expose those reviewed methods until the runtime is synchronized
```

R6.2 has already removed the false active-memory blocker. The current host state is:

```text
active_memory_enabled=false
active_memory_resolution=disabled_by_plugins_allowlist
```

## Current Bound Identities

The execution review must refresh every identity immediately before mutation, but the design baseline is:

```text
OpenClaw version=2026.6.9
OpenClaw entrypoint=/home/lionsol/.local/lib/node_modules/openclaw/openclaw.mjs
Gateway service=openclaw-gateway.service
Gateway Node=/home/lionsol/.local/node24/bin/node
Gateway Node version=v24.8.0
Gateway NODE_MODULE_VERSION=137
current runtime root=/home/lionsol/.openclaw/extensions/memory-engine
current install source=path
current install sourcePath=/home/lionsol/.openclaw/workspace/plugins/memory-engine
current plugin version=0.8.22
current runtime build identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
current source/runtime difference_count=28
current safe config fingerprint=502802868b51ee459691729b99c00a94d2c91081334952f32a743dbd18e1c79f
```

The reviewed commit used for the actual candidate must be the clean repository HEAD approved at the later execution review. Do not hard-code `9e60531` as the future install identity merely because it closed R6.2.

## Rejected Synchronization Routes

### Direct workspace directory install

Do not execute:

```bash
openclaw plugins install . --force
```

OpenClaw 2026.6.9 copies local directories recursively without excluding `.git`, development files, tests, reports, or the existing `node_modules` tree. The inspected source checkout is approximately 938 MB and the current extension approximately 859 MB.

For local directory installs, OpenClaw does not install runtime dependencies. It copies whatever dependency tree is already present. This makes the result depend on the developer checkout and whichever Node ABI last built that checkout.

### Direct archive install

Do not install an ordinary `npm pack` archive directly through OpenClaw.

The archive path does request dependency installation, but OpenClaw 2026.6.9 invokes:

```text
npm install --omit=dev --ignore-scripts
```

`better-sqlite3` requires its install lifecycle to obtain or build the native binary. An archive with no `node_modules` plus `--ignore-scripts` cannot be treated as a validated ABI-137 candidate.

### Linked source install

Do not use:

```bash
openclaw plugins install --link <source>
```

A linked runtime makes later source edits immediately affect the production plugin and removes the reviewed-copy and rollback boundary.

### CLI-local runtime inspection

Do not use:

```bash
openclaw plugins inspect memory-engine --runtime --json
```

In OpenClaw 2026.6.9 this imports the plugin into the CLI process. The default shell resolves that CLI through Node 22 / ABI 127 rather than querying the already-running Node 24 Gateway. It can also initialize plugin storage.

Use cold inspection and Gateway RPC instead.

## Selected Deployment Model

The selected model is an offline, dependency-complete candidate directory:

```text
clean reviewed source
  -> npm pack source archive
  -> extract into isolated candidate root
  -> copy exact reviewed package-lock.json
  -> Node 24 npm ci --omit=dev with lifecycle scripts enabled
  -> native in-memory smoke
  -> source/candidate parity=0
  -> immutable evidence manifest
  -> later OpenClaw local-directory install from the completed candidate
```

This combines the advantages of both OpenClaw install paths:

```text
npm pack excludes .git and source node_modules
operator-controlled Node 24 build produces ABI-compatible native dependencies
OpenClaw local-directory install copies the already validated dependency tree
OpenClaw still performs its staged target replacement and installed-package scan
```

The inspected dry-run package facts were:

```text
archive bytes=1215892
unpacked bytes=5532037
file count=612
contains .git=false
contains node_modules=false
contains tests=true
contains docs=true
```

Tests and docs remain in the candidate for this remediation. Reducing the published file list is a separate packaging task and must not be mixed with the runtime repair.

## Artifact Root

A later approved preparation stage must use one owner-only root outside the repository and outside the active extension directory:

```text
ARTIFACT_ROOT=$HOME/.openclaw/backups/memory-engine/r6.3/<UTC-run-id>
```

Required layout:

```text
ARTIFACT_ROOT/
  source/
    reviewed-head.txt
    source-archive.tgz
    source-archive.sha256
    package-lock.json
    package-lock.sha256
  candidate/
    package files
    node_modules/
  rollback-runtime/
    exact pre-change runtime tree
  config/
    openclaw.json.pre
  memory-data/
    memory-engine/
    lancedb/
  evidence/
    repository-identity.json
    openclaw-cold-inspect.json
    openclaw-registry.json
    gateway-status-pre.json
    candidate-parity.json
    candidate-native-smoke.json
    runtime-parity-post-install.json
    runtime-preflight-post-start.json
    tools-catalog-post-start.json
    gateway-status-post.json
    rollback-verification.json
```

The artifact root must be mode `0700`. Config and manifest files containing local paths must be mode `0600`. No artifact may be a symlink or hardlink to the active configuration, runtime, or data paths.

## R6.4 Offline Candidate Preparation

R6.4 is the next stage after this design closes. It may build and validate the candidate and rehearse supported installation only against a fully isolated OpenClaw home/state/config. It may not change the active OpenClaw environment.

### Source gate

Required source state:

```text
worktree clean
index clean
reviewed HEAD recorded
reviewed HEAD reachable in Git
package.json version recorded
package-lock lockfileVersion=3
better-sqlite3 locked version=11.10.0
@lancedb/lancedb locked version=0.29.0
focused tests pass
static check passes
full suite has zero failures
A5 smoke passes 10/10
```

### Source archive

The later approved command must run through Node 24:

```bash
cd /home/lionsol/.openclaw/workspace/plugins/memory-engine
PATH="$HOME/.local/node24/bin:$PATH" \
  npm pack --ignore-scripts --pack-destination "$ARTIFACT_ROOT/source"
```

Record the exact archive filename, byte count, and SHA-256.

Extract only into the artifact root. Reject path traversal, symlinks outside the root, unexpected nested package roots, or a package id/version mismatch.

`npm pack` does not include `package-lock.json`; copy the exact reviewed lockfile into the extracted candidate and bind its SHA-256 separately.

### Node 24 dependency installation

The candidate dependency command must explicitly enable lifecycle scripts because the source and lockfile are operator-reviewed:

```bash
cd "$ARTIFACT_ROOT/candidate"
PATH="$HOME/.local/node24/bin:$PATH" \
  npm ci \
    --omit=dev \
    --ignore-scripts=false \
    --no-audit \
    --no-fund
```

Before running, remove inherited `NPM_CONFIG_IGNORE_SCRIPTS` and `npm_config_ignore_scripts` values or override them explicitly. Record:

```text
node executable
node version
NODE_MODULE_VERSION
npm executable
npm version
registry/cache source if relevant
install exit code
installed dependency versions
```

The command may write only inside the isolated candidate and npm cache. It must never run in the repository or active extension directory.

### Native smoke

The candidate must prove actual native use, not merely load the JavaScript wrapper.

Required smoke:

```text
Node=v24.8.0
NODE_MODULE_VERSION=137
require better-sqlite3
open :memory: database
create table
insert row
read row
close database
load @lancedb/lancedb
open a disposable LanceDB directory under ARTIFACT_ROOT
create/read a disposable table where supported
remove disposable database
```

No smoke may access:

```text
~/.openclaw/memory/main.sqlite
~/.openclaw/memory/memory-engine/memory-engine.sqlite
~/.openclaw/memory/lancedb
```

### Candidate parity

Run the existing parity tool:

```bash
$HOME/.local/node24/bin/node \
  bin/build-runtime-source-parity-report.js \
  --source-root /home/lionsol/.openclaw/workspace/plugins/memory-engine \
  --runtime-root "$ARTIFACT_ROOT/candidate" \
  --checked-at <canonical-UTC-ISO> \
  --out "$ARTIFACT_ROOT/evidence/candidate-parity.json" \
  --pretty
```

Required result:

```text
source_runtime_equal=true
difference_count=0
source_identity_valid=true
runtime_identity_valid=true
candidate runtime build identity=<recorded SHA-256 identity>
```

### Candidate immutability gate

After the candidate passes validation:

```text
record deterministic runtime-closure inventory
record complete package inventory
record candidate tree byte count
make candidate non-writable to accidental operator edits where practical
re-hash immediately before live install
```

Any change invalidates the candidate.

## Pre-Mutation Authorization Packet

A later execution review must refresh and approve all of the following. R6.3 does not create them.

### C0: exact OpenClaw config backup

Bind:

```text
live path=/home/lionsol/.openclaw/openclaw.json
backup path under ARTIFACT_ROOT/config
exact byte equality
SHA-256
byte count
mode 0600
separate inode
non-symlink
non-hardlink
```

### R0: exact pre-change runtime recovery tree

Copy the whole current runtime tree outside the extension install base:

```text
source=/home/lionsol/.openclaw/extensions/memory-engine
destination=ARTIFACT_ROOT/rollback-runtime
copy semantics=preserve files, modes, timestamps, symlinks, and internal hardlink relationships
root must be an independent directory
```

R0 intentionally includes the current dependency tree and development files because it is an emergency exact recovery source, not the new deployment format.

Required verification:

```text
current runtime build identity matches recorded pre-change identity
R0 runtime build identity matches current runtime identity
selected full-tree inventory matches
better-sqlite3 in R0 is compatible with Gateway ABI 137
```

### H0: host state evidence

Capture without `--runtime`:

```text
openclaw plugins inspect memory-engine --json
openclaw plugins inspect active-memory --json
openclaw plugins registry --json
openclaw gateway status --json
systemd service definition
Gateway PID/start timestamp
Gateway Node executable/version/ABI
config SHA-256
```

Expected pre-state:

```text
memory-engine enabled=true
active-memory enabled=false
active-memory reason=not in allowlist
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
productionEvidenceWindow.enabled=false
no evidence epoch
Gateway healthy
```

### D0: quiesced memory-data snapshot

The memory-data backup must occur only after the Gateway is stopped and no memory-engine process is using the stores.

Snapshot:

```text
~/.openclaw/memory/memory-engine
~/.openclaw/memory/lancedb
```

Record core DB files only as untouched boundary evidence; do not copy or manipulate the OpenClaw core DB as part of this plugin remediation.

The snapshot is a rollback safety artifact. Restoring it is a separate emergency action and must occur only when post-start evidence shows the new runtime changed memory data incompatibly. Do not overwrite healthy new data merely because runtime rollback is required.

## Planned Live Transaction

The following sequence is not authorized by this document.

### 1. Final preflight

Immediately before stopping the Gateway:

```text
candidate hash unchanged
candidate parity=0
candidate native smoke=pass
source worktree still clean
source HEAD unchanged
C0 and R0 verified
Gateway healthy
safe feature state unchanged
no uncontrolled rollout or evidence activity
```

### 2. Stop and quiesce

Use the exact Node 24 OpenClaw entrypoint:

```bash
$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  gateway stop --json
```

Verify:

```text
systemd service inactive
Gateway port 18789 not listening
previous Gateway PID exited
no memory-engine process holds engine SQLite or LanceDB files
```

Then create and verify D0.

The install command is not assumed data-neutral. R6.4 later proved that OpenClaw imports memory-engine during install validation and may initialize memory-engine SQLite and LanceDB state in the selected OpenClaw state directory. Therefore D0 and pre-install store identities must exist before the live install command.

### 3. Install the validated candidate

Use Node 24 explicitly from a stable working directory outside the active runtime, candidate, rollback tree, and OpenClaw stage/backup directories:

```bash
cd /home/lionsol/.openclaw/workspace/plugins/memory-engine

$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  plugins install "$ARTIFACT_ROOT/candidate" --force
```

Do not run the install or subsequent verification while the shell current working directory is inside the runtime being replaced. R6.4 reproduced `ENOENT: no such file or directory, uv_cwd` after a successful replacement invalidated such a cwd.

The candidate already contains production dependencies. OpenClaw should treat this as a local directory update, stage the complete tree, scan it, move the old target to its internal temporary backup, publish the staged candidate, update the installed-plugin record, and remove its internal backup after success.

OpenClaw may import memory-engine during installation validation. Before Gateway start, capture and compare engine SQLite and LanceDB identities against the post-D0 pre-install baseline. An unreviewed semantic data change blocks startup and requires the applicable rollback branch.

The OpenClaw internal backup is not a substitute for R0 because it is removed after a successful install.

### 4. Pre-start disk verification

Before starting the Gateway:

```text
cold inspect installPath is unchanged
cold inspect version is 0.8.22
installed runtime root is a regular directory
installed runtime parity against reviewed source=0
installed runtime build identity equals candidate identity
installed dependency versions equal candidate manifest
Node 24 native :memory: smoke passes against installed runtime
config SHA-256 equals C0 unless a separately reviewed host mutation was expected
active-memory boundary remains clean
AutoRecall/full/evidence remain disabled
engine SQLite semantic identity is unchanged unless separately reviewed
LanceDB logical identity is unchanged unless separately reviewed
WAL/SHM housekeeping is recorded separately from semantic data changes
```

Any failure rolls back before Gateway start.

### 5. Start Gateway

Use:

```bash
$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  gateway start --json
```

Wait for:

```text
service active/running
new Gateway PID
Gateway Node=/home/lionsol/.local/node24/bin/node
Gateway ABI=137
RPC healthy
OpenClaw version=2026.6.9
memory-engine listed in Gateway startup plugin set
no startup exception from memory-engine
```

### 6. Loaded runtime verification

Call the reviewed operator-read preflight:

```bash
openclaw gateway call memoryEngine.sustainedRuntimePreflight \
  --params '{}' \
  --json
```

Required result:

```text
status=clean
loaded runtime build identity=candidate identity
live config path=/home/lionsol/.openclaw/openclaw.json
live config SHA-256=expected post-install hash
active_memory_enabled=false
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
production evidence=false
```

Do not execute `memoryEngine.productionEvidenceHealthcheck` while the evidence window is inactive. Its registration may be proven by receiving its expected domain failure rather than `unknown method`, or by a Gateway method catalog if available.

### 7. Tool registration verification

Use the already-running Gateway:

```bash
openclaw gateway call tools.catalog \
  --params '{"agentId":"edi","includePlugins":true}' \
  --json
```

Required registered tools:

```text
memory_engine
memory_engine_search
memory_engine_get
```

Tool visibility for a specific profile is separate from registration. Record the catalog profile and any filtering reason.

### 8. Post-start tests

Run only after Gateway health and loaded identity are proven:

```text
post-install source/runtime parity=0
focused Gateway registration tests pass
static check passes
full repository suite has zero failures
A5 smoke passes 10/10
a no-op/manual diagnostic does not enable AutoRecall or evidence
```

No memory search traffic should be manufactured merely to prove registration.

## Rollback Branches

### Install failure before publish

OpenClaw should restore its internal target backup. Verify:

```text
current runtime build identity=pre-change identity
cold install record is coherent
config SHA-256=C0
Gateway remains stopped
```

Use R0 only if the internal restoration cannot be proved.

### Post-install disk verification failure

Before Gateway start, reinstall R0 through the same Node 24 host path:

```bash
$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  plugins install "$ARTIFACT_ROOT/rollback-runtime" --force
```

Verify the old runtime identity and native ABI before starting the Gateway.

The rollback install record may now name `rollback-runtime` as its source path. That is an acceptable emergency state but must be recorded; do not falsely claim the original sourcePath was restored.

### Gateway start or loaded verification failure

Stop the failed Gateway if it is running, reinstall R0, restore C0 only when its bytes changed, and start the Gateway through Node 24.

Required rollback result:

```text
Gateway healthy
runtime build identity=pre-change identity
active-memory still disabled
AutoRecall/full/evidence inactive
A5 smoke=10/10
config bytes either unchanged or restored to C0
rollback install source recorded accurately
```

### Memory-data incompatibility

Runtime rollback does not automatically restore D0.

Restore D0 only when all are true:

```text
Gateway stopped
new runtime produced confirmed incompatible data changes
the controlled window accepted no legitimate new writes that must be preserved
operator separately authorizes destructive data restoration
current stores are preserved as a failure artifact
```

Core DB restoration is outside this runbook.

## Abort Conditions

Abort before mutation on:

```text
source worktree dirty
candidate archive or lock hash drift
candidate parity non-zero
native smoke failure
candidate built under Node other than v24.8.0 / ABI 137
candidate contains source .git or inherited source node_modules
C0 or R0 incomplete
Gateway unhealthy
active-memory enabled or ambiguous
AutoRecall/full/evidence already active
unexpected scheduler or evidence epoch
insufficient free disk for candidate, R0, D0, and failed-install retention
```

Abort and roll back after mutation on:

```text
install command non-zero
installed parity non-zero
installed native smoke failure
config changed unexpectedly
Gateway fails to start
Gateway runs under wrong Node or ABI
preflight unknown or non-clean
required Gateway methods missing
required tools not registered
memory-engine startup errors
unexpected memory-data mutation before controlled validation
```

## Authorization Separation

```text
R6.3 design review
  -> may close this contract only

R6.4 offline candidate and rollback rehearsal
  -> may create artifacts outside production paths
  -> may rehearse install/rollback only with isolated HOME, OPENCLAW_STATE_DIR, and OPENCLAW_CONFIG_PATH
  -> may not install into the active extension, stop, reload, or restart the real Gateway

R6.5 live remediation execution authorization
  -> may approve one exact candidate, one exact artifact root, one exact command sequence, and one rollback branch
  -> still requires explicit operator approval

B8-A7 sustained runtime authorization
  -> remains separate after runtime remediation succeeds
```

## Current Boundary

```text
B8-A7-R6.2 host activation boundary compatibility=PASSED / CLOSED
B8-A7-R6.3 runtime-remediation authorization design=PASSED / CLOSED
B8-A7-R6.4 offline candidate and rollback rehearsal=PASSED / CLOSED
B8-A7-R6.5 live remediation execution authorization packet=PASSED / CLOSED
R6.5 live execution=NOT AUTHORIZED
explicit operator approval=NOT RECEIVED
offline candidate build=PASSED / FROZEN EPHEMERAL ARTIFACT
offline C0/R0 rehearsal copies=PASS / REFRESH REQUIRED BEFORE LIVE EXECUTION
D0 production memory-data backup=NOT CREATED
live configuration mutation=NOT AUTHORIZED
live plugin install/reload=NOT AUTHORIZED
live Gateway stop/start/restart=NOT AUTHORIZED
live native dependency build=NOT AUTHORIZED
AutoRecall activation=NOT AUTHORIZED
production evidence activation=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

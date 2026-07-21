# B8-A7-R6.4 Offline Candidate and Rollback Rehearsal Decision

> **Decision: PASSED / CLOSED**
>
> Date: 2026-07-21
>
> Reviewed source: `9b6b734f321b5708e621cdd7a6dba92a5dd0e036`
>
> Artifact root: `/tmp/memory-engine-r6.4-9b6b734`
>
> Scope: offline candidate build, independent recovery-copy verification, and isolated OpenClaw install/rollback rehearsal only

## Decision Summary

R6.4 execution passed and independent EDI verification closed the stage at commit `59278a6`.

A dependency-complete memory-engine candidate was built from the reviewed clean source under Node `v24.8.0` / `NODE_MODULE_VERSION 137`, validated against the exact lockfile, exercised through real `better-sqlite3` and disposable LanceDB operations, proven source/runtime-identical, frozen against accidental writes, installed through an isolated OpenClaw `2026.6.9` state, rolled back through the same supported plugin-install surface, and installed forward again.

The real OpenClaw configuration, extension tree, Gateway process, and production memory stores were not modified.

R6.4 does not authorize live execution. The candidate and rehearsal artifacts are under `/tmp` and must be treated as ephemeral. R6.5 must reverify every bound identity immediately before any live action, or rebuild the candidate under the same reviewed contract if the artifact root is absent or changed.

## Source Gate

The source gate was bound to:

```text
reviewed_head=9b6b734f321b5708e621cdd7a6dba92a5dd0e036
reviewed_describe=v0.8.22-memory-process-boundary-audit-227-g9b6b734
worktree_clean=true
package_name=memory-engine-plugin
package_version=0.8.22
package_lock_version=3
better_sqlite3_locked_version=11.10.0
lancedb_locked_version=0.29.0
focused_tests=39/39 pass
static_check=520 files pass
full_suite=1746 pass / 0 fail / 8 skip
A5_fail_closed_smoke=10/10 pass
git_diff_check=pass
```

The full verification results were completed before commit `9b6b734` and accepted as the R6.3 closeout evidence.

## Artifact Root

```text
path=/tmp/memory-engine-r6.4-9b6b734
mode=0700
total_bytes=1514553441
reported_size=1.5G
production_path=false
```

No artifact is stored in the Git repository or active extension directory.

## Source Archive

The source archive was generated with the Node 24 toolchain:

```text
filename=memory-engine-plugin-0.8.22.tgz
byte_count=1227074
sha256=acbc27b55d0863fbff5dada85eec40993186012802eaba1a1291e132d194697b
entry_count=614
contains_source_git=false
contains_source_node_modules=false
package_name=memory-engine-plugin
package_version=0.8.22
manifest_plugin_id=memory-engine
```

Archive traversal and absolute-path checks passed. The package root and version matched the reviewed source.

`npm pack` omitted `package-lock.json`, so the exact reviewed lockfile was copied into the extracted candidate and bound separately:

```text
package_json_sha256=752f46d03f7fe87f744e4441a9f79fccae3d4e09ece129ee60a0ad19abcdf47a
package_lock_sha256=8ee89a15cc54eb532618cf011a30f5684cedf0aa0c026cb69378bc025ec58718
```

## Node 24 Candidate Build

The production dependency installation used:

```text
node_executable=/home/lionsol/.local/node24/bin/node
node_version=v24.8.0
NODE_MODULE_VERSION=137
npm_executable=/home/lionsol/.local/node24/bin/npm
npm_version=11.6.0
npm_command=npm ci --omit=dev --ignore-scripts=false --no-audit --no-fund
install_result=pass
```

Installed direct dependencies:

```text
better-sqlite3=11.10.0
@lancedb/lancedb=0.29.0
npm_problem_count=0
resolved_package_node_count=87
```

Candidate tree:

```text
files=2865
directories=351
symlinks=4
hardlinked_files=6
tree_bytes=312673100
```

All four symlinks were npm command links under `node_modules/.bin` and resolved inside the candidate. The hardlinks were internal `better-sqlite3` build aliases. No symlink or hardlink referenced the source checkout, active extension, active configuration, or production memory directories.

## Native Smokes

The candidate proved actual native execution rather than JavaScript-wrapper import only.

SQLite smoke:

```text
node=v24.8.0
NODE_MODULE_VERSION=137
database=:memory:
create_table=pass
insert=pass
readback=native-ok
close=pass
```

LanceDB smoke:

```text
path=/tmp/memory-engine-r6.4-9b6b734/smoke/lancedb-disposable
production_path=false
connect=pass
create_table=pass
readback=lance-ok
disposable_path_removed=true
```

The smoke did not access:

```text
/home/lionsol/.openclaw/memory/main.sqlite
/home/lionsol/.openclaw/memory/memory-engine/memory-engine.sqlite
/home/lionsol/.openclaw/memory/lancedb
```

## Candidate Parity and Identity

```text
checked_at=2026-07-21T09:33:07.000Z
source_runtime_equal=true
difference_count=0
source_file_count=148
runtime_file_count=148
source_identity_valid=true
runtime_identity_valid=true
source_build_identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
candidate_build_identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
```

Native binary hashes:

```text
better_sqlite3.node=be4109c5b07514ade1a2e1452cbed9fca25cbb8d025b76fa2a81e21a91286a05
better_sqlite3_test_extension.node=938b08199d5e7f2a36f97eccaf939061866adb0db0c3d1dd62a8ff22d8cfb1ff
lancedb_linux_x64_gnu.node=9f0261d60d1181023d4ea48c5b871d19e9af010748ddbde057b94188f97921fd
lancedb_linux_x64_musl.node=46e66227ff52d6a37a626019b5ffb583d99e0103039dad298c56d91b98bc1c5b
```

## Candidate Freeze

After validation:

```text
writable_files=0
writable_directories=0
candidate_root_mode=0500
candidate_tree_sha256=5692d954c92b3dc3f10c0c645b14e71632abfe4346120461c409ad6c70bdb224
post_freeze_native_smoke=pass
```

Any changed mode, file, dependency, archive, lockfile, runtime closure, or tree hash invalidates this candidate for R6.5.

## C0 Configuration Rehearsal Artifact

A byte-exact independent copy of the current OpenClaw configuration was created under the artifact root.

```text
live_path=/home/lionsol/.openclaw/openclaw.json
backup_path=/tmp/memory-engine-r6.4-9b6b734/config/openclaw.json.pre-r6.4
byte_count=22802
mode=0600
live_sha256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a
backup_sha256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a
byte_equal=true
separate_inode=true
hardlink_count=1
symlink=false
```

This C0 is rehearsal evidence only. R6.5 must refresh it immediately before live execution.

## R0 Runtime Recovery Rehearsal

An independent exact copy of the current active runtime was created outside the extension install base.

```text
source=/home/lionsol/.openclaw/extensions/memory-engine
backup=/tmp/memory-engine-r6.4-9b6b734/rollback-runtime
reported_size=859M
files=5522
directories=633
symlinks=4
tree_bytes=882079435
source_backup_shared_regular_file_inodes=0
full_tree_diff=none
```

Deterministic full-tree identity:

```text
source_tree_sha256=6da85f45dc433fe2874a8eaf0299643886d5825ff64910af9367195da3d1cdc9
rollback_tree_sha256=6da85f45dc433fe2874a8eaf0299643886d5825ff64910af9367195da3d1cdc9
```

Runtime-closure identity:

```text
source_runtime_equal=true
difference_count=0
source_file_count=128
runtime_file_count=128
pre_change_runtime_build_identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
rollback_runtime_build_identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
```

R0 `better-sqlite3` completed an actual Node 24 / ABI 137 `:memory:` create/insert/read/close smoke.

This R0 is rehearsal evidence only. R6.5 must refresh it after its final preflight and before any live replacement.

## Isolated OpenClaw Rehearsal

The OpenClaw transaction was exercised with all state redirected under:

```text
HOME=/tmp/memory-engine-r6.4-9b6b734/sandbox-home
OPENCLAW_HOME=/tmp/memory-engine-r6.4-9b6b734/sandbox-home
OPENCLAW_STATE_DIR=/tmp/memory-engine-r6.4-9b6b734/sandbox-home/.openclaw
OPENCLAW_CONFIG_PATH=/tmp/memory-engine-r6.4-9b6b734/sandbox-home/.openclaw/openclaw.json
```

The real OpenClaw state directory was not used.

### Forward candidate installation

The frozen dependency-complete candidate installed through the explicit Node 24 OpenClaw entrypoint.

```text
install_result=pass
install_source=path
install_source_path=/tmp/memory-engine-r6.4-9b6b734/candidate
sandbox_install_path=/tmp/memory-engine-r6.4-9b6b734/sandbox-home/.openclaw/extensions/memory-engine
installed_version=0.8.22
installed_candidate_parity=true
installed_candidate_difference_count=0
installed_candidate_build_identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
installed_candidate_native_smoke=pass
```

### Rollback installation

R0 was installed through the same supported OpenClaw path with `--force`.

```text
rollback_install_result=pass
install_source=path
install_source_path=/tmp/memory-engine-r6.4-9b6b734/rollback-runtime
installed_version=0.8.22
rollback_parity=true
rollback_difference_count=0
rollback_build_identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
rollback_native_smoke=pass
```

The rollback install record accurately named the R0 path. The rehearsal does not claim restoration of the historical original `sourcePath` value.

### Final forward reinstallation

The frozen candidate was installed again after rollback.

```text
final_forward_install_result=pass
final_install_source_path=/tmp/memory-engine-r6.4-9b6b734/candidate
final_candidate_parity=true
final_candidate_difference_count=0
final_candidate_build_identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
```

The isolated transaction therefore proved:

```text
candidate -> installed candidate
installed candidate -> R0 rollback
R0 rollback -> frozen candidate
```

## New Operational Findings

### Plugin installation is not data-neutral

`openclaw plugins install` imported memory-engine in the isolated CLI process during install validation. In the sandbox it:

```text
attempted confidence-table initialization
created sandbox memory-engine SQLite state
initialized sandbox LanceDB
```

This was confined to the isolated state directory, but it proves that the live install command is not merely a filesystem copy.

R6.5 must therefore require:

```text
Gateway stopped and quiesced before install
D0 completed before install
pre-install engine SQLite and LanceDB identities recorded
post-install pre-start data identities recorded
no unreviewed data change accepted
runtime and D0 rollback available before Gateway start
```

For the reviewed source/runtime delta, no memory schema change is expected. A changed engine database main-file hash or changed LanceDB logical identity during install is a blocker unless separately explained and approved. WAL/SHM housekeeping must be recorded rather than silently treated as semantic data change.

### Install and verification require a stable working directory

One rehearsal verification initially failed with:

```text
ENOENT: no such file or directory, uv_cwd
```

The preceding install had replaced the sandbox runtime while the shell current working directory was inside that runtime. The install succeeded; the subsequent process could not resolve its deleted cwd.

R6.5 must execute every install, rollback, inspect, parity, and smoke command from a stable directory outside:

```text
active extension target
candidate target being replaced
rollback target being replaced
OpenClaw internal stage or backup directories
```

The reviewed repository root or artifact root is acceptable.

### Sandbox plugin import is not Gateway evidence

The sandbox install output reported the plugin as loaded because the install/inspection CLI imported it locally. That does not prove registration in the real already-running Gateway. R6.5 must still use post-start Gateway RPC for methods and tools.

## Production Non-Mutation Evidence

Before and after all R6.4 actions:

```text
real_config_sha256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a
Gateway_PID=676
Gateway_start_timestamp=Tue 2026-07-21 07:27:26 CST
Gateway_state=active/running
real_plugin_install=not performed
real_Gateway_stop/start/restart=not performed
real_config_mutation=not performed
production_D0=not created
production_memory_restore=not performed
AutoRecall_activation=not performed
production_evidence_activation=not performed
```

## R6.5 Entry Requirements

R6.5 may prepare one exact live execution authorization only after this decision is committed and independently verified.

It must bind or refresh:

```text
reviewed source HEAD=9b6b734f321b5708e621cdd7a6dba92a5dd0e036
candidate path and candidate_tree_sha256
candidate build identity
source archive and lockfile hashes
Node 24 / ABI 137 native smokes
fresh C0 exact configuration backup
fresh R0 exact runtime recovery tree
fresh H0 host/Gateway/config/install evidence
quiesced D0 created only after authorized Gateway stop
stable working directory outside replaced paths
pre/post install memory-data identity gate
exact Node 24 OpenClaw commands
exact rollback branches
explicit operator approval
```

If `/tmp/memory-engine-r6.4-9b6b734` is absent, writable, changed, or partially cleaned, R6.5 must not reconstruct trust from filenames. It must rebuild and revalidate the candidate and recovery artifacts.

## Repository Closeout Preflight

After recording the R6.4 decision and updating the current contracts:

```text
focused R6.1-R6.4 and authorization-chain tests=47/47 pass
static_check=521 files pass
full_suite=1754 pass / 0 fail / 8 skip
A5_fail_closed_smoke=10/10 pass
git_diff_check=pass
```

These results are repository preflight evidence. Independent EDI verification is still required before commit closeout.

## Final Decision

```text
B8-A7-R6.2 host activation boundary compatibility=PASSED / CLOSED
B8-A7-R6.3 runtime-remediation authorization design=PASSED / CLOSED
B8-A7-R6.4 offline candidate and rollback rehearsal=PASSED / CLOSED
offline candidate artifact=VALIDATED / FROZEN / EPHEMERAL
C0 rehearsal copy=PASS / REFRESH REQUIRED BEFORE LIVE EXECUTION
R0 rehearsal copy=PASS / REFRESH REQUIRED BEFORE LIVE EXECUTION
sandbox forward rollback forward rehearsal=PASS
D0 quiesced production data snapshot=NOT CREATED
B8-A7-R6.5 live remediation execution authorization packet=PASSED / CLOSED
B8-A7-R6.5 live remediation execution=ROLLED BACK / SAFE
candidate Gateway activation=NOT REACHED
old runtime restored=TRUE
configuration restored to exact C0=TRUE
memory data restored from D0=FALSE / NOT REQUIRED
B8-A7-R6.5.1 config semantic equivalence repair=PASSED / CLOSED
R6.5 live retry=NOT AUTHORIZED
explicit retry approval=NOT RECEIVED
live retry candidate install/reload=NOT AUTHORIZED
live retry Gateway stop/start/restart=NOT AUTHORIZED
live retry configuration mutation=NOT AUTHORIZED
live memory-data restoration=NOT AUTHORIZED
AutoRecall activation=NOT AUTHORIZED
production evidence activation=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

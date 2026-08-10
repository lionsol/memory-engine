# Session-Flush Reconciliation Runtime Install + Non-Live Qualification Stage Card — 2026-08-10

> Status: `FROZEN` — not committed; runtime execution requires separate Sol authorization after commit.
>
> This Stage Card authorizes no runtime mutation by itself.
>
> Source implementation commit: `ac0e5f054551847e724be504bae80947abd7d675`.

## 1. Decision

Can the committed bounded-eventual `session_flush` reconciliation implementation from `ac0e5f0...` be qualified against the active OpenClaw runtime by:

1. constructing an exact four-file runtime overlay over the currently active R2 provenance release;
2. temporarily installing and loading that candidate for non-live identity/loadability checks only; and
3. restoring the current R2 runtime before the stage closes,

without triggering real Core→Engine or Engine→Lance reconciliation and without deploying unrelated repository changes?

Use exactly one stage outcome:

~~~text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
~~~

A passing stage proves only temporary runtime installability, active identity parity, module loadability, and safe restoration.

It does **not** authorize or prove persistent activation, real backlog reconciliation, live retrieval behavior, AutoRecall behavior, or production convergence.

## 2. Why success must end in rollback

The source implementation intentionally wires reconciliation into the existing `session-checkpoint` lifecycle.

Current cron evidence:

~~~text
name=session-checkpoint
enabled=true
schedule=30 3 * * *
timezone=Asia/Shanghai
~~~

Therefore, leaving `ac0e5f0...` installed after non-live qualification would create a future real-data write obligation at the next successful checkpoint cycle.

That would bypass the still-separate `REAL_DATA_RECONCILIATION` authorization gate.

Accordingly, this stage uses a **temporary qualification install**:

~~~text
current R2 active runtime
        ↓
construct immutable candidate
        ↓
temporary candidate install
        ↓
non-live identity/loadability qualification
        ↓
mandatory success rollback to R2
        ↓
stage closes with R2 active again
~~~

Rollback at the end is not evidence of candidate failure. It is the intended success end-state of this stage.

## 3. Source authority

Repository root:

~~~text
/home/lionsol/.openclaw/workspace/plugins/memory-engine
~~~

Frozen source implementation commit:

~~~text
ac0e5f054551847e724be504bae80947abd7d675
~~~

Parent commit:

~~~text
3402d3cf2ab462abd06c03387ff3aba1a2291a8e
~~~

Source Stage Card:

~~~text
docs/smoke-tests/session-flush-bounded-eventual-reconciliation-source-implementation-stage-card-20260810.md
~~~

Source Stage Card SHA256:

~~~text
e31060e13883473a2b0b61387d13b82ea1029c359b585c6722610ad4eff22507
~~~

Source implementation was independently adjudicated:

~~~text
PASS_WITH_FINDINGS
~~~

and committed with a clean worktree.

No source/test/doc modification is authorized during this runtime stage.

## 4. Current active runtime baseline

Current verified runtime facts at Stage Card creation:

~~~text
plugin=memory-engine
version=0.8.22
status=loaded
installPath=/home/lionsol/.openclaw/extensions/memory-engine
sourcePath=/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2
~~~

Current active rollback/base release:

~~~text
/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2
~~~

The active extension and this R2 release currently match for the existing provenance overlay files and package metadata.

Known R2/active hashes:

~~~text
lib/recall/hybrid-search.js
4cc0e74ac587b3c38b86add5de4ca8e116ed2358091c58a828a0e326778a2cce

lib/recall/auto-recall-debug-metadata.js
f0910a1f39484d6abcfb07e0b369b2a98e6de0165eb6403b1edef42a7cce3a07

package.json
752f46d03f7fe87f744e4441a9f79fccae3d4e09ece129ee60a0ad19abcdf47a

package-lock.json
8ee89a15cc54eb532618cf011a30f5684cedf0aa0c026cb69378bc025ec58718
~~~

These inherited files must remain unchanged in the new candidate.

## 5. Exact implementation delta provenance

A critical anti-drift fact is already proven:

For each existing runtime target changed by commit `ac0e5f0...`, the version in parent `3402d3c...` is byte-identical to both the R2 release and current active runtime.

### 5.1 `bin/session-checkpoint.js`

~~~text
parent/R2/active SHA256=
1e39d12bcebe37728613b3b420ee7402ba0aa8833ae21fd8f58fa842075837e9

ac0e5f0 source SHA256=
544dd01c33e1e4b435be4695df5b4dc28621223f5e76505a4d4298423a8a36dd
~~~

### 5.2 `lib/checkpoint/orphan-repair.js`

~~~text
parent/R2/active SHA256=
837587ef75174d8aefbd36d97839c3487b10d9b92a872ad6292e7f078b7a3035

ac0e5f0 source SHA256=
157e298a1a509f2aa19446223ab1334fee6114da10c3055d3a2542087476ff4f
~~~

### 5.3 `lib/checkpoint/runtime.js`

~~~text
parent/R2/active SHA256=
1ca5deba67cacc688fca844ca7c02dbdefdb510f9909ec75bd57f64d63965b62

ac0e5f0 source SHA256=
dbae65c9e0aa647d6cf94dab458cf5bec7115dbd6e6fbaa5307e1421ff0bb13a
~~~

### 5.4 New module

~~~text
lib/checkpoint/session-flush-reconciliation.js
~~~

is absent from:

~~~text
parent 3402d3c...
R2 release
current active runtime
~~~

and has source SHA256:

~~~text
d3d40da9e40f0fb3762d1953fda09b04c134e90096f29a94c8eb90ce6971c25a
~~~

Therefore the runtime overlay can be proven as exactly the implementation delta from `3402d3c...` to `ac0e5f0...`, without including unrelated repository changes.

## 6. Fixed candidate

The only authorized new runtime candidate path is:

~~~text
/home/lionsol/.openclaw/backups/memory-engine/releases/session-flush-reconciliation-overlay-ac0e5f0-20260810-r1
~~~

This path was absent at Stage Card creation.

It must also be absent at execution preflight.

If it exists at execution preflight, stop without modifying, deleting, renaming, reusing, or overwriting it.

Do not create an R2/R3 candidate under the same execution authorization.

## 7. Fixed rollback authority

The rollback target is fixed to the currently active verified release:

~~~text
/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2
~~~

The rollback release is immutable evidence.

Do not chmod, edit, delete, rename, or reinstall files *inside* that release.

Rollback is performed only by installing that fixed release through the sanctioned OpenClaw plugin installer.

## 8. Candidate construction strategy

Do **not** install the repository checkout directly.

Construct the new candidate by copying the fixed R2 release with metadata preserved, then overlay exactly four runtime files from source commit `ac0e5f0...`:

~~~text
bin/session-checkpoint.js
lib/checkpoint/orphan-repair.js
lib/checkpoint/runtime.js
lib/checkpoint/session-flush-reconciliation.js
~~~

Do not copy the source test file into the runtime candidate as an implementation delta.

Do not overlay any other source file.

## 9. Candidate permission mechanics

The R2 release is sealed.

Verified baseline modes include:

~~~text
release root=0500
bin/=0500
lib/=0500
lib/checkpoint/=0500

bin/session-checkpoint.js=0400
lib/checkpoint/orphan-repair.js=0400
lib/checkpoint/runtime.js=0400
~~~

The copied candidate inherits these modes.

Candidate construction may use only these bounded permission changes on the **copied candidate**:

1. temporarily add owner-write permission to the three copied existing target files;
2. overwrite those three candidate files with exact source bytes;
3. restore those files to `0400`;
4. temporarily add owner-write permission to candidate `lib/checkpoint/` only, solely to create the new module;
5. create `lib/checkpoint/session-flush-reconciliation.js` with exact source bytes;
6. set the new module to owner/group matching candidate ownership and mode `0400`;
7. restore candidate `lib/checkpoint/` to `0500`.

No permission change is authorized on:

- the R2 rollback release;
- the active extension;
- the repository;
- candidate root;
- candidate `bin/` directory;
- candidate `lib/` directory;
- any unrelated candidate path.

If any broader directory permission change is required, stop for scope review.

## 10. Candidate qualification

Before stopping Gateway, prove all of the following.

### 10.1 Authority

- repository HEAD equals the exact committed Stage Card execution HEAD;
- Stage Card SHA256 equals the authorized packet;
- repository worktree is clean;
- source implementation commit remains `ac0e5f0...`;
- rollback/base release exists;
- active install path exists;
- fixed candidate path does not yet exist before construction.

### 10.2 Base parity

Before constructing the candidate, re-prove that the three existing target files in:

~~~text
parent 3402d3c...
R2 rollback release
active extension
~~~

remain byte-identical to the frozen baseline hashes in this card.

If any of those three base hashes drift, stop rather than guessing whether the overlay remains safe.

### 10.3 Exact candidate delta

After construction, prove the candidate differs from R2 only as follows:

~~~text
modified:
  bin/session-checkpoint.js
  lib/checkpoint/orphan-repair.js
  lib/checkpoint/runtime.js

added:
  lib/checkpoint/session-flush-reconciliation.js
~~~

No fifth file difference is allowed.

The four candidate target hashes must equal the frozen source hashes from Section 5.

### 10.4 Package/dependency inheritance

Candidate must inherit unchanged:

~~~text
package.json
package-lock.json
node_modules dependency closure
~~~

from R2.

The package and lock hashes must remain exactly the R2 values in Section 4.

Do not run `npm install`, `npm ci`, `npm rebuild`, or any package mutation against the candidate.

### 10.5 Node/native ABI

Qualification must use the existing Node 24 environment.

Current known compatible executable:

~~~text
/home/lionsol/.local/node24/bin/node
~~~

Known current values:

~~~text
Node v24.8.0
NODE_MODULE_VERSION=137
~~~

Before Gateway stop, verify with the candidate dependency closure that:

- `better-sqlite3` loads under Node24;
- candidate `lib/checkpoint/session-flush-reconciliation.js` can be required;
- candidate `lib/checkpoint/orphan-repair.js` can be required;
- candidate `bin/session-checkpoint.js` can be required without invoking its `main()` path.

Import/load checks must not call checkpoint main, open real DBs, invoke embeddings, run Lance operations, or mutate runtime state.

## 11. Current AutoRecall boundary

Current configuration contains:

~~~text
autoRecall.topK=3
autoRecall.timeoutMs=8000
~~~

and does not contain an explicit `autoRecall.enabled` scalar.

Current source default is:

~~~text
DEFAULT_AUTO_RECALL.enabled=false
~~~

Therefore the effective intended state remains AutoRecall disabled unless a separate config source proves otherwise.

This stage must not add or modify any AutoRecall config key.

If effective AutoRecall unexpectedly resolves enabled during execution preflight, stop before candidate installation.

## 12. Cron safety gate

Because the candidate would automatically reconcile real data if `session-checkpoint` executes while it is active, runtime execution must establish a no-checkpoint window before stopping Gateway.

Execution preflight must:

1. resolve the current enabled `session-checkpoint` cron row;
2. confirm it remains scheduled at `30 3 * * *` in `Asia/Shanghai` or record any drift;
3. resolve the next scheduled run time;
4. reject the temporary install transaction if the next scheduled run is within 60 minutes;
5. record that the checkpoint job has not started during the transaction before each candidate-active verification phase.

Do not disable, edit, delete, or reschedule the cron job in this stage.

If the safety window becomes insufficient after Gateway stop, restore/keep Gateway stopped as needed and proceed directly to rollback rather than completing additional candidate checks.

A passing stage requires no session-checkpoint execution during the candidate-active interval.

## 13. Runtime operator

Sol remains the runtime operator.

GPT designs/reviews the transaction and analyzes terminal evidence.

DevSpace is read-only for runtime inspection.

Edi is not used in this stage unless Sol separately authorizes it.

Codex is not needed for runtime mutation and must not modify source during this stage.

## 14. Temporary runtime transaction

Only after all candidate qualification and cron safety gates pass:

1. record bounded pre-install runtime identity and service health;
2. record current plugin `install.sourcePath`, `install.installPath`, version, and loaded state;
3. record current active hashes for the four target paths, including that the new module is absent;
4. stop Gateway;
5. install the fixed candidate once with the explicitly resolved OpenClaw CLI under the Node24 environment and `--force`;
6. verify the plugin install record points to the fixed candidate before starting Gateway if the CLI allows this safely;
7. start Gateway;
8. perform only the non-live candidate qualification in Section 15;
9. regardless of candidate qualification success, stop Gateway again;
10. reinstall the fixed R2 rollback release once with `--force`;
11. start Gateway;
12. perform the restoration verification in Section 16;
13. stop and report.

The candidate may be installed at most once under this execution authorization.

The R2 rollback release may be installed at most once as the planned restoration step, unless a failed candidate install leaves no installation mutation and rollback is mechanically unnecessary.

Do not make a second candidate or second candidate install attempt under the same authorization.

## 15. Candidate-active non-live verification

Do not send a user prompt, memory query, memory tool request, AutoRecall request, H6 turn, natural canary, synthetic retrieval probe, or checkpoint command.

Do not run any function that opens or reconciles real Core/Engine/Lance data.

Verify only the following.

### 15.1 Service and plugin identity

- Gateway is running/healthy after candidate installation;
- `memory-engine` plugin reports `loaded`;
- plugin version remains `0.8.22`;
- install path is `/home/lionsol/.openclaw/extensions/memory-engine`;
- install `sourcePath` equals the fixed candidate path.

Use the actual 2026.6.9 inspect schema:

~~~text
plugin.source
plugin.origin
plugin.activationSource
install.source
install.sourcePath
install.installPath
install.version
~~~

Do not rely on obsolete top-level `sourcePath`/`installPath` fields.

### 15.2 Active byte parity

Active installed hashes must equal the candidate/source hashes for exactly:

~~~text
bin/session-checkpoint.js
lib/checkpoint/orphan-repair.js
lib/checkpoint/runtime.js
lib/checkpoint/session-flush-reconciliation.js
~~~

Existing provenance overlay files must still equal their R2 hashes:

~~~text
lib/recall/hybrid-search.js
lib/recall/auto-recall-debug-metadata.js
~~~

Package and lock hashes must still equal R2.

No unrelated active runtime file is authorized to differ from the candidate.

### 15.3 Pure parser contract

Using the active installed `session-flush-reconciliation.js` under Node24, run only an in-memory pure parser check.

The synthetic Markdown must contain:

- one canonical `session_flush/raw_log` entry;
- nested ordinary `##` body headings;
- a second true canonical entry with different provenance.

The pure parser must prove:

- nested body H2 headings do not split the first entry;
- true canonical entries remain distinct;
- first entry provenance/category remain `session_flush/raw_log`.

This check must call only the pure parser export.

Do not call `collectEligibleSessionFlushCoreRows()` unless every Core access seam is fully replaced by an in-memory stub and no runtime path can open the real Core DB.

Pure parser-only verification is preferred.

### 15.4 Module loadability

Under Node24, verify active installed modules can be imported/required without side effects:

~~~text
lib/checkpoint/session-flush-reconciliation.js
lib/checkpoint/orphan-repair.js
lib/checkpoint/runtime.js
bin/session-checkpoint.js
~~~

Requiring `bin/session-checkpoint.js` is allowed only because `require.main !== module` must keep `main()` unexecuted.

Do not invoke exported `main`, `nightlyCheckpoint`, reconciliation, orphan repair, embedding, or DB functions.

### 15.5 Static orchestration evidence

Read-only source inspection may confirm that installed `bin/session-checkpoint.js` contains the intended order:

~~~text
nightlyCheckpoint
→ reconcileSessionFlushManagedState
→ repairOrphanVectors({ scope: "session_flush" })
→ resolveConfigConflicts
~~~

This is static identity evidence only.

Do not execute this orchestration against the real runtime.

### 15.6 No checkpoint execution

Before candidate rollback, re-check the cron job/runtime evidence and prove no `session-checkpoint` run began during the candidate-active interval.

If a checkpoint run did begin, immediately stop candidate-active runtime, restore R2, classify the stage `STOPPED`, and report potential real-data contamination for a separately authorized audit.

Do not inspect/repair real memory data under this stage.

## 16. Mandatory success restoration

After the candidate-active checks, restore R2 even when every candidate check passed.

Restoration verification must prove:

~~~text
plugin=loaded
version=0.8.22
installPath=/home/lionsol/.openclaw/extensions/memory-engine
sourcePath=/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2
~~~

Active target state must return to:

~~~text
bin/session-checkpoint.js
SHA256=1e39d12bcebe37728613b3b420ee7402ba0aa8833ae21fd8f58fa842075837e9

lib/checkpoint/orphan-repair.js
SHA256=837587ef75174d8aefbd36d97839c3487b10d9b92a872ad6292e7f078b7a3035

lib/checkpoint/runtime.js
SHA256=1ca5deba67cacc688fca844ca7c02dbdefdb510f9909ec75bd57f64d63965b62

lib/checkpoint/session-flush-reconciliation.js
ABSENT
~~~

Existing provenance files and package/lock hashes must remain unchanged from R2.

The stage may pass only if restoration is proven.

## 17. Failure and fail-closed restoration

If candidate construction fails before Gateway stop:

- do not touch runtime;
- preserve any partially constructed candidate as evidence if it exists;
- do not reuse or mutate it under the same execution identity;
- report `STOPPED`.

If candidate install/start/non-live qualification fails after Gateway stop:

- proceed directly to the single authorized R2 restoration;
- do not patch the candidate;
- do not retry candidate installation;
- verify R2 restoration and report `STOPPED`.

If R2 restoration itself fails or its identity cannot be proven:

- leave/put Gateway stopped if necessary to prevent the candidate from reaching the next checkpoint schedule;
- do not perform a second rollback install attempt under this authorization;
- report `STOPPED` with exact service/runtime state;
- require new Sol authorization for recovery.

Do not leave the candidate active merely because rollback verification is inconvenient.

## 18. Allowed mutations during separately authorized execution

Only the following mutations are allowed:

1. create the one fixed persistent candidate release;
2. bounded temporary owner-write permission changes on copied candidate files/directory exactly as Section 9;
3. stop/start Gateway for the temporary candidate transaction;
4. install the fixed candidate once;
5. stop/start Gateway for planned restoration;
6. reinstall the fixed R2 rollback release once;
7. write bounded private transaction evidence outside the repository if needed.

No other runtime/config/data mutation is authorized.

## 19. Explicitly forbidden operations

Do not:

- install the full repository checkout;
- install any fifth source/runtime file;
- include `test/session-flush-reconciliation.test.js` as a runtime overlay delta;
- modify repository source or docs during execution;
- modify `openclaw.json`;
- enable AutoRecall;
- alter `topK`, timeout, allowlists, retrieval thresholds, channels, ranking, fusion, Card, or gate behavior;
- modify cron state;
- run real `session-checkpoint.js`;
- invoke `nightlyCheckpoint()` against real files;
- invoke `reconcileSessionFlushManagedState()` against real data;
- invoke scoped `repairOrphanVectors()` against real data;
- invoke global orphan repair;
- run `openclaw memory index`;
- run any memory-engine sync/backfill/reindex CLI;
- run embeddings for production memory;
- open/write real Lance rows;
- mutate Core DB, Engine DB, LanceDB, sessions, smart-add files, episodes, or historical evidence;
- send live or synthetic retrieval prompts;
- run H6/natural canary;
- create schema/config/CLI/OpenSpec/scheduler/ledger/state machine;
- run `npm install`, `npm ci`, or `npm rebuild` in candidate or active install;
- commit, tag, push, or create release tags;
- leave the candidate active after this stage passes.

## 20. Pass criteria

The stage may return `PASS` only if all three criteria hold.

### Criterion 1 — exact candidate

A persistent candidate is constructed from R2 with exactly:

~~~text
3 modified runtime files
1 added runtime module
0 other differences
~~~

with frozen source hashes, restored sealed permissions, unchanged package/lock/native closure, and Node24 loadability.

### Criterion 2 — temporary non-live qualification

One candidate install succeeds, Gateway/plugin become healthy, active `sourcePath` and four active hashes prove the candidate is loaded, pure parser/module-load/static identity checks pass, and no checkpoint/reconciliation/retrieval/data operation occurs.

### Criterion 3 — mandatory restoration

R2 is reinstalled, Gateway/plugin recover healthy, `sourcePath` returns to R2, the three old target hashes are restored, the new module is absent again, and no checkpoint run occurred while the candidate was active.

`PASS_WITH_FINDINGS` is allowed only for a non-blocking observation that does not weaken these three criteria.

## 21. Stop conditions

Stop before runtime mutation if:

- HEAD/Stage Card authority drifts;
- worktree is not clean;
- R2/active/parent base parity no longer matches;
- candidate path already exists;
- exact four-file delta cannot be proven;
- candidate permissions cannot be restored to sealed state;
- package/lock/native dependency closure drifts;
- Node24/ABI validation fails;
- effective AutoRecall is unexpectedly enabled;
- checkpoint cron safety window is not sufficient;
- another runtime/data subsystem enters scope.

Stop and restore R2 if:

- candidate install identity differs;
- Gateway/plugin fails health/loading;
- active hashes do not equal candidate;
- pure parser/module import fails;
- validation would require real DB/index/retrieval access;
- checkpoint starts while candidate is active;
- any unplanned runtime mutation appears.

## 22. Evidence minimization

Use minimum sufficient evidence.

For candidate identity:

- exact hash/diff proof is primary evidence;
- no broad repository/runtime inventory is required.

For plugin identity:

- `openclaw plugins inspect memory-engine --runtime --json` path-like fields plus active hashes are sufficient.

For no reconciliation:

- absence of a session-checkpoint run during candidate-active window plus prohibition on manual invocation is primary evidence;
- do not inspect or compare real memory contents merely to prove nothing happened.

For restoration:

- plugin sourcePath + target hashes/new-module absence + service loaded state are sufficient.

Do not require byte-for-byte snapshots of unrelated DBs, sessions, reports, or memory directories.

## 23. Execution packet

A later execution authorization must bind all of:

~~~text
Stage Card path=
docs/smoke-tests/session-flush-reconciliation-runtime-install-nonlive-qualification-stage-card-20260810.md

Stage Card SHA256=
<computed after freeze>

Stage Card commit=
<commit after separate commit authorization>

Repository HEAD=
<exact committed Stage Card HEAD>

Source implementation commit=
ac0e5f054551847e724be504bae80947abd7d675

Rollback/base release=
/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2

Candidate path=
/home/lionsol/.openclaw/backups/memory-engine/releases/session-flush-reconciliation-overlay-ac0e5f0-20260810-r1

MAX_EXECUTIONS=1
~~~

Any change to Stage Card content, Stage Card commit, repository HEAD, fixed candidate path, fixed rollback path, source implementation commit, or consumed execution count invalidates that execution packet.

## 24. Runtime execution report

A later execution report must include:

- exact Stage Card path/SHA/commit/HEAD;
- source implementation commit;
- preflight R2/active/parent parity;
- exact candidate path;
- exact candidate four-file diff and hashes;
- candidate permission restoration evidence;
- package/lock hashes;
- Node24 version/ABI and candidate import/load results;
- current checkpoint cron schedule and candidate-active safety window;
- pre-install plugin sourcePath/installPath/status;
- candidate-active sourcePath/installPath/status;
- active four-file candidate parity;
- pure parser result;
- confirmation no checkpoint/reconciliation/retrieval/data operation ran;
- planned R2 restoration command/result;
- final plugin sourcePath/installPath/status;
- final old target hashes and new-module absence;
- final service state;
- stage outcome;
- at most one next-gate recommendation.

## 25. State semantics after a passing stage

A passing stage establishes only:

~~~text
current_fact:
ac0e5f0 candidate can be constructed, temporarily installed, loaded,
and non-live qualified under Node24, then R2 can be restored.

current active runtime after stage:
R2 provenance release, not ac0e5f0 candidate.

persistent activation:
NOT IMPLEMENTED / NOT AUTHORIZED.

real Core→Engine reconciliation:
NOT PERFORMED / NOT AUTHORIZED.

real Engine→Lance reconciliation:
NOT PERFORMED / NOT AUTHORIZED.
~~~

Do not describe `ac0e5f0` as the active production runtime after this stage passes.

## 26. Successor boundary

After a passing temporary qualification, stop.

The next product-level decision would require a separate Stage Card and separate Sol authorization for some bounded form of persistent activation / real lifecycle reconciliation.

Do not automatically:

- leave the candidate installed;
- run historical backlog reconciliation;
- enable AutoRecall;
- run a natural canary;
- tune retrieval;
- start Candidate-Builder;
- tag/push/release.

## 27. Authorization state at freeze

~~~text
Stage Card=FROZEN
Stage Card commit=NOT_AUTHORIZED
Runtime execution=NOT_AUTHORIZED
Candidate construction=NOT_AUTHORIZED until runtime execution
Temporary candidate install=NOT_AUTHORIZED
Mandatory R2 restoration=authorized only inside a later runtime execution packet
Persistent activation=NOT_AUTHORIZED
Real-data reconciliation=NOT_AUTHORIZED
AutoRecall enablement=NOT_AUTHORIZED
Commit/tag/push=NOT_AUTHORIZED
MAX_EXECUTIONS=not consumed
~~~

After freezing this card, stop at the Stage Card commit authorization gate.

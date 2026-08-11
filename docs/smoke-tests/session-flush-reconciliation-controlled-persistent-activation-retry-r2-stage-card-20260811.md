# Session-Flush Reconciliation Controlled Persistent Activation Retry R2 Stage Card — 2026-08-11

## Decision

Can the already-qualified immutable `ac0e5f0` reconciliation candidate become the persistent active runtime after one natural `session-checkpoint` lifecycle, when the observation harness is hardened to fail closed on any Gateway restart or runtime/config drift during the provisional-active window?

This retry does not reopen source implementation, runtime qualification, or first real-data qualification.

## Why Retry R2 exists

The first Controlled Persistent Activation transaction was `STOPPED` after a second Gateway restart occurred during the provisional observation window.

Historical facts from that transaction:

~~~text
candidate activation began=2026-08-11T16:57:50+08:00
candidate provisional READY PID=1941285
unexpected full-process restart=2026-08-11T18:47:00+08:00
post-restart PID=1950627
rollback began=2026-08-11T19:18:06+08:00
R2 restoration=PASS
final outcome=STOPPED
execution consumed=1
~~~

Owner provenance established after the stop:

~~~text
The 18:47 restart occurred while Edi was being used to enable OpenClaw heartbeat.
The restart is therefore treated as owner-directed external runtime/config activity,
not as evidence of a reconciliation candidate defect.
~~~

The previous watcher also had a harness gap: it monitored cron authority but did not detect Gateway PID/start-identity drift during the observation window.

Retry R2 closes that harness gap and freezes an operator/runtime-mutation embargo for the provisional-active window.

## Authority at Stage Card creation

Expected repository authority:

~~~text
repo=/home/lionsol/.openclaw/workspace/plugins/memory-engine
HEAD=1a0b7a25988f24299433d7cf486bc69216e7e431
worktree=clean
source implementation=ac0e5f054551847e724be504bae80947abd7d675
~~~

Qualified predecessors:

~~~text
Gateway Readiness Evidence Harness Qualification=PASS
Runtime Qualification Retry R3=PASS
First Real-Data Reconciliation Canary=PASS
Controlled Persistent Activation attempt 1=STOPPED due external runtime interference
R2 restoration after attempt 1=PASS
~~~

Attempt-1 `STOPPED` does not invalidate the candidate or the first real-data canary.

## Fixed artifacts

~~~text
candidate=/home/lionsol/.openclaw/backups/memory-engine/releases/session-flush-reconciliation-overlay-ac0e5f0-20260810-r1
R2=/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2
active extension=/home/lionsol/.openclaw/extensions/memory-engine
Node=/home/lionsol/.local/node24/bin/node
Node version=v24.8.0
NODE_MODULE_VERSION=137
OpenClaw=2026.6.9
plugin version=0.8.22
~~~

Candidate target hashes remain:

~~~text
bin/session-checkpoint.js
544dd01c33e1e4b435be4695df5b4dc28621223f5e76505a4d4298423a8a36dd

lib/checkpoint/orphan-repair.js
157e298a1a509f2aa19446223ab1334fee6114da10c3055d3a2542087476ff4f

lib/checkpoint/runtime.js
dbae65c9e0aa647d6cf94dab458cf5bec7115dbd6e6fbaa5307e1421ff0bb13a

lib/checkpoint/session-flush-reconciliation.js
d3d40da9e40f0fb3762d1953fda09b04c134e90096f29a94c8eb90ce6971c25a
~~~

Do not rebuild or mutate candidate/R2 artifacts.

## In scope

Exactly three items:

1. Install the fixed candidate once and prove candidate identity, deterministic Gateway `READY`, AutoRecall disabled, and unchanged scheduler authority.
2. Observe exactly one natural target `session-checkpoint` lifecycle while continuously fail-closing on Gateway process identity drift and post-install runtime/config drift.
3. Leave candidate active only on a passing verdict; otherwise restore fixed R2 once and prove R2 `READY`.

No source-code or product-config change is authorized by this retry.

## Retry R2 harness hardening

After candidate reaches `READY`, capture a provisional-active runtime baseline:

~~~text
Gateway MainPID=<exact PID>
Gateway ExecMainStartTimestamp=<exact timestamp or equivalent stable service-start identity>
openclaw.json SHA256=<exact post-install hash>
repository HEAD=<exact Stage Card HEAD>
Stage Card SHA256=<exact frozen SHA>
cron id/expression/timezone=<exact values>
cron target nextRunAtMs=<exact target slot>
~~~

During the entire provisional-active observation window, the watcher must periodically verify at least:

~~~text
Gateway MainPID unchanged
Gateway service-start identity unchanged
openclaw.json SHA256 unchanged
repository HEAD unchanged
worktree clean
Stage Card SHA256 unchanged
cron enabled/expression/timezone unchanged
AutoRecall remains false
candidate sourcePath/installPath/version unchanged
~~~

Any Gateway PID/service-start change after the authorized candidate start is an unexpected restart and is immediately `STOPPED`, even if Gateway becomes healthy again.

Any post-install `openclaw.json` hash change is runtime/config drift and is immediately `STOPPED`.

The authorized candidate installation may legitimately alter installation metadata before the provisional baseline is captured; therefore config hash enforcement begins only after candidate identity/READY are proven and the provisional baseline is frozen.

## Operator/runtime-mutation embargo

From `CANDIDATE_PROVISIONAL_ACTIVE=PASS` until the target-cycle verdict closes, do not perform any runtime/config mutation, including through Edi, Codex, CLI, UI, automation, or manual shell commands.

Specifically do not:

- change heartbeat configuration;
- modify `openclaw.json`;
- modify cron jobs;
- install/update/remove plugins;
- restart/stop/start Gateway;
- upgrade OpenClaw;
- alter agent/provider/model runtime configuration;
- enable AutoRecall;
- run checkpoint/reconciliation manually;
- run index/sync/backfill/reindex.

Ordinary OpenClaw/chat usage and remote terminal/browser disconnects are allowed, provided they do not mutate runtime/config authority.

If an external operational need requires any forbidden mutation, terminate the retry and allow its authorized R2 rollback instead of changing the environment underneath the observation.

## Scheduled lifecycle authority

Use the existing scheduler only:

~~~text
job=session-checkpoint
schedule=30 3 * * *
timezone=Asia/Shanghai
~~~

At execution preflight, capture:

~~~text
pre lastRunAtMs=<exact value>
pre nextRunAtMs=<exact value>
target scheduled lifecycle=that captured nextRunAtMs
observation horizon=<explicit bounded time after the target slot>
~~~

The target run is identified by the captured scheduler slot, not by millisecond equality between planned and actual start.

The target run must advance `lastRunAtMs` exactly once to an actual-start timestamp:

~~~text
actual lastRunAtMs > pre lastRunAtMs
actual lastRunAtMs >= captured target nextRunAtMs
actual lastRunAtMs < observation horizon
post nextRunAtMs > captured target nextRunAtMs
~~~

No manually triggered checkpoint is authorized.

## Scheduled reconciliation contract

The natural target lifecycle must reach the existing sequence:

~~~text
nightlyCheckpoint()
→ reconcileSessionFlushManagedState({ trigger: "nightly_checkpoint" })
→ repairOrphanVectors({ scope: "session_flush", trigger: "nightly_checkpoint", ... })
→ resolveConfigConflicts()
→ checkpoint completion/skip/timeout completion path
~~~

Nightly LLM extraction may succeed, skip, or time out under existing bounded behavior.

Reconciliation remains bounded by the qualified implementation:

~~~text
MAX_ENGINE_INSERTS_PER_CYCLE=500
MAX_LANCE_WRITES_PER_CYCLE=10
~~~

Required Engine invariants:

- `engine_inserted <= 500`;
- only first-slice eligible IDs are inserted;
- existing Engine lifecycle rows are preserved;
- ambiguous/unmappable inputs remain fail-closed;
- positive ambiguity/backlog may keep `engine_converged=false`.

Required Lance invariants:

- `lance_added <= 10`;
- only active/non-archived eligible Engine IDs are considered;
- exact Core/Engine/Lance ID identity is preserved;
- no duplicate/delete/wrong-scope/cross-entry mutation;
- retryable provider/write failures remain explicit pending backlog;
- positive backlog does not authorize a second cycle.

The reconciliation Core seam remains readonly through the existing `withCoreDbReadonly()` boundary. Existing normal checkpoint outputs outside the reconciliation seam are not treated as Core-ownership violations.

## Cron checkout/candidate parity

The current cron wrapper runs the repository checkout copy of `bin/session-checkpoint.js`, not the active extension path directly.

Therefore preflight and final evidence must prove the repository checkout runtime files used by the scheduled path remain byte-identical to the immutable candidate for the four qualified reconciliation files.

No repository change is allowed during execution.

## Preflight before mutation

Before the first Gateway stop, prove:

1. exact Retry R2 Stage Card path/SHA/commit, HEAD, clean worktree, fixed candidate/R2 artifacts, candidate hashes, Node24/native closure;
2. current active runtime is R2 `loaded`/`0.8.22`, R2 sourcePath/installPath/hash identity, Gateway `READY`;
3. AutoRecall=`false`, cron authority unchanged, target slot still in the future, no checkpoint/maintenance process active;
4. repository scheduled runtime files equal candidate hashes;
5. bounded `/tmp` watcher/evidence paths are collision-free.

Any preflight drift stops before runtime mutation and does not consume execution count.

## Authorized runtime sequence

After a separately bound execution authorization:

1. create one bounded detached child watcher/evidence transaction under `/tmp`;
2. consume execution count immediately before the first Gateway stop;
3. stop Gateway once;
4. install fixed candidate once;
5. start Gateway once;
6. poll candidate readiness with the qualified `12 × 2s` classifier;
7. prove candidate identity/hashes, AutoRecall false, cron unchanged, repo parity, and no maintenance process;
8. capture provisional Gateway PID/service-start identity and post-install `openclaw.json` SHA;
9. enter passive observation and enforce the runtime-mutation embargo/drift checks;
10. observe exactly the captured natural target checkpoint;
11. collect scheduled Engine/Lance/checkpoint evidence and final runtime/config/cron/authority evidence;
12. on `PASS`/allowed `PASS_WITH_FINDINGS`, leave candidate active;
13. otherwise execute the single authorized R2 rollback and prove R2 `READY`.

No second candidate install or second R2 reinstall is authorized.

## Allowed mutations

Only:

1. bounded private `/tmp` harness/evidence files;
2. one Gateway stop/start plus one fixed candidate install;
3. exactly one natural existing scheduled checkpoint and its normal pre-existing outputs;
4. target-run bounded reconciliation (`Engine<=500`, `Lance<=10`);
5. on non-passing outcome only, one Gateway stop/start plus one fixed R2 reinstall.

## Failure and rollback

Immediately classify `STOPPED` and restore R2 when possible on:

- Gateway PID or service-start identity drift after provisional baseline;
- post-install `openclaw.json` SHA drift;
- candidate install/readiness/identity failure;
- cron/authority/repository drift;
- target run not provable within the bounded horizon;
- more than one checkpoint run before verdict;
- Engine/Lance cap/scope/ID/ownership violation;
- unexpected Lance delete or cross-entry write;
- Gateway not `READY` after target cycle;
- required scope expansion or any forbidden runtime mutation.

`INSUFFICIENT_EVIDENCE` also requires R2 rollback before close.

A bounded retryable Lance provider/write failure may be `PASS_WITH_FINDINGS` only when all cap/scope/ID/no-delete, scheduler, runtime-stability, config-stability, and Gateway-availability invariants hold.

Valid Engine/Lance writes are not transactionally undone by R2 rollback; rollback restores runtime/code authority only.

## Outcomes

`PASS` requires all three:

1. Candidate installs exactly once, reaches deterministic `READY`, matches fixed identity/hashes, and provisional Gateway/config/scheduler/repository authority is frozen.
2. No Gateway restart, config mutation, cron/repo drift, or forbidden operator/runtime mutation occurs during the provisional window; exactly one natural target checkpoint proves bounded scheduled Engine/Lance orchestration and normal checkpoint continuation.
3. Candidate remains active/READY after the target cycle, config/scheduler/repo authority remains unchanged, no second cycle occurred, and the existing daily lifecycle is accepted as persistent product behavior.

`PASS_WITH_FINDINGS` is limited to bounded retryable Lance provider/write failure or non-blocking evidence formatting that weakens none of the runtime/config/scope safety invariants.

`INSUFFICIENT_EVIDENCE` means persistent activation cannot be proven and R2 must be restored.

`STOPPED` applies to any hard invariant, restart/config drift, unexpected mutation, or scope violation; restore R2 when possible.

## Execution count

A separately bound execution packet must set:

~~~text
MAX_EXECUTIONS=1
~~~

Read-only preflight does not consume it.

The count is consumed at the first authorized runtime mutation, normally the Gateway stop before candidate installation.

No second Retry R2 transaction is authorized after consumption.

## State after PASS

~~~text
current active runtime=candidate
persistent candidate activation=QUALIFIED
session-checkpoint=30 3 * * * Asia/Shanghai
future natural scheduled reconciliation cycles=AUTHORIZED AS PRODUCT BEHAVIOR
per-cycle Engine cap=500
per-cycle Lance cap=10
manual reconciliation cycles=NOT AUTHORIZED
AutoRecall=disabled
~~~

Future natural cycles do not require per-cycle owner authorization after this stage passes, provided candidate/config/scheduler/repository authority does not drift.

## Successor boundary

After outcome, stop.

Do not automatically enable AutoRecall, tune caps/retrieval, remediate ambiguous entries, manually converge backlog, tag, push, or release.

## Execution authorization boundary

This Stage Card does not itself create executable authority.

A later owner authorization must bind exactly:

~~~text
Stage Card path=docs/smoke-tests/session-flush-reconciliation-controlled-persistent-activation-retry-r2-stage-card-20260811.md
Stage Card SHA256=<computed after freeze>
Stage Card commit=<exact commit containing this card>
Repository HEAD=<exact Stage Card HEAD>
Source implementation commit=ac0e5f054551847e724be504bae80947abd7d675
Candidate path=/home/lionsol/.openclaw/backups/memory-engine/releases/session-flush-reconciliation-overlay-ac0e5f0-20260810-r1
R2 rollback path=/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2
MAX_EXECUTIONS=1
~~~

The execution packet must additionally freeze the concrete preflight target `nextRunAtMs`, observation horizon, provisional Gateway PID/service-start identity after candidate activation, and post-install `openclaw.json` SHA.

Any Stage Card/commit/HEAD/artifact/scheduler/scope/count drift invalidates the packet.

## Authorization state at freeze

~~~text
Controlled Persistent Activation Retry R2 Stage Card=FROZEN
repository scope=ONE MARKDOWN FILE ONLY
retry execution=NOT YET BOUND TO FROZEN COMMIT
MAX_EXECUTIONS=not created/consumed
candidate install=NOT AUTHORIZED until exact execution packet is bound
target natural checkpoint=NOT AUTHORIZED until exact execution packet is bound
R2 rollback=authorized only inside later non-passing execution packet
manual reconciliation=NOT AUTHORIZED
AutoRecall enablement=NOT AUTHORIZED
push/tag/release=NOT AUTHORIZED
~~~

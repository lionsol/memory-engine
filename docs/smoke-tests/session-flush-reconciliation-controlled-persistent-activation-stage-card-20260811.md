# Session-Flush Reconciliation Controlled Persistent Activation Stage Card — 2026-08-11

## Decision

Can the already-qualified immutable `ac0e5f0` reconciliation candidate replace R2 as the persistent active runtime, traverse exactly one natural enabled `session-checkpoint` lifecycle at `03:30 Asia/Shanghai`, and remain active only if that scheduled cycle proves the bounded reconciliation and checkpoint-availability contracts in production?

This is the first persistent-activation decision.

It does not authorize a manually triggered checkpoint.

## Authority

Expected repository authority at freeze:

~~~text
repo=/home/lionsol/.openclaw/workspace/plugins/memory-engine
HEAD=f0c4e5dfa924c75a42b42a3df2bc7404c91fc44f
worktree=clean
source implementation=ac0e5f054551847e724be504bae80947abd7d675
~~~

Qualified predecessors:

~~~text
Gateway Readiness Evidence Harness Qualification=PASS
Runtime Qualification Retry R3=PASS
First Real-Data Reconciliation Canary=PASS
~~~

Historical first real-data canary evidence:

~~~text
eligible_session_flush=694
ambiguous_chunk_count=37
unmappable_chunk_count=0
Engine inserted=169
Engine non-ambiguous backlog after=0
Lance added=10
Lance failed=0
Lance backlog after=649
active runtime after canary=R2
~~~

These counts are a dated baseline, not fixed expectations for the scheduled cycle.

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

Candidate target hashes:

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

1. Install the fixed candidate once, prove candidate identity and deterministic Gateway `READY`, and keep AutoRecall disabled.
2. Observe exactly the first natural enabled `session-checkpoint` run after activation; prove scheduled Engine reconciliation, scoped Lance reconciliation, and normal checkpoint continuation without manually triggering the lifecycle.
3. Leave candidate active only on a passing verdict; otherwise restore fixed R2 once and prove R2 `READY`.

## Persistent activation state machine

Before the first scheduled-cycle verdict:

~~~text
candidate active state=PROVISIONAL
future natural cycles beyond the target=NOT YET ACCEPTED
~~~

After `PASS` or allowed `PASS_WITH_FINDINGS`:

~~~text
candidate active state=PERSISTENT
existing cron remains enabled and unchanged
future natural daily cycles=accepted product behavior
~~~

Each natural cycle remains bounded by the frozen implementation:

~~~text
MAX_ENGINE_INSERTS_PER_CYCLE=500
MAX_LANCE_WRITES_PER_CYCLE=10
~~~

Persistent activation does not authorize manual extra cycles, convergence loops, cap tuning, or a new scheduler.

## Preflight before mutation

Before the first Gateway stop, prove:

1. exact Stage Card path/SHA/commit, HEAD, clean worktree, fixed candidate/R2 artifacts, candidate hashes, and Node24/native closure;
2. active runtime is R2 `loaded`/`0.8.22`, R2 sourcePath/installPath, R2 target hashes, reconciliation module absent, and Gateway `READY` under the qualified classifier;
3. AutoRecall=`false`; `session-checkpoint` is enabled at `30 3 * * *` / `Asia/Shanghai`; no checkpoint/maintenance process is active; bounded `/tmp` evidence paths are collision-free.

Capture pre-activation checkpoint:

~~~text
lastRunAtMs=<exact value>
nextRunAtMs=<exact value>
target scheduled lifecycle=that captured nextRunAtMs
~~~

Any preflight drift stops before runtime mutation.

## Authorized runtime sequence after separate execution authorization

1. create one bounded child transaction/evidence harness under `/tmp`;
2. stop Gateway once;
3. install fixed candidate once;
4. start Gateway once;
5. poll candidate readiness with the qualified `12 × 2s` classifier;
6. prove candidate plugin/source/hash identity, AutoRecall still disabled, cron unchanged, and no maintenance process active;
7. remain passive until the captured target `session-checkpoint` run occurs naturally;
8. do not call checkpoint/reconciliation functions manually;
9. after the target run, collect checkpoint, Engine, Lance, cron, Gateway, and authority evidence;
10. on passing verdict, leave candidate active;
11. otherwise execute the single authorized R2 rollback and prove R2 `READY`.

No second candidate install or second R2 reinstall is authorized.

## Target scheduled lifecycle

The target run must advance checkpoint `lastRunAtMs` from the captured pre-activation value to the captured `nextRunAtMs` exactly once before transaction close.

Evidence must show the natural checkpoint reached the implemented sequence:

~~~text
nightlyCheckpoint()
→ reconcileSessionFlushManagedState({ trigger: "nightly_checkpoint" })
→ repairOrphanVectors({ scope: "session_flush", trigger: "nightly_checkpoint", ... })
→ resolveConfigConflicts()
→ checkpoint completion/skip/timeout completion path
~~~

Nightly LLM extraction may succeed, skip, or time out under its existing bounded behavior. Reconciliation must remain reachable when orchestration continues.

A recoverable reconciliation/provider failure must remain incomplete rather than falsely converged and must not take Gateway availability down.

## Engine contract

Report/derive:

~~~text
eligible_session_flush
ambiguous_chunk_count
engine_existing
engine_inserted
engine_backlog_remaining
engine_converged
error
~~~

Required:

- `engine_inserted <= 500`;
- only implemented first-slice eligible IDs are inserted;
- existing Engine lifecycle rows are preserved;
- ambiguous/unmappable inputs remain fail-closed;
- backlog remains current eligible Core IDs minus managed Engine IDs;
- positive backlog/ambiguity may leave `engine_converged=false`.

## Lance contract

Report/derive:

~~~text
lance_eligible
lance_existing
lance_added
lance_failed
lance_backlog_remaining
lance_converged
error
~~~

Required:

- `lance_added <= 10`;
- only active/non-archived eligible Engine IDs are considered;
- Core text is read by exact chunk ID;
- Lance row ID equals Engine/Core ID;
- no duplicate/delete/wrong-scope/cross-entry mutation;
- retryable embedding/write failures remain pending backlog;
- positive backlog does not authorize another cycle inside this stage.

A bounded retryable `lance_failed > 0` may be `PASS_WITH_FINDINGS` only when scope/ID/cap/no-delete invariants and checkpoint/Gateway availability all hold.

## Core ownership boundary

Do not require the entire Core DB/file to remain byte-identical across the natural nightly checkpoint because existing checkpoint behavior may create normal outputs outside reconciliation.

The new reconciliation seam itself must preserve:

~~~text
collectEligibleSessionFlushCoreRows()
→ withCoreDbReadonly()
→ openCoreDbReadonly({ readonly: true })
~~~

Scoped Lance text lookup remains exact-ID Core read.

No candidate-added direct Core write path is authorized.

## Final runtime and scheduler evidence

On a passing verdict prove:

~~~text
Gateway readiness=READY
plugin status=loaded
version=0.8.22
install.sourcePath=candidate
install.installPath=/home/lionsol/.openclaw/extensions/memory-engine
cron enabled=true
cron expression=30 3 * * *
cron timezone=Asia/Shanghai
repository=clean
~~~

No second new scheduled run may occur before transaction close.

## Failure and rollback

Valid Engine/Lance writes are not undone by restoring R2. Rollback restores code/runtime authority only.

Restore R2 on:

- candidate install/readiness/identity failure;
- target scheduled run not provable within the bounded observation horizon frozen in the execution packet;
- authority/cron drift;
- Engine/Lance cap violation;
- eligibility escape, wrong-ID/cross-entry addition, unexpected Lance delete, or candidate-added Core write path;
- Gateway not `READY` after target cycle;
- more than one new scheduled run before verdict;
- insufficient evidence for persistent activation.

A bounded retryable Lance provider failure alone does not require rollback when all `PASS_WITH_FINDINGS` conditions hold.

## Allowed mutations

Only:

1. bounded private `/tmp` harness/evidence files;
2. one Gateway stop/start plus one fixed candidate install;
3. the first natural existing scheduled checkpoint and its normal pre-existing checkpoint outputs;
4. target-run bounded reconciliation (`Engine<=500`, `Lance<=10`);
5. on non-passing outcome only, one Gateway stop/start plus one fixed R2 reinstall.

## Forbidden scope

Do not:

- modify repository source/tests/docs during execution;
- mutate/rebuild candidate or R2 artifacts;
- modify `openclaw.json` or cron;
- manually run checkpoint or reconciliation/orphan-repair functions;
- run a second reconciliation cycle;
- run index/sync/backfill/reindex;
- enable AutoRecall or change retrieval behavior;
- send retrieval/memory-tool/H6/natural-canary traffic for qualification;
- tune caps;
- create a persistent scheduler/ledger/queue/config mechanism;
- tag/push/release.

## Outcomes and pass criteria

`PASS` requires all three:

1. Candidate installs exactly once, reaches deterministic `READY`, matches fixed identity/hashes, AutoRecall stays disabled, and cron/authority stay unchanged.
2. Exactly one natural target checkpoint advances `lastRunAtMs` once and proves scheduled Engine/Lance orchestration within `Engine<=500` and `Lance<=10`, with no scope/ID/delete/Core-ownership violation and with checkpoint/Gateway availability preserved.
3. Candidate remains active/READY after the target cycle, repo remains clean, no manual/second cycle occurred, and the unchanged daily scheduler is accepted as the persistent lifecycle.

`PASS_WITH_FINDINGS` is limited to a bounded retryable Lance provider/write failure or non-blocking evidence-formatting issue that weakens none of the safety invariants.

`INSUFFICIENT_EVIDENCE` requires R2 rollback before close.

`STOPPED` applies to authority drift, cap/scope/ownership violation, runtime failure, more than one scheduled cycle, unexpected mutation, or required scope expansion; restore R2 when possible inside the one rollback budget.

## Execution count

A later execution packet must set:

~~~text
MAX_EXECUTIONS=1
~~~

Read-only preflight does not consume it.

The count is consumed at the first authorized runtime mutation, normally the first Gateway stop before candidate installation.

No second controlled-persistent-activation transaction is authorized after consumption.

## Required report

Report exact Stage Card/SHA/commit/HEAD, candidate/R2 authorities, pre-activation R2/readiness/AutoRecall/cron values, transaction evidence paths, candidate activation evidence, target `lastRunAtMs` transition, Engine/Lance scheduled summaries and safety audit, checkpoint completion/failure-isolation evidence, final candidate-or-R2 identity/readiness, cron unchanged, repo clean, no manual/second cycle, and final outcome.

## State after PASS

~~~text
current active runtime=candidate
persistent candidate activation=QUALIFIED
session-checkpoint=existing 30 3 * * * Asia/Shanghai
future natural scheduled reconciliation cycles=AUTHORIZED AS PRODUCT BEHAVIOR
per-cycle Engine cap=500
per-cycle Lance cap=10
manual extra reconciliation cycles=NOT AUTHORIZED
AutoRecall=disabled
~~~

Future natural cycles do not require per-cycle owner authorization after this stage passes, provided implementation/config/scheduler authority does not drift.

## Successor boundary

After outcome, stop.

Do not automatically enable AutoRecall, tune retrieval/caps, remediate ambiguous entries, run manual backlog convergence, tag, push, or release.

After `PASS`/`PASS_WITH_FINDINGS`, the next product-level decision may be persistent-operation observation/governance or a separately authorized AutoRecall/retrieval stage; it is not another reconciliation runtime retry.

## Execution authorization boundary

This Stage Card does not itself authorize persistent activation.

A later owner authorization must bind exactly:

~~~text
Stage Card path=docs/smoke-tests/session-flush-reconciliation-controlled-persistent-activation-stage-card-20260811.md
Stage Card SHA256=<computed after freeze>
Stage Card commit=<exact commit containing this card>
Repository HEAD=<exact committed Stage Card HEAD>
Source implementation commit=ac0e5f054551847e724be504bae80947abd7d675
Candidate path=/home/lionsol/.openclaw/backups/memory-engine/releases/session-flush-reconciliation-overlay-ac0e5f0-20260810-r1
R2 rollback path=/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2
MAX_EXECUTIONS=1
~~~

The later execution packet must also freeze the concrete preflight `nextRunAtMs` as the single target lifecycle and a bounded observation horizon covering that run.

Any Stage Card/commit/HEAD/candidate/R2/scheduler/scope/count drift invalidates the packet.

## Authorization state at freeze

~~~text
Controlled Persistent Activation Stage Card=FROZEN
repository scope=ONE MARKDOWN FILE ONLY
persistent activation execution=NOT AUTHORIZED BY THIS CARD
MAX_EXECUTIONS=not created/consumed
candidate install=NOT AUTHORIZED until separate execution packet
target natural checkpoint=NOT AUTHORIZED until separate execution packet
future natural cycles=NOT AUTHORIZED unless this stage passes
R2 rollback=authorized only inside later execution packet on non-passing path
manual reconciliation cycle=NOT AUTHORIZED
AutoRecall enablement=NOT AUTHORIZED
push/tag/release=NOT AUTHORIZED
~~~

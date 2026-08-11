# Session-Flush Reconciliation Runtime Qualification Retry R3 Stage Card — 2026-08-11

## Decision

Can the already-qualified immutable `ac0e5f0` reconciliation candidate be temporarily installed and non-live qualified, then R2 restored, with candidate-active and restoration Gateway connectivity proven by the independently qualified readiness gate rather than inferred from `gateway status` shell rc or service-active state?

Sol explicitly reopened this product-level retry decision on 2026-08-11 after `Gateway Readiness Evidence Harness Qualification` passed.

R3 does not reopen product implementation, candidate construction, persistent activation, or real-data reconciliation.

## Authority and lineage

Expected repository authority at freeze:

~~~text
repo=/home/lionsol/.openclaw/workspace/plugins/memory-engine
HEAD=8f74863957e2969752a06e6d8dc2ce20590a7f22
worktree=clean
~~~

Source implementation:

~~~text
commit=ac0e5f054551847e724be504bae80947abd7d675
outcome=PASS_WITH_FINDINGS
~~~

Prior runtime lineage:

~~~text
initial temporary qualification=STOPPED
retry R2=INSUFFICIENT_EVIDENCE
drift review=SPLIT
~~~

Qualified split successor:

~~~text
Gateway Readiness Evidence Harness Qualification=PASS
Stage Card commit=8f74863957e2969752a06e6d8dc2ce20590a7f22
Stage Card SHA256=67b1ae9cf64e637f766fdf802bfd744e2f5d28c0e8d60fa71822a75d53e2e2fd
~~~

R3 preserves retry R2 product/runtime scope and changes only the Gateway readiness evidence gate.

## Fixed artifacts

R2 rollback/base:

~~~text
/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2
~~~

Existing immutable candidate:

~~~text
/home/lionsol/.openclaw/backups/memory-engine/releases/session-flush-reconciliation-overlay-ac0e5f0-20260810-r1
~~~

Active extension:

~~~text
/home/lionsol/.openclaw/extensions/memory-engine
~~~

Runtime environment:

~~~text
/home/lionsol/.local/node24/bin/node
Node v24.8.0
NODE_MODULE_VERSION=137
OpenClaw 2026.6.9
plugin version=0.8.22
~~~

Candidate hashes:

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

Exact candidate delta over R2 remains:

~~~text
modified:
  bin/session-checkpoint.js
  lib/checkpoint/orphan-repair.js
  lib/checkpoint/runtime.js
added:
  lib/checkpoint/session-flush-reconciliation.js
~~~

R2 restoration hashes:

~~~text
bin/session-checkpoint.js
1e39d12bcebe37728613b3b420ee7402ba0aa8833ae21fd8f58fa842075837e9

lib/checkpoint/orphan-repair.js
837587ef75174d8aefbd36d97839c3487b10d9b92a872ad6292e7f078b7a3035

lib/checkpoint/runtime.js
1ca5deba67cacc688fca844ca7c02dbdefdb510f9909ec75bd57f64d63965b62

lib/checkpoint/session-flush-reconciliation.js
ABSENT
~~~

Do not rebuild, mutate, chmod, reseal, repair, rename, delete, or overwrite candidate/R2 artifacts.

## In scope

Exactly three items:

1. Requalify repository, immutable candidate, R2 baseline, Node/native closure, AutoRecall, cron, and maintenance safety before mutation.
2. Install the existing candidate once and perform the already-defined non-live qualification only after Gateway readiness becomes `READY` under the qualified classifier.
3. Restore R2 once and prove final R2 identity plus Gateway `READY` under the same classifier.

## Readiness gate

Use the qualified readiness semantics exactly:

~~~text
READY = Runtime running
        + Connectivity probe: ok
        + readiness-consistent listening evidence

NOT_READY = explicit connectivity failure/non-listening evidence

UNKNOWN = incomplete, contradictory, unparsable, or insufficient evidence
          => fail closed
~~~

Polling:

~~~text
MAX_ATTEMPTS=12
INTERVAL_SECONDS=2
~~~

Precedence and control flow:

1. contradictory explicit success/failure => `UNKNOWN`;
2. explicit connectivity failure/non-listening => `NOT_READY`;
3. running + explicit connectivity success + listening evidence => `READY`;
4. otherwise => `UNKNOWN`;
5. `READY` continues;
6. `NOT_READY` retries only while attempts remain;
7. `UNKNOWN` terminates that readiness cycle fail closed;
8. 12 attempts without `READY` is readiness failure.

Shell rc=0, systemd active state, PID presence, and warm-up text never independently establish readiness.

Each attempt must preserve bounded auditable evidence and its classifier verdict.

## Execution harness

Reuse retry R2 harness corrections:

- independent child bash subprocess, not top-level `exit` branches pasted into the operator shell;
- bounded persistent `/tmp` transaction/evidence files;
- `EXIT/INT/TERM/HUP` restoration handling;
- inspect JSON isolated from stderr plugin logs;
- candidate install maximum 1;
- R2 reinstall maximum 1.

No persistent harness, CLI, config, service, scheduler, ledger, table, queue, state machine, or OpenSpec is created.

## Preflight before runtime mutation

Before any Gateway stop, prove:

1. exact R3 Stage Card path/SHA/commit, repository HEAD, and clean worktree match the authorized packet;
2. candidate path, exact four hashes/delta, sealed permissions, package/lock inheritance, and Node24/native closure still match;
3. R2 rollback release exists and remains the fixed restoration authority;
4. active runtime is R2 by plugin sourcePath/installPath/version/loaded state, R2 hashes, and new-module absence;
5. current R2 Gateway readiness is `READY` under the qualified classifier;
6. effective AutoRecall remains disabled;
7. checkpoint schedule remains `30 3 * * *` in `Asia/Shanghai`, next run is more than 60 minutes away, and no maintenance/checkpoint process is active;
8. bounded `/tmp` transaction paths are safe to use.

Any failure stops before runtime mutation. Do not repair or broaden scope.

## Authorized runtime sequence after separate execution authorization

1. create bounded child transaction/evidence artifacts under `/tmp`;
2. stop Gateway;
3. install existing immutable candidate once;
4. start Gateway;
5. poll candidate readiness under `12 × 2s`;
6. only if candidate reaches `READY`, perform bounded candidate-active non-live qualification;
7. once candidate install was attempted, proceed to mandatory R2 restoration regardless of candidate result;
8. stop Gateway;
9. install fixed R2 once;
10. start Gateway;
11. poll restoration readiness under `12 × 2s`;
12. verify final R2 identity and no-checkpoint evidence;
13. exit child transaction and report.

No second candidate install or second R2 reinstall is authorized.

## Candidate-active qualification after READY

Verify only:

- plugin `loaded`, version `0.8.22`, active install path, and `install.sourcePath` equals fixed candidate;
- active four target hashes equal frozen candidate hashes;
- R2 provenance files and package/lock remain unchanged;
- Node24 module loadability for reconciliation/orphan-repair/runtime modules and `session-checkpoint.js` with `require.main !== module`;
- bounded constants remain Engine max 500 and Lance max 10;
- pure in-memory parser contract passes;
- static orchestration order remains:

~~~text
nightlyCheckpoint
→ reconcileSessionFlushManagedState
→ repairOrphanVectors({ scope: "session_flush" })
→ resolveConfigConflicts
~~~

- checkpoint `lastRunAtMs` does not advance and no maintenance process begins while candidate is active.

Do not invoke checkpoint main, reconciliation, orphan repair, embeddings, retrieval, AutoRecall, memory tools, or Core/Engine/Lance operations.

If candidate readiness becomes `UNKNOWN` or exhausts 12 `NOT_READY` attempts, do not continue candidate qualification; proceed directly to the single R2 restoration. A transient `NOT_READY` followed by `READY` within budget is permitted.

## Mandatory R2 restoration

Once candidate installation was attempted, R2 restoration is mandatory.

Passing restoration requires:

~~~text
Gateway readiness=READY
plugin status=loaded
version=0.8.22
install.sourcePath=/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2
install.installPath=/home/lionsol/.openclaw/extensions/memory-engine
~~~

and:

- three R2 target hashes restored;
- reconciliation module absent;
- provenance files/package/lock remain R2;
- checkpoint `lastRunAtMs` unchanged through candidate-active interval;
- no maintenance process remains.

If restoration readiness is `UNKNOWN` or exhausts 12 attempts, the stage is `STOPPED`. Do not perform a second R2 reinstall.

## Allowed mutations during execution

Only:

1. bounded `/tmp` child transaction/evidence artifacts;
2. Gateway stop/start for candidate transaction;
3. one install of fixed immutable candidate;
4. Gateway stop/start for mandatory restoration;
5. one reinstall of fixed R2.

## Forbidden scope

Do not:

- modify repository source/tests/docs during execution;
- mutate candidate/R2 artifacts;
- modify `openclaw.json` or cron;
- enable AutoRecall or change retrieval behavior;
- run checkpoint, reconciliation, orphan repair, index/sync/backfill/reindex, or production embeddings;
- inspect/mutate Core, Engine, or Lance for validation;
- send retrieval/memory-tool/H6/natural-canary traffic;
- install/rebuild dependencies;
- create new product/runtime/config mechanisms;
- leave candidate persistently installed;
- perform real-data reconciliation;
- tag/push/release.

## Outcomes and pass criteria

`PASS` requires all three:

1. candidate installed exactly once, reaches deterministic `READY`, and bounded plugin/byte/module/parser/static non-live checks pass without checkpoint/data/retrieval operations;
2. R2 restored exactly once, reaches deterministic `READY`, exact R2 identity is proven, and no checkpoint ran while candidate was active;
3. authority, execution counts, clean repo, child-process evidence, and forbidden-scope boundaries remain intact.

`PASS_WITH_FINDINGS` is only for a non-blocking logging/formatting observation that weakens none of the criteria.

`INSUFFICIENT_EVIDENCE` applies only when R2 is safely restored and `READY`, but a required non-destructive qualification fact remains unprovable within scope.

`STOPPED` applies to candidate qualification failure, restoration readiness/identity failure, authority drift, unexpected mutation, or need to broaden scope.

## Execution count

A later execution packet must set:

~~~text
MAX_EXECUTIONS=1
~~~

Read-only preflight does not consume it. The count is consumed at the first authorized runtime mutation, normally the first Gateway stop before candidate installation. No second R3 transaction is authorized after consumption.

## Required report

Report:

- exact Stage Card path/SHA/commit/HEAD;
- immutable candidate and R2 authorities;
- active R2 preflight identity/readiness plus AutoRecall/cron/maintenance safety;
- child script/log paths;
- candidate install result and readiness attempts/verdicts;
- candidate-active non-live evidence if READY;
- checkpoint evidence;
- mandatory R2 reinstall result and readiness attempts/verdicts;
- final R2 identity/Gateway state;
- clean repo and zero forbidden data/retrieval operation statement;
- stage outcome and at most one successor recommendation.

## State after PASS

~~~text
current_fact:
the ac0e5f0 immutable candidate can be temporarily installed,
reach deterministic Gateway readiness, satisfy bounded non-live runtime
qualification, and then be replaced by the fixed R2 runtime which also
reaches deterministic Gateway readiness.

current active runtime after stage=R2 provenance release
persistent activation=NOT AUTHORIZED / NOT IMPLEMENTED
real Core→Engine reconciliation=NOT PERFORMED / NOT AUTHORIZED
real Engine→Lance reconciliation=NOT PERFORMED / NOT AUTHORIZED
~~~

Retry R2 remains historically `INSUFFICIENT_EVIDENCE`; R3 does not rewrite that outcome.

## Successor boundary

After R3 outcome, stop. Do not automatically persist the candidate, run real reconciliation, enable AutoRecall, run a natural canary, tune retrieval, create another retry, tag, push, or release.

## Execution authorization boundary

This frozen Stage Card does not itself authorize runtime execution.

A later execution authorization must bind exactly:

~~~text
Stage Card path=docs/smoke-tests/session-flush-reconciliation-runtime-qualification-retry-r3-stage-card-20260811.md
Stage Card SHA256=<computed after freeze>
Stage Card commit=<exact commit containing this card>
Repository HEAD=<exact committed Stage Card HEAD>
Source implementation commit=ac0e5f054551847e724be504bae80947abd7d675
Readiness harness Stage Card SHA256=67b1ae9cf64e637f766fdf802bfd744e2f5d28c0e8d60fa71822a75d53e2e2fd
Candidate path=/home/lionsol/.openclaw/backups/memory-engine/releases/session-flush-reconciliation-overlay-ac0e5f0-20260810-r1
R2 rollback path=/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2
MAX_EXECUTIONS=1
~~~

Any Stage Card content/commit, HEAD, fixed artifact, source/readiness authority, scope, or execution-count drift invalidates the packet.

## Authorization state at freeze

~~~text
Retry R3 Stage Card=FROZEN
Stage Card repository scope=ONE MARKDOWN FILE ONLY
Retry R3 runtime execution=NOT AUTHORIZED BY THIS CARD
Retry R3 MAX_EXECUTIONS=not created/consumed
Existing candidate reuse=ACCEPTED FOR R3
Candidate mutation/new construction=NOT AUTHORIZED
Gateway stop/start=NOT AUTHORIZED until separate R3 execution packet
Candidate install=NOT AUTHORIZED until separate R3 execution packet
Mandatory R2 restoration=authorized only inside later R3 execution packet
Persistent activation=NOT AUTHORIZED
Real-data reconciliation=NOT AUTHORIZED
AutoRecall enablement=NOT AUTHORIZED
Push/tag/release=NOT AUTHORIZED
~~~

Stop at the separate R3 runtime-execution authorization gate after mechanical validation and commit.

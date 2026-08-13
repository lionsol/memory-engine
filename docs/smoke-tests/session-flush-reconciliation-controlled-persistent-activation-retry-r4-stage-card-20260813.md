# Session-Flush Reconciliation Controlled Persistent Activation Retry R4 Stage Card — 2026-08-13

## Decision

Can the already-qualified immutable `ac0e5f0` session-flush reconciliation candidate become the persistent active runtime after one natural scheduled `session-checkpoint` lifecycle when the qualification harness is hardened against Windows/WSL host reboot by:

1. keeping R2 active until a short pre-target critical window;
2. writing qualification evidence to a reboot-survivable private path instead of `/tmp`;
3. recording WSL boot identity explicitly;
4. preserving the R3 exact target-near Core/Engine/Lance state-effect contract; and
5. providing a bounded recovery-only path if a host reboot occurs after the single execution count is consumed?

This is a qualification-harness retry only.

It does not reopen reconciliation source implementation, first-real-data qualification, runtime qualification, caps, ordering, eligibility, scheduler design, AutoRecall, retrieval behavior, or backlog convergence policy.

## Mandatory R3 post-host-reboot drift review

Verdict:

~~~text
DRIFT_REVIEW=CONTINUE_WITH_HOST_REBOOT_HARDENING
product/source change=NO
candidate artifact change=NO
R2 artifact change=NO
scheduler payload change=NO
cron schedule change=NO
AutoRecall change=NO
reconciliation semantics change=NO
reconciliation caps change=NO
manual backlog convergence=NO
qualification harness change=YES
persistent reboot-survivable evidence=YES
short delayed activation window=YES
boot identity evidence=YES
recovery-only rollback continuation=YES
~~~

Reason:

- Retry R3 passed preflight, consumed its single execution, installed the candidate, reached deterministic Gateway `READY`, matched exact candidate identity/hashes, captured an activation baseline, and entered the provisional observation embargo.
- The owner subsequently reported that Windows Update automatically restarted the host overnight.
- R3's evidence was stored only under `/tmp`; after host/WSL restart the R3 final markers, target-near snapshot, post snapshot, and result artifact were no longer available.
- The current Gateway service has a new post-reboot start identity and therefore cannot satisfy R3's frozen provisional PID/start boundary.
- Retry R3 had already emitted `EXECUTION_COUNT_CONSUMED=1`; therefore Retry R3 cannot be executed again.
- Current active plugin identity is exact R2, Gateway is `READY`, and AutoRecall remains disabled.
- The post-reboot cron lifecycle at `2026-08-13 07:35:54 +08:00` generated a canonical `checkpoint_llm` episode for target date `2026-08-12`.
- Current state is consistent with one additional bounded Lance reconciliation cycle: historical pre-R3 Lance total was `65`; current Lance total is `75`; current Engine eligible backlog remains zero; current active eligible count remains `694`; current Lance active-eligible backlog is `629`.
- The delayed post-reboot lifecycle is outside R3's frozen `03:30–04:00` observation horizon and cannot retroactively qualify R3.

The first loss is therefore host-reboot resilience of the qualification harness/evidence boundary, not evidence of a product reconciliation defect.

## Retry R3 final historical adjudication

Retry R3 is permanently classified:

~~~text
Controlled Persistent Activation Retry R3=STOPPED
reason=host_reboot_invalidated_provisional_observation_boundary
EXECUTION_COUNT_CONSUMED=1
R3_REEXECUTION=NOT_AUTHORIZED
~~~

This R4 Stage Card does not retroactively change R3 to `PASS`, `PASS_WITH_FINDINGS`, or `INSUFFICIENT_EVIDENCE`.

## Current authority at R4 Stage Card creation

Repository review facts:

~~~text
repo=/home/lionsol/.openclaw/workspace/plugins/memory-engine
review HEAD=d578f1d676921bc146b4c1f9dd5eed16ba0ce989
source implementation=ac0e5f054551847e724be504bae80947abd7d675
~~~

Current worktree is not clean at review time:

~~~text
modified=docs/stabilization-plan.md
R4 Stage Card file=this file
~~~

The pre-existing `docs/stabilization-plan.md` modification is outside R4 scope and must not be overwritten, reverted, staged, or silently included by the R4 Stage Card authoring transaction.

It is not repository authority until separately resolved by the owner.

**R4 runtime execution is blocked unless the worktree is clean at the later exact execution preflight.**

A later R4 execution packet must bind the exact committed R4 Stage Card HEAD and must not rely on the review-time HEAD above.

## Current runtime review facts

At R4 Stage Card creation:

~~~text
active runtime=R2
Gateway=READY
Gateway MainPID=543
Gateway ExecMainStartTimestamp=Thu 2026-08-13 07:35:36 CST
Gateway NRestarts=0
AutoRecall.enabled=false
openclaw.json sha256=acc1c2556fab8819ff5b0cdd38b54d86d6e8e4adaf38dfc500107746dc5ff838
~~~

Current cron review facts:

~~~text
cron id=7b40cc54-3c66-4183-a0f7-453e3e9cec00
enabled=true
expr=30 3 * * *
timezone=Asia/Shanghai
lastRunAtMs=1786577754960
lastRunLocal=2026-08-13 07:35:54 +08:00
lastRunStatus=ok
nextRunAtMs=1786649400000
nextRunLocal=2026-08-14 03:30:00 +08:00
~~~

The current next-run timestamp is a dated review fact only. The execution packet must re-read and freeze the then-current exact scheduler lifecycle.

## Post-reboot delayed lifecycle review

Canonical target episode:

~~~text
path=/home/lionsol/.openclaw/workspace/memory/episodes/2026-08-12.md
targetDate=2026-08-12
generatedAt=2026-08-12T23:36:04.029Z
local generatedAt=2026-08-13 07:36:04 +08:00
category=episodic
source_type=checkpoint_llm
~~~

Current reconciliation state review:

~~~text
eligible_session_flush=694
ambiguous_chunk_count=37
unmappable_chunk_count=0
Engine managed eligible=694
Engine active eligible=694
Engine eligible backlog=0
Lance global total=75
Lance active-eligible backlog=629
~~~

Historical pre-R3 Lance total:

~~~text
65
~~~

Observed current delta:

~~~text
Lance global total delta since R3 activation baseline=+10
~~~

This state is consistent with one bounded `MAX_LANCE_WRITES_PER_CYCLE=10` reconciliation cycle during the delayed post-reboot checkpoint lifecycle.

Because the R3 target-near snapshot did not survive, this review does not claim exact-ID attribution of that historical `+10` and does not use it as R3 qualification evidence.

R4 must derive its own exact expected IDs from a fresh target-near snapshot.

## Qualified predecessors

~~~text
Gateway Readiness Evidence Harness Qualification=PASS
Runtime Qualification Retry R3=PASS
First Real-Data Reconciliation Canary=PASS
Controlled Persistent Activation initial transaction=STOPPED due external runtime mutation
Controlled Persistent Activation Retry R2=INSUFFICIENT_EVIDENCE due truncated scheduler diagnostics
Controlled Persistent Activation Retry R3=STOPPED due host reboot invalidating provisional observation
~~~

None of these outcomes invalidate the immutable candidate artifact or the first-real-data reconciliation qualification.

## Fixed runtime artifacts

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

R2 active hashes:

~~~text
bin/session-checkpoint.js
1e39d12bcebe37728613b3b420ee7402ba0aa8833ae21fd8f58fa842075837e9

lib/checkpoint/orphan-repair.js
837587ef75174d8aefbd36d97839c3487b10d9b92a872ad6292e7f078b7a3035

lib/checkpoint/runtime.js
1ca5deba67cacc688fca844ca7c02dbdefdb510f9909ec75bd57f64d63965b62
~~~

Natural cron wrapper:

~~~text
/home/lionsol/.openclaw/workspace/plugins/memory-engine/bin/run-session-checkpoint-direct.sh
sha256=c46391e7d603668abe588e857e92b25aa09ac9119706364a406418f25ff0f768
~~~

Candidate and R2 artifacts are immutable for R4.

Do not rebuild either artifact.

## Static scheduled-path authority

The cron payload must remain exactly equivalent to:

~~~text
sh -lc /bin/bash /home/lionsol/.openclaw/workspace/plugins/memory-engine/bin/run-session-checkpoint-direct.sh
~~~

The wrapper resolves the repository checkout and invokes canonical `bin/session-checkpoint.js`.

The scheduled reconciliation path remains:

~~~text
nightlyCheckpoint
→ reconcileSessionFlushManagedState
→ repairOrphanVectors({scope:"session_flush"})
→ resolveConfigConflicts
~~~

R4 does not alter this path.

## Reconciliation contract frozen from the qualified candidate

### Eligibility

Session-flush eligibility remains based on:

~~~text
path
provenance
category
line-range mapping
~~~

Ambiguous or unmappable chunks fail closed.

The known `37` ambiguous chunks are not modified by this stage.

### Core → Engine

Frozen behavior:

~~~text
Core access=readonly
ordering=updated_at ascending, then id ascending
insert-if-missing=idempotent
MAX_ENGINE_INSERTS_PER_CYCLE=500
no delete
no cross-entry mutation
~~~

### Engine → Lance

Frozen behavior:

~~~text
scope=session_flush
ordering=same ordered eligible Core rows
active/non-archived only
exact Core text by chunk ID
MAX_LANCE_WRITES_PER_CYCLE=10
no delete
no cross-entry mutation
provider/write failures retryable
~~~

No R4 source change is authorized.

## R4 harness design change 1 — delayed candidate activation

R3 activated the candidate many hours before the natural target and therefore exposed the qualification transaction to a long host-reboot window.

R4 reduces that exposure.

A detached watcher may be started well before the target, but it must remain in **pre-execution waiting mode** with R2 active until the frozen target enters the critical activation window.

Default critical activation lead:

~~~text
ACTIVATION_LEAD_MS=1200000
activation not before=target - 20 minutes
~~~

The execution packet may tighten the exact lead time only if it remains at least 10 minutes and no more than 30 minutes.

Before the activation window:

~~~text
candidate install=NO
Gateway stop/start=NO
execution count consumed=NO
R2 remains active
~~~

Immediately before consuming the execution count, the watcher must repeat the full mutating preflight and prove that the frozen target is still the scheduler's current `nextRunAtMs`.

If the host/WSL reboots before execution consumption, the candidate remains R2 and the qualification execution has not been consumed.

A later relaunch of the **same exact watcher SHA and same exact execution packet** is allowed only when all of the following remain true:

~~~text
EXECUTION_COUNT_CONSUMED marker absent
Stage Card/HEAD/watcher SHA unchanged
cron target unchanged and still future
worktree clean
R2 exact and Gateway READY
AutoRecall disabled
persistent evidence proves no candidate activation occurred
~~~

Such a relaunch is launcher recovery, not a second R4 runtime execution.

Once `EXECUTION_COUNT_CONSUMED=1` is durably recorded, no relaunch may perform candidate activation again.

## R4 harness design change 2 — reboot-survivable evidence

R4 must not use `/tmp` as the sole evidence authority.

Authorized private evidence root:

~~~text
/home/lionsol/.openclaw/backups/memory-engine/qualification-evidence/
  session-flush-reconciliation-controlled-persistent-activation-retry-r4-20260813/
~~~

The execution packet may append a deterministic target timestamp suffix to avoid collisions.

Requirements:

~~~text
directory mode=0700
regular evidence file mode=0600 where practical
no source text payloads unless already required by the frozen episode provenance check
IDs/metadata only for Core/Engine/Lance snapshots
no writes to repo files
no writes to Core DB
no product DB schema changes
no persistent product instrumentation
~~~

At minimum persist:

~~~text
watcher SHA
authority snapshot
transaction-state.json
event log
launcher metadata
boot-id snapshot(s)
pre-execution R2 snapshot
activation baseline snapshot
target-near snapshot
expected-state.json
post-target snapshot
target episode provenance summary
final result.json
rollback/recovery evidence
~~~

Evidence updates that change transaction phase must be durable before the next runtime mutation.

The watcher should use atomic replace semantics for `transaction-state.json` where practical.

## R4 harness design change 3 — WSL boot identity

Capture:

~~~text
/proc/sys/kernel/random/boot_id
~~~

at:

1. watcher start;
2. immediate pre-execution preflight;
3. post-candidate activation;
4. target-near snapshot;
5. post-target snapshot;
6. final close.

Within one valid consumed transaction, all boot IDs must be identical.

A changed boot ID after execution consumption proves that the continuous provisional observation boundary was broken and requires `STOPPED`.

A boot ID change before execution consumption does not consume the execution. The watcher must fail closed and require exact preflight re-establishment before any later launcher recovery.

## R4 harness design change 4 — recovery-only continuation

A host reboot can kill the watcher before its EXIT trap executes.

Therefore R4 defines a bounded recovery-only continuation for the already-consumed transaction.

Recovery-only mode is authorized only when persistent evidence proves:

~~~text
EXECUTION_COUNT_CONSUMED=1
final qualified marker absent
candidate activation was attempted or completed
current boot_id differs from consumed transaction boot_id OR watcher died unexpectedly
~~~

Recovery-only mode may do exactly:

1. inspect current active plugin/runtime state;
2. if current runtime is already exact R2 and Gateway READY, record `RECOVERY_R2_ALREADY_PRESENT=PASS` and stop;
3. otherwise perform exactly one bounded R2 restore transaction;
4. prove Gateway `READY`;
5. prove exact R2 source/hash identity;
6. prove AutoRecall remains disabled;
7. record final recovery evidence.

Recovery-only mode must not:

~~~text
install candidate
run checkpoint
run reconciliation
write Lance
write Engine
change cron
change config
change repository
consume another qualification execution
~~~

Recovery-only closure does not turn the interrupted R4 qualification into `PASS`.

## Evidence contract retained from R3

R4 retains scheduler-state plus exact target-near/post state effects as the primary qualification proof.

`lastDiagnostics.summary` remains advisory because OpenClaw may truncate it.

### Target-near timing

Capture the target-near snapshot as close as safely practical to the frozen natural target, normally within the final 60 seconds before `targetNextRunAtMs`.

After snapshot completion, re-read cron state and require:

~~~text
lastRunAtMs still equals frozen pre-target lastRunAtMs
runningAtMs absent/zero
snapshot completion time < targetNextRunAtMs
boot_id unchanged
~~~

If the natural lifecycle starts while the target-near snapshot is being captured, classify `INSUFFICIENT_EVIDENCE`.

### Snapshot contents

Capture ordered eligible Core authority:

~~~text
id
updated_at
path
start_line
end_line
category/provenance basis as required for audit
~~~

Capture Engine state for eligible IDs:

~~~text
chunk_id
initial_confidence
confidence
last_confidence_update
base_tau
hit_count
is_archived
is_protected
conflict_flag
category
~~~

Capture Lance:

~~~text
exact unique global IDs
exact eligible IDs present
~~~

Do not persist canonical memory text in these state snapshots.

### Target-window authority stability

Require:

~~~text
target-near ordered eligible IDs == post-target ordered eligible IDs
ambiguous count unchanged
unmappable count unchanged
~~~

If this authority changes during the target window, use `INSUFFICIENT_EVIDENCE`.

### Expected Engine transition

From target-near state derive:

~~~text
engine_missing_pre = ordered eligible IDs absent from Engine
expected_engine_selected = first min(500, engine_missing_pre.length)
~~~

After the target lifecycle require:

~~~text
Engine eligible new exact IDs == expected_engine_selected
Engine eligible removed exact IDs == none
pre-existing eligible Engine row fields unchanged
new rows satisfy raw_log policy:
  is_archived=0
  is_protected=0
  conflict_flag=0
  category=raw_log
post Engine missing == pre missing - expected inserts
~~~

A zero Engine delta is valid only when target-near evidence independently proves zero Engine eligible backlog.

### Expected Lance transition

Construct expected post-Engine active eligible ordering from:

~~~text
target-near ordered eligible Core rows
+
pre-existing active Engine IDs
+
expected Engine inserted IDs
~~~

Then derive:

~~~text
lance_missing_pre = ordered active eligible IDs absent from Lance
expected_lance_selected = first min(10, lance_missing_pre.length)
~~~

For clean `PASS` when `lance_missing_pre > 0`, require:

~~~text
Lance global new exact IDs == expected_lance_selected
Lance removed exact IDs == none
no global Lance additions outside expected_lance_selected during target window
all new IDs belong to post-target active eligible session_flush authority
~~~

If `lance_missing_pre=0`, a no-op Lance transition is observationally valid but lacks positive Lance execution evidence; without another independent non-truncated positive proof classify `INSUFFICIENT_EVIDENCE`.

If observed Lance additions are fewer than expected and no independent non-truncated provider/write failure signal exists, classify `INSUFFICIENT_EVIDENCE`.

## Scheduler transition proof

Freeze before the critical activation window:

~~~text
pre lastRunAtMs=<exact>
target nextRunAtMs=<exact>
target local time=<exact>
observation horizon=<explicit bounded post-target time>
~~~

The execution packet should use a horizon no later than 30 minutes after the frozen natural target unless a narrower bound is practical.

The target lifecycle must satisfy:

~~~text
actual lastRunAtMs > pre lastRunAtMs
actual lastRunAtMs >= frozen target nextRunAtMs
actual lastRunAtMs < observation horizon
post nextRunAtMs > frozen target nextRunAtMs
exactly one new scheduler lifecycle before verdict
lastRunStatus=ok
lastStatus=ok when present
runningAtMs absent/zero before settlement
~~~

The exact scheduler command entry must still match the canonical wrapper.

Scheduler summary truncation is not by itself a failure when all primary evidence channels close.

## Target episode provenance

The wrapper may return zero after writing a fallback episode, so scheduler status alone is insufficient.

The target episode must exist and be nonempty.

Require:

~~~text
targetDate=<expected target date>
source_type=checkpoint_fallback absent
~~~

Normally canonical success provides:

~~~text
source_type=checkpoint_llm
~~~

The episode `generatedAt` must fall inside the frozen target lifecycle/horizon window.

A proven `checkpoint_fallback` is `STOPPED` for clean persistent activation qualification.

Unresolvable episode provenance is `INSUFFICIENT_EVIDENCE`.

## Pre-execution waiting mode

A R4 watcher may start hours before target only to preserve scheduling convenience.

While waiting:

~~~text
runtime mutation=NONE
candidate install=NONE
Gateway mutation=NONE
EXECUTION_COUNT_CONSUMED=0
active runtime must remain R2 at the moment mutating preflight begins
~~~

The watcher may periodically record only:

~~~text
current wall-clock time
boot_id
whether frozen target remains future
whether execution has been consumed
~~~

It must not treat long pre-activation PID/config stability as qualification evidence.

Qualification runtime/config stability begins only after candidate provisional `READY` and is intentionally bounded to the short critical window.

## Exact mutating preflight

Immediately before consuming the execution count require all of the following:

1. exact committed R4 HEAD matches execution packet;
2. worktree clean;
3. exact R4 Stage Card SHA matches execution packet;
4. exact watcher SHA matches execution packet;
5. candidate hashes exact;
6. R2 hashes exact;
7. active runtime is exact R2;
8. Gateway `READY`;
9. Node `v24.8.0`, ABI `137`;
10. AutoRecall disabled;
11. cron ID/enabled/expr/timezone exact;
12. cron payload exact;
13. frozen `preLastRunAtMs` and `targetNextRunAtMs` still exact;
14. target is future and current time is inside the authorized activation window;
15. target plus horizon cannot include a second natural lifecycle;
16. canonical wrapper/repo candidate hashes exact;
17. no checkpoint/reconciliation/maintenance process active;
18. evidence directory exact, private, collision-safe, and writable;
19. persistent transaction state says execution unconsumed;
20. current boot ID recorded and stable through preflight.

Any preflight failure before execution consumption stops without candidate activation.

## Execution-count boundary

R4 must set:

~~~text
MAX_EXECUTIONS=1
~~~

The count is consumed exactly once, immediately before the first authorized candidate Gateway stop.

Before the first Gateway stop, durably persist:

~~~text
EXECUTION_COUNT_CONSUMED=1
consumed_at=<timestamp>
consumed_boot_id=<boot_id>
RESTORATION_REQUIRED=1
~~~

Once durably consumed, no R4 candidate activation retry is authorized regardless of outcome.

## Authorized runtime sequence

After a separately bound owner execution authorization:

1. create/validate private persistent evidence directory;
2. start the exact detached watcher in pre-execution waiting mode;
3. remain R2 and perform no runtime mutation until the activation window;
4. enter the activation window and perform exact mutating preflight;
5. snapshot current R2 authority and current boot ID;
6. durably persist `EXECUTION_COUNT_CONSUMED=1` and rollback obligation;
7. stop Gateway once;
8. install candidate once;
9. start Gateway once;
10. poll deterministic readiness with the already-qualified readiness classifier;
11. prove candidate source/hash identity exact;
12. prove AutoRecall disabled and cron unchanged;
13. freeze provisional Gateway PID/start/ActiveEnter/NRestarts/config SHA and boot ID;
14. capture activation baseline snapshot;
15. enter short passive observation embargo;
16. within final 60 seconds before target, capture target-near snapshot;
17. re-prove target has not started and boot ID/runtime/config authority remains exact;
18. derive expected Engine/Lance exact selected IDs;
19. wait only for the frozen natural cron lifecycle;
20. observe exactly one target lifecycle and settlement;
21. capture immediate post-target state and target episode provenance;
22. run exact state-transition audit;
23. perform final scheduler/repository/candidate/runtime/config/boot-ID stability checks;
24. if qualified, durably record final outcome before clearing rollback obligation;
25. clear `RESTORATION_REQUIRED` only after final qualified evidence is durable;
26. leave candidate active on `PASS` or allowed `PASS_WITH_FINDINGS`;
27. on in-process non-pass, perform exactly one bounded R2 rollback;
28. if watcher is lost after consumption, use only the R4 recovery-only continuation described above.

## Observation embargo

From candidate provisional `READY` until final verdict:

Do not modify:

~~~text
Gateway lifecycle
OpenClaw config
heartbeat config
cron config
plugin install state
model/provider configuration
repository HEAD/worktree
Stage Card
candidate/R2 artifacts
AutoRecall
checkpoint/reconciliation manually
Engine/Lance manually
~~~

Ordinary conversations and read-only inspection that do not mutate these authorities remain allowed.

Any external mutation or reboot inside this consumed critical window invalidates continuous observation.

## Runtime stability proof

Freeze after candidate `READY`:

~~~text
MainPID
ExecMainStartTimestamp
ActiveEnterTimestamp
NRestarts
openclaw.json SHA256
boot_id
~~~

Poll no less frequently than every 30 seconds during the critical window.

Any change before final close is `STOPPED`.

## Outcomes

### PASS

`PASS` requires all of the following:

1. exact candidate activation succeeds once;
2. Gateway reaches deterministic `READY`;
3. candidate source/hash identity exact;
4. AutoRecall remains disabled;
5. candidate provisional PID/start/config/boot identity remains stable;
6. exactly one natural target scheduler lifecycle occurs within horizon and settles `ok`;
7. target episode proves canonical non-fallback provenance;
8. target-near/post eligible authority is stable;
9. exact Engine transition matches expected bounded selection;
10. exact global Lance transition matches expected bounded selection;
11. no delete/wrong-scope/existing-row mutation occurs;
12. repository/Stage/watcher/scheduler/candidate authority remains exact;
13. final qualified evidence is durably persisted before rollback obligation is cleared;
14. candidate remains active and Gateway `READY` after final close.

### PASS_WITH_FINDINGS

Limited to:

- scheduler diagnostic-summary truncation when primary proof closes; or
- a bounded retryable Lance provider/write failure only when an independent non-truncated channel proves attempted/failing exact selected IDs and all cap/scope/no-delete/runtime/provenance invariants remain closed.

A host reboot is never a `PASS_WITH_FINDINGS` condition.

### INSUFFICIENT_EVIDENCE

Use when attribution cannot be proven, including:

- target-near snapshot crosses target start;
- target-near/post eligible authority changes;
- target lifecycle/episode provenance is ambiguous;
- expected state snapshot cannot be fully read;
- Lance delta is smaller than expected without independent failure proof;
- Lance backlog is zero without independent positive execution proof;
- state transition cannot be uniquely attributed to the target lifecycle.

### STOPPED

Use when any hard authority or safety invariant is violated, including:

- host/WSL reboot after execution consumption;
- boot ID drift after execution consumption;
- Gateway PID/start/config restart drift;
- candidate install/readiness/identity failure;
- AutoRecall/config/cron/repository drift;
- target scheduler status not `ok`;
- fallback episode;
- Engine cap/scope/delete/existing-row violation;
- Lance unexpected global addition/delete/wrong-scope violation;
- more than one scheduler lifecycle;
- required scope expansion or forbidden mutation.

## R2 rollback semantics

On any in-process non-pass after candidate mutation:

1. install R2 exactly once;
2. start Gateway exactly once as required;
3. prove Gateway `READY`;
4. prove exact R2 source/hash identity;
5. prove AutoRecall disabled;
6. durably record rollback result.

No second R2 reinstall is authorized inside the same transaction.

Valid Engine/Lance writes produced by a natural checkpoint lifecycle are not transactionally undone.

## Host reboot after execution consumption

If persistent evidence later proves the consumed transaction was interrupted by host/WSL reboot:

~~~text
R4 final qualification=STOPPED
R4 candidate re-execution=NOT AUTHORIZED
recovery-only continuation=AUTHORIZED within the same consumed transaction
~~~

The recovery-only continuation may restore runtime authority only. It may not replay qualification.

## Host reboot before execution consumption

If the watcher is lost before durable `EXECUTION_COUNT_CONSUMED=1`:

~~~text
R4 execution consumed=NO
candidate activation=NO
R2 expected to remain active
qualification outcome=not yet executed
~~~

A same-packet launcher recovery may be used only if the exact target remains future and all exact preflight authority remains unchanged.

If the frozen target has changed or passed, a new execution packet must be bound to the still-frozen R4 Stage Card; this does not require a new Stage Card unless scope/contract/authority materially changes.

## Persistent evidence retention

Do not delete R4 evidence until final adjudication and successor-boundary closure.

After final adjudication, evidence cleanup is a separate housekeeping action and must not be mixed into runtime qualification.

The evidence directory is qualification evidence, not product runtime state.

## Current known R4 starting state

Dated review state only:

~~~text
eligible_session_flush=694
ambiguous=37
unmappable=0
Engine eligible managed=694
Engine active eligible=694
Engine eligible backlog=0
Lance global total=75
Lance active-eligible backlog=629
~~~

The execution packet must re-snapshot rather than assume these values remain current.

## Explicit non-goals

R4 does not authorize:

- source-code changes;
- cap changes;
- eligibility changes;
- ambiguity repair of the `37` chunks;
- manual reconciliation;
- manual Lance backlog convergence;
- AutoRecall enablement;
- retrieval tuning;
- scheduler redesign;
- cron schedule/payload mutation;
- OpenClaw upgrade;
- new product instrumentation;
- persistent systemd/Windows scheduled task installation;
- release/tag/push;
- architecture Phase 2.5 implementation.

## Drift rule

A new Stage Card is required before runtime execution if any of the following changes materially:

~~~text
candidate artifact
R2 artifact
reconciliation source semantics
scheduler wrapper/payload
cron identity/schedule semantics
R4 evidence contract
persistent evidence root semantics
execution-count semantics
rollback/recovery semantics
qualification scope
~~~

A changed exact cron target timestamp by itself can be rebound in a later exact execution packet if the frozen Stage Card contract remains unchanged and the new target is a natural lifecycle of the same cron authority.

## Required execution packet freeze

Before runtime authorization, the packet must freeze at minimum:

~~~text
R4 committed HEAD
R4 Stage Card path/SHA/commit
worktree clean
candidate/R2 paths and hashes
repo scheduler hashes
watcher path/SHA
persistent evidence directory
current boot_id
preLastRunAtMs
targetNextRunAtMs
target local time
activation-window start
target-near-window start
observation horizon
current R2/Gateway/config/AutoRecall authority
MAX_EXECUTIONS=1
~~~

## Required report

Final report must include at minimum:

- R3 historical `STOPPED` boundary and execution consumed;
- R4 exact Stage Card/HEAD/watcher authority;
- evidence directory and boot identity;
- whether execution was consumed;
- candidate activation/readiness identity;
- provisional Gateway/config/boot identity;
- activation baseline summary;
- target-near timestamp and exact derived Engine/Lance backlog counts;
- expected Engine/Lance selected exact IDs/counts;
- natural scheduler transition/status;
- target episode provenance;
- exact post-target Engine/Lance state delta;
- scheduler diagnostics truncation advisory state;
- final runtime/repository/config/boot stability;
- rollback or recovery evidence when applicable;
- final outcome;
- whether candidate remains persistently active.

## Authorization boundary

This Stage Card authorizes documentation of the R4 qualification contract only.

It does **not** itself authorize:

~~~text
candidate installation
Gateway mutation
R4 watcher runtime execution
R2 rollback/recovery runtime mutation
checkpoint/reconciliation invocation
~~~

A later exact owner authorization must bind the committed Stage Card, exact HEAD, exact watcher SHA, exact target lifecycle, and:

~~~text
MAX_EXECUTIONS=1
~~~

The separately authorized R4 transaction includes its bounded in-process rollback and, only if needed after a post-consumption host reboot, the recovery-only continuation described in this Stage Card.

## Successor boundary

On `PASS` or allowed `PASS_WITH_FINDINGS`:

- leave candidate active;
- future natural scheduled reconciliation becomes accepted product behavior under the qualified candidate/runtime boundary;
- AutoRecall remains disabled;
- stop before backlog convergence, AutoRecall rollout, release/tag/push, or Phase 2.5 implementation.

On non-pass:

- restore/confirm R2 runtime authority;
- do not replay R4 after execution consumption;
- perform mandatory drift review before any successor qualification decision.

## Frozen execution-count policy

~~~text
MAX_EXECUTIONS=1
execution consumed immediately before first candidate Gateway stop
pre-consumption launcher recovery may not mutate runtime
post-consumption candidate replay prohibited
post-consumption recovery-only R2 closure allowed as part of same transaction
~~~

## Stage closure

At commit time the Stage Card must be mechanically frozen with:

~~~text
Stage Card SHA256=<to be computed after final review>
commit=<to be created>
HEAD=<commit containing this Stage Card>
worktree=clean required before runtime execution
~~~

Until the unrelated `docs/stabilization-plan.md` worktree modification is separately resolved, this Stage Card may be reviewed and committed independently but R4 runtime execution remains blocked by the clean-worktree preflight requirement.

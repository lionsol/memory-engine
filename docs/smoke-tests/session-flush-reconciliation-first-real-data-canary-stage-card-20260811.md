# Session-Flush Reconciliation First Real-Data Canary Stage Card — 2026-08-11

## Decision

Can the already-qualified immutable `ac0e5f0` candidate execute exactly one bounded real-data reconciliation canary against current Core/Engine/Lance state, while the active runtime remains R2, and prove the new data-plane is safe enough to consider a later persistent activation?

This stage does not install the candidate and does not cross a scheduled checkpoint under candidate.

## Why this stage exists

Source, offline, Gateway-readiness, temporary-install, and non-live runtime qualification have passed.

The remaining unproven boundary is irreversible real-data mutation.

Reinstalling R2 restores code, not Engine/Lance rows already written. Therefore first real-data execution is separated from persistent activation.

## Authority

Expected repository authority at freeze:

~~~text
repo=/home/lionsol/.openclaw/workspace/plugins/memory-engine
HEAD=64511379b38989b2802f86738599ee50ad8d595b
worktree=clean
~~~

Fixed source/candidate:

~~~text
source implementation=ac0e5f054551847e724be504bae80947abd7d675
candidate=/home/lionsol/.openclaw/backups/memory-engine/releases/session-flush-reconciliation-overlay-ac0e5f0-20260810-r1
~~~

Qualified lineage:

~~~text
Gateway Readiness Evidence Harness Qualification=PASS
Runtime Qualification Retry R3=PASS
R3 Stage Card commit=64511379b38989b2802f86738599ee50ad8d595b
R3 Stage Card SHA256=6fe7f575b5bd25ea72b87b7f926a25283259706ce7687635892be7839accb34f
~~~

Current active baseline must remain:

~~~text
R2=/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2
plugin version=0.8.22
~~~

## In scope

Exactly three items:

1. Read-only impact preview using the implemented first-slice eligibility semantics.
2. Exactly one Core→Engine reconciliation call, followed by exactly one scoped Engine→Lance call, directly from the immutable candidate under Node24.
3. Post-canary verification of bounded writes, derived backlog, active R2 identity/readiness, checkpoint isolation, and clean repository authority.

## Frozen first-slice eligibility

No eligibility expansion is authorized.

~~~text
path=memory/smart-add/%.md
provenance=session_flush exactly
category policy=raw_log
generated-smart-add=excluded
line-range mapping=required
ambiguous/unmappable=fail closed
Core=read-only
~~~

Episodes, manual, `agent_smart_add`, unknown provenance, generated smart-add, and new quality gates remain deferred.

## Execution model

The active extension remains R2 throughout.

The ephemeral `/tmp` harness may invoke only:

~~~text
reconcileSessionFlushManagedState({ trigger: "real_data_canary" })
    ↓
repairOrphanVectors({ scope: "session_flush" })
~~~

using the exact candidate artifact and qualified Node24/native dependency closure.

Do not execute `session-checkpoint.js` main or `nightlyCheckpoint()`.

No Gateway stop/start/restart or plugin install/reinstall is authorized.

## Read-only impact preview

Before mutation, report enough same-path evidence to establish:

~~~text
eligible_session_flush
ambiguous_chunk_count
unmappable_chunk_count
engine_existing
engine_missing_before
engine_write_cap=500
~~~

For Lance, report/derive when safely available:

~~~text
lance_eligible
lance_existing
lance_missing_before
lance_write_cap=10
~~~

Do not create a second eligibility algorithm just for preview.

If reliable preview requires mutation or a new product mechanism, stop before write.

## Mutation budget

Exactly one call per layer is authorized.

~~~text
MAX_ENGINE_INSERTS_PER_CYCLE=500
MAX_LANCE_WRITES_PER_CYCLE=10
~~~

Maximum canary-attributable new writes:

~~~text
Engine insert-if-missing rows <= 500
Lance exact-ID additions <= 10
~~~

Positive backlog is valid and does not authorize another cycle.

Do not loop to convergence.

## Engine result contract

Report:

~~~text
eligible_session_flush
ambiguous_chunk_count
unmappable_chunk_count
engine_existing
engine_missing_before
engine_inserted
engine_backlog_remaining
engine_converged
~~~

Required invariants:

- `engine_inserted <= 500`;
- Core remains read-only;
- only eligible first-slice IDs may be inserted;
- existing Engine lifecycle rows are preserved;
- backlog remains `eligible Core IDs - Engine IDs`;
- `engine_converged=false` is valid with remaining bounded backlog or ambiguity.

Any eligibility escape, Core write, or cap violation is `STOPPED`.

## Lance result contract

Report:

~~~text
lance_eligible
lance_existing
lance_missing_before
lance_added
lance_failed
lance_backlog_remaining
lance_converged
~~~

Required invariants:

- `lance_added <= 10`;
- only active/non-archived eligible Engine IDs are selected;
- Core text is read by exact chunk ID;
- Lance row ID equals Engine/Core ID;
- existing Lance IDs are not duplicated;
- write/embedding failure remains retryable without invalidating Engine state;
- backlog remains `eligible active Engine IDs - Lance IDs`;
- `lance_converged=true` only when no eligible active Engine ID remains absent.

A bounded retryable `lance_failed > 0` may be `PASS_WITH_FINDINGS` only if no wrong/cross-entry write occurred and all other safety invariants hold.

## Active-runtime and checkpoint isolation

Before and after the canary prove:

~~~text
Gateway readiness=READY
plugin status=loaded
version=0.8.22
install.sourcePath=R2
install.installPath=/home/lionsol/.openclaw/extensions/memory-engine
~~~

Preflight must also prove:

~~~text
session-checkpoint schedule=30 3 * * *
tz=Asia/Shanghai
next scheduled run > 60 minutes away
no checkpoint/maintenance process active
~~~

Record `lastRunAtMs` before and after; it must not advance during this canary.

Do not change cron.

## Allowed real-data access/mutation

Only:

- implemented readonly Core eligibility/text reads;
- Engine reads required by the candidate path and evidence;
- at most 500 implemented insert-if-missing Engine rows;
- Lance reads required by scoped reconciliation/evidence;
- production embedding only for the at-most-10 selected rows;
- at most 10 exact-ID Lance additions;
- bounded private `/tmp` evidence files.

No other real-data mutation is authorized.

## Forbidden scope

Do not:

- install or persist candidate;
- stop/start/restart Gateway or reinstall R2;
- execute checkpoint main or manually run the scheduled checkpoint;
- invoke a second reconciliation cycle;
- run global orphan repair, memory index, sync, backfill, or reindex;
- mutate Core DB or smart-add/episode/session files;
- alter existing Engine lifecycle rows beyond implemented insert-if-missing behavior;
- delete/rewrite Lance rows;
- broaden eligibility or change caps/confidence/tau;
- change retrieval, AutoRecall, config, cron, schema, scheduler, CLI, ledger, queue, state machine, or OpenSpec;
- send retrieval/memory-tool/H6/natural-canary traffic;
- tag/push/release.

## Failure semantics

Real-data writes are not transactionally undone by restoring R2.

Therefore:

- preflight failure => stop before mutation;
- Engine success + Lance retryable failure => preserve valid Engine state and report explicit Lance backlog;
- wrong-ID/cross-entry write, Core write, cap violation, or eligibility escape => stop immediately and preserve evidence;
- do not compensate by deleting/rewriting data under this authorization;
- remediation requires a new recovery Stage Card.

## Pass criteria

`PASS` requires all three:

1. Preflight proves exact authority, R2 active/READY, safe checkpoint window, fixed eligibility, and bounded impact before write.
2. Exactly one Engine call and one scoped Lance call remain within `Engine<=500` and `Lance<=10`, with Core read-only, exact-ID semantics, no eligibility escape, and valid result/backlog contracts.
3. Post-canary evidence shows R2 still active/READY, checkpoint `lastRunAtMs` unchanged, repo clean, no forbidden operation, and remaining backlog explicit with no automatic second cycle.

`PASS_WITH_FINDINGS` is limited to a retryable bounded Lance failure or evidence-formatting issue that weakens none of the safety invariants.

`INSUFFICIENT_EVIDENCE` applies only when bounded state remains safe but a required fact cannot be proven without scope expansion.

`STOPPED` applies to authority drift, preflight failure, cap/eligibility/Core-safety violation, wrong-ID behavior, unexpected mutation, or required scope expansion.

## Execution count

A later execution packet must set:

~~~text
MAX_EXECUTIONS=1
~~~

Read-only preflight does not consume it.

The count is consumed immediately before the one authorized `reconcileSessionFlushManagedState()` real-data call.

No second write cycle is authorized after consumption.

## Required report

Report:

- Stage Card path/SHA/commit/HEAD;
- candidate/source authority and active R2 identity/readiness;
- checkpoint window and pre/post `lastRunAtMs`;
- read-only impact preview;
- Engine and Lance result contracts;
- changed IDs/counts without memory contents;
- cap, Core-readonly, exact-ID, and no-second-cycle evidence;
- remaining Engine/Lance backlog;
- repo/runtime final authority;
- outcome and at most one successor recommendation.

Do not print memory text, secrets, embeddings, provider keys, or broad DB dumps.

## State after PASS

~~~text
current_fact:
the qualified ac0e5f0 data-plane can execute one bounded real-data
Core→Engine→Lance canary against current production memory state while
active runtime remains R2.

current active runtime=R2
persistent candidate activation=NOT AUTHORIZED
additional reconciliation cycles=NOT AUTHORIZED
AutoRecall enablement=NOT AUTHORIZED
~~~

PASS does not imply backlog convergence.

## Successor boundary

After outcome, stop.

Only after PASS/PASS_WITH_FINDINGS may the next product-level decision be a separate controlled persistent-activation Stage Card using the qualified candidate and existing scheduled lifecycle.

Do not automatically persist candidate, run another reconciliation cycle, trigger/wait for a scheduled checkpoint under candidate, enable AutoRecall, run retrieval canaries, tune caps, tag, push, or release.

## Execution authorization boundary

This Stage Card does not authorize real-data execution.

A later authorization must bind exactly:

~~~text
Stage Card path=docs/smoke-tests/session-flush-reconciliation-first-real-data-canary-stage-card-20260811.md
Stage Card SHA256=<computed after freeze>
Stage Card commit=<exact commit containing this card>
Repository HEAD=<exact committed Stage Card HEAD>
Source implementation commit=ac0e5f054551847e724be504bae80947abd7d675
Candidate path=/home/lionsol/.openclaw/backups/memory-engine/releases/session-flush-reconciliation-overlay-ac0e5f0-20260810-r1
Current active baseline=R2 provenance release
MAX_EXECUTIONS=1
~~~

Any Stage Card/commit/HEAD/candidate/baseline/scope/count drift invalidates the packet.

## Authorization state at freeze

~~~text
First real-data canary Stage Card=FROZEN
Stage Card repository scope=ONE MARKDOWN FILE ONLY
Real-data canary execution=NOT AUTHORIZED
MAX_EXECUTIONS=not created/consumed
Candidate installation/persistent activation=NOT AUTHORIZED
Gateway mutation=NOT AUTHORIZED
Core writes=NOT AUTHORIZED
Engine insert-if-missing<=500=AUTHORIZED ONLY INSIDE LATER EXECUTION PACKET
Scoped Lance exact-ID writes<=10=AUTHORIZED ONLY INSIDE LATER EXECUTION PACKET
Second reconciliation cycle=NOT AUTHORIZED
AutoRecall enablement=NOT AUTHORIZED
Push/tag/release=NOT AUTHORIZED
~~~

After freeze and mechanical validation, stop at the separate real-data execution authorization gate.

# Session-Flush Reconciliation Persistent Rollout Successor Stage Card — 2026-08-16

## Decision

Can the already-qualified immutable `ac0e5f0` session-flush reconciliation candidate become the persistent active memory-engine runtime, remain Gateway-ready, and coexist with one natural scheduled `session-checkpoint` lifecycle without changing AutoRecall or reconciliation semantics?

This is a new product-level rollout decision after terminal R4 stopped on qualification-harness authority false positives. It is not R5 and does not reopen the R4 retry chain.

## User value

Close persistent activation with minimum sufficient evidence so the qualified reconciliation candidate can become the normal runtime without another harness-driven retry loop.

## In scope

1. Activate the existing immutable candidate exactly once under separately bound owner execution authorization.
2. Observe one naturally scheduled `session-checkpoint` lifecycle while the candidate remains the active Gateway plugin.
3. Keep the candidate active on PASS; otherwise restore exact R2 and stop.

## Non-goals

- no product-source or candidate rebuild;
- no reconciliation eligibility/cap/order changes;
- no backlog-convergence campaign;
- no AutoRecall enablement or retrieval tuning;
- no mutating Nightly Maintenance rollout;
- no R5 or additional numbered retry stage.

## Runtime authority

Execution must bind an exact committed HEAD, this exact committed Stage Card SHA, one exact watcher SHA, one exact natural cron target, and `MAX_EXECUTIONS=1`.

Repository worktree drift is fail-closed only for runtime-relevant source surfaces:

~~~text
bin/
lib/
repository-root *.js
repository-root *.cjs
package.json
package-lock.json
openclaw.plugin.json
~~~

Unrelated `docs/`, `test/`, report, or roadmap changes do not invalidate runtime authority. The Stage Card itself remains independently frozen by exact SHA.

Candidate and rollback artifacts remain immutable. The execution packet must re-prove their frozen hashes and must verify exact active R2 before activation.

## Pass criteria

1. The exact candidate becomes the active plugin and Gateway reaches deterministic `READY` with AutoRecall still disabled and authorized configuration semantics unchanged.
2. Exactly one bound natural `session-checkpoint` cron lifecycle completes successfully after activation; the cron authority advances from the packet-bound pre-run state to the packet-bound target run without manual checkpoint/reconciliation invocation.
3. After that lifecycle, the exact candidate remains active and Gateway-ready, with no rollback condition triggered.

## Allowed mutations

- one candidate plugin activation transaction;
- Gateway stop/start required by that activation;
- normal writes caused by the single natural `session-checkpoint` lifecycle;
- exact R2 restoration only if a stop/rollback condition occurs.

No manual checkpoint, reconciliation, backlog drain, AutoRecall mutation, Nightly Maintenance mutation, schema migration, or unrelated runtime/config change is authorized.

## Stop / rollback

Stop before activation if repository runtime-source authority, Stage SHA, watcher SHA, candidate/R2 hashes, active R2 identity, Gateway readiness, AutoRecall state, cron authority, or configuration authority is not exact.

After activation, restore exact R2 and stop if candidate installation/identity fails, Gateway does not become READY, AutoRecall/config authority changes unexpectedly, the bound natural cron lifecycle fails, or the candidate is no longer exact/READY after that lifecycle.

Host/environment interruption or evidence collection failure is not a product defect. Do not create another numbered retry automatically; adjudicate with the strongest surviving evidence and stop if the decision cannot be supported.

## Evidence discipline

Use minimum sufficient evidence only:

- plugin identity + Gateway status for persistent-runtime state;
- cron authority/status for the natural lifecycle;
- exact source/artifact hashes for execution authority.

Do not require whole-database equality, exhaustive event counts, unrelated worktree cleanliness, or additional synthetic traffic.

## Authorization boundary

This Stage Card does not authorize execution. Sol must separately authorize the exact committed HEAD/Stage SHA/watcher SHA/target packet. Unless explicitly changed by Sol, `MAX_EXECUTIONS=1`.

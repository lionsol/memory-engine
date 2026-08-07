# Post-Fix Fresh Real-Plan Read-Only Dry-Run Stage Card — 2026-08-07

> Status: `READY_FOR_COMMIT`
>
> This stage defines one fresh real-plan read-only dry-run after the post-fix
> readiness review passed. It does not authorize `prepare`, `verify`, candidate/R0
> construction, publication, runtime installation, service/configuration mutation,
> database/session/memory access, tag, or push.
>
> The Stage Card itself must be committed before execution. After that commit,
> GPT/Sol must freeze the exact full execution commit as `AUTHORIZED_HEAD`; the
> execution authority must not be inferred from a branch name, short hash, or a
> later moving `HEAD`.

## Stage decision

Can the committed Candidate-Builder Harness bind one brand-new real plan to the
exact reviewed source, current active/release runtime identities, current
configuration fingerprint, current Node 24 toolchain and current user services,
then execute exactly one `dry-run --plan` with:

~~~text
decision=PASS
mutation_count=0
preflight_findings=[]
~~~

while preserving the historical FAILED transaction unchanged and creating no new
claim, staging root, final authority, candidate, or R0?

A pass answers only that question. It does not authorize `prepare`.

## User value

The previous real-plan dry-run passed, but the later real `prepare` exposed two
source-level blockers: node-gyp header ownership extraction and a too-short shared
npm-ci timeout. Those blockers are now committed as source fixes and the
post-fix readiness inspection has passed. A fresh dry-run is required because a
new prepare transaction must bind a new one-shot run identity to the now-fixed
source and to freshly revalidated live host identities.

## Frozen predecessor evidence

The immediately preceding readiness review returned `PASS_WITH_FINDINGS` at:

~~~text
readiness_authorized_head=352958d15a13b516f275989bbc2565bceecae8e8
worktree=clean
Node=v24.8.0
ABI=137
npm=11.6.0
Gateway=active/running, NRestarts=0
Console=active/running, NRestarts=0
historical FAILED claim=present and unchanged
historical staging=absent
historical final=absent
unexpected authority-parent entries=[]
plan_created=false
run_id_allocated=false
claim_created=false
~~~

That readiness evidence is a predecessor gate, not a substitute for fresh plan
binding. The dry-run execution must re-resolve the live bindings immediately
before generating its plan.

## Required source ancestry

The execution HEAD must contain all of these commits as ancestors:

~~~text
24eca45cef3aba5669eade2207a6eaadfc520a2c
  fix(runtime): preserve prepare failures and expose resolver target

bd39f8d9ba3625f42d447f9edd70451533e3887a
  fix(runtime): use bound node headers for npm ci

97454ee70f47f8fd4421806f4a10100b78e27186
  fix(runtime): bound npm ci sandbox timeout

352958d15a13b516f275989bbc2565bceecae8e8
  docs(runtime): freeze post-fix prepare readiness review
~~~

## Historical failed run — immutable audit history

The prior prepare identity is permanently consumed:

~~~text
run_id=real-plan-dry-run-20260806T112843Z-5723d05
plan_sha256=fee1feeb757aefe4685f817aa91496dc1d9f533c9e2f09eb71c29dad426a18da
claim_outcome=FAILED
claim_sha256_at_readiness=9e03ad3c0d65d5e419789cee9cfe4dc2fdaec0489ee01e6b6e3c95a79627a15d
~~~

The old run ID, old plan, and historical claim must never be reused, repaired,
deleted, rewritten, or converted to `PUBLISHED`.

The historical failure sidecar was absent at readiness. This stage does not
create one retroactively.

## Correct authority-parent invariant

Do **not** require the persistent authority parent to be empty.

The correct invariant is:

~~~text
historical immutable audit claims may exist
AND
historical failed staging/final roots remain absent
AND
the new run_id claim/staging/final paths do not exist before dry-run
AND
dry-run creates none of those new authority paths
~~~

Expected top-level authority-parent state before and after this stage:

~~~text
.run-claims/   -> allowed audit namespace
~~~

Any additional top-level authority-parent entry is a stop condition unless it was
already explicitly reviewed and authorized before execution. This Stage Card
contains no such additional authorization.

## In scope

Only these three items are in scope:

1. Re-resolve and freeze one exact real plan using a brand-new one-shot run ID at
   the separately authorized full execution HEAD.
2. Execute exactly one Candidate-Builder `dry-run --plan` against that plan.
3. Prove no-mutation invariants before/after and return the dry-run evidence to
   GPT for a stage decision.

## Non-goals

This stage does not authorize:

- `prepare`;
- `verify --authority`;
- creation of a run claim;
- staging, candidate, R0, archive, manifest, sentinel, or final authority
  construction;
- any retry using the same run ID after rejection or interruption;
- cleanup or mutation of historical claims/evidence;
- plugin install, reinstall, reload, stop, start, restart, or sourcePath change;
- OpenClaw configuration writes;
- AutoRecall enablement or H6 canary execution;
- database, LanceDB, session, memory, prompt, transcript, or agent-state access;
- source or test changes;
- dependency, timeout, nodedir, namespace, sandbox, or toolchain changes;
- commit, amend, tag, or push during execution.

If the dry-run reveals a source defect or live binding defect, stop. Do not turn
this stage into a repair stage.

## Allowed filesystem/process effects

Persistent writes allowed by this stage are limited to the plan evidence area:

~~~text
$HOME/.openclaw/backups/memory-engine/runtime-authority-plans/
~~~

The owner may create only:

1. one brand-new mode `0600` plan JSON for the fresh run ID;
2. one brand-new mode `0600` dry-run evidence JSON for that same run ID.

The plan-parent directory may already contain historical plan/evidence records;
do not delete, rename, rewrite, or reuse them.

The Candidate-Builder sandbox capability probe may create temporary disposable
scratch under the OS temporary directory and inside its private namespace. That
scratch must be cleaned by the existing product path before the dry-run returns.
It is not authority publication and does not relax `mutation_count=0` for the
Candidate-Builder transaction.

No persistent write under the authority publication parent is allowed.

## Fresh run ID contract

The execution packet must generate a new run ID only after all pre-plan source,
live-binding, service, toolchain, authority-history, and owner/mode gates pass.

The run ID must:

- satisfy the committed schema `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`;
- be generated from the current UTC time plus the exact execution commit and a
  small cryptographic random suffix;
- be different from the historical failed run ID;
- have no existing plan file, dry-run evidence file, claim, staging root, or final
  authority path;
- be treated as consumed for this stage once its plan file is created, even if
  the dry-run later rejects or the operator aborts.

Do not retry by editing or overwriting the same plan. A later attempt requires a
new Stage decision and new run ID.

## Plan binding contract

The plan must use schema:

~~~text
memory-engine-runtime-authority-plan-v1
~~~

and must be written owner-only mode `0600` with exclusive creation semantics.

The plan must bind freshly observed values for:

- exact source commit and source tree identity;
- origin remote;
- active plugin root;
- registered release source path;
- config path and SHA-256 without printing config contents;
- active/release artifact semantic, topology, and exact identities;
- source/active/release runtime identities;
- Gateway and Console unit names, PID, and restart counts;
- Node v24.8.0 / ABI 137;
- npm, Git, tar, unshare, mount, chroot, systemctl, Python, compiler, make, ar,
  and node-gyp closure exact bindings/versions/hashes;
- package.json and package-lock SHA-256;
- persistent authority parent;
- existing targeted test file binding required by the plan schema.

The source, active, and release identities are separate authorities. Do not
require source runtime identity to equal the installed active/release runtime
identity before a new candidate is built.

## Plan lifetime

The generated plan must use a short validity window. Default:

~~~text
expires_at = created_at + 20 minutes
~~~

Plan generation, fingerprint capture, and the one dry-run invocation must occur
within that window.

If the plan expires, stop. Do not edit its timestamps or reuse its run ID.

## Pre-plan gates

Before allocating a new run ID or writing a plan, all of the following must pass:

- `AUTHORIZED_HEAD` is a full lowercase 40-hex commit;
- actual HEAD equals `AUTHORIZED_HEAD`;
- worktree is clean;
- all required source commits are ancestors;
- Node is v24.8.0 / ABI 137;
- active root, registered release, and config path resolve exactly;
- active/release artifact manifests and source/active/release runtime identities
  are valid;
- Gateway and Console are `active/running` with valid PID/restart counters;
- the exact toolchain required by Candidate-Builder resolves and hashes cleanly;
- authority parent is a real owner-controlled `0700` directory;
- `.run-claims` is a real owner-controlled `0700` directory;
- the historical failed claim is an owner-controlled `0600` regular file with
  `outcome=FAILED` and the historical plan SHA-256;
- the historical claim SHA-256 equals its pre-execution fingerprint and remains
  unchanged while the new plan is bound;
- historical staging/final roots are absent;
- authority parent has no unexpected top-level entry.

Failure before plan creation means no run ID should be allocated and no plan file
should be written.

## Pre-dry-run invariants

After the plan is created but before invoking `dry-run`, capture and verify:

- plan file mode, owner, SHA-256, run ID, created_at, expires_at;
- source HEAD/tree and clean worktree;
- config SHA-256;
- Gateway and Console exact state/PID/restart count;
- authority-parent inventory;
- historical failed claim SHA-256;
- optional historical sidecar SHA-256 if one unexpectedly appeared before this
  stage; if it appears without an explained external event, stop;
- new `.staging-<run_id>` absent;
- new `<run_id>/` final root absent;
- new `.run-claims/<run_id>.json` absent.

## Dry-run command contract

Execute exactly once:

~~~text
Node24 bin/prepare-runtime-authority.cjs dry-run --plan <fresh-plan> --pretty
~~~

The command output must be captured directly to the brand-new mode `0600`
dry-run evidence file for this run ID.

Do not invoke `prepare` after this command, regardless of whether it passes.

## Dry-run PASS contract

The returned JSON must satisfy all of these:

~~~text
schema=memory-engine-runtime-authority-dry-run-v1
decision=PASS
mutation_count=0
preflight_findings=[]
validated_bindings.run_id=<fresh run id>
validated_bindings.source_commit=<AUTHORIZED_HEAD>
plan_sha256=<exact generated plan SHA-256>
~~~

The dry-run must also prove the production sandbox capability probe through the
actual Candidate-Builder factory/preflight path.

## Post-dry-run no-mutation gates

Immediately after the one dry-run invocation, recheck:

- source HEAD/tree/worktree unchanged;
- plan file SHA-256 unchanged;
- config path/SHA-256 unchanged;
- active root and release path unchanged;
- Gateway and Console state/PID/restart counts unchanged;
- authority-parent top-level inventory unchanged;
- historical FAILED claim SHA-256 unchanged;
- historical claim remains `FAILED` with the same plan SHA-256;
- historical staging/final roots remain absent;
- new run claim absent;
- new staging root absent;
- new final authority root absent;
- no candidate or R0 authority path created for the new run;
- dry-run evidence is the only second persistent record created for the new run.

If the service PID/restart counters drift due to an unexplained external event,
return `INSUFFICIENT_EVIDENCE`; do not rerun automatically.

## Pass criteria

The stage may return `PASS` only if all three criteria hold:

1. A brand-new exact mode-0600 plan binds the separately authorized clean HEAD
   and fresh live/toolchain identities without touching historical audit state.
2. Exactly one production `dry-run --plan` returns `decision=PASS`,
   `mutation_count=0`, and an empty `preflight_findings` array.
3. Source/config/services/authority history remain stable and no new
   claim/staging/final/candidate/R0 authority is created.

## Stop conditions

Stop without repair or retry if any of the following occurs:

- pre-plan gate fails;
- source worktree is dirty;
- execution HEAD differs from frozen `AUTHORIZED_HEAD`;
- any required fix commit is missing from ancestry;
- plan creation collides with an existing file/path;
- generated plan fails schema, mode, owner, hash, or time-window validation;
- historical claim is absent, changed, not `FAILED`, or bound to a different
  historical plan SHA-256;
- historical staging/final path reappears;
- an unexpected authority-parent top-level entry exists;
- new run claim/staging/final path already exists before dry-run;
- dry-run returns `REJECT` or exits nonzero;
- dry-run reports any preflight finding or nonzero mutation count;
- source/config/runtime binding/service/authority history drifts during the
  transaction;
- temporary sandbox scratch remains after dry-run;
- execution would require DB/session/memory access;
- any repair, cleanup, install, reload, source edit, or second dry-run is proposed
  to make the stage pass.

A rejected or interrupted fresh plan does not authorize another run ID by itself.
Return evidence to GPT for a new decision.

## Outcome semantics

### `PASS`

Means only:

> One fresh post-fix real plan has passed the production read-only Candidate-
> Builder dry-run with zero authority mutation and stable host bindings.

A later one-shot `prepare` remains separately authorized.

### `PASS_WITH_FINDINGS`

Allowed only for non-blocking observations that do not weaken the exact plan,
dry-run, no-mutation, service/config stability, or historical-claim gates.

Known examples that may remain findings:

- local `main` is ahead of `origin/main`, while the exact local full commit is
  the explicit execution authority;
- source runtime identity differs from installed active/release runtime identity,
  because installation has not yet occurred;
- npm 11.6 warns that the current `npm_config_nodedir` compatibility surface may
  change in a future npm major, while the currently bound npm/node-gyp path is
  already proven.

### `INSUFFICIENT_EVIDENCE`

Use when a required observation cannot be safely established or an unexplained
concurrent service/config/runtime-binding drift makes the one dry-run ambiguous.

### `STOPPED`

Use for a concrete violated gate, rejected plan/dry-run, historical-claim
mismatch, unexpected authority entry, or attempted scope expansion.

## Required owner report

~~~text
stage=Post-Fix Fresh Real-Plan Read-Only Dry-Run
result=PASS | PASS_WITH_FINDINGS | INSUFFICIENT_EVIDENCE | STOPPED

authorized_head=
actual_head_before=
actual_head_after=
source_tree_before=
source_tree_after=
worktree_clean_before=
worktree_clean_after=
required_fix_ancestors=
branch_status=
origin_main=

run_id=
plan_path=
plan_mode_owner=
plan_sha256_before=
plan_sha256_after=
plan_created_at=
plan_expires_at=

active_root_before=
active_root_after=
active_release_before=
active_release_after=
source_runtime_identity=
active_runtime_identity=
release_runtime_identity=
config_sha256_before=
config_sha256_after=

gateway_state_before=
gateway_state_after=
console_state_before=
console_state_after=
node_version=
node_abi=
node_toolchain_binding=

authority_parent_inventory_before=
authority_parent_inventory_after=
historical_failed_claim_outcome_before=
historical_failed_claim_outcome_after=
historical_failed_claim_plan_sha256_before=
historical_failed_claim_plan_sha256_after=
historical_failed_claim_sha256_before=
historical_failed_claim_sha256_after=
historical_staging_absent_before=
historical_staging_absent_after=
historical_final_absent_before=
historical_final_absent_after=

new_claim_absent_before=
new_claim_absent_after=
new_staging_absent_before=
new_staging_absent_after=
new_final_absent_before=
new_final_absent_after=

dry_run_evidence_path=
dry_run_evidence_mode_owner=
dry_run_schema=
dry_run_decision=
dry_run_mutation_count=
dry_run_preflight_findings=
dry_run_plan_sha256=
dry_run_validated_run_id=
dry_run_validated_source_commit=

source_drift=false | true
config_drift=false | true
runtime_binding_drift=false | true
service_drift=false | true
claim_drift=false | true
authority_inventory_drift=false | true
runtime_mutation=false
config_mutation=false
service_operation=false
data_access=false
claim_created=false
prepare_executed=false
verify_executed=false
runtime_install=false

findings=
recommendation=
~~~

## Execution packet policy

The exact independent-WSL execution packet is intentionally not embedded here.
It must be supplied only after:

1. this Stage Card is committed as a docs-only atomic commit;
2. the repository is clean;
3. GPT/Sol separately freeze the resulting full commit as `AUTHORIZED_HEAD`;
4. Sol explicitly authorizes this dry-run stage execution.

The future packet must reuse the already-reviewed Candidate-Builder binding logic
from the prior real-plan protocol, with only these protocol corrections:

- no obsolete `authority parent must be empty` check;
- no cleanup of historical claims;
- exact historical claim before/after fingerprinting;
- brand-new run ID with exclusive plan creation;
- new run-specific claim/staging/final absence checks before and after dry-run;
- exactly one `dry-run`; never `prepare` in the same authorization.

## Authorization state

~~~text
stage_card=frozen
stage_card_commit=not authorized
stage_execution=not authorized
new_plan=not authorized
run_id_allocation=not authorized
real_plan_dry_run=not authorized
prepare=not authorized
verify=not authorized
runtime_install=not authorized
runtime_reload=not authorized
tag=false
push=false
~~~

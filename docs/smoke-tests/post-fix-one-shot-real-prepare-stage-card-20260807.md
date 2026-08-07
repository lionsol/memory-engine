# Post-Fix One-Shot Real Prepare Stage Card — 2026-08-07

> Status: `READY_FOR_COMMIT`
>
> This Stage Card freezes the fail-closed contract for one future real
> Candidate-Builder `prepare` transaction after the resolver/failure-evidence,
> bound-Node-header, and npm-ci-timeout fixes. It does **not** authorize a
> `prepare` execution by itself.
>
> The card must be committed before the next fresh real plan is generated. After
> that commit, one new plan must pass the already-committed Post-Fix Fresh
> Real-Plan Read-Only Dry-Run protocol at the exact same source HEAD and exact
> same plan SHA-256. Only then may Sol separately authorize one `prepare` using
> that already-dry-run-passed plan.

## Stage decision

Can one exact, freshly dry-run-passed real plan be consumed exactly once by the
production Candidate-Builder `prepare` path and either:

1. publish a complete self-bound runtime authority with a `PUBLISHED` claim; or
2. fail closed with a permanently consumed `FAILED` claim and bounded failure
   evidence,

without changing the active OpenClaw installation, configuration, services, or
user data?

This stage ends at authority publication or fail-closed prepare failure. It does
not authorize installation, reload, runtime activation, `verify --authority`,
AutoRecall changes, or H6 canaries.

## User value

The previous real prepare on 2026-08-06 exposed two independent source-level
blockers only after an earlier dry-run had passed:

- native dependency construction could not preserve archive ownership inside the
  mapped-root namespace;
- a valid real-lockfile `npm ci` could exceed the old 120-second sandbox budget.

The source now binds Node headers through the read-only `/runtime` mount and gives
only `npm.ci_candidate` the evidence-derived 300-second inner / 330-second outer
budget. A fresh product dry-run has already proved the corrected preflight path,
but its run ID was intentionally consumed as dry-run evidence because this
prepare Stage Card had not yet been frozen.

The next transaction must therefore establish the complete governance order
*before* a new run identity is allocated:

~~~text
prepare Stage Card committed
-> clean exact HEAD frozen
-> brand-new real plan generated
-> exactly one read-only dry-run passes
-> repository remains unchanged
-> Sol separately authorizes prepare
-> exactly one prepare consumes that same plan/run ID
~~~

## Current source authority before this Stage Card

At Stage Card creation:

~~~text
HEAD=d3ddf11801ccd5ed6a2b56926bb407f39a1603f6
branch=main...origin/main [ahead 11]
worktree=clean before this Stage Card is written
origin/main=4c7ef07a52d5f8c86a522bd00f7f9d2a942fdca7
~~~

Relevant committed source fixes and protocol cards already in ancestry:

~~~text
24eca45cef3aba5669eade2207a6eaadfc520a2c
  fix(runtime): preserve prepare failures and expose resolver target

bd39f8d9ba3625f42d447f9edd70451533e3887a
  fix(runtime): use bound node headers for npm ci

97454ee70f47f8fd4421806f4a10100b78e27186
  fix(runtime): bound npm ci sandbox timeout

352958d15a13b516f275989bbc2565bceecae8e8
  docs(runtime): freeze post-fix prepare readiness review

d3ddf11801ccd5ed6a2b56926bb407f39a1603f6
  docs(runtime): freeze post-fix fresh real-plan dry-run
~~~

The actual execution HEAD will be the docs-only commit that contains this Stage
Card. GPT/Sol must later freeze that exact full 40-hex commit as the only source
authority for both the next fresh dry-run and the subsequent prepare.

## Predecessor evidence

### Post-fix readiness review

The read-only readiness inspection passed with findings at source HEAD
`352958d15a13b516f275989bbc2565bceecae8e8`:

~~~text
Node=v24.8.0
ABI=137
npm=11.6.0
Gateway=active/running
Console=active/running
historical FAILED claim=present and unchanged
historical staging=absent
historical final=absent
unexpected authority-parent entries=[]
source/config/service/claim drift=false
~~~

### First post-fix fresh dry-run

A later fresh real-plan dry-run at HEAD
`d3ddf11801ccd5ed6a2b56926bb407f39a1603f6` returned:

~~~text
run_id=real-plan-dry-run-20260807T115843Z-d3ddf11-5b7f64f9
plan_sha256=961bafac4b7b62a4aee10c2b4f2e68dfb7947d26601ea141b2c31dfcc1d07769
decision=PASS
mutation_count=0
preflight_findings=[]
new claim/staging/final=absent
source/config/runtime/service/claim/authority drift=false
~~~

That run is valid dry-run evidence but is **not** eligible for this future
prepare because committing this Stage Card changes the exact source HEAD. Its
plan/evidence records must remain untouched as historical audit material.

## Historical consumed run identities

Two run identities are already consumed and must never be reused.

### Historical failed prepare

~~~text
run_id=real-plan-dry-run-20260806T112843Z-5723d05
plan_sha256=fee1feeb757aefe4685f817aa91496dc1d9f533c9e2f09eb71c29dad426a18da
claim_outcome=FAILED
claim_sha256=9e03ad3c0d65d5e419789cee9cfe4dc2fdaec0489ee01e6b6e3c95a79627a15d
~~~

Its failed staging and final authority roots must remain absent. Its claim is
immutable audit history.

### Post-fix dry-run-only plan

~~~text
run_id=real-plan-dry-run-20260807T115843Z-d3ddf11-5b7f64f9
plan_sha256=961bafac4b7b62a4aee10c2b4f2e68dfb7947d26601ea141b2c31dfcc1d07769
prepare_eligible=false
reason=source HEAD will change when this Stage Card is committed
~~~

No claim exists for this dry-run-only identity. Its plan and dry-run evidence
must not be overwritten, edited, or repurposed.

## In scope

Only these three items are in scope:

1. Require a brand-new real plan, created **after this Stage Card is committed**,
   to pass exactly one production read-only dry-run at the exact prepare source
   HEAD and exact plan SHA-256.
2. After separate Sol authorization, execute exactly one production
   `prepare --plan <same-plan>` invocation for that same run ID and plan SHA.
3. Classify the resulting transaction as a complete `PUBLISHED` authority or a
   fail-closed consumed `FAILED` run, while proving active runtime/config/service
   and user data were not mutated.

## Non-goals

This stage does not authorize:

- source or test changes;
- editing the plan after its successful dry-run;
- a second dry-run or second `prepare` using the same run ID;
- `verify --authority` after publication;
- installation, reinstall, activation, reload, stop, start, or restart;
- OpenClaw plugin `sourcePath` or configuration writes;
- AutoRecall enablement or H6 canary execution;
- database, LanceDB, memory, session, prompt, transcript, or agent-state access;
- cleanup, repair, deletion, or rewriting of any historical claim, plan, dry-run
  evidence, or failure evidence;
- automatic retry after a failed or interrupted prepare;
- manually converting a claim between `FAILED` and `PUBLISHED`;
- tag or push.

A successful authority publication is an offline artifact result only. It must
not be described as a deployed or active runtime build.

## Required execution ordering

The following ordering is mandatory.

### Gate A — commit this Stage Card

This Markdown must first be committed as a docs-only atomic commit. The repository
must then be clean. That resulting full commit becomes the candidate execution
HEAD.

No real plan is generated before this commit.

### Gate B — fresh dry-run under the final source HEAD

Using the already-committed
`post-fix-fresh-real-plan-read-only-dry-run-stage-card-20260807.md` protocol:

1. GPT/Sol freezes the exact full execution HEAD;
2. Sol separately authorizes the fresh dry-run stage;
3. a brand-new run ID and mode-0600 plan are created;
4. exactly one production `dry-run --plan` is executed;
5. it must return `decision=PASS`, `mutation_count=0`, and
   `preflight_findings=[]`;
6. source HEAD/tree/worktree, config, service counters, authority history, and
   the exact plan SHA must remain unchanged.

The dry-run report must be returned to GPT for a stage decision. Do not execute
`prepare` in the same authorization.

### Gate C — separately authorize prepare without changing HEAD

After Gate B passes:

- do not commit, amend, checkout, merge, rebase, pull, or edit source;
- do not change the plan;
- do not generate another run ID;
- recheck that the plan has not expired;
- Sol must explicitly authorize the one-shot prepare;
- GPT must bind the authorization to the exact run ID, plan SHA-256, plan path,
  and execution HEAD that passed Gate B.

Only then may `prepare` be invoked once.

## Exact prepare binding

Prepare authorization must name all four immutable values:

~~~text
AUTHORIZED_HEAD=<full 40-hex commit>
RUN_ID=<fresh dry-run-passed run ID>
PLAN_PATH=<absolute owner-controlled mode-0600 plan path>
PLAN_SHA256=<exact dry-run-passed plan SHA-256>
~~~

Immediately before prepare, all four must still match the dry-run evidence.

The plan must still be inside its original validity window. If it expires, stop.
Do not edit timestamps, overwrite the plan, or reuse its run ID. A new run
requires a new fresh-dry-run authorization and a new plan.

## Authority-parent invariant

The persistent authority parent is not required to be empty.

Expected pre-prepare top-level state remains:

~~~text
.run-claims/   -> historical audit namespace
~~~

Before prepare for the new run ID:

~~~text
.run-claims/<new-run-id>.json                  absent
.run-claims/<new-run-id>.failure-evidence.json absent
.staging-<new-run-id>                           absent
<new-run-id>/                                   absent
~~~

Existing historical claims may remain. They must be fingerprinted and remain
unchanged throughout the new transaction except for the **new** run's own claim
namespace created by prepare.

Do not clean historical claims to satisfy an obsolete empty-parent assumption.

## Production prepare command contract

After separate authorization, execute exactly once through the bound Node 24
runtime:

~~~text
Node24 bin/prepare-runtime-authority.cjs prepare --plan <exact-plan> --pretty
~~~

Do not wrap the product path with a diagnostic replacement, timeout override,
custom sandbox child, retry loop, alternate npm command, or modified environment
that changes the committed Candidate-Builder contract.

The product command's normal stdout/stderr may be captured into owner-only
transaction evidence outside the authority publication tree, provided that this
does not alter the plan, claim, staging, or authority semantics.

## Expected successful transaction semantics

On success, the committed production path is expected to:

1. repeat production preflight and exact host/tool binding checks;
2. atomically create the new `.run-claims/<run-id>.json` claim;
3. create `.staging-<run-id>` as an owner-controlled staging root;
4. archive exact source and package staged source;
5. run the real candidate dependency construction in the sandbox, including
   `npm.ci_candidate` with the closed 300000/330000 ms timeout policy;
6. verify candidate runtime identity, better-sqlite3, LanceDB, targeted tests,
   manifests, archive re-extraction, and R0 capture/verification;
7. capture host-stability evidence and remove transient construction artifacts;
8. assemble `authority.json`, typed inventory, and checksums;
9. atomically publish staging to `<persistent_parent>/<run-id>`;
10. update only the new run's claim to `PUBLISHED`.

A successful prepare must leave:

~~~text
.run-claims/<run-id>.json  -> outcome=PUBLISHED
<run-id>/                  -> published authority root
.staging-<run-id>          -> absent
~~~

and must leave active/release plugin paths, OpenClaw config, Gateway/Console
identity, and user data unchanged.

## Expected failure semantics

Any prepare error after the one-shot claim is created consumes the run ID.

Ordinary fail-closed behavior is expected to:

- capture bounded claim-bound failure evidence before failed staging cleanup;
- keep the original error primary if evidence capture itself fails;
- set the new claim to `FAILED` where possible;
- remove unpublished staging where possible;
- leave final authority absent;
- never resume or retry the same run ID.

Expected ordinary failure end-state:

~~~text
.run-claims/<run-id>.json                  -> outcome=FAILED
.run-claims/<run-id>.failure-evidence.json -> present when bounded capture succeeds
.staging-<run-id>                           -> absent
<run-id>/                                   -> absent
~~~

If publication rename occurred but rollback to staging cannot be completed, the
product may return `RECOVERY_REQUIRED`. That is an immediate `STOPPED` outcome.
Do not manually repair, install, or continue. Preserve all paths and evidence for
review.

## Prepare success evidence gate

A zero process exit by itself is insufficient.

After a successful command, the owner must read only the bounded authority and
claim metadata necessary to prove:

- the new claim exists as owner-controlled mode `0600`, binds the exact run ID
  and exact plan SHA, and has `outcome=PUBLISHED`;
- final authority root exists as an owner-controlled real directory;
- staging root is absent;
- `authority.json` binds the exact run ID, plan SHA, source commit/tree, and has
  `published=true`;
- checksums/inventory expected by the prepared authority are present;
- no failure-evidence sidecar exists for the successful run unless the product
  contract explicitly changed before execution;
- source HEAD/tree/worktree, plan SHA, active/release paths, config SHA, and
  Gateway/Console PID/restart counters remain unchanged before/after.

This post-prepare evidence check is **not** permission to run
`verify --authority`. Full self-binding verification remains a separate future
stage and separate authorization.

## Prepare failure evidence gate

If prepare exits nonzero, report at minimum:

- process exit code and bounded stderr;
- new claim existence/outcome/run ID/plan SHA/fingerprint;
- failure-evidence sidecar existence and fingerprint;
- failure evidence journal stage, command operation ID, and exit code when
  safely readable from the bounded sidecar;
- staging/final existence;
- source/config/service before/after fingerprints;
- whether the error contains `RECOVERY_REQUIRED`.

Do not inspect arbitrary staging files after failure and do not access
DB/session/memory to diagnose in this stage.

## Pass criteria

The stage may return `PASS` only if all three criteria hold:

1. The exact same plan/run ID/plan SHA that passed one fresh production dry-run
   is consumed exactly once by `prepare` before plan expiry, with no source or
   plan drift.
2. Prepare exits successfully and leaves a complete published authority plus an
   exact `PUBLISHED` claim, with staging absent and bounded publication evidence
   consistent with the plan/source bindings.
3. Source, active/release binding, OpenClaw configuration, Gateway/Console state,
   and prohibited data surfaces remain unchanged throughout the transaction.

A fail-closed `FAILED` claim is correct safety behavior but is not a stage
`PASS`; classify the stage as `STOPPED` or `INSUFFICIENT_EVIDENCE` according to
what the retained evidence proves.

## Allowed mutations

Before prepare authorization, only the separately authorized fresh dry-run may
create its one plan file and one dry-run evidence file under:

~~~text
$HOME/.openclaw/backups/memory-engine/runtime-authority-plans/
~~~

During the separately authorized prepare, mutations are limited to the **new
run ID** inside:

~~~text
$HOME/.openclaw/backups/memory-engine/runtime-authorities/
~~~

Specifically, the product may create/update only its new claim/failure-evidence,
staging transaction root, and published final authority according to the
committed Candidate-Builder contract.

No active runtime, configuration, service, database, session, or memory mutation
is allowed.

## Stop conditions

Stop immediately and do not repair or retry if any occurs:

- this Stage Card is not committed before the fresh plan is created;
- actual HEAD differs from the exact dry-run/prepare authorized HEAD;
- worktree is dirty;
- required fix/protocol commits are missing from ancestry;
- plan/run ID/plan SHA differs from the successful fresh dry-run evidence;
- plan is expired;
- historical claim or authority-parent state drifts before prepare;
- the new claim/staging/final path exists before prepare;
- source, active/release path, config hash, Node/toolchain, Gateway PID/restart
  count, or Console PID/restart count drifts from the plan before prepare;
- prepare is invoked more than once;
- prepare attempts to use an alternate plan, timeout, sandbox child, npm command,
  environment override, or repair path;
- prepare returns nonzero;
- claim is not exactly `PUBLISHED` after an apparently successful prepare;
- final authority is absent, staging remains, or publication metadata does not
  bind the exact run/plan/source;
- config/service/source drift occurs during prepare;
- any DB/session/memory access is proposed to make the transaction pass;
- `RECOVERY_REQUIRED` occurs;
- installation, reload, verify, or H6 canary is proposed inside this stage.

A stopped run is consumed once its claim exists. Do not delete the claim or
reuse the run ID.

## Outcome semantics

### `PASS`

One exact dry-run-passed real plan was consumed once, produced a published
offline runtime authority with a matching `PUBLISHED` claim, and left prohibited
runtime/config/service/data surfaces unchanged.

### `PASS_WITH_FINDINGS`

Use only when the successful prepare result is complete and all safety gates
pass, but a non-blocking observation remains, for example:

- local main remains ahead of `origin/main` while the exact local commit is the
  frozen execution authority;
- source runtime identity differs from the currently installed active/release
  runtime identity because the new authority has not yet been installed;
- npm 11.6 retains the known future-major `npm_config_nodedir` warning while the
  currently bound node-gyp path succeeds.

### `INSUFFICIENT_EVIDENCE`

Use when a required post-prepare fact cannot be established safely or concurrent
external drift makes the result ambiguous without proving a concrete product
failure.

### `STOPPED`

Use for any concrete violated gate, failed prepare, `FAILED` claim,
`RECOVERY_REQUIRED`, mismatched publication, or attempted scope expansion.

## Required owner report

~~~text
stage=Post-Fix One-Shot Real Prepare
result=PASS | PASS_WITH_FINDINGS | INSUFFICIENT_EVIDENCE | STOPPED

authorized_head=
actual_head_before=
actual_head_after=
source_tree_before=
source_tree_after=
worktree_clean_before=
worktree_clean_after=

run_id=
plan_path=
plan_sha256_expected=
plan_sha256_before=
plan_sha256_after=
plan_created_at=
plan_expires_at=
dry_run_evidence_path=
dry_run_decision=
dry_run_mutation_count=
dry_run_preflight_findings=
dry_run_plan_sha256=
dry_run_validated_run_id=
dry_run_validated_source_commit=

claim_absent_before=
claim_present_after=
claim_outcome_after=
claim_run_id_after=
claim_plan_sha256_after=
claim_sha256_after=
failure_evidence_absent_before=
failure_evidence_present_after=
failure_evidence_sha256_after=
failure_journal_stage=
failure_operation_id=
failure_command_exit_code=

staging_absent_before=
staging_absent_after=
final_absent_before=
final_present_after=
authority_json_present=
authority_published=
authority_run_id=
authority_plan_sha256=
authority_source_commit=
authority_source_tree_identity=
checksums_present=
entry_inventory_bound=

prepare_exit_code=
prepare_stderr=
recovery_required=

active_root_before=
active_root_after=
active_release_before=
active_release_after=
config_sha256_before=
config_sha256_after=
gateway_state_before=
gateway_state_after=
console_state_before=
console_state_after=

source_drift=false | true
plan_drift=false | true
runtime_binding_drift=false | true
config_drift=false | true
service_drift=false | true
historical_claim_drift=false | true
runtime_install=false
runtime_reload=false
verify_executed=false
data_access=false

findings=
recommendation=
~~~

## Authorization state

~~~text
stage_card=frozen
stage_card_commit=not authorized
fresh_plan_after_commit=not authorized
fresh_dry_run_after_commit=not authorized
prepare=not authorized
verify=not authorized
runtime_install=not authorized
runtime_reload=not authorized
h6_canary=not authorized
tag=false
push=false
~~~

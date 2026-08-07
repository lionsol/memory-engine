# Post-Fix Real-Prepare Readiness Review Stage Card — 2026-08-07

> Status: `READY_FOR_AUTHORIZATION`
>
> This stage is a read-only readiness review after the committed Candidate-Builder
> fixes for resolver binding, durable prepare failure evidence, bound Node headers,
> and operation-specific npm-ci timeout. It does not authorize a new plan file,
> `dry-run`, `prepare`, `verify`, candidate/R0 construction, runtime installation,
> service mutation, configuration mutation, database/session/memory access, tag,
> or push.

## Stage decision

Is the current committed source and the current live host binding state clean,
exact, and internally consistent enough to authorize a **separate fresh real-plan
read-only dry-run stage** at the exact reviewed HEAD, without reusing or mutating
any historical failed run identity or claim?

This stage answers readiness only. A `PASS` does not itself authorize plan
creation, `dry-run`, or `prepare`.

## User value

The previous real `prepare` exposed two independent source-level Candidate-Builder
blockers after the real-plan dry-run had already passed:

1. node-gyp header extraction failed because archive ownership preservation was
   incompatible with the mapped-root user namespace;
2. the shared 120-second sandbox timeout was shorter than a valid real-lockfile
   `npm ci` construction.

Both blockers are now source-fixed and committed. Before generating another
one-shot run identity, the project must prove that no new source drift, runtime
binding drift, stale staging/final authority, claim mutation, toolchain mismatch,
or service/configuration drift makes another real-plan attempt unsafe.

## Current source facts

At Stage Card creation:

~~~text
HEAD=97454ee70f47f8fd4421806f4a10100b78e27186
branch=main
origin/main=4c7ef07a52d5f8c86a522bd00f7f9d2a942fdca7
local ahead count=9
worktree=clean before this Stage Card is written
~~~

Relevant committed fixes include:

~~~text
24eca45cef3aba5669eade2207a6eaadfc520a2c
  fix(runtime): preserve prepare failures and expose resolver target

bd39f8d9ba3625f42d447f9edd70451533e3887a
  fix(runtime): use bound node headers for npm ci

97454ee70f47f8fd4421806f4a10100b78e27186
  fix(runtime): bound npm ci sandbox timeout
~~~

The selected closed timeout policy at HEAD is:

~~~text
npm.ci_candidate:
  inner=300000ms
  outer=330000ms

ordinary registered sandbox operations:
  inner=120000ms
  outer=120000ms

capability-probe:
  outer=30000ms
~~~

The selected npm-ci budget was derived from successful real-lockfile timing
samples and then proved through the real product `SandboxRunner`/sandbox-child
path with no diagnostic timeout override.

## Historical failed run — immutable audit history

The previous real prepare identity is permanently consumed:

~~~text
run_id=real-plan-dry-run-20260806T112843Z-5723d05
plan_sha256=fee1feeb757aefe4685f817aa91496dc1d9f533c9e2f09eb71c29dad426a18da
claim_outcome=FAILED
claimed_at=2026-08-06T11:37:38.690Z
~~~

Historical evidence established:

- the old staging root is absent;
- the old final authority root is absent;
- no runtime publication/install/config/service mutation occurred;
- the old run ID and claim must never be reused, deleted, repaired, rewritten, or
  converted to `PUBLISHED`.

The existence of the historical FAILED claim is **not** a reason to clean the
authority parent. It is required audit history.

## Important protocol correction from the first real-plan Stage Card

The earlier `real-plan-read-only-dry-run-stage-card-20260806.md` required the
persistent authority parent to be empty. That condition was valid before the
first prepare attempt, but it is no longer valid after an intentional one-shot
FAILED claim exists under `.run-claims/`.

For all future real-plan work, the correct invariant is:

~~~text
historical immutable claims may exist
AND
new run_id claim/staging/final paths must not exist
AND
no stale staging/final authority from prior failed runs may exist
~~~

Do not delete historical claims merely to satisfy an obsolete empty-directory
check.

## In scope

Only these three items are in scope:

1. Read-only source and repository freeze at the exact current HEAD.
2. Read-only live binding inspection of the active/release plugin identities,
   config fingerprint, user services, Node/toolchain, and authority-parent audit
   layout.
3. A readiness decision that either permits drafting a **new separately
   authorized real-plan dry-run packet** or stops with findings.

## Non-goals

This stage does not authorize:

- creation of a new plan JSON or evidence file;
- allocation of a new run ID;
- Candidate-Builder `dry-run`, `prepare`, or `verify`;
- creation or mutation of `.run-claims`;
- staging, candidate, R0, archive, manifest, sentinel, or final authority
  construction;
- cleanup of the historical FAILED claim or any historical audit evidence;
- plugin install, reinstall, reload, stop, start, restart, or sourcePath change;
- OpenClaw configuration writes;
- AutoRecall enablement or H6 canary execution;
- database, LanceDB, session, memory, prompt, transcript, or agent-state access;
- source/test implementation changes;
- dependency, timeout, nodedir, namespace, sandbox, or toolchain changes;
- commit, tag, or push.

If a source defect is discovered, classify it as a blocker and stop this stage.
Do not silently turn the readiness review into a coding stage.

## Allowed observations

The owner may inspect only the minimum host/runtime metadata needed for exact
binding:

- Git HEAD/tree/status and origin URL;
- active plugin root and registered release source path;
- artifact/runtime identities using the existing Candidate-Builder helper paths;
- configuration file metadata and SHA-256, without printing configuration
  contents;
- Gateway/Console unit names, `ActiveState`, `SubState`, `MainPID`, and
  `NRestarts`;
- exact Node/npm/Git/tar/unshare/mount/chroot/systemctl/Python/compiler/make/ar
  and node-gyp tool bindings/versions/hashes required by the harness;
- authority parent ownership/mode and a bounded top-level/`.run-claims`
  inventory sufficient to verify the historical failed run and absence of stale
  staging/final roots.

No data-store or conversational content is required.

## Pass criteria

The stage may return `PASS` only if all three criteria are satisfied.

### 1. Exact source readiness

- HEAD equals the Stage Card execution HEAD explicitly authorized by GPT/Sol;
- worktree is clean;
- the three committed source-fix commits above are ancestors of HEAD;
- no source/test/config change occurs during the inspection;
- Node remains `v24.8.0`, ABI `137`, and the bound npm/node-gyp/toolchain
  identities remain valid for Candidate-Builder preflight.

### 2. Live binding stability

- active plugin root and registered release resolve exactly and are valid
  Candidate-Builder inputs;
- configuration fingerprint can be captured without reading its semantic
  contents into the report;
- Gateway and Console are `active/running`, with valid PID/restart counters;
- source/active/release runtime identities and manifests are structurally valid;
- no read-only inspection changes service/config/source state.

### 3. Authority-history integrity and fresh-run eligibility

- persistent authority parent exists, is owner-controlled mode `0700`, and is not
  a symlink;
- `.run-claims` may exist and must be owner-controlled mode `0700` if present;
- the historical claim for
  `real-plan-dry-run-20260806T112843Z-5723d05` exists as an owner-controlled
  regular non-symlink file, remains `FAILED`, and still binds the historical
  plan SHA-256 above;
- the old staging and old final authority paths are absent;
- there is no unexpected staging/final authority root requiring cleanup before a
  new attempt;
- no new run ID is allocated in this readiness stage.

## Historical claim fingerprint rule

At the start of the owner inspection, record a SHA-256 and metadata fingerprint
for the historical FAILED claim without printing the whole JSON payload.

At the end, fingerprint it again.

The two fingerprints must be identical.

If a historical `.failure-evidence.json` sidecar already exists, fingerprint it
before/after in the same way. Do not require creation of such a sidecar if it did
not already exist.

## Authority-parent inventory rule

Do not require the authority parent to be empty.

Instead classify bounded top-level entries as:

~~~text
.run-claims/                  -> expected audit namespace
.staging-<run_id>             -> transaction staging; must be explained
<run_id>/                     -> published final authority; must be explained
other entry                   -> unexpected; stop for review
~~~

For the historical failed run:

~~~text
.staging-real-plan-dry-run-20260806T112843Z-5723d05 -> must be absent
real-plan-dry-run-20260806T112843Z-5723d05/         -> must be absent
~~~

Do not remove any unexpected entry in this stage. Report and stop.

## Source-level regression evidence accepted from prior committed stages

The readiness review may rely on these already-completed source-level proofs
without rerunning the entire suite solely for this read-only stage:

~~~text
bound /runtime headers real-lockfile npm ci=PASS
better-sqlite3 native smoke=PASS
LanceDB smoke=PASS

npm-ci timeout historical/fresh successful samples:
  179269ms
  210551ms
  175561ms

selected product timeout:
  inner=300000ms
  outer=330000ms

post-fix product-timeout real-lockfile proof=PASS
focused timeout tests=20/20
production E2E=17/17
runtime-authority tests=79/79
static check=614 files
full suite=1832 passed / 0 failed / 8 skipped
~~~

A new full suite is required only if source changes occur after the reviewed
HEAD. Source change means this readiness stage stops and a new implementation
review is required.

## Stop conditions

Stop immediately with `STOPPED` or `INSUFFICIENT_EVIDENCE` as appropriate if:

- HEAD differs from the separately frozen execution HEAD;
- the worktree is dirty before execution;
- any required fix commit is not an ancestor;
- source, active, release, config, service, or toolchain identity cannot be
  resolved exactly;
- Node is not `v24.8.0` / ABI `137`;
- Gateway or Console is not `active/running`;
- service PID/restart count changes during the bounded inspection without an
  explained external event;
- the authority parent or `.run-claims` violates owner/mode/type rules;
- the historical FAILED claim is absent, changed, not `FAILED`, or binds a
  different plan SHA-256;
- an old staging/final root for the failed run exists;
- an unexpected top-level authority-parent entry exists;
- the inspection would require DB/session/memory access;
- a repair, cleanup, install, reload, new plan, or new run ID is proposed in
  order to make the readiness check pass.

Do not repair and continue in the same stage.

## Readiness outcome semantics

### `PASS`

Means only:

> The source and current host bindings are clean enough to draft a fresh,
> separately authorized real-plan read-only dry-run using a brand-new run ID.

It does **not** authorize the dry-run itself.

### `PASS_WITH_FINDINGS`

Allowed only for non-blocking observations that do not weaken exact source,
live binding, authority-history, or fresh-run eligibility gates.

Examples:

- local branch remains ahead of `origin/main` while the exact local commit is the
  explicitly reviewed execution authority;
- `docs/current-state.md` lags the latest source commit but is not used as the
  execution authority;
- npm 11.6 continues to warn that `npm_config_nodedir` may change in a future
  major version, while the currently bound npm/node-gyp combination remains
  proven.

### `INSUFFICIENT_EVIDENCE`

Use when a required read-only fact cannot be established safely.

### `STOPPED`

Use for a concrete violated gate, drift, historical-claim mismatch, unexpected
authority entry, or attempted scope expansion.

## Expected owner execution surface after authorization

If this Stage Card is authorized, Sol—not DevSpace and not Edi—runs the bounded
read-only inspection in the independent WSL terminal.

The execution packet must:

- set `set -euo pipefail` and `umask 077`;
- bind the exact authorized full HEAD supplied after this Stage Card is frozen;
- use the bound Node 24 runtime;
- print only hashes/metadata needed for review, not config contents;
- capture before/after source/config/service/claim fingerprints;
- perform no write except ordinary terminal output;
- not create a plan or run ID.

The exact command packet will be supplied only after separate authorization of
this readiness stage.

## Required report

~~~text
stage=Post-Fix Real-Prepare Readiness Review
result=PASS | PASS_WITH_FINDINGS | INSUFFICIENT_EVIDENCE | STOPPED

authorized_head=
actual_head=
worktree_clean=
required_fix_ancestors=
branch_status=
origin_main=

node_version=
node_abi=
node_toolchain_binding=
active_root=
active_release=
source_runtime_identity=
active_runtime_identity=
release_runtime_identity=
config_sha256_before=
config_sha256_after=

gateway_unit=
gateway_state_before=
gateway_state_after=
console_unit=
console_state_before=
console_state_after=

authority_parent_type_mode_owner=
authority_parent_inventory=
run_claims_type_mode_owner=
historical_failed_claim_present=
historical_failed_claim_outcome=
historical_failed_claim_plan_sha256=
historical_failed_claim_sha256_before=
historical_failed_claim_sha256_after=
historical_failure_sidecar_present=
historical_failure_sidecar_sha256_before=
historical_failure_sidecar_sha256_after=
historical_staging_absent=
historical_final_absent=
unexpected_authority_entries=

source_drift=false | true
config_drift=false | true
service_drift=false | true
claim_drift=false | true
runtime_mutation=false
config_mutation=false
service_operation=false
data_access=false
plan_created=false
run_id_allocated=false
claim_created=false

findings=
recommendation=
~~~

## Authorization state

~~~text
stage_card=frozen
stage_execution=not authorized
new_plan=not authorized
real_plan_dry_run=not authorized
prepare=not authorized
verify=not authorized
runtime_install=not authorized
runtime_reload=not authorized
tag=false
push=false
~~~

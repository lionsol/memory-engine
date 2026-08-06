# npm-ci Timeout Investigation Stage Card — 2026-08-06

> Status: `READY_FOR_AUTHORIZATION`
>
> This card authorizes no source change, real plan, prepare, runtime operation,
> tag, or push by itself.

## Stage decision

Can the Candidate-Builder prove whether the existing 120-second sandbox limit is
merely too short for a valid real-lockfile `npm ci`, distinguish the inner and
outer timeout boundaries, and—only if successful completion evidence exists—set
the smallest explicit operation-specific bounded budget without weakening the
sandbox or fail-closed transaction?

## User value

A real Candidate-Builder prepare must be able to complete a legitimate dependency
installation while remaining bounded, deterministic, one-shot, and diagnosable.
An arbitrary timeout increase would hide hangs and weaken the transaction; keeping
an unproven 120-second ceiling would reject valid installations.

## Current facts

- Source HEAD is `24eca45cef3aba5669eade2207a6eaadfc520a2c`.
- Commit `24eca45` preserves bounded prepare failure evidence and exposes the
  exact symlink target of `/etc/resolv.conf` read-only inside the sandbox.
- The pre-fix disposable real-lockfile reproduction failed at DNS resolution:
  npm debug evidence recorded `EAI_AGAIN` because `/etc/resolv.conf` pointed to
  `/mnt/wsl/resolv.conf`, which was absent inside the chroot.
- The post-fix disposable reproduction reached npm registry HTTP 200 responses
  for real dependencies including `better-sqlite3` and `@lancedb/lancedb`.
- That post-fix reproduction did not complete before the current 120-second
  sandbox limit. It ended with `spawnSync /usr/bin/unshare ETIMEDOUT` after
  partially creating 62 `node_modules` entries.
- No evidence currently proves the normal successful cold-cache or warm-cache
  completion duration for this real lockfile under the production-shaped
  sandbox.
- Two independent 120-second watchdogs currently exist:
  1. outer `SandboxRunner.run()` around the `unshare` process;
  2. inner `execFileSync(chroot ...)` in `sandbox-child.js`.
- The npm process launched inside the chroot does not currently receive its own
  explicit operation budget; it is terminated indirectly by the enclosing
  chroot watchdog.
- All sandbox operations currently share the same outer 120-second limit.
- Production E2E uses local synthetic dependencies and therefore does not prove
  the duration of the real registry/native dependency tree.
- The failed historical real run
  `real-plan-dry-run-20260806T112843Z-5723d05` remains a `FAILED` claim and is
  immutable historical evidence.

## Classification of the finding

`blocker`

A new real prepare cannot be responsibly authorized while a legitimate real
`npm ci` is known to hit the generic sandbox ceiling and no evidence-backed
operation budget exists.

## In scope

At most three work items:

1. Reproduce and measure the real-lockfile install under the same Node/npm,
   namespace, chroot, resolver, toolchain, command, and fixed environment using
   disposable roots only.
2. Identify the first timeout boundary and determine whether the process is
   making forward progress, completing normally under a higher diagnostic-only
   ceiling, or hanging/failing elsewhere.
3. If and only if successful completion evidence exists, implement and test the
   smallest immutable operation-specific timeout contract for
   `npm.ci_candidate`.

## Non-goals

- no real plan creation;
- no real dry-run, prepare, verify, candidate, R0, or authority publication;
- no reuse or cleanup of the historical failed run or claim;
- no plugin install, reload, start, restart, or service operation;
- no OpenClaw configuration mutation;
- no database, session, memory, or private runtime data access;
- no retry loop;
- no background/resumable install mechanism;
- no shared persistent npm cache;
- no `npm install` substitution;
- no lifecycle-script disabling;
- no Node/npm upgrade or downgrade;
- no host environment inheritance;
- no sandbox root expansion;
- no plan schema, CLI flag, config object, database table, ledger, or state
  machine;
- no changes to unrelated archive, verify, retrieval, memory, or Console code;
- no tag or push;
- no commit unless separately authorized.

## Evidence protocol

### Disposable root

Every timing reproduction must run under a fresh `/tmp` root or equivalent
Codex-owned disposable directory. It must not use the live persistent authority
parent.

The reproduction must copy only the exact current:

- `package.json`;
- `package-lock.json`.

Record their SHA-256 identities before every run.

### Exact tool and command binding

Use the committed source bindings:

```text
Node: /home/lionsol/.local/node24/bin/node
npm CLI: /home/lionsol/.local/node24/lib/node_modules/npm/bin/npm-cli.js
Node version: v24.8.0
npm version: 11.6.0
```

Use the production command shape:

```text
npm ci --omit=dev --no-audit --no-fund --cache <disposable-cache>
```

The sandbox path must continue to use:

```text
unshare --user --map-root-user --mount --pid --fork --mount-proc
chroot
fixed child environment
read-only runtime/tool/system bindings
controlled writable staging, home, tmp, and npm cache
```

### Diagnostic-only ceiling

The reproduction harness may inject a higher timeout only in disposable test
code. This does not authorize a product timeout change.

The diagnostic ceiling must be:

- finite;
- no more than 15 minutes per run;
- recorded in the report;
- applied without changing the repository before the first successful timing
  evidence is collected.

If a run does not complete within 15 minutes, stop with
`INSUFFICIENT_EVIDENCE`. Do not raise the ceiling again.

### Required measurements

Capture for each run:

- cold or warm cache classification;
- start and finish timestamps;
- wall-clock duration;
- inner child outcome;
- outer `unshare` outcome;
- npm exit code;
- whether timeout originated inside or outside the chroot;
- bounded npm debug evidence;
- last observed npm phase/progress event;
- candidate file/module counts at completion or termination;
- package and lockfile hashes before and after;
- `npm ls --all --omit=dev` result if installation completes;
- `better-sqlite3` native load smoke if installation completes;
- LanceDB import smoke if installation completes;
- confirmation that no child `unshare`, `chroot`, npm, compiler, or node-gyp
  process remains after exit.

### Minimum timing sample

Collect, when technically possible:

1. one successful fresh-cache run;
2. one successful warm-cache run using the first run's disposable cache but a
   fresh candidate directory.

A third run is not required unless the first two materially conflict.

Network variability must not be hidden. Report registry errors separately from
install duration.

## First-timeout-boundary gate

Before editing source, prove all of the following:

1. which watchdog fired in the current architecture;
2. whether npm was still making forward progress near 120 seconds;
3. whether the same install completes under the bounded diagnostic ceiling;
4. whether completion includes dependency-tree validation and native module
   smoke.

If any item remains unknown, source behavior change is forbidden and the stage
must end `INSUFFICIENT_EVIDENCE`.

## Product timeout decision rule

A production change is allowed only after at least one valid cold-cache success
and one valid warm-cache success.

The selected inner `npm.ci_candidate` budget must:

- be explicit and immutable in source;
- apply only to `npm.ci_candidate`;
- be derived from measured successful duration;
- include a bounded safety margin;
- remain no greater than 15 minutes;
- preserve all other sandbox operation limits unless evidence independently
  proves they need change.

Recommended selection rule:

```text
selected_inner_budget = round_up_to_30_seconds(
  max(successful_cold_ms, successful_warm_ms)
  + max(60 seconds, 25 percent of max successful duration)
)
```

If this rule exceeds 15 minutes, stop instead of implementing it.

The outer `unshare` watchdog must exceed the inner operation budget by a small,
explicit cleanup/reporting grace period so the inner timeout remains the first
observable boundary. The grace period must be bounded and justified by tests.

Do not expose timeout values through plan input, CLI input, environment
variables, or OpenClaw configuration.

## Expected implementation shape

The likely minimal design is an immutable closed timeout policy keyed by existing
registered sandbox operation IDs, for example:

```text
npm.ci_candidate -> measured operation budget
all other sandbox operations -> existing 120-second budget
capability probe -> existing 30-second budget
```

The exact implementation is not predetermined. Codex must inspect impact before
editing.

Any solution must propagate a validated timeout through both layers:

1. `SandboxRunner` outer watchdog;
2. `sandbox-child` inner chroot watchdog or direct child command budget.

The implementation must reject missing, malformed, negative, unbounded, or
unknown timeout values rather than silently defaulting to a larger duration.

## Pass criteria

1. Persistent disposable evidence proves successful real-lockfile cold-cache and
   warm-cache completion, including `npm ls` and native module smoke, or the
   stage honestly stops `INSUFFICIENT_EVIDENCE` without a source change.
2. If changed, only `npm.ci_candidate` receives an evidence-derived bounded
   budget, inner/outer timeout ordering is explicit, and timeout failures remain
   structured and fail closed.
3. Focused tests, production E2E, all runtime-authority tests, static check, and
   the full suite pass in the bound Node24/project-timezone environment.

## Required negative tests if source changes

Add deterministic tests proving:

- `npm.ci_candidate` receives the selected inner budget;
- its outer watchdog includes only the bounded grace period;
- another sandbox operation retains the previous 120-second budget;
- capability probe retains 30 seconds;
- unknown operation IDs remain rejected;
- malformed timeout propagation is rejected;
- an inner timeout is reported as a structured
  `CommandExecutionError` for `npm.ci_candidate`;
- outer cleanup completes and no publication occurs after timeout;
- no retry is attempted.

Do not create tests that sleep for the full production timeout. Use injected
spawns/clocks or a short deterministic fixture.

## Validation sequence

Use the bound environment:

```bash
export PATH=/home/lionsol/.local/node24/bin:/usr/bin:/bin
export TZ=Asia/Shanghai
export NODE24=/home/lionsol/.local/node24/bin/node
```

Run, in order:

```bash
$NODE24 --test test/runtime-authority-sandbox.test.js \
  test/runtime-authority-command-registry.test.js \
  test/runtime-authority-prepare.test.js
```

```bash
$NODE24 --test test/runtime-authority-production-e2e.test.js
```

```bash
$NODE24 --test test/runtime-authority-*.test.js
```

```bash
$NODE24 bin/static-check.js
```

```bash
$NODE24 --test
```

`git diff --check` must pass.

## Allowed mutations

Allowed only after separate implementation authorization:

- bounded source/test edits in `lib/runtime-authority/` and
  `test/runtime-authority-*`;
- this Stage Card and a bounded persistent result section;
- disposable `/tmp` reproduction files and caches, removed at completion.

Not allowed:

- real authority parent writes;
- real claim writes;
- runtime/config/service/data changes;
- source `node_modules` mutation;
- generated reports outside this Stage Card unless explicitly justified;
- commit, tag, or push without separate authorization.

## Stop conditions

Stop and report without a product timeout change if:

- real install does not complete within 15 minutes;
- registry/network instability prevents a valid timing sample;
- native build or package integrity fails after DNS succeeds;
- cold and warm results are too inconsistent to select a bounded budget;
- successful completion requires disabling scripts, relaxing isolation, sharing a
  persistent cache, or inheriting host environment;
- the implementation would need a plan/config/CLI timeout input;
- another subsystem enters scope;
- the historical failed claim or runtime would need to be touched;
- child processes cannot be proven terminated after timeout;
- evidence cannot distinguish inner and outer timeout behavior.

## Historical evidence boundary

The following remains historical and immutable:

```text
run_id=real-plan-dry-run-20260806T112843Z-5723d05
claim_outcome=FAILED
prepare_exit_code=2
published=false
```

Do not use that run to test any new timeout behavior.

## Required Codex report

Codex must persist a result section in this file and return:

```text
task_goal=
starting_head=
changed_files=
cold_reproduction_command=
cold_reproduction_result=
cold_duration_ms=
warm_reproduction_command=
warm_reproduction_result=
warm_duration_ms=
inner_timeout_boundary=
outer_timeout_boundary=
last_progress_before_120s=
completion_integrity=
native_smoke=
selected_inner_timeout_ms=
selected_outer_timeout_ms=
timeout_selection_rationale=
behavior_change=
security_invariants_preserved=
targeted_tests=
production_e2e=
runtime_authority_tests=
static_check=
full_suite=
runtime_mutation=false
config_mutation=false
service_operation=false
data_access=false
failed_real_claim_untouched=true
risks=
commit_hash=<only if separately authorized>
tag=false
push=false
recommendation=
```

If no valid budget can be selected, use:

```text
selected_inner_timeout_ms=NOT_SET
selected_outer_timeout_ms=NOT_SET
recommendation=INSUFFICIENT_EVIDENCE
```

## Authorization state

```text
stage_card=frozen
planning=complete
Codex implementation=not yet authorized
real plan=false
real dry-run=false
real prepare=false
runtime rollout=false
commit=false
tag=false
push=false
```

## Codex result — 2026-08-06

~~~text
task_goal=证明真实 lockfile npm ci 的 120 秒限制是否过短，并区分 inner chroot watchdog、outer unshare watchdog、npm 与 native build failure；仅在 cold/warm 成功证据完整时选择产品 timeout。
starting_head=24eca45cef3aba5669eade2207a6eaadfc520a2c
initial_worktree=?? docs/smoke-tests/npm-ci-timeout-investigation-stage-card-20260806.md；git diff --check passed。
cold_reproduction_command=Disposable v2 controller under /tmp using production-shaped SandboxRunner and operation_id=npm.ci_candidate; outer diagnostic wrapper=900000ms; temporary child wrapper injected inner chroot timeout=840000ms; exact argv=/home/lionsol/.local/node24/lib/node_modules/npm/bin/npm-cli.js --prefix <tmp>/staging/candidate ci --omit=dev --no-audit --no-fund --cache <tmp>/staging/npm-cache; fixed outer env=PATH=/home/lionsol/.local/node24/bin:/usr/bin:/bin,TZ=Asia/Shanghai,LC_ALL=C。
cold_reproduction_result=FAILURE_AFTER_NATIVE_BUILD; fresh cold root=/tmp/memory-engine-npm-ci-timeout-cold-v2-5N16iH; package_json_sha256=752f46d03f7fe87f744e4441a9f79fccae3d4e09ece129ee60a0ad19abcdf47a; package_lock_sha256=8ee89a15cc54eb532618cf011a30f5684cedf0aa0c026cb69378bc025ec58718; registry downloads returned HTTP 200; better-sqlite3 lifecycle eventually exited 1; no watchdog fired. Diagnostic wrapper reported ENOBUFS while collecting 293453 bytes stderr against existing 256KiB output ceiling, but bounded npm debug log records underlying native failure。
cold_duration_ms=183952
warm_reproduction_command=NOT_RUN; Stage Card stop condition reached after cold native-build failure, so no partial cache was reused as a warm sample。
warm_reproduction_result=NOT_RUN
warm_duration_ms=NOT_SET
npm_ls_result=NOT_RUN; installation did not complete。
better_sqlite3_smoke=NOT_RUN; better-sqlite3 install lifecycle failed before validation。
lancedb_smoke=NOT_RUN; installation did not complete。
inner_timeout_boundary=NOT_REACHED; diagnostic inner watchdog was 840000ms and npm terminated with native build exit 1 at 183952ms。
outer_timeout_boundary=NOT_REACHED; diagnostic outer unshare watchdog was 900000ms; spawn_meta.timed_out=false. Only outer-layer diagnostic error was ENOBUFS while capturing oversized stderr after child had already failed。
first_timeout_boundary=NONE_IN_THIS_RUN; existing 120-second boundary would have elapsed while npm was still in better-sqlite3 native install, but run later failed at native build boundary. Not valid evidence for increasing product timeout。
last_progress_before_120s=At 110098ms and 120162ms, npm debug log remained at line 234 native install; node_modules_entries=63. Prior registry tarballs HTTP 200. Final: prebuild-install request timed out, node-gyp fetched Node headers HTTP 200, then repeated TAR_ENTRY_ERROR EINVAL fchown and exited 1。
progress_at_timeout=At 110098ms and 120162ms, npm debug log remained at line 234 native install; node_modules_entries=63. Prior registry tarballs HTTP 200. Final: prebuild-install request timed out, node-gyp fetched Node headers HTTP 200, then repeated TAR_ENTRY_ERROR EINVAL fchown and exited 1。
completion_integrity=No successful install; manifest/lock hashes unchanged; final node_modules_entries=0; npm debug log=2026-08-06T14_39_46_521Z-debug-0.log, bytes=300595, sha256=10c226a5f83e87fcf27d1175ebfbd9ea0f3a8a356743c46ce2f8d8cee389adc6。
native_smoke=NOT_RUN; decisive native failure was better-sqlite3 install/node-gyp extraction。
selected_inner_timeout_ms=NOT_SET
selected_outer_timeout_ms=NOT_SET
timeout_selection_basis=Product modification gate not met: no successful cold run, no warm run, no npm ls/native smoke completion, no reproducible successful duration. Stop condition native build failure after DNS success applies; no timeout increase/retry/fallback/native workaround attempted。
timeout_selection_rationale=INSUFFICIENT_EVIDENCE; the observed run is a native dependency failure, not a completed installation that exceeded 120 seconds。
behavior_change=none; no product source/test/config/runtime/timeout files changed. Only this persistent Stage Card result section was added。
security_invariants_preserved=All reproduction roots disposable /tmp; only package.json/package-lock copied into candidate; production namespace/chroot/fixed env/resolver/tool bindings used; no live authority parent, plan, claim, runtime, service, configuration, database, session, or memory touched。
process_cleanup_result=cold process_cleanup.clean=true; related_rows_after=[]; worker_pid_alive=false. Post-run process scan found no residual unshare, chroot, npm, node-gyp, gcc/g++, or related Node process. Warm/validation processes not started。
changed_files=docs/smoke-tests/npm-ci-timeout-investigation-stage-card-20260806.md only。
targeted_tests=NOT_RUN; stage stopped at evidence gate before source validation; no source change。
production_e2e=NOT_RUN; stopped at native-build failure。
runtime_authority_tests=NOT_RUN; stopped at native-build failure。
static_check=NOT_RUN; no source change and stop before product validation。
full_suite=NOT_RUN; no source change and stop before product validation。
runtime_mutation=false
config_mutation=false
service_operation=false
data_access=false
failed_real_claim_untouched=true
risks=Real native dependency failure after successful registry downloads, not a normal successful install merely exceeding 120 seconds. prebuild-install request timeout and node-gyp header extraction fchown errors require separate investigation; timeout change would be speculative. Diagnostic collector hit existing 256KiB stderr ceiling, but npm debug log was complete and sufficient。
commit_hash=not committed
tag=false
push=false
recommendation=INSUFFICIENT_EVIDENCE
~~~

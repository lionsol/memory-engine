# npm-ci Post-Fetch / Native-Build Timeout Diagnosis Stage Card — 2026-08-08

> Status: `READY_FOR_COMMIT`
>
> Product-source baseline: `97454ee70f47f8fd4421806f4a10100b78e27186`
>
> Pre-card repository HEAD: `901e7d196b81ee530ea489504a07390d352cf0c5`
>
> This Stage Card authorizes diagnosis only. It does **not** authorize a source
> fix, timeout increase, real plan, dry-run, prepare retry, authority verify,
> runtime installation, service operation, tag, push, or mutation of historical
> transaction evidence.

## Stage decision

When the production Candidate-Builder `npm.ci_candidate` reaches its committed
300,000ms inner watchdog after registry fetches have completed, is the remaining
work:

1. a legitimate, finite native/lifecycle build that requires a larger bounded
   operation budget; or
2. a stalled/hung lifecycle or child-process path that must be fixed instead of
   hidden by a larger timeout?

This stage answers only that question.

## User value

The Candidate-Builder must allow a legitimate dependency construction to finish,
but it must not turn a real hang into a longer hidden failure. The next source
change therefore needs direct evidence about what happens **after fetch** and
before the 300-second chroot watchdog fires.

## Triggering current fact

The one-shot real prepare for:

~~~text
AUTHORIZED_HEAD=901e7d196b81ee530ea489504a07390d352cf0c5
RUN_ID=real-plan-dry-run-20260807T141200Z-901e7d1-692f0934
PLAN_SHA256=343e3ac48a99cc48c0d6047ea7feaca304392ef8496e02bddb7c61b210f4b097
~~~

passed the final pre-prepare gate and then failed in the product prepare path:

~~~text
prepare_exit_code=2
failure_journal_stage=DEPENDENCIES_INSTALLED
failure_operation_id=npm.ci_candidate
failure_command_exit_code=2
stderr=spawnSync /usr/sbin/chroot ETIMEDOUT
~~~

The run is permanently consumed and must never be retried.

The fail-closed transaction behaved correctly:

~~~text
claim_outcome=FAILED
failure_evidence_present=true
staging_present=false
final_authority_present=false
authority_json_present=false
checksums_present=false
recovery_required=false
~~~

The active installation, release binding, config, Gateway, Console, repository
HEAD/tree/worktree, and prior historical FAILED claim remained stable.

## Current timeout fact

At product-source baseline `97454ee...` (and the docs-only descendant
pre-card HEAD `901e7d...`), the committed closed timeout policy is:

~~~text
npm.ci_candidate:
  inner_timeout_ms=300000
  outer_timeout_ms=330000

other registered sandbox operations:
  inner_timeout_ms=120000
  outer_timeout_ms=120000

capability-probe:
  inner_timeout_ms=120000
  outer_timeout_ms=30000
~~~

The failed prepare timing is consistent with the 300-second inner boundary:

~~~text
claim_at=2026-08-07T14:27:51.577Z
npm_ci_log_start=2026-08-07T14:27:56.597Z
failure_evidence_at≈2026-08-07T14:32:57.909Z
~~~

Therefore this is not evidence that the operation-specific timeout failed to
bind. The current evidence is that the bound 300-second inner timeout was reached.

## Prior timing evidence

The earlier timeout-resolution stage used valid successful disposable samples:

~~~text
historical_successful_cold_ms=179269
fresh_successful_cold_ms=210551
fresh_successful_warm_ms=175561
~~~

Using the frozen selection formula, those samples produced:

~~~text
selected_inner_timeout_ms=300000
selected_outer_timeout_ms=330000
~~~

Those samples remain valid historical evidence. The new real prepare is a newer,
more production-representative counterexample showing that 300 seconds is not a
safe proven upper bound for every real prepare.

The old formula must **not** be rerun with an invented `300001ms` success value.
A timed-out run is not a successful duration sample.

## Post-fetch evidence from the failed prepare

The retained bounded npm debug log shows successful registry fetches including:

~~~text
@lancedb/lancedb         3871ms
apache-arrow             5189ms
@types/node              5834ms
better-sqlite3          13799ms
~~~

The log ended after dependency fetch/reify activity and did not record a normal
npm completion.

`better-sqlite3@11.10.0` has an install script. Under Node `v24.8.0`, ABI `137`,
prior investigation already established that a matching prebuilt binary is not
available for this path, so node-gyp fallback is expected.

This makes the native/lifecycle boundary the primary diagnosis target, but the
stage must prove the actual blocking child/process rather than assume it.

## Classification

`blocker`

Another real prepare must not be authorized until this stage distinguishes
legitimate slow completion from a stall/hang. Increasing the product timeout
without that distinction would weaken the fail-closed contract.

## In scope

Only these three work items are in scope:

1. Reproduce the production-shaped `npm.ci_candidate` path in a disposable
   environment with enough bounded observability to identify the last active
   lifecycle/native-build child and its progress.
2. Determine whether the same install completes normally under a finite
   diagnostic-only ceiling, including dependency-tree and native-module smoke.
3. Produce a decision record that classifies the result as `LEGITIMATE_SLOW`,
   `STALL_OR_HANG`, or `INSUFFICIENT_EVIDENCE` and identifies the smallest next
   source-change stage, if any.

No source fix belongs to this diagnosis stage.

## Explicit non-goals

Do not:

- create another real authority plan;
- run another real dry-run, prepare, or `verify --authority`;
- reuse the consumed `real-plan-dry-run-20260807T141200Z-901e7d1-692f0934`;
- edit, delete, repair, rewrite, or normalize its plan, dry-run evidence, claim,
  failure evidence, or prepare logs;
- alter the older historical FAILED claim;
- change `npm.ci_candidate` product timeout values;
- change the timeout ceiling constants;
- add timeout plan/config/env/CLI overrides;
- add retries, resumable installs, background workers, heartbeats, watchdog
  daemons, or a new state machine;
- disable npm lifecycle scripts;
- replace `npm ci` with `npm install`;
- change Node, npm, better-sqlite3, LanceDB, node-gyp, tar, compiler, or Python
  versions;
- change `npm_config_nodedir=/runtime`;
- change namespace, chroot, resolver, mount, ownership, or toolchain bindings;
- access or modify DB, memory, sessions, prompts, transcripts, or agent state;
- install/reinstall/reload/restart/stop/start OpenClaw or Console services;
- change OpenClaw config or plugin sourcePath;
- commit, tag, or push without separate authorization.

## Evidence source hierarchy

Use the minimum sufficient evidence in this order:

1. the immutable real prepare failure evidence already captured for the consumed
   run;
2. one production-shaped disposable reproduction with bounded child/process
   observability;
3. at most one second disposable confirmation if the first reproduction is
   ambiguous or materially inconsistent with prior successful timing samples.

Do not collect repeated timing samples merely to build a distribution.

## Disposable reproduction boundary

The diagnostic reproduction must use a fresh disposable root outside the live
runtime-authority parent.

It may copy only the exact current source inputs required to reproduce candidate
dependency installation, including the current `package.json` and
`package-lock.json`.

It must reuse the production mechanisms where relevant:

~~~text
CommandRegistry npm.ci_candidate descriptor
SandboxRunner
sandbox-child chroot path
Node v24.8.0 / ABI 137
npm 11.6.0
npm_config_nodedir=/runtime
bound compiler/Python/make/ar/node-gyp toolchain
controlled resolver and namespace
fresh candidate node_modules
fresh disposable npm cache unless explicitly running one warm confirmation
~~~

The live persistent authority parent must not be used as the writable staging
root for diagnosis.

## Diagnostic-only timeout ceiling

A disposable diagnostic harness may replace only the **diagnostic watchdog** for
the reproduction. It must not modify product source before the stage decision.

Rules:

- finite ceiling;
- maximum 15 minutes for the single diagnostic reproduction;
- no infinite wait;
- no retry loop;
- record the exact diagnostic ceiling;
- record whether completion occurred before the ceiling;
- a diagnostic ceiling is not itself a candidate production timeout.

If the operation still has not completed by 15 minutes, terminate the
diagnostic run. Classify it as `STALL_OR_HANG` only when direct process/log/artifact
evidence proves loss of meaningful forward progress or another concrete stall
boundary. If the process is still making meaningful progress, or the evidence
cannot distinguish slow progress from a stall, classify the stage
`INSUFFICIENT_EVIDENCE`. The 15-minute diagnostic ceiling is a stop boundary,
not proof of a hang by itself.

## Required observability

The diagnosis must identify, as far as the operating system and existing tools
permit, the process tree and phase around the native/lifecycle boundary.

Capture at minimum:

- reproduction start timestamp;
- npm-ci start timestamp;
- npm debug log path and bounded content;
- last npm debug-log sequence number and phase;
- process tree snapshots at bounded intervals or milestone transitions;
- child executable/argv category for npm lifecycle descendants where visible;
- whether `prebuild-install` is attempted;
- whether prebuild lookup fails or falls back;
- whether `node-gyp` starts;
- whether `make`/compiler processes start;
- whether those processes show continued CPU/process turnover or remain stuck;
- candidate `node_modules` / better-sqlite3 build artifact progress at bounded
  milestones;
- exact final npm exit or diagnostic-timeout outcome;
- confirmation that no unshare/chroot/npm/node-gyp/make/compiler child remains
  after cleanup.

Do not log secrets or export arbitrary environment contents. Preserve the
existing redaction boundary for credentials, proxy/auth data, tokens, cookies,
and secrets.

## Progress classification

### `LEGITIMATE_SLOW`

Classify as `LEGITIMATE_SLOW` only if the disposable reproduction:

1. completes with npm exit 0 before the 15-minute diagnostic ceiling;
2. completes `npm ls --all --omit=dev` successfully;
3. loads `better-sqlite3` successfully in a disposable smoke;
4. loads/imports LanceDB successfully in a disposable smoke;
5. shows bounded evidence of forward lifecycle/native-build progress after the
   old 300-second boundary;
6. leaves no relevant child process behind;
7. preserves source package/lock hashes.

Only this classification may justify a later timeout-recalculation source stage.

### `STALL_OR_HANG`

Classify as `STALL_OR_HANG` if any of the following is proven:

- the 15-minute diagnostic ceiling is reached **and** bounded evidence shows no
  meaningful forward progress over an observation interval sufficient to
  identify a stall;
- a lifecycle/native-build child remains alive without meaningful forward
  progress for a bounded observation interval;
- a child is waiting on a missing/unreachable resource that should have been
  provided by the production sandbox;
- process/log evidence identifies a repeatable deadlock/stall boundary;
- cleanup cannot terminate all disposable descendants cleanly.

A `STALL_OR_HANG` result forbids timeout enlargement as the next fix.

### `INSUFFICIENT_EVIDENCE`

Use `INSUFFICIENT_EVIDENCE` when the reproduction fails for an unrelated
transient external reason before it reaches the relevant boundary, or when the
available observability cannot distinguish progress from a stall.

Do not convert an ambiguous run into `LEGITIMATE_SLOW` merely because it runs
longer than 300 seconds.

## If `LEGITIMATE_SLOW` is proven

This diagnosis stage still makes **no product change**.

A subsequent separately authorized source stage may recalculate the production
budget using only successful durations.

That later stage must include the new successful production-shaped duration and
all still-valid earlier successful samples. It must define a new explicit bounded
formula before editing source.

Do not assume the prior 25%/60-second margin formula remains sufficient merely
because it was used before. The later stage must decide whether the evidence
supports retaining or revising that formula.

The existing hard ceiling of 900,000ms inner / 930,000ms outer must not be
increased by this diagnosis stage.

## If `STALL_OR_HANG` is proven

The next separately authorized source stage must target the first proven stall
boundary only.

Examples of potentially valid blocker classes, if actually proven, include:

- prebuild fallback waiting behavior;
- node-gyp child-process invocation/binding;
- compiler or make process behavior inside the namespace;
- unavailable filesystem/tool/header path required after fetch;
- child stdio/process-management behavior that prevents lifecycle completion.

Do not broaden into dependency upgrades or general sandbox redesign unless the
specific evidence requires it.

## Pass criteria

This diagnosis stage passes only if all three criteria are satisfied:

1. The consumed real prepare remains immutable `FAILED` evidence and the live
   runtime/config/services remain untouched.
2. One bounded disposable production-shaped reproduction provides enough direct
   evidence to classify the post-fetch behavior as `LEGITIMATE_SLOW` or
   `STALL_OR_HANG`, with child/process cleanup proven.
3. The report identifies one bounded next decision without implementing it.

If criterion 2 cannot be satisfied, outcome is `INSUFFICIENT_EVIDENCE` rather
than `PASS`.

## Stop conditions

Stop immediately if:

- any live runtime/config/service mutation is proposed or observed;
- any historical claim/evidence mutation is proposed or observed;
- the disposable run would require a product source edit before classification;
- a second unrelated subsystem enters scope;
- the diagnostic reproduction reaches 15 minutes without valid completion; stop
  the run, then classify `STALL_OR_HANG` only if direct stall evidence exists,
  otherwise use `INSUFFICIENT_EVIDENCE`;
- cleanup cannot prove termination of diagnostic descendants;
- the process requires access to DB/session/memory/user data;
- the investigation starts proposing a larger timeout before proving
  `LEGITIMATE_SLOW`.

## Allowed mutations

For this diagnosis stage, allowed mutations are limited to:

- this Markdown Stage Card when explicitly authorized;
- disposable diagnostic files/directories under a bounded temporary root during
  a separately authorized Codex diagnosis;
- diagnostic report files explicitly requested for source review.

Not allowed:

- runtime-authority transaction state;
- live OpenClaw installation/config/services;
- project source code before a later separately authorized fix stage;
- DB/session/memory data;
- historical evidence rewriting.

## Required report from Codex

Codex must report:

- exact source HEAD and clean/dirty status before diagnosis;
- task goal;
- exact disposable root;
- exact toolchain bindings;
- diagnostic timeout ceiling;
- reproduction command/path description;
- start/end/duration;
- npm debug evidence summary;
- observed process/lifecycle/native-build sequence;
- whether `prebuild-install`, `node-gyp`, make, and compiler were observed;
- evidence of progress or stall after 300 seconds;
- final npm outcome;
- npm ls result if completed;
- better-sqlite3 smoke result if completed;
- LanceDB smoke result if completed;
- package/lock hash integrity;
- descendant cleanup result;
- live runtime/config/service mutation status;
- classification: `LEGITIMATE_SLOW`, `STALL_OR_HANG`, or
  `INSUFFICIENT_EVIDENCE`;
- recommendation;
- changed files;
- tests run;
- commit hash only if a separate commit authorization is later granted.

## Stage outcome vocabulary

GPT must issue only one of:

~~~text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
~~~

Interpretation for this card:

- `PASS`: diagnosis directly classifies the boundary and the report has no
  material side finding;
- `PASS_WITH_FINDINGS`: diagnosis directly classifies the boundary but records a
  bounded non-blocking finding;
- `INSUFFICIENT_EVIDENCE`: evidence does not distinguish legitimate slow work
  from a stall;
- `STOPPED`: a safety, scope, or cleanup stop condition prevents the diagnosis
  from reaching a valid classification or completing the required evidence and
  descendant-cleanup checks.

## Authorization boundary after this card

Freezing this card does not authorize Codex to run the disposable reproduction.

The next authorization, if Sol grants it, is limited to **diagnostic execution
under this Stage Card**. It does not include source changes, commit, tag, push,
real plan generation, real dry-run, real prepare, verify, install, reload, or
service mutation.

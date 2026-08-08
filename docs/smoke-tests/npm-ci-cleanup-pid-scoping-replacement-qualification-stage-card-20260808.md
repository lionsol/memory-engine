# npm-ci Cleanup PID-Scoping Replacement Qualification Stage Card — 2026-08-08

> Status: `FROZEN` — execution requires separate Sol authorization
>
> Repository HEAD before this card: `408cb84791826464b5030aeedeab60984a9bf706`
>
> Product-source baseline: `97454ee70f47f8fd4421806f4a10100b78e27186`
>
> This Stage Card authorizes no execution by itself. Replacement qualification execution requires separate Sol authorization.

## Stage decision

Can the disposable qualification harness correct only its cleanup PID scoping so that it preserves the already-proven live install-window observability and exits cleanly without targeting an ancestor process outside the diagnostic descendant tree?

This stage qualifies cleanup determinism only. It does not reopen the production timeout decision and does not require a run to exceed `300000ms`.

## Triggering current facts

The prior live-observability qualification reproduction established the substantive monitor path but closed `OBSERVABILITY_NOT_QUALIFIED` / `INSUFFICIENT_EVIDENCE` because cleanup did not meet the frozen criterion.

The prior authorized reproduction reported:

~~~text
source_head=408cb84791826464b5030aeedeab60984a9bf706
reproduction_count=1
monitor_start=2026-08-08T03:03:22.282Z
npm_ci_start=2026-08-08T03:03:22.304Z
npm_ci_end=2026-08-08T03:06:42.341Z
monitor_end=2026-08-08T03:06:42.396Z
sampling=500ms / 387 live snapshots
npm_result=exit 0
naturally_crossed_300000ms=false
tracked_changed_files=none
~~~

Direct live evidence observed the production-shaped chain:

~~~text
unshare -> sandbox child -> npm -> prebuild-install -> node-gyp -> make -> compiler
~~~

The monitor also observed process-state/CPU progression and timestamp-correlated better-sqlite3 build artifacts while npm was running.

The only material qualification failure was cleanup PID scoping:

- all npm/native diagnostic descendants were gone;
- no root-matching diagnostic process remained;
- the monitor logged its normal end and stderr was empty;
- the controller nevertheless exited `143` because its cleanup scan incorrectly included the ancestor `/usr/bin/timeout` wrapper as a termination target.

The production timeout remains unchanged:

~~~text
npm.ci_candidate inner=300000ms
npm.ci_candidate outer=330000ms
~~~

The real consumed prepare remains immutable failed evidence and must not be reused or modified.

## Classification

`blocker`

The observability method should not be treated as qualified until the disposable controller proves clean descendant-only cleanup. No product-source or timeout change is required to answer this blocker.

## In scope

Only these three work items are in scope:

1. Correct the disposable-only controller cleanup logic so termination targets are limited to the qualification root's own descendant process tree and never include ancestors such as the external `/usr/bin/timeout` wrapper.
2. Execute exactly one replacement production-shaped qualification reproduction to prove the previously demonstrated live observability still works and the controller/monitor/diagnostic descendants all terminate cleanly.
3. Produce a bounded report with one qualification result and one smallest next decision; do not implement that next decision.

## Explicit non-goals

Do not:

- modify Candidate-Builder product source;
- modify the production timeout policy;
- create timeout plan/config/env/CLI overrides;
- change package/dependency/Node/npm/node-gyp/compiler/Python/make/ar versions;
- change resolver, namespace, chroot, mounts, ownership, or `npm_config_nodedir=/runtime`;
- change production `CommandRegistry npm.ci_candidate` behavior;
- redesign the monitor or add new observability mechanisms unless required solely to preserve the already-proven 500ms live sampling behavior;
- add retries, heartbeats, daemons, background workers, resumable installs, or state machines;
- add artificial sleeps, CPU/I/O throttling, network shaping, resource starvation, or any mechanism intended to force the run beyond `300000ms`;
- run a second replacement reproduction merely because the first finishes below `300000ms`;
- run a real authority plan, real dry-run, real prepare, or `verify --authority`;
- reuse or mutate any consumed authority transaction or historical evidence;
- install/reinstall/reload/restart/stop/start OpenClaw or Console;
- change OpenClaw config or plugin sourcePath;
- access or modify DB, sessions, memory, prompts, transcripts, or agent state;
- commit, tag, or push without separate authorization.

## Disposable-only cleanup correction

Any controller/monitor correction must remain outside tracked product source and inside one fresh disposable diagnostic root.

The cleanup target set must be derived from the diagnostic process tree, not from broad command-name matching alone.

At minimum, cleanup logic must prove that:

- the controller knows the root PID(s) it spawned or owns;
- only descendants of those owned diagnostic roots are eligible for targeted termination;
- ancestor processes are excluded even when their argv contains the disposable root path or wrapper command;
- `/usr/bin/timeout` launched by the operator shell is not treated as a diagnostic descendant unless it was itself explicitly spawned by the disposable controller;
- termination remains deterministic if npm exits normally;
- cleanup evidence can distinguish `already exited` from `terminated by cleanup`.

Do not weaken cleanup by simply ignoring exit status `143`, suppressing errors, or declaring all matching processes harmless.

## Replacement qualification boundary

Use exactly one fresh disposable root outside the live runtime-authority parent.

Preserve the same production-shaped mechanisms from the previous successful observability run:

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
fresh disposable npm cache
~~~

Preserve the already-qualified live observability pattern where practical:

- monitor begins before npm;
- monitor remains referenced across the full install window;
- bounded sampling cadence approximately `500ms`;
- live process-tree / PID / PPID / state / CPU-time observations;
- timestamp-correlated npm log and better-sqlite3 artifact milestones.

The purpose of the run is cleanup qualification, not another timing distribution sample.

## Diagnostic ceiling

Use a finite diagnostic-only ceiling no greater than 15 minutes.

The ceiling is a safety/cleanup boundary only. It is not evidence of a hang and is not a candidate production timeout.

Do not deliberately slow the install.

## Qualification result

### `CLEANUP_QUALIFIED`

Use only if all of the following are proven:

1. live monitor coverage remains valid from before npm starts through npm exit or diagnostic stop, with representative lifecycle/native-build activity captured;
2. controller cleanup targets only owned diagnostic descendants, excludes the external ancestor `/usr/bin/timeout`, and the controller/monitor finish with a clean expected exit rather than signal `143` caused by self/ancestor targeting;
3. no diagnostic descendant remains, package/lock hashes are unchanged, tracked product/source files remain unchanged, and live runtime/config/services/DB/session/memory/historical authority evidence remain untouched.

The run does not need to exceed `300000ms`.

If it naturally exceeds `300000ms`, preserve direct post-boundary evidence but do not classify or modify the production timeout in this stage.

### `CLEANUP_NOT_QUALIFIED`

Use if any of the following occurs:

- an ancestor or unrelated process remains in the cleanup target set;
- controller/monitor still exits due to incorrect PID scoping;
- cleanup relies only on broad name/path matching and cannot prove descendant ownership;
- a relevant diagnostic descendant remains;
- cleanup cannot distinguish owned descendants from unrelated processes;
- the cleanup correction materially breaks the previously proven install-window observability;
- another qualification criterion cannot be proven.

## Pass criteria

This stage passes only if all three criteria are satisfied:

1. The cleanup correction is disposable-only and does not modify tracked product source, timeout policy, runtime/config/services, DB/session/memory, or historical authority evidence.
2. Exactly one replacement qualification reproduction proves `CLEANUP_QUALIFIED`, including clean expected controller/monitor termination and no remaining diagnostic descendants.
3. The report identifies exactly one bounded next decision without implementing it.

If criterion 2 is not satisfied, GPT outcome is `INSUFFICIENT_EVIDENCE` unless a stop condition requires `STOPPED`.

## Stop conditions

Stop immediately if:

- tracked product source or production timeout values must change to make cleanup work;
- any live runtime/config/service/DB/session/memory mutation is proposed or observed;
- any consumed historical authority evidence would be reused or modified;
- cleanup proposes signaling an ancestor or unrelated host process;
- cleanup cannot determine descendant ownership safely;
- artificial delay/resource manipulation is proposed;
- a second replacement qualification reproduction is proposed;
- a second unrelated subsystem enters scope;
- the diagnostic ceiling is reached; stop and preserve evidence, without calling the ceiling itself a hang.

## Allowed mutations

Allowed only after separate Sol execution authorization:

- one fresh disposable diagnostic root;
- disposable-only controller/monitor files inside that root;
- bounded disposable logs/process/artifact evidence;
- a diagnostic report file only if explicitly requested.

Not allowed:

- tracked product/source changes;
- runtime-authority transaction state;
- live OpenClaw installation/config/services;
- DB/session/memory data;
- historical evidence rewriting.

## Required Codex report

Codex must report:

- exact repository HEAD and clean/dirty status before and after;
- exact disposable root;
- cleanup PID-scoping rule and how descendant ownership is established;
- ancestor exclusion evidence, including the external `/usr/bin/timeout` wrapper;
- controller PID, monitor PID, owned diagnostic root PID(s), and representative descendant PIDs;
- monitor start / npm start / npm end / monitor end timestamps;
- diagnostic ceiling and sampling cadence;
- representative retained live observability evidence;
- final npm outcome;
- controller final exit status;
- monitor final exit status;
- which diagnostic PIDs exited naturally versus were explicitly terminated by cleanup;
- final descendant cleanup scan;
- whether the run naturally crossed `300000ms`;
- if crossed, direct post-300s evidence only;
- package.json/package-lock.json hash integrity;
- tracked changed files;
- runtime/config/service/DB/session/memory mutation status;
- historical evidence mutation status;
- replacement reproduction count;
- qualification classification: `CLEANUP_QUALIFIED` or `CLEANUP_NOT_QUALIFIED`;
- exactly one smallest recommended next decision;
- commit hash only if separately authorized.

## Stage outcome vocabulary

GPT must issue only one of:

~~~text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
~~~

Interpretation:

- `PASS`: cleanup PID scoping is directly qualified and no material side finding remains;
- `PASS_WITH_FINDINGS`: cleanup PID scoping is qualified with a bounded non-blocking finding;
- `INSUFFICIENT_EVIDENCE`: cleanup is not qualified or evidence cannot prove descendant-only deterministic cleanup;
- `STOPPED`: a safety, scope, or cleanup stop condition prevents valid qualification.

## Authorization boundary after this card

Committing or freezing this Stage Card does not authorize the replacement qualification reproduction.

A later explicit Sol authorization may permit exactly one replacement qualification reproduction under this card. It does not authorize product-source changes, timeout changes, real plan/dry-run/prepare/verify, install/reload, commit, tag, or push.

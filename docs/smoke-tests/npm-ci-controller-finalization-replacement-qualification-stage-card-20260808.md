# npm-ci Controller Finalization Replacement Qualification Stage Card — 2026-08-08

> Status: `FROZEN` — execution requires separate Sol authorization
>
> Repository HEAD before this card: `0634b8c6705eec2ec00970a73931a5d8882e1e17`
>
> Product-source baseline: `97454ee70f47f8fd4421806f4a10100b78e27186`
>
> This Stage Card authorizes no execution by itself. Replacement qualification execution requires separate Sol authorization.

## Stage decision

Can the disposable qualification controller correct only its post-cleanup finalization/report-persistence path so that the already-proven live observability and descendant-only cleanup evidence are durably recorded before summary/report processing, and the controller exits cleanly without changing production behavior?

This stage qualifies controller finalization only. It does not reopen PID-scoping design, live-observability design, the production timeout decision, or real authority publication.

## Triggering current facts

The prior cleanup PID-scoping replacement qualification closed `INSUFFICIENT_EVIDENCE` / `CLEANUP_NOT_QUALIFIED` after exactly one authorized replacement reproduction.

That run established the following direct evidence:

~~~text
source_head=0634b8c6705eec2ec00970a73931a5d8882e1e17
product_source_baseline=97454ee70f47f8fd4421806f4a10100b78e27186
replacement_reproduction_count=1
final_npm_result=exit 0
monitor_final_exit_status=0
controller_final_exit_status=2
naturally_crossed_300000ms=false
tracked_changed_files=none
runtime/config/service/DB/session/memory/historical-evidence mutation=false
~~~

The already-proven live observability remained valid during the install window:

- monitor began before npm;
- approximately `500ms` sampling produced repeated live snapshots;
- the observed chain included `unshare -> sandbox-child -> npm -> prebuild-install -> node-gyp -> make -> compiler`;
- compiler CPU/state progression and timestamp-correlated `better-sqlite3` artifacts were captured;
- npm completed successfully.

The cleanup PID-scoping blocker itself was also materially resolved:

- the external operator-launched `/usr/bin/timeout` ancestor was explicitly identified and excluded from the cleanup target set;
- cleanup targeting was based on controller-owned diagnostic process-tree relationships rather than broad command/path matching alone;
- final descendant scans showed no remaining known diagnostic PIDs and no root-matching non-check processes.

The remaining failure occurred after cleanup:

- controller finalization attempted `npmDebugSummary` with an undefined log path;
- controller exited `2` after cleanup rather than a clean expected status;
- per-PID cleanup signal outcomes were not fully persisted before the controller failure.

Therefore the unresolved blocker is finalization/report persistence, not PID ownership, observability, npm lifecycle behavior, or production timeout selection.

The production timeout remains unchanged:

~~~text
npm.ci_candidate inner=300000ms
npm.ci_candidate outer=330000ms
~~~

## Classification

`blocker`

The diagnostic harness should not be treated as fully qualified until cleanup evidence is durably persisted before any fallible post-cleanup summary/report step and the controller can complete with a clean expected exit.

## In scope

Only these three work items are in scope:

1. Correct disposable-only controller finalization so required cleanup outcomes are persisted before `npmDebugSummary` or any other fallible post-cleanup reporting step, and missing/undefined npm debug-log paths are handled deterministically without corrupting the cleanup result.
2. Execute exactly one replacement production-shaped qualification reproduction to prove the previously established observability and descendant-only cleanup remain intact while controller/monitor finalization completes cleanly and per-PID cleanup outcomes are durably reported.
3. Produce one bounded qualification report with one result and one smallest next decision; do not implement the next decision.

## Explicit non-goals

Do not:

- modify Candidate-Builder product source;
- modify the production timeout policy;
- reopen or redesign cleanup PID ownership unless new direct evidence proves the already-qualified descendant-only rule is wrong;
- redesign live observability or sampling unless required solely to preserve the already-proven approximately `500ms` monitor behavior;
- create timeout plan/config/env/CLI overrides;
- change package/dependency/Node/npm/node-gyp/compiler/Python/make/ar versions;
- change resolver, namespace, chroot, mounts, ownership, or `npm_config_nodedir=/runtime`;
- change production `CommandRegistry npm.ci_candidate` behavior;
- add retries, heartbeats, daemons, background workers, resumable installs, or state machines;
- add artificial sleeps, CPU/I/O throttling, network shaping, resource starvation, or any mechanism intended to force the run beyond `300000ms`;
- run a second replacement reproduction merely because the first finishes below `300000ms`;
- run a real authority plan, real dry-run, real prepare, or `verify --authority`;
- reuse or mutate consumed authority transactions or historical evidence;
- install/reinstall/reload/restart/stop/start OpenClaw or Console;
- change OpenClaw config or plugin sourcePath;
- access or modify DB, sessions, memory, prompts, transcripts, or agent state;
- commit, tag, or push without separate authorization.

## Disposable-only finalization correction

Any controller/monitor correction must remain outside tracked product source and inside one fresh disposable diagnostic root.

The controller finalization sequence must preserve a fail-closed but evidence-safe ordering.

At minimum it must establish this ordering:

1. npm/diagnostic execution reaches a terminal state;
2. monitor is stopped deterministically;
3. owned descendant cleanup is performed using the already-established descendant-only ownership rule;
4. per-PID cleanup outcomes are durably persisted, distinguishing at least:
   - exited naturally before cleanup;
   - explicitly signaled by cleanup;
   - already absent when cleanup evaluated;
   - signal attempted but failed, if any;
5. final descendant scan is durably persisted;
6. only after required cleanup evidence is durable may optional npm debug-log summary/report enrichment execute;
7. a missing, undefined, unreadable, or absent npm debug-log path must not erase or invalidate already-persisted cleanup evidence;
8. controller final exit status must accurately reflect the qualification result without masking a true cleanup failure.

Do not weaken evidence by merely swallowing all finalization errors or always forcing exit `0`.

If an optional summary step fails after required cleanup evidence is safely persisted, record that bounded reporting finding explicitly. Do not rewrite a failed cleanup as successful.

## Replacement qualification boundary

Use exactly one fresh disposable root outside the live runtime-authority parent.

Preserve the same production-shaped mechanisms already used successfully:

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

Preserve the already-proven cleanup and observability behavior:

- monitor begins before npm;
- monitor remains referenced across the full install window;
- bounded sampling cadence approximately `500ms`;
- live process-tree / PID / PPID / state / CPU-time observations;
- cleanup target set is derived from controller-owned diagnostic descendants;
- external ancestor `/usr/bin/timeout` is excluded;
- final descendant scan proves no diagnostic descendants remain;
- timestamp-correlated npm log and `better-sqlite3` artifact milestones are retained where available.

The purpose of this run is controller finalization qualification, not another timing distribution sample.

## Diagnostic ceiling

Use a finite diagnostic-only ceiling no greater than 15 minutes.

The ceiling is a safety/cleanup boundary only. It is not evidence of a hang and is not a candidate production timeout.

Do not deliberately slow the install.

## Qualification result

### `FINALIZATION_QUALIFIED`

Use only if all of the following are directly proven:

1. previously established live monitor coverage remains valid from before npm starts through npm exit or diagnostic stop, with representative lifecycle/native-build activity retained;
2. previously established descendant-only cleanup remains valid, the external ancestor `/usr/bin/timeout` is excluded, and no relevant diagnostic descendant remains;
3. per-PID cleanup outcomes and final descendant scan are durably persisted before optional/fallible summary enrichment;
4. the persisted report distinguishes natural exit, already absent, explicit cleanup termination, and signal failure where applicable rather than collapsing all outcomes into one bucket;
5. missing/undefined/unreadable npm debug-log state is handled deterministically and cannot destroy already-persisted mandatory cleanup evidence;
6. controller and monitor both finish with expected clean exit status `0`; an optional post-persistence report-enrichment failure may be recorded as a bounded finding only if it is handled without changing either process to a non-zero exit and without compromising required evidence;
7. package/lock hashes remain unchanged, tracked product/source files remain unchanged, and live runtime/config/services/DB/session/memory/historical authority evidence remain untouched.

The run does not need to exceed `300000ms`.

If it naturally exceeds `300000ms`, preserve direct post-boundary evidence but do not classify or modify the production timeout in this stage.

### `FINALIZATION_NOT_QUALIFIED`

Use if any of the following occurs:

- mandatory cleanup outcomes are still not persisted before a fallible summary/report step;
- a finalization exception can erase, truncate, or make unavailable required cleanup evidence;
- controller exits non-cleanly because of the same or another post-cleanup finalization defect;
- per-PID cleanup outcomes remain materially incomplete or ambiguous;
- descendant-only cleanup or live observability is materially regressed;
- an ancestor/unrelated process enters the cleanup target set;
- a relevant diagnostic descendant remains;
- another qualification criterion cannot be proven.

## Pass criteria

This stage passes only if all three criteria are satisfied:

1. The finalization correction is disposable-only and does not modify tracked product source, timeout policy, runtime/config/services, DB/session/memory, or historical authority evidence.
2. Exactly one replacement qualification reproduction proves `FINALIZATION_QUALIFIED`, including durable cleanup evidence before optional summary processing and clean controller/monitor completion.
3. The report identifies exactly one bounded next decision without implementing it.

If criterion 2 is not satisfied, GPT outcome is `INSUFFICIENT_EVIDENCE` unless a stop condition requires `STOPPED`.

## Stop conditions

Stop immediately if:

- tracked product source or production timeout values must change to make finalization work;
- any live runtime/config/service/DB/session/memory mutation is proposed or observed;
- any consumed historical authority evidence would be reused or modified;
- finalization proposes signaling an ancestor or unrelated host process;
- descendant ownership can no longer be determined safely;
- the correction proposes forcing exit `0` without proving mandatory evidence persistence;
- artificial delay/resource manipulation is proposed;
- a second replacement qualification reproduction is proposed;
- a second unrelated subsystem enters scope;
- the diagnostic ceiling is reached; stop and preserve evidence, without calling the ceiling itself a hang.

## Allowed mutations

Allowed only after separate Sol execution authorization:

- one fresh disposable diagnostic root;
- disposable-only controller/monitor/finalization files inside that root;
- bounded disposable logs/process/artifact/evidence files;
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
- finalization ordering and persistence rule;
- mandatory cleanup evidence file/path and when it was persisted relative to optional summary processing;
- controller PID, monitor PID, owned diagnostic root PID(s), representative descendant PIDs, and external `/usr/bin/timeout` ancestor PID;
- explicit ancestor-exclusion evidence;
- cleanup target PID list;
- per-PID cleanup outcomes, distinguishing natural exit / already absent / explicitly terminated / signal failed where applicable;
- final descendant cleanup scan;
- monitor start / npm start / npm end / monitor end timestamps;
- diagnostic ceiling and sampling cadence;
- representative retained live observability evidence;
- npm debug-log path state and how missing/undefined/unreadable cases were handled;
- final npm outcome;
- controller final exit status;
- monitor final exit status;
- whether the run naturally crossed `300000ms`;
- if crossed, direct post-300s evidence only;
- package.json/package-lock.json hash integrity;
- tracked changed files;
- runtime/config/service/DB/session/memory mutation status;
- historical evidence mutation status;
- replacement reproduction count;
- qualification classification: `FINALIZATION_QUALIFIED` or `FINALIZATION_NOT_QUALIFIED`;
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

- `PASS`: controller finalization/report persistence is directly qualified and no material side finding remains;
- `PASS_WITH_FINDINGS`: finalization is qualified with a bounded non-blocking finding that does not compromise mandatory cleanup evidence, controller/monitor exit `0`, or clean deterministic completion;
- `INSUFFICIENT_EVIDENCE`: finalization is not qualified or evidence cannot prove durable mandatory cleanup reporting and deterministic completion;
- `STOPPED`: a safety, scope, or cleanup stop condition prevents valid qualification.

## Authorization boundary after this card

Committing or freezing this Stage Card does not authorize the replacement qualification reproduction.

A later explicit Sol authorization may permit exactly one finalization-only replacement qualification reproduction under this card. It does not authorize product-source changes, timeout changes, real plan/dry-run/prepare/verify, install/reload, commit, tag, or push.

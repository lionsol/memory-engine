# npm-ci Live Observability Qualification Stage Card — 2026-08-08

> Status: `FROZEN` — execution requires separate Sol authorization
>
> Repository HEAD before this card: `817326bb8d99bb3a6c85853511630ae07beb547f`
>
> Product-source baseline: `97454ee70f47f8fd4421806f4a10100b78e27186`
>
> This Stage Card authorizes no execution by itself. Diagnostic execution requires separate Sol authorization.

## Stage decision

Can a corrected disposable diagnostic harness reliably observe the live `npm.ci_candidate` lifecycle/native-build path from before npm starts until cleanup, without changing the production install path, so that a future naturally slow run can distinguish meaningful forward progress from a stall?

This stage qualifies the observability method. It does not change the production timeout and does not require a run to exceed 300,000ms.

## Triggering current facts

The previous frozen timeout-diagnosis stage closed `INSUFFICIENT_EVIDENCE`.

Its valid second disposable reproduction used the production-shaped `npm.ci_candidate` path and completed successfully in approximately `149923ms`, including successful `npm ls`, `better-sqlite3` smoke, and LanceDB smoke.

However, the required live process observability was not valid during the install window:

- the initial monitor exited after its first snapshot because of disposable-harness `unref()` behavior;
- the corrected monitor started only after npm had already completed;
- node-gyp/make/compiler activity was therefore inferred from generated artifacts rather than directly observed live;
- no direct evidence existed after the 300,000ms boundary because that reproduction completed before the boundary.

The real consumed prepare remains separate immutable evidence: it reached the committed `300000ms` inner watchdog and failed with `spawnSync /usr/sbin/chroot ETIMEDOUT` during `npm.ci_candidate`.

The difference between the real >300s failure and the disposable ~150s success remains unexplained.

## Classification

`blocker`

The timeout question should not be reopened until the diagnostic method itself can prove that it observes live lifecycle/native-build activity correctly.

## In scope

Only these three work items are in scope:

1. Correct the disposable-only monitor/controller behavior so observation starts before `npm.ci_candidate`, remains alive for the entire install window, and terminates deterministically after cleanup.
2. Run one production-shaped disposable qualification reproduction to prove that the monitor captures real lifecycle/native-build process transitions and artifact progress while npm is actually running.
3. Produce a bounded qualification report and identify the smallest next decision. If the reproduction naturally exceeds 300,000ms, preserve direct post-300s evidence; if it finishes earlier, do not manufacture or infer post-300s behavior.

## Explicit non-goals

Do not:

- modify Candidate-Builder product source;
- modify the production timeout policy (`300000ms` inner / `330000ms` outer);
- create timeout plan/config/env/CLI overrides;
- add retries, resumable installs, heartbeats, daemons, background workers, or state machines;
- add artificial sleeps, CPU throttling, I/O throttling, network shaping, resource starvation, or other mechanisms intended to force the install across 300,000ms;
- change `package.json`, `package-lock.json`, dependency versions, Node, npm, node-gyp, compiler, Python, make, ar, resolver, namespace, chroot, mounts, ownership, or `npm_config_nodedir=/runtime`;
- run a real plan, real dry-run, real prepare, or `verify --authority`;
- reuse or mutate any consumed historical authority run;
- install/reinstall/reload/restart/stop/start OpenClaw or Console services;
- change OpenClaw config, plugin sourcePath, DB, sessions, memory, prompts, transcripts, or agent state;
- commit, tag, or push without separate authorization.

## Qualification reproduction boundary

Use one fresh disposable root outside the live runtime-authority parent.

The reproduction must preserve the same production-shaped mechanisms required by the previous diagnosis card where relevant:

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

Disposable diagnostic monitor/controller code may be created outside tracked product source for this stage. It must not alter the production command descriptor or product timeout constants.

## Diagnostic ceiling

Use a finite diagnostic-only ceiling no greater than 15 minutes.

The ceiling is a cleanup/safety boundary only. It is never proof of `STALL_OR_HANG` by itself.

Do not deliberately slow the install to reach the ceiling or the 300,000ms production boundary.

## Required live observability

The qualification run must prove, with timestamps, that monitoring begins before npm starts and remains active until npm exits or the diagnostic ceiling is reached.

Capture at minimum:

- monitor start timestamp;
- npm-ci start/end timestamps;
- monitor end timestamp;
- repeated bounded process-tree snapshots during the npm install window;
- visible lifecycle descendant executable/argv categories where available;
- live observation of `prebuild-install` and/or the fallback lifecycle command when visible;
- live observation of node-gyp when it runs, or a direct bounded explanation if process sampling misses a short-lived child;
- live observation of make/compiler descendants when they run, or direct timestamp-correlated artifact evidence for short-lived children;
- CPU-time, process-state, PID/PPID turnover, or equivalent bounded indicators sufficient to distinguish activity from a static wait;
- timestamped better-sqlite3 build-artifact milestones correlated with the live process window;
- npm debug-log phase/timestamp summary;
- final npm outcome;
- descendant cleanup proof.

The monitor itself must not depend on a detached/unreferenced event loop that can exit before the observed process completes.

Do not dump arbitrary environment variables or secrets.

## Qualification result

### `OBSERVABILITY_QUALIFIED`

The diagnostic method is qualified only if all of the following are proven:

1. monitoring starts before npm and stays active across the full npm install window;
2. repeated live snapshots or equivalent bounded telemetry capture actual lifecycle/native-build activity while npm is running, with timestamps correlated to npm/artifact phases;
3. monitor and all disposable descendants terminate cleanly, package/lock hashes remain unchanged, and no tracked product/source file is modified.

The install does not need to exceed 300,000ms for this result.

If the same run naturally exceeds 300,000ms, separately report whether direct evidence after that boundary shows meaningful progress, a concrete stall, or remains ambiguous. Do not convert that observation into a production timeout change in this stage.

### `OBSERVABILITY_NOT_QUALIFIED`

Use this classification if the monitor exits early, starts too late, misses the install window in a way that prevents activity/stall interpretation, materially perturbs the production-shaped path, cannot prove cleanup, or otherwise fails the three qualification criteria.

## Pass criteria

This stage passes only if all three criteria are satisfied:

1. The disposable-only observability correction does not modify tracked product source, production timeout policy, live runtime/config/services, DB/session/memory state, or historical authority evidence.
2. One production-shaped qualification reproduction proves `OBSERVABILITY_QUALIFIED` using live install-window evidence and clean descendant cleanup.
3. The report identifies exactly one bounded next decision without implementing it.

If criterion 2 is not satisfied, the GPT stage outcome is `INSUFFICIENT_EVIDENCE` unless a stop condition requires `STOPPED`.

## Stop conditions

Stop immediately if:

- any live runtime/config/service/DB/session/memory mutation is proposed or observed;
- any consumed historical authority evidence would be reused or modified;
- product source or production timeout values must be changed to make observability work;
- the reproduction requires artificial delay/resource manipulation to cross 300,000ms;
- a second unrelated subsystem enters scope;
- a second qualification reproduction is proposed merely because the first finishes below 300,000ms;
- cleanup cannot prove termination of diagnostic descendants;
- the diagnostic ceiling is reached; stop the run, preserve evidence, and do not call the ceiling itself a hang.

## Allowed mutations

Allowed only when separately authorized for execution:

- one fresh disposable diagnostic root outside live authority state;
- disposable-only monitor/controller files and bounded diagnostic logs/artifacts inside that root;
- a diagnostic report file if explicitly requested.

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
- monitor/controller description;
- monitor start / npm start / npm end / monitor end timestamps;
- diagnostic ceiling;
- exact production-shaped mechanisms/toolchain reused;
- process sampling cadence or milestone policy;
- representative live process-tree evidence during npm;
- lifecycle/prebuild/node-gyp/make/compiler observations;
- timestamped artifact progression;
- npm debug phase/timestamp summary;
- whether the run naturally crossed 300,000ms;
- if crossed, direct post-300s progress/stall/ambiguity evidence;
- final npm outcome;
- package/lock hash integrity;
- descendant cleanup result;
- live runtime/config/service mutation status;
- historical evidence mutation status;
- tracked changed files;
- qualification classification: `OBSERVABILITY_QUALIFIED` or `OBSERVABILITY_NOT_QUALIFIED`;
- one smallest recommended next decision;
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

- `PASS`: observability is directly qualified and no material side finding remains;
- `PASS_WITH_FINDINGS`: observability is directly qualified with a bounded non-blocking finding;
- `INSUFFICIENT_EVIDENCE`: observability was not qualified or the evidence cannot establish that the monitor is reliable enough for the next timeout diagnosis;
- `STOPPED`: a safety, scope, or cleanup stop condition prevents valid qualification.

## Authorization boundary after this card

Committing or freezing this Stage Card does not authorize Codex to execute the qualification reproduction.

A later explicit Sol authorization may permit one qualification reproduction under this card only. It does not authorize a product source fix, production timeout change, real plan/dry-run/prepare/verify, install/reload, commit, tag, or push.

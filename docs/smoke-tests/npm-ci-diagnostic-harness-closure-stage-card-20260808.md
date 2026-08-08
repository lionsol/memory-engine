# npm-ci Diagnostic Harness Closure Stage Card — 2026-08-08

> Status: `FROZEN` — execution requires separate Sol authorization
>
> Repository HEAD before this card: `5b79d191083dbbf58c2dc311c1db0730fc59694b`
>
> Product-source baseline: `97454ee70f47f8fd4421806f4a10100b78e27186`
>
> This Stage Card authorizes no execution by itself. Closure qualification execution requires separate Sol authorization.

## Stage decision

Can the disposable `npm.ci_candidate` diagnostic harness be closed as fit for future timeout diagnosis by correcting the remaining final-scan authority defect, preserving the already-proven observability/cleanup/finalization guarantees, and passing one final production-shaped qualification reproduction without modifying product behavior?

This is the final diagnostic-harness closure stage. It does not decide the production timeout and it must not be split into additional micro-stages for non-safety cosmetic/reporting defects.

## Anti-drift reason for this closure stage

The preceding diagnostic work established the major harness capabilities incrementally, but verification work began to exceed the original product question and produced repeated harness-only micro-stages.

The current evidence already proves:

- live install-window observability works across `npm.ci_candidate`;
- descendant-tree ownership can distinguish owned diagnostic descendants from the external `/usr/bin/timeout` ancestor;
- mandatory cleanup evidence can be persisted before optional report enrichment;
- optional npm debug-summary handling can complete without losing mandatory evidence;
- monitor exit `0` has been demonstrated;
- final owned-descendant scans have shown no owned diagnostic descendants remaining;
- tracked product source, production timeout, runtime/config/services, DB/session/memory, and historical authority evidence remained untouched.

The last finalization-only replacement reproduction still ended `FINALIZATION_NOT_QUALIFIED` because the final verification scan treated an outer shell ancestor matching the disposable-root text as a blocking non-owned process and therefore forced controller exit `1`, despite:

~~~text
owned_alive=[]
post_run_known_pid_scan=none
mandatory evidence persisted before optional reporting
monitor exit=0
npm exit=0
~~~

Therefore the remaining defect is the final verification scan's authority boundary, not descendant cleanup itself.

## Classification

`blocker`

The harness must not be used for another timeout-diagnosis run until its final verification uses owned-descendant/process-tree authority consistently and the entire qualification finishes deterministically.

## In scope

Only these three work items are in scope:

1. Correct the disposable-only final verification scan so owned diagnostic descendant/process-tree authority is the blocking criterion; ancestor or unrelated path/argv matches may be recorded as non-owned observations but cannot independently fail closure.
2. Execute exactly one final production-shaped harness-closure qualification reproduction preserving the already-proven observability, cleanup ownership, mandatory-evidence persistence, and finalization behavior.
3. Produce one closure report with one harness result and one smallest next product decision; do not implement that next decision.

## Explicit non-goals

Do not:

- modify Candidate-Builder product source;
- modify the production timeout policy;
- select or calculate a new production timeout;
- create timeout plan/config/env/CLI overrides;
- change package/dependency/Node/npm/node-gyp/compiler/Python/make/ar versions;
- change resolver, namespace, chroot, mounts, ownership, or `npm_config_nodedir=/runtime`;
- change production `CommandRegistry npm.ci_candidate` behavior;
- redesign the live monitor, descendant ownership model, or mandatory evidence model beyond what is strictly required to preserve their already-proven behavior;
- add retries, heartbeats, daemons, background workers, resumable installs, or state machines;
- add artificial sleeps, CPU/I/O throttling, network shaping, resource starvation, or any mechanism intended to force the run beyond `300000ms`;
- execute more than one closure qualification reproduction;
- run a real authority plan, real dry-run, real prepare, or `verify --authority`;
- reuse or mutate any consumed authority transaction or historical evidence;
- install/reinstall/reload/restart/stop/start OpenClaw or Console;
- change OpenClaw config or plugin sourcePath;
- access or modify DB, sessions, memory, prompts, transcripts, or agent state;
- commit, tag, or push without separate authorization.

## Disposable-only correction boundary

All correction code must remain outside tracked product source and inside one fresh disposable diagnostic root.

The final verification authority must be based on owned process-tree membership.

At minimum:

- record controller, monitor, and owned diagnostic root PIDs;
- derive owned descendants from explicit spawn ownership plus PID/PPID/process-tree relationships;
- blocking `alive` results apply only to owned diagnostic descendants;
- ancestors are never owned merely because their argv contains the disposable root or wrapper command;
- unrelated host processes are never owned merely because their argv/path/name matches a diagnostic string;
- the external `/usr/bin/timeout` wrapper remains explicitly excluded unless it was itself spawned by the controller;
- the outer operator shell remains explicitly non-owned;
- broad root/path/argv matching may be retained only as secondary forensic telemetry and must be labeled `non_owned_observation`, not treated as cleanup authority;
- any actual owned descendant remaining alive is still a hard failure.

Do not weaken cleanup or closure by ignoring a true owned descendant, suppressing a signal failure, or forcing controller exit `0` after a mandatory failure.

## Hard closure requirements

These requirements are mandatory. Failure of any one means the harness is not closed:

1. **Live observability**
   - monitor starts before npm;
   - remains active across the complete install window;
   - captures representative lifecycle/native-build activity with bounded process/state/CPU/artifact/log evidence.

2. **Owned-descendant authority**
   - cleanup and final verification use owned descendant/process-tree authority;
   - external `/usr/bin/timeout`, outer shell ancestors, and unrelated host processes are excluded from the owned target set;
   - actual owned descendants cannot be hidden by the exclusion logic.

3. **Mandatory evidence persistence**
   - cleanup targets and per-PID outcomes are persisted before optional reporting;
   - outcomes distinguish as applicable `exited_naturally`, `already_absent`, `terminated_by_cleanup`, and `signal_failed`;
   - optional report enrichment cannot erase or invalidate mandatory evidence.

4. **Deterministic finalization**
   - controller exit status is `0` only when all mandatory requirements pass;
   - monitor exit status is `0`;
   - no owned diagnostic descendant remains after cleanup;
   - package/lock hashes and tracked repository state remain unchanged.

5. **Safety boundary**
   - live runtime/config/services, DB/session/memory, and historical authority evidence remain untouched;
   - no ancestor or unrelated host process is signaled by cleanup.

## Non-blocking findings after hard closure

Once every hard closure requirement above is proven, a defect may be recorded as `PASS_WITH_FINDINGS` instead of creating another micro-stage only when all of the following are true:

- it is optional reporting, formatting, cosmetic telemetry, or other non-safety enrichment;
- mandatory evidence is complete and durable;
- controller and monitor both exit `0`;
- no owned diagnostic descendant remains;
- descendant ownership/ancestor exclusion remains correct;
- live observability remains valid;
- it does not affect the ability of a future timeout diagnosis to distinguish meaningful process progress from static waiting.

Examples may include an unavailable optional debug-summary field or cosmetic report formatting. This rule must not be used to downgrade a hard closure failure into a finding.

## Closure reproduction boundary

Use exactly one fresh disposable root outside the live runtime-authority parent.

Preserve the production-shaped mechanisms already used by the qualified path:

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

Preserve the established observability/finalization pattern:

- monitor starts before npm and remains referenced;
- bounded sampling cadence approximately `500ms`;
- PID/PPID/state/CPU-time/process-turnover evidence;
- prebuild-install/node-gyp/make/compiler evidence when present;
- timestamp-correlated better-sqlite3 artifact milestones;
- mandatory cleanup evidence persisted before optional report enrichment;
- final owned-descendant scan after cleanup.

The run is for harness closure, not another timing distribution sample.

## Diagnostic ceiling

Use a finite diagnostic-only ceiling no greater than 15 minutes.

The ceiling is a safety/cleanup boundary only. It is not evidence of a hang and is not a candidate production timeout.

Do not deliberately slow the install.

## Closure result

### `HARNESS_CLOSED`

Use only if all hard closure requirements are directly proven in the one authorized reproduction, including:

- valid live observability;
- descendant-only cleanup and final verification authority;
- explicit exclusion of external timeout and shell ancestors;
- complete mandatory per-PID cleanup evidence persisted before optional reporting;
- controller exit `0`;
- monitor exit `0`;
- no owned diagnostic descendants remaining;
- package/lock hashes unchanged;
- tracked source unchanged;
- runtime/config/services/DB/session/memory/history untouched.

The run does not need to exceed `300000ms`.

If it naturally exceeds `300000ms`, preserve direct post-boundary evidence as a side observation only. Do not select or modify a production timeout in this stage.

### `HARNESS_NOT_CLOSED`

Use if any hard closure requirement cannot be proven or regresses, including:

- an actual owned descendant remains;
- descendant ownership cannot be established safely;
- an ancestor/unrelated process enters the cleanup target set;
- controller or monitor exits non-zero because of a mandatory closure failure;
- mandatory evidence is missing/incomplete;
- live observability materially regresses;
- tracked source or live runtime state changes.

A non-owned root/path/argv match alone is not a hard failure when ownership evidence proves the process is an ancestor or unrelated host process and it is not signaled.

## Pass criteria

This stage passes only if all three criteria are satisfied:

1. The final-scan correction is disposable-only and preserves all already-proven observability, cleanup, evidence-persistence, and safety boundaries.
2. Exactly one closure qualification reproduction proves `HARNESS_CLOSED` and deterministic clean completion.
3. The report explicitly closes the diagnostic harness and names exactly one next product-level decision without implementing it.

If criterion 2 is not satisfied, GPT outcome is `INSUFFICIENT_EVIDENCE` unless a stop condition requires `STOPPED`.

## Stop conditions

Stop immediately if:

- tracked product source or production timeout values must change to close the harness;
- any live runtime/config/service/DB/session/memory mutation is proposed or observed;
- any consumed historical authority evidence would be reused or modified;
- cleanup proposes signaling an ancestor or unrelated host process;
- owned descendant authority cannot be established safely;
- a true owned descendant is proposed to be ignored merely to obtain exit `0`;
- artificial delay/resource manipulation is proposed;
- a second closure qualification reproduction is proposed;
- a second unrelated subsystem enters scope;
- the diagnostic ceiling is reached; stop and preserve evidence without calling the ceiling itself a hang.

## Allowed mutations

Allowed only after separate Sol execution authorization:

- one fresh disposable diagnostic root;
- disposable-only controller/monitor/final-scan files inside that root;
- bounded disposable logs/process/artifact evidence;
- one diagnostic report file if explicitly requested.

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
- closure correction description;
- controller PID and monitor PID;
- owned diagnostic root PID(s);
- external timeout ancestor PID and outer shell ancestor PID where visible;
- owned-descendant derivation rule;
- blocking cleanup/final-scan authority rule;
- secondary non-owned root/path/argv observations, if any;
- cleanup target PID list;
- persisted per-PID cleanup outcomes;
- mandatory evidence path and persistence timestamp;
- monitor start / npm start / npm end / monitor end timestamps;
- diagnostic ceiling and sampling cadence;
- representative retained live observability evidence;
- optional reporting result/findings;
- final npm outcome;
- controller final exit status;
- monitor final exit status;
- final owned-descendant scan;
- whether any ancestor/unrelated host process was signaled;
- whether the run naturally crossed `300000ms`;
- if crossed, direct post-300s evidence only;
- package.json/package-lock.json hash integrity;
- tracked changed files;
- runtime/config/service/DB/session/memory mutation status;
- historical evidence mutation status;
- closure reproduction count;
- closure classification: `HARNESS_CLOSED` or `HARNESS_NOT_CLOSED`;
- bounded non-blocking findings, if any;
- exactly one smallest next product-level decision;
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

- `PASS`: harness is directly proven `HARNESS_CLOSED` with no material non-blocking finding;
- `PASS_WITH_FINDINGS`: harness is directly proven `HARNESS_CLOSED`, while one or more bounded non-blocking findings satisfy the explicit non-blocking rule above;
- `INSUFFICIENT_EVIDENCE`: harness closure is not proven or a hard closure requirement fails without triggering a safety/scope stop;
- `STOPPED`: a safety, scope, ownership, or cleanup stop condition prevents valid closure qualification.

## Anti-micro-stage closure rule

After this stage executes, do not automatically create another harness-only micro-stage.

If the harness is `HARNESS_CLOSED`, close harness qualification and return to a separately authorized product-level timeout-diagnosis decision.

If the harness is `HARNESS_NOT_CLOSED`, record the failure and stop. Any further harness work requires an explicit fresh anti-drift review by Sol/GPT; it is not the automatic continuation of this stage.

## Authorization boundary after this card

Committing or freezing this Stage Card does not authorize execution.

A later explicit Sol authorization may permit exactly one diagnostic-harness closure reproduction under this card. It does not authorize product-source changes, timeout changes, real plan/dry-run/prepare/verify, install/reload, commit, tag, or push.

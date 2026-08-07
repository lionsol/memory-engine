# npm-ci Timeout Resolution Stage Card — 2026-08-07

> Status: `READY_FOR_AUTHORIZATION`
>
> Source baseline: `bd39f8d9ba3625f42d447f9edd70451533e3887a`
>
> This card authorizes nothing by itself. Codex execution, source changes, commit,
> tag, push, real-plan use, runtime installation, and service operations remain
> separately authorized.

## Stage decision

Can Candidate-Builder replace the currently shared 120-second sandbox watchdog
with a bounded, evidence-derived timeout for `npm.ci_candidate` only, while
keeping every other sandbox operation at its existing limit and preserving the
inner-before-outer failure boundary?

This stage must answer that question using successful real-lockfile timing
evidence. It must not guess a larger timeout merely because 120 seconds is known
to be too short.

## User value

A valid candidate construction must not be killed by Candidate-Builder while it
is making legitimate progress, but a stalled lifecycle must still terminate in
a deterministic, bounded, diagnosable way.

## Current facts

- Current committed source HEAD is expected to be:

~~~text
bd39f8d9ba3625f42d447f9edd70451533e3887a
~~~

- `npm.ci_candidate` now receives the committed fixed local Node-header binding:

~~~text
npm_config_nodedir=/runtime
~~~

- The ownership failure in node-gyp header extraction is proven and fixed in
  source by using the already-bound Node runtime headers.
- A production-shaped disposable real-lockfile install using that construction
  path completed successfully with:

~~~text
candidate_full_install_result=SUCCESS
candidate_full_install_duration_ms=179269
npm_ls_result=PASS
better_sqlite3_smoke=PASS
lancedb_smoke=PASS
manifest_hashes_unchanged=true
~~~

- Therefore the previous uncertainty has changed: there is now direct evidence
  that a valid real-lockfile install can require more than 120 seconds and still
  succeed.
- The current product still has two independent 120-second watchdogs:
  1. outer `SandboxRunner.run()` around the `unshare` process;
  2. inner `execFileSync(chroot ...)` in `sandbox-child.js`.
- The current product therefore remains unsuitable for another real `prepare`
  attempt until this timeout boundary is resolved.
- Capability probe remains a separate 30-second operation and is not part of
  this stage.

## Historical evidence incorporated into this stage

The earlier timeout investigation stopped `INSUFFICIENT_EVIDENCE` because its
cold install failed at the native-build boundary before successful completion
could be measured.

The subsequent native-dependency investigation removed that blocker and produced
a valid successful cold timing sample of `179269ms`.

This stage may use that committed historical sample as one valid successful
cold sample, but it must still obtain a fresh paired cold/warm timing sequence
under the current committed source before selecting a production budget.

## In scope

At most three items are in scope:

1. Obtain fresh production-shaped disposable cold-cache and warm-cache
   successful timing samples using the current committed local-header behavior.
2. Derive and implement one immutable operation-specific inner/outer timeout
   policy for `npm.ci_candidate` only.
3. Verify the selected product timeout by completing a fresh real-lockfile
   candidate install under the actual product policy, then run required focused
   and broad tests.

Anything else is out of scope unless it is proven to be a blocker for this exact
decision.

## Non-goals

Do not:

- run a real authority plan, dry-run, prepare, or verify;
- install, reload, restart, stop, or mutate OpenClaw runtime/services;
- access or modify the historical FAILED claim;
- access databases, sessions, memory, or runtime authority state;
- change `better-sqlite3`, LanceDB, Node, npm, node-gyp, or tar versions;
- alter `npm_config_nodedir=/runtime` in this stage;
- solve the npm 11 future `unknown env config nodedir` compatibility warning;
- change namespace mappings, chroot policy, resolver bindings, mount roots, or
  host environment inheritance;
- disable lifecycle scripts;
- add retries, fallback installs, network retries, heartbeat daemons, or a new
  timeout configuration surface;
- expose timeout values through plan input, CLI input, environment variables,
  OpenClaw configuration, or user-controlled data;
- increase output limits unless a new blocking evidence problem is separately
  proven;
- change the timeout of any sandbox operation other than `npm.ci_candidate`;
- change the 30-second capability probe timeout;
- commit, amend, tag, or push without separate authorization.

## Allowed temporary diagnostic behavior

Before product code is changed, Codex may use a disposable `/tmp` harness that
reuses the production `CommandRegistry`, `SandboxRunner`, namespace, chroot,
fixed environment, resolver handling, tool bindings, and current committed
`npm.ci_candidate` descriptor while replacing only the diagnostic watchdogs.

Diagnostic watchdogs must be:

- finite;
- no greater than 15 minutes for any single run;
- clearly recorded in this report;
- used only for timing evidence;
- absent from product source until the product modification gate passes.

No diagnostic timeout is itself a candidate production value.

## Required timing sequence

### 1. Fresh cold-cache sample

Create a fresh disposable root under `/tmp`.

Requirements:

- copy only the current `package.json` and `package-lock.json` into the disposable
  candidate;
- use an empty disposable npm cache;
- use the committed `npm_config_nodedir=/runtime` path through the production
  command registry;
- use Node `v24.8.0`, ABI `137`, npm `11.6.0`, and the currently bound production
  toolchain;
- record wall-clock duration in milliseconds;
- record package/lock hashes before and after;
- require `npm ci` exit 0;
- require `npm ls --all --omit=dev` exit 0;
- require `better-sqlite3` native smoke success;
- require LanceDB smoke success;
- confirm no downloaded Node-header devdir became part of candidate state;
- confirm no relevant child process remains after exit.

If this fresh cold run fails for network, native build, integrity, sandbox, or
another subsystem reason, stop `INSUFFICIENT_EVIDENCE`. Do not implement a
production timeout from the historical sample alone.

### 2. Warm-cache sample

Reuse only the npm cache created by the successful fresh cold run.

Create a fresh candidate directory with the same package/lock inputs and no
existing `node_modules`.

Run the identical `npm.ci_candidate` production-shaped path.

Requirements are the same as the cold sample, including npm ls, native smokes,
hash integrity, and process cleanup.

The warm sample is invalid if it reuses the prior candidate's `node_modules` or
any already-built package tree. It may reuse only the disposable npm cache.

If the warm run fails, stop `INSUFFICIENT_EVIDENCE` and do not select a product
timeout.

## Timing evidence set

The timeout must be derived from all valid successful evidence available to
this stage, not only the fastest fresh sample.

The minimum evidence set is:

~~~text
historical_successful_cold_ms = 179269
fresh_successful_cold_ms = measured value
fresh_successful_warm_ms = measured value
~~~

Define:

~~~text
observed_max_ms = max(
  179269,
  fresh_successful_cold_ms,
  fresh_successful_warm_ms
)
~~~

Do not discard the historical `179269ms` sample if a later run is faster.

## Product timeout selection rule

Only after both fresh samples succeed may source be changed.

Select the inner `npm.ci_candidate` budget using exactly:

~~~text
margin_ms = max(60000, observed_max_ms * 0.25)
raw_inner_ms = observed_max_ms + margin_ms
selected_inner_timeout_ms = round_up(raw_inner_ms, 30000)
~~~

Where `round_up(value, 30000)` means the smallest multiple of 30,000ms that is
not less than `value`.

The selected inner timeout must be:

- explicit and immutable in source;
- no greater than 900000ms;
- used only by `npm.ci_candidate`;
- independent of caller input;
- independent of plan/config/env values.

If the formula exceeds `900000ms`, stop `INSUFFICIENT_EVIDENCE` and do not
increase the ceiling.

## Outer timeout rule

The inner chroot watchdog must remain the first intended timeout boundary.

Use:

~~~text
selected_outer_timeout_ms = selected_inner_timeout_ms + 30000
~~~

The 30-second outer grace exists only for inner-timeout propagation, namespace
exit, cleanup, and bounded evidence reporting.

A focused regression must prove:

1. for `npm.ci_candidate`, inner timeout equals the selected evidence-derived
   value;
2. outer timeout equals inner + 30,000ms;
3. the inner boundary is therefore earlier than the outer boundary;
4. another sandbox operation still uses 120,000ms;
5. capability probe still uses 30,000ms;
6. an unknown operation remains rejected.

If focused testing proves 30 seconds is insufficient to preserve inner-first
observability, stop and report the finding. Do not silently enlarge the grace
period in this stage.

## Expected implementation boundary

Codex must inspect impact before editing. The preferred shape is a closed,
immutable timeout policy keyed only by registered sandbox operation ID.

Expected semantic policy:

~~~text
capability-probe:
  outer = 30000ms

npm.ci_candidate:
  inner = selected_inner_timeout_ms
  outer = selected_outer_timeout_ms

all other registered sandbox operations:
  inner = 120000ms
  outer = 120000ms
~~~

The exact file organization is not predetermined. A tiny dedicated internal
policy helper is acceptable if it prevents duplicated timeout constants between
`sandbox.js` and `sandbox-child.js`.

The policy must not become a public configuration surface.

## Fail-closed requirements

Any timeout-policy implementation must fail closed if:

- the operation ID is unknown;
- a policy returns a non-integer, non-positive, or unbounded value;
- inner timeout is greater than or equal to the selected outer timeout for
  `npm.ci_candidate`;
- a caller attempts to supply or override a timeout value;
- a product operation has no defined bounded timeout.

Do not accept a default such as `Infinity`, zero, undefined-as-unbounded, or
arbitrary caller input.

## Post-change real-lockfile proof

After implementing the product policy, run one fresh disposable real-lockfile
`npm.ci_candidate` through the actual changed product source with no diagnostic
timeout override.

This is mandatory.

It must prove:

- actual `npm.ci_candidate` exit 0 under the selected product timeout;
- measured duration below the selected inner budget;
- `npm ls --all --omit=dev` passes;
- better-sqlite3 native smoke passes;
- LanceDB smoke passes;
- package.json and package-lock hashes remain unchanged;
- no residual `unshare`, `chroot`, npm, node-gyp, gcc/g++, make, or related Node
  process remains;
- no real authority parent, claim, runtime, service, config, DB, session, or
  memory state was touched.

If the real-lockfile proof hits the selected timeout, do not raise it again in
this stage. Stop `INSUFFICIENT_EVIDENCE`.

## Tests after a source change

Run targeted checks first, then broader verification because timeout behavior is
a shared runtime boundary.

Required:

1. timeout-policy focused tests;
2. command-registry/sandbox/prepare focused tests as relevant;
3. production E2E;
4. all `runtime-authority-*` tests;
5. static check;
6. full suite.

Full suite must use the project business-zone environment:

~~~bash
PATH=/home/lionsol/.local/node24/bin:/usr/bin:/bin \
TZ=Asia/Shanghai \
/home/lionsol/.local/node24/bin/node --test
~~~

Do not classify a known timezone-boundary failure caused by forcing `TZ=UTC` as
a product regression.

## Pass criteria

At most three pass criteria:

1. Fresh cold and warm real-lockfile installs both succeed, and the selected
   timeout is calculated exactly from the maximum of all valid successful
   samples including historical `179269ms`.
2. Product source gives only `npm.ci_candidate` the evidence-derived inner budget
   and inner+30s outer budget; all other sandbox operation/probe budgets remain
   unchanged and caller override is impossible.
3. A fresh real-lockfile install succeeds under the actual product timeout, and
   focused, production E2E, runtime-authority, static, and full-suite validation
   all pass.

## Allowed mutations

Before the product modification gate:

- disposable `/tmp` reproduction roots and caches only;
- this Stage Card may be updated with persistent evidence.

After the product modification gate passes:

- minimal source needed for the internal timeout policy;
- minimal focused tests;
- this Stage Card result section.

No runtime/service/config/data mutation is allowed.

## Stop conditions

Stop `INSUFFICIENT_EVIDENCE` without a product timeout change if:

- fresh cold or warm install does not complete successfully;
- registry/network instability invalidates a timing sample;
- native build or package integrity fails;
- required native smoke fails;
- observed formula exceeds 15 minutes;
- a minimal closed policy cannot keep all other sandbox operations unchanged;
- inner-before-outer timeout ordering cannot be proven;
- the post-change real-lockfile proof hits the selected product timeout;
- the fix requires retry, fallback, public configuration, a new persistent
  artifact, a dependency upgrade, sandbox weakening, or another subsystem.

Stop `STOPPED` if:

- a real authority plan/claim/runtime/service/config/data path is touched;
- the historical FAILED run identity is reused;
- an unauthorized commit/tag/push occurs;
- unrelated source changes appear in the worktree.

## Drift classification

New findings discovered during this stage must be classified as:

- `blocker`: prevents safe timeout selection or validation;
- `adjacent_defect`: real but not required for the timeout decision;
- `hypothetical_hardening`: possible future issue without current failure
  evidence.

Only blockers may enter this stage.

Known findings that remain outside scope unless they become blockers:

- npm 11.6 warns that `npm_config_nodedir` may stop being accepted by a future
  npm major;
- better-sqlite3@11.10.0 lacks a Node ABI 137 prebuild asset;
- earlier diagnostic stderr exceeded the existing 256KiB capture limit.

## Required Codex report

~~~text
task_goal=
starting_head=
initial_worktree=
historical_successful_cold_ms=179269
fresh_cold_command=
fresh_cold_result=
fresh_cold_duration_ms=
fresh_warm_command=
fresh_warm_result=
fresh_warm_duration_ms=
observed_max_ms=
margin_ms=
raw_inner_ms=
selected_inner_timeout_ms=
selected_outer_timeout_ms=
timeout_selection_math=
pre_change_product_timeout_behavior=
changed_files=
behavior_change=
caller_override_test=
other_operation_timeout_test=
capability_probe_timeout_test=
inner_before_outer_test=
post_change_real_lockfile_command=
post_change_real_lockfile_result=
post_change_duration_ms=
npm_ls_result=
better_sqlite3_smoke=
lancedb_smoke=
manifest_hashes_unchanged=
process_cleanup_result=
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
commit_hash=not committed
tag=false
push=false
recommendation=
~~~

If timing evidence is incomplete or the post-change proof fails:

~~~text
selected_inner_timeout_ms=NOT_SET or NOT_ACCEPTED
selected_outer_timeout_ms=NOT_SET or NOT_ACCEPTED
recommendation=INSUFFICIENT_EVIDENCE
~~~

## Authorization state

~~~text
planning=complete
codex_execution=not authorized
source_change=not authorized until evidence gate passes
real_plan=false
real_dry_run=false
real_prepare=false
real_verify=false
runtime_install=false
service_operation=false
commit=false
tag=false
push=false
~~~

## Codex result — 2026-08-07

~~~text
result=PASS_WITH_FINDINGS
task_goal=在已提交 /runtime headers 修复基础上取得 fresh cold/warm 成功样本，按固定公式选择 npm.ci_candidate 的 operation-specific inner/outer timeout，并用真实产品 timeout 完成一次 fresh real-lockfile npm ci。
starting_head=bd39f8d9ba3625f42d447f9edd70451533e3887a
initial_worktree=?? docs/smoke-tests/npm-ci-timeout-resolution-stage-card-20260807.md；git diff --check passed。
historical_successful_cold_ms=179269
fresh_cold_command=env -i PATH=/home/lionsol/.local/node24/bin:/usr/bin:/bin TZ=Asia/Shanghai /home/lionsol/.local/node24/bin/node /tmp/memory-engine-npm-ci-timeout-resolution-69tKn5/timeout-evidence-controller.cjs；controller 使用当前 committed CommandRegistry/SandboxRunner/namespace/chroot/fixed env，diagnostic inner=840000ms、outer=900000ms；cold candidate/cache/staging 全新。
fresh_cold_result=SUCCESS；exit_code=0；added 74 packages；node_modules entries=2568；npm debug log=2026-08-07T01_14_04_173Z-debug-0.log，30476 bytes，sha256=27e12ac2826f0a60d1b64ecd2a30c5764cdfd598920f30a9163efa3f0368e156；无 header devdir/artifact。
fresh_cold_duration_ms=210551
fresh_cold_npm_ls=PASS；npm ls --all --omit=dev exit 0，better-sqlite3@11.10.0 与 @lancedb/lancedb@0.29.0 dependency tree 完整。
fresh_cold_better_sqlite3_smoke=PASS；ok=true，available=true，sqlite_version=3.49.2。
fresh_cold_lancedb_smoke=PASS；ok=true，available=true。
fresh_warm_command=同一 controller 的第二阶段；删除 cold candidate/install tree，仅保留 cold 产生的 disposable npm cache，创建全新 warm candidate 后以相同 npm.ci_candidate 命令运行；未复用 node_modules/build output/candidate 文件。
fresh_warm_result=SUCCESS；exit_code=0；added 74 packages；node_modules entries=2568；最新 warm npm debug log=2026-08-07T01_17_37_116Z-debug-0.log，13228 bytes，sha256=6c332377f6f731cfc190f1ab7f003c4606fdc8dfb02fe3518fbb60f3a1f13509；无 header devdir/artifact。
fresh_warm_duration_ms=175561
fresh_warm_npm_ls=PASS；npm ls --all --omit=dev exit 0。
fresh_warm_better_sqlite3_smoke=PASS；ok=true，available=true，sqlite_version=3.49.2。
fresh_warm_lancedb_smoke=PASS；ok=true，available=true。
observed_max_ms=210551
margin_ms=60000
raw_inner_ms=270551
selected_inner_timeout_ms=300000
selected_outer_timeout_ms=330000
timeout_selection_math=max(179269,210551,175561)=210551；max(60000,210551*0.25=52637.75)=60000；210551+60000=270551；round_up(270551,30000)=300000；outer=300000+30000=330000。
pre_change_product_timeout_behavior=all sandbox operations inner=120000ms/outer=120000ms；capability probe outer=30000ms，child inner仍=120000ms；npm.ci_candidate 因共享 120000ms 外层/内层而被合法安装拒绝。
changed_files=lib/runtime-authority/sandbox.js; lib/runtime-authority/sandbox-child.js; lib/runtime-authority/timeout-policy.js; test/runtime-authority-sandbox.test.js; test/runtime-authority-command-registry.test.js; docs/smoke-tests/npm-ci-timeout-resolution-stage-card-20260807.md
behavior_change=新增 immutable closed timeout policy：仅 npm.ci_candidate 使用 inner=300000ms、outer=330000ms；其他 registered sandbox operations 保持 inner/outer=120000ms；capability probe 保持 outer=30000ms/inner=120000ms；sandbox-child 仅接受产品生成且 bounded 的 inner timeout。
before_regression=旧实现 focused sandbox test：5 passed / 1 failed；失败断言为实际 outer=120000ms、预期=330000ms，证明旧实现拒绝选定 policy。
after_regression=focused command-registry/sandbox/prepare：20 passed / 0 failed；覆盖 inner/outer、inner-before-outer、其他 operation、capability probe、caller timeout override、malformed timeout、unknown operation fail-closed。
caller_override_test=PASS；caller 传 timeout=1 不改变 npm.ci_candidate 的 330000/300000 policy；CommandRegistry input.timeout 未传入 sandbox；无 plan/CLI/env/config timeout 输入。
other_operation_timeout_test=PASS；node.candidate_targeted_tests outer=120000ms、inner=120000ms。
capability_probe_timeout_test=PASS；capability-probe outer=30000ms、inner=120000ms。
inner_before_outer_test=PASS；npm.ci_candidate inner=300000ms，outer=330000ms，固定 30000ms cleanup/reporting grace。
post_change_real_lockfile_command=env -i PATH=/home/lionsol/.local/node24/bin:/usr/bin:/bin TZ=Asia/Shanghai /home/lionsol/.local/node24/bin/node /tmp/memory-engine-npm-ci-timeout-product-proof-Y8sU52/product-timeout-proof.cjs；使用真正 committed SandboxRunner/sandbox-child/defaultSpawn，无 diagnostic wrapper、custom spawn、temporary timeout override。
post_change_real_lockfile_result=SUCCESS；npm ci exit_code=0；added 74 packages；diagnostic_override=false；实际 policy inner=300000ms、outer=330000ms，未触发 watchdog。
post_change_duration_ms=180559
npm_ls_result=PASS；npm ls --all --omit=dev exit 0。
better_sqlite3_smoke=PASS；ok=true，available=true，sqlite_version=3.49.2。
lancedb_smoke=PASS；ok=true，available=true。
manifest_hashes_unchanged=PASS；package.json before/after=752f46d03f7fe87f744e4441a9f79fccae3d4e09ece129ee60a0ad19abcdf47a；package-lock.json before/after=8ee89a15cc54eb532618cf011a30f5684cedf0aa0c026cb69378bc025ec58718。
process_cleanup_result=PASS；fresh cold、fresh warm、post-change product proof 各阶段 process scan 均为空；最终无 residual unshare/chroot/npm/node-gyp/gcc/g++/make/related Node process。
security_invariants_preserved=namespace/chroot、shell=false、fixed env、resolver handling、path broker、read-only /runtime、exact tool bindings、lifecycle scripts、bounded evidence、raw caller input rejection、unknown operation rejection 均保持；timeout policy 不读取 plan/CLI/config/env，不新增 root/cache/proxy/retry/fallback。
targeted_tests=PASS；focused timeout regression old=5/1，new=20/0；相关 command-registry/sandbox/prepare=20/0。
production_e2e=17 passed / 0 failed；188974ms。
runtime_authority_tests=79 passed / 0 failed；184860ms。
static_check=614 files passed。
full_suite=1832 passed / 0 failed / 8 skipped；209975ms；PATH=bound Node24，TZ=Asia/Shanghai。
runtime_mutation=false
config_mutation=false
service_operation=false
data_access=false
failed_real_claim_untouched=true
risks=better-sqlite3@11.10.0 ABI 137 prebuild asset 仍不存在，fallback=node-gyp 仍是预期；npm 11.6 仍警告 unknown env config nodedir，属于已知后续兼容性 finding；timeout policy 已证明当前 bound npm/node-gyp 路径，但尚未执行 runtime install/reload/restart；未因测试或安装慢而扩大其他 operation timeout。
commit_hash=not committed
tag=false
push=false
recommendation=PASS_WITH_FINDINGS；timeout 300000/330000 由完整成功样本唯一计算并经真实产品路径证明；可进入后续单独授权的 runtime rollout 评审，不在本阶段执行 install/reload/restart。
~~~

## GPT blocker fix and revalidation — 2026-08-07

~~~text
stage_outcome=PASS_WITH_FINDINGS
blocker=旧实现把 closed inner timeout 作为 --inner-timeout-ms 传入 sandbox-child.js；child 只验证调用者提供的 bounded integer，因此合法的 argv 值 1 可以覆盖 npm.ci_candidate 的 closed policy 300000。
blocker_fix=PASS；buildSandboxArgv() 删除 --inner-timeout-ms 及其值；sandbox-child.js 不再读取 args.innerTimeoutMs，并在 operation 校验后直接调用 getSandboxTimeoutPolicy(operation).inner_timeout_ms；SandboxRunner outer watchdog 继续从同一 helper 读取 outer_timeout_ms。
inner_timeout_input_surface_removed=PASS；生成的 sandbox argv 不含 --inner-timeout-ms；sandbox-child.js 源码不含 args.innerTimeoutMs 或该 flag；caller timeout=1、caller env 中的 inner_timeout_ms=1/npm_config_timeout=1 均不影响 policy。
closed_policy_child_binding=PASS；npm.ci_candidate child-side inner=300000ms；ordinary node.candidate_targeted_tests child-side inner=120000ms；capability-probe child-side inner=120000ms；unknown operation 继续 fail closed。
selected_inner_timeout_ms=300000
selected_outer_timeout_ms=330000
timing_evidence_preserved=PASS；不重跑 cold/warm；historical_successful_cold_ms=179269，fresh_cold_ms=210551，fresh_warm_ms=175561，observed_max_ms=210551，margin_ms=60000，raw_inner_ms=270551，round_up(raw_inner_ms,30000)=300000，outer=330000。

product_timeout_proof_command=env -i PATH=/home/lionsol/.local/node24/bin:/usr/bin:/bin TZ=Asia/Shanghai /home/lionsol/.local/node24/bin/node /tmp/memory-engine-npm-ci-timeout-blocker-proof-fNOglq/product-timeout-proof.cjs /tmp/memory-engine-npm-ci-timeout-blocker-proof-fNOglq /home/lionsol/.openclaw/workspace/plugins/memory-engine
product_timeout_proof_scope=新的 /tmp disposable staging/candidate/npm-cache；当前真实 package.json/package-lock.json；当前 SandboxRunner、sandbox-child、CommandRegistry、namespace、chroot、fixed env；无 diagnostic override、temporary child wrapper、custom spawn timeout；diagnostic_override=false。
product_timeout_proof_result=SUCCESS；npm ci exit_code=0；added 74 packages；node_modules entries=2568；policy observed inner=300000ms/outer=330000ms；未触发任一 watchdog。
product_timeout_proof_duration_ms=157322
product_timeout_proof_npm_log=2026-08-07T03_01_34_189Z-debug-0.log；30243 bytes；sha256=acf51e13cb129809c68a3358e3886ea354fb93e0c13a7aab229a7341b5ad5427
npm_ls_result=PASS；npm ls --all --omit=dev exit_code=0；stdout_bytes=2703。
better_sqlite3_smoke=PASS；{"ok":true,"available":true,"sqlite_version":"3.49.2"}。
lancedb_smoke=PASS；{"ok":true,"available":true}。
manifest_hashes_unchanged=PASS；package.json before/after=752f46d03f7fe87f744e4441a9f79fccae3d4e09ece129ee60a0ad19abcdf47a；package-lock.json before/after=8ee89a15cc54eb532618cf011a30f5684cedf0aa0c026cb69378bc025ec58718。
header_artifacts_check=PASS；candidate 中不存在 .node-gyp、node-v24.8.0 或其他 header extraction directory；唯一宽匹配的 tar-stream/headers.js 是依赖源码文件，不是 Node headers 下载产物。

first_product_proof_harness_attempt=STOPPED_BEFORE_NPM；一次性 controller 漏传只读的 plan.source_repo，candidateInput 在 realpath(undefined) 处 fail closed；未执行 npm、未写 cache、未产生进程；补齐绑定后使用同一空 candidate/cache 完成上述 fresh proof。
before_regression=旧 timeout implementation 的 focused sandbox regression 为 5 passed / 1 failed；旧实现仍把 npm.ci_candidate outer timeout 设为 120000ms，不能满足 selected 330000ms。
after_regression=PASS；focused command-registry/sandbox/prepare command 共 20 passed / 0 failed；覆盖无 --inner-timeout-ms argv、caller timeout/argv/env 不可覆盖、child closed inner policy、ordinary operation、capability probe 和 unknown operation fail closed。
other_operation_timeout_result=PASS；node.candidate_targeted_tests inner=120000ms、outer=120000ms；未扩大其他 sandbox operation。
capability_probe_timeout_result=PASS；capability-probe inner=120000ms、outer=30000ms。
caller_override_result=PASS；caller 传 timeout=1 且传入 timeout-like env 后仍为 npm.ci_candidate inner=300000ms、outer=330000ms；CommandRegistry 不把 timeout 传入 sandbox；无 plan/CLI/config/env timeout policy 输入。
process_cleanup_result=PASS_FOR_REPRODUCTION；product proof controller 在 npm ci、npm ls、两项 native smoke 完成后扫描为空；外部复查无 unshare、chroot、npm-cli.js、node-gyp、gcc/g++、make 或相关 Node 子进程。系统另有与本 reproduction 无关的既存 `npm exec @agent npm exec @agentmemory/agentmemory --port 3111`，未触碰。

targeted_tests=PASS；PATH=bound Node24，TZ=Asia/Shanghai；test/runtime-authority-sandbox.test.js test/runtime-authority-command-registry.test.js test/runtime-authority-prepare.test.js；20 passed / 0 failed。
production_e2e=PASS；test/runtime-authority-production-e2e.test.js；17 passed / 0 failed；187681.810857ms。
runtime_authority_tests=PASS；test/runtime-authority-*.test.js；79 passed / 0 failed；186667.912819ms。
static_check=PASS；npm run check；614 files passed。
full_suite=PASS；PATH=/home/lionsol/.local/node24/bin:/usr/bin:/bin TZ=Asia/Shanghai /home/lionsol/.local/node24/bin/node --test；1832 passed / 0 failed / 8 skipped；212797.807397ms。

changed_files=lib/runtime-authority/sandbox.js; lib/runtime-authority/sandbox-child.js; lib/runtime-authority/timeout-policy.js; test/runtime-authority-sandbox.test.js; test/runtime-authority-command-registry.test.js; docs/smoke-tests/npm-ci-timeout-resolution-stage-card-20260807.md
behavior_change=仅移除 child timeout 的 caller-visible argv/input surface；inner timeout 由 registered operation ID 对应的 immutable closed policy 直接决定，outer timeout 仍由同一 helper 决定；selected budget、dependency、nodedir、namespace、sandbox roots、fixed env 和其他 operation timeout 均不变。
security_invariants_preserved=PASS；shell=false、namespace/chroot、fixed environment、resolver allow-list、PathBroker、read-only /runtime、exact tool bindings、lifecycle scripts、no retry/fallback、bounded watchdog、unknown operation rejection、raw caller input rejection、FAILED claim untouched 均保持。
runtime_mutation=false
config_mutation=false
service_operation=false
data_access=false
failed_real_claim_untouched=true
risks=better-sqlite3@11.10.0 ABI 137 仍无匹配 prebuild，fallback=node-gyp 为当前版本行为；npm 11.6.0 仍报告 unknown env config nodedir warning；本阶段未执行 runtime install/reload/restart。
commit_hash=not committed
tag=false
push=false
recommendation=PASS_WITH_FINDINGS；blocker 已以最小 closed-policy binding 修正，并由 fresh real-lockfile product-timeout proof 和全部验证 gate 证明；不在本阶段执行 install/reload/restart。
~~~

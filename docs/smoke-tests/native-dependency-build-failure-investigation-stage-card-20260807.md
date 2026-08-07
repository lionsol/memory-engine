# Native Dependency Build Failure Investigation — Stage Card

> Status: `READY_FOR_AUTHORIZATION`
>
> Date: 2026-08-07
>
> Business timezone: Asia/Shanghai
>
> Starting source baseline: `78d8a0999746aa2b828556ad50bfbb3f9a909d26`

## Stage decision

Can the Candidate-Builder prove the first project-controlled boundary that makes
`better-sqlite3@11.10.0` fail to construct inside the production-shaped sandbox,
and, only if that boundary is proven, apply one minimal fix that preserves the
existing namespace, chroot, path, tool-identity, and fail-closed contracts?

This stage is not a dependency-upgrade stage and is not a timeout-adjustment
stage.

## User value

The real Candidate-Builder cannot reach a successful `npm ci` while the native
SQLite dependency fails during its install lifecycle. Until that construction
path is understood, increasing the sandbox timeout or retrying real `prepare`
would only consume new one-shot run identities without proving that a candidate
can be built.

## Current facts

- Source HEAD after the timeout investigation report commit is
  `78d8a0999746aa2b828556ad50bfbb3f9a909d26`.
- The previous disposable cold-cache investigation reached npm registry HTTP 200
  and continued past the original 120-second product timeout.
- The cold run terminated after about `183952 ms`, before either enlarged
  diagnostic watchdog fired.
- `better-sqlite3@11.10.0` has this install contract:

~~~text
prebuild-install || node-gyp rebuild --release
~~~

- The prebuild request timed out, then the fallback `node-gyp` path downloaded
  the Node headers successfully enough to begin extraction.
- The decisive native-build log contained repeated
  `TAR_ENTRY_ERROR / EINVAL fchown` errors during Node header extraction, after
  which node-gyp exited non-zero.
- The sandbox is created with `unshare --user --map-root-user`; a direct local
  inspection of the same user-namespace model reports:

~~~text
namespace uid=0 gid=0
uid_map: namespace 0 -> host 1000, length 1
gid_map: namespace 0 -> host 1000, length 1
~~~

- npm's bound node-gyp closure currently contains `node-gyp@11.2.0` and
  `tar@6.2.1`.
- In the bound `tar@6.2.1`, extraction defaults to `preserveOwner=true` when the
  extracting process sees UID 0. When archive UID/GID differs from the process
  UID/GID, tar attempts `fchown` and then `chown`.
- The sandbox child process sees UID 0 because of `--map-root-user`.
- The bound Node runtime is `v24.8.0`, module ABI `137`, and has local development
  headers under the already-bound runtime tree, including:

~~~text
/home/lionsol/.local/node24/include/node/node.h
/home/lionsol/.local/node24/include/node/common.gypi
/home/lionsol/.local/node24/include/node/config.gypi
~~~

- This Node build reports `use_prefix_to_find_headers=false`, so node-gyp does not
  automatically select those runtime-local headers.
- Current node-gyp documentation supports explicit `--nodedir` and environment
  configuration of node-gyp options when node-gyp is invoked through npm.

## Historical external context, not local proof

The following background helps define tests but must not be treated as the local
root cause without reproduction:

- `better-sqlite3` has documented Node 24 prebuild gaps in early 12.x releases;
  upstream reported ABI 137 prebuild support as fixed in `12.1.0`.
- Current project dependency is older: `better-sqlite3@11.10.0`.
- Therefore the absence of a usable ABI 137 prebuild for 11.10.0 is plausible,
  and source-build fallback may be expected rather than itself being a defect.

Do not upgrade `better-sqlite3` in this stage to test that hypothesis.

## In scope

At most three work items are authorized if this Stage Card is approved:

1. Prove whether the prebuild path is expected to fall back for the exact locked
   package/runtime combination, and distinguish missing asset from sandbox
   connectivity failure.
2. Prove or reject the user-namespace ownership hypothesis for node-gyp's Node
   header extraction using exact archive ownership metadata and a minimal
   reproduction under the same UID/GID mapping.
3. If and only if the first project-controlled boundary is proven, test and apply
   one minimal construction fix that uses only already-bound runtime/tool inputs
   and then re-run a full disposable real-lockfile install plus native smoke.

## Non-goals

- no real plan, `dry-run`, `prepare`, or `verify`;
- no reuse or modification of any historical FAILED claim or run ID;
- no runtime plugin install, reload, restart, Gateway/Console operation, or
  configuration mutation;
- no database, session, memory, or customer data access;
- no increase to the 120-second product timeout in this stage;
- no retry loop, fallback loop, lifecycle suppression, `--ignore-scripts`, or
  substitution of `npm install` for `npm ci`;
- no `better-sqlite3`, LanceDB, Node, npm, node-gyp, or tar version upgrade;
- no broad bind of host `/home`, `/mnt/wsl`, npm cache, compiler cache, or other
  host directories;
- no inheritance of the full host environment or proxy environment;
- no disabling owner checks globally in tar/node-gyp;
- no patching files inside the installed npm/node-gyp/tar toolchain;
- no product setting that accepts arbitrary `nodedir`, tarball, proxy, or devdir
  input from a plan, CLI flag, configuration file, or environment variable;
- no commit, tag, or push unless separately authorized.

## Required investigation sequence

### A. Prebuild path classification

Use a disposable `/tmp` root and the exact locked package metadata to determine
the expected prebuild URL for:

~~~text
better-sqlite3=11.10.0
runtime=node
target=24.8.0
ABI=137
platform=linux
arch=x64
~~~

Record the exact URL after redaction of any credentials. Then distinguish:

1. asset exists and sandbox can fetch it;
2. asset exists but sandbox cannot fetch it;
3. asset does not exist and source-build fallback is expected;
4. evidence is insufficient.

A host-side network check may be used only for the exact public URL and only as
an independent comparison. Do not import host proxy/environment settings into
the sandbox.

If the asset is absent, classify `prebuild-install` fallback as expected behavior
for this lock/runtime pair and do not attempt to "fix" prebuild-install.

If the asset exists but the sandbox cannot fetch it, record that as a separate
network finding. Do not broaden sandbox environment or proxy inputs in this
stage unless that inability is independently proven to be the only blocker and a
closed, fixed binding can be designed within the Stage Card limits.

### B. Exact Node-header ownership evidence

Obtain the exact Node `v24.8.0` headers tarball used by node-gyp in a disposable
root, or capture an integrity-bound copy before cleanup. Record:

- source URL;
- SHA-256;
- tar implementation used for inspection;
- representative and unique UID/GID values from archive entries;
- whether any archive UID/GID is outside the one-entry namespace mapping.

Do not rely on guesses about Node release archive ownership.

### C. Minimal ownership reproduction

Build a minimal reproduction that does not invoke the full package install first.
It must compare, with the same `tar@6.2.1` behavior where practical:

1. extraction outside the user namespace;
2. extraction inside `unshare --user --map-root-user` to disposable storage;
3. the namespace `uid_map` and `gid_map` visible to the extracting process;
4. the exact `fchown/chown` target UID/GID that fails, if a failure occurs.

The reproduction must prove whether the same archive/entry ownership produces
`EINVAL` specifically because the requested owner is not mapped into the user
namespace.

A synthetic archive may be used only as a secondary control after the exact Node
headers archive has been inspected. Synthetic evidence alone is insufficient.

### D. Bound-runtime header alternative

If ownership mapping is proven to be the fatal extraction boundary, test one
closed alternative before any product change:

> Tell node-gyp to use the already-bound Node `v24.8.0` runtime development
> headers under `/runtime` instead of downloading/extracting a second copy.

The diagnostic must first prove that `/runtime` contains the node-gyp-required
header layout for the exact running Node version, including the effective
`include/node/common.gypi` and `config.gypi` paths.

Use node-gyp's supported `nodedir` mechanism rather than patching node-gyp or tar.
For npm 11, prefer the documented npm-invoked node-gyp environment form rather
than deprecated `npm_config_*` option injection.

This diagnostic is allowed only with a hard-coded `/runtime` value inside the
disposable harness. Do not expose it as user input.

### E. Full disposable install gate

Only after A-D have isolated a first project-controlled boundary, run a fresh
production-shaped `npm.ci_candidate` under `/tmp` with the candidate fix and a
diagnostic watchdog no greater than 15 minutes.

A valid success must include all of:

- `npm ci` exit code 0;
- `npm ls --all --omit=dev` exit code 0;
- `better-sqlite3` loads under the bound Node and performs a disposable in-memory
  or temporary-file SQLite smoke without touching project/runtime databases;
- LanceDB package import/native smoke succeeds;
- `package.json` and `package-lock.json` hashes are unchanged;
- no related process remains after exit;
- no new host root or environment inheritance is introduced.

If full install still fails, stop with `INSUFFICIENT_EVIDENCE` unless the new
first incorrect boundary is a direct consequence of the candidate fix and is
within the same subsystem. Do not chain speculative fixes.

## Product modification gate

No product source change is permitted until all of the following are true:

1. The fatal node-gyp extraction failure is reproduced independently of the full
   npm install and tied to a concrete namespace/filesystem/ownership boundary.
2. The candidate alternative uses only inputs already included in the current
   authority/tool/runtime binding and does not require a new host root, mutable
   cache authority, external configuration, or relaxed namespace isolation.
3. A production-shaped disposable real-lockfile install completes with native
   smoke under the candidate behavior.

If any condition is missing, finish with:

~~~text
result=INSUFFICIENT_EVIDENCE
behavior_change=none
~~~

## Allowed minimal product fix

If the modification gate passes, the preferred minimal shape is:

- keep `--user --map-root-user`, namespace mounts, chroot, resolver binding, path
  broker, command registry, tool identity, and one-shot transaction semantics;
- add one fixed node-gyp configuration value derived from the already-bound Node
  runtime, for `npm.ci_candidate` lifecycle execution only;
- the value must resolve inside the chroot to the already-mounted `/runtime`;
- the host-side source of `/runtime` remains the exact bound Node runtime root;
- no arbitrary caller-provided `nodedir` is accepted;
- no downloaded Node-header cache becomes part of authority state;
- no owner/chown behavior is globally disabled.

The exact environment key must be selected from node-gyp/npm 11 documented
behavior and covered by a regression test. Do not assume deprecated npm config
prefixes are acceptable.

If `/runtime` is not a valid node-gyp `nodedir` for this installation, do not
invent a new runtime-header packaging mechanism in this stage. Stop and split a
new design stage.

## Security invariants

The following must remain true:

- sandbox operation set remains closed;
- shell execution remains disabled;
- namespace and chroot remain mandatory;
- operator home, source `node_modules`, active runtime, release runtime, config,
  session, and memory roots remain denied except for already-approved exact
  bindings;
- `/runtime` remains read-only;
- compiler/Python/node-gyp bindings remain exact and tool-identity checked;
- npm lifecycle scripts remain enabled and unmodified;
- no host credentials, proxy secrets, npmrc, auth token, cookie, or general HOME
  state enters evidence or the sandbox;
- failure evidence remains bounded and redacted;
- process cleanup is verified after every reproduction.

## Test-first expectations if source changes

Before implementing a source fix, Codex must create a focused failing regression
that demonstrates the desired closed behavior. At minimum, tests should prove:

- only `npm.ci_candidate` receives the fixed node-gyp runtime-header binding;
- the value is exactly the mapped runtime root and cannot be supplied by caller
  input;
- other sandbox operations do not unexpectedly inherit the new node-gyp option;
- existing fixed environment and denied-root tests continue to pass;
- resolver and command-failure evidence tests continue to pass.

After a source fix, run in this order:

1. focused new tests;
2. `test/runtime-authority-sandbox.test.js` and relevant command-registry tests;
3. production E2E;
4. all runtime-authority tests;
5. static check;
6. full suite with the bound Node 24 and business timezone.

Full-suite environment:

~~~bash
PATH=/home/lionsol/.local/node24/bin:/usr/bin:/bin \
TZ=Asia/Shanghai \
/home/lionsol/.local/node24/bin/node --test
~~~

## Pass criteria

The stage may return `PASS` or `PASS_WITH_FINDINGS` only if all three criteria
are satisfied:

1. The exact prebuild and node-gyp paths are classified with persistent evidence,
   and the fatal `fchown/chown` boundary is either proven or explicitly rejected.
2. If source changed, a production-shaped disposable real-lockfile install,
   dependency-tree validation, `better-sqlite3` smoke, and LanceDB smoke all pass
   without weakening security invariants.
3. All required regression/static/full-suite checks pass, or the stage stops
   before source modification with an honest `INSUFFICIENT_EVIDENCE` result.

## Stop conditions

Stop without speculative product changes if any of the following occurs:

- exact archive ownership cannot be obtained safely;
- `EINVAL` cannot be reproduced at the claimed namespace ownership boundary;
- candidate `nodedir=/runtime` is not structurally valid for the bound Node;
- candidate full install fails at an unrelated second subsystem;
- proposed fix requires a dependency upgrade, new authority artifact, new plan
  field, configuration object, CLI option, host cache, proxy inheritance, or
  broader mount;
- a reproduction needs runtime DB/session/memory access;
- a diagnostic run exceeds 15 minutes;
- cleanup leaves related processes or mounts behind;
- source HEAD/worktree drifts outside this Stage Card.

## Findings classification

During execution classify discoveries as:

- `blocker`: required to answer this stage decision;
- `adjacent_defect`: real but not required for native dependency construction;
- `hypothetical_hardening`: no current failing evidence.

Examples:

- prebuild request latency is an `adjacent_defect` if the asset is absent and
  source build succeeds through the closed header path;
- the previous 120-second product timeout remains an `adjacent_defect` until a
  successful installation duration is measured;
- the 256 KiB diagnostic stderr collector ceiling is an `adjacent_defect` unless
  it prevents retention of decisive evidence;
- upgrading `better-sqlite3` solely to obtain prebuilds is a separate dependency
  design decision, not an automatic fix.

## Allowed mutations during investigation

Allowed:

- disposable files under `/tmp`;
- exact public network fetches needed for the package prebuild URL, Node headers,
  npm registry artifacts, and the production-shaped install;
- this Stage Card result section;
- focused source/test changes only after the modification gate passes.

Not allowed:

- real authority parent writes;
- historical claim changes;
- active/release runtime writes;
- config/service operations;
- DB/session/memory access;
- tag or push;
- commit unless separately authorized.

## Required persistent evidence

Do not rely on the terminal transcript. Before deleting disposable roots, write a
concise evidence summary into this Stage Card containing:

- exact manifest/lock hashes;
- prebuild URL classification and decisive status/error;
- Node headers URL and SHA-256;
- archive UID/GID summary;
- namespace UID/GID maps;
- minimal extraction reproduction command/result;
- exact failed owner values, if reproduced;
- `/runtime` header-layout validation;
- candidate node-gyp configuration mechanism;
- full-install result and duration;
- npm debug-log hash and decisive excerpt;
- native smoke results;
- process/mount cleanup result.

Do not paste full logs or credentials.

## Required Codex report

~~~text
task_goal=
starting_head=
initial_worktree=
package_json_sha256=
package_lock_sha256=
prebuild_expected_url=
prebuild_asset_classification=
prebuild_sandbox_result=
node_headers_url=
node_headers_sha256=
node_headers_archive_owner_summary=
namespace_uid_map=
namespace_gid_map=
minimal_extraction_reproduction=
minimal_extraction_result=
failed_chown_uid_gid=
ownership_root_cause=
runtime_nodedir_layout_result=
candidate_node_gyp_configuration=
candidate_full_install_result=
candidate_full_install_duration_ms=
npm_ls_result=
better_sqlite3_smoke=
lancedb_smoke=
process_cleanup_result=
first_incorrect_boundary=
behavior_change=
changed_files=
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

If the modification gate is not met, report:

~~~text
behavior_change=none
recommendation=INSUFFICIENT_EVIDENCE
~~~

## Authorization state

~~~text
stage=Native Dependency Build Failure Investigation
planning=complete
Codex investigation/implementation=not authorized
real plan=false
real dry-run=false
real prepare=false
runtime install/reload=false
commit=false
tag=false
push=false
~~~

## Codex result — 2026-08-07

~~~text
result=PASS_WITH_FINDINGS
task_goal=证明 better-sqlite3@11.10.0 fallback 到 node-gyp 后的 TAR_ENTRY_ERROR/EINVAL fchown 是否由 user namespace ownership 映射冲突造成，并验证使用已绑定 Node 24.8.0 /runtime headers 的最小 fail-closed 修复。
starting_head=78d8a0999746aa2b828556ad50bfbb3f9a909d26
initial_worktree=?? docs/smoke-tests/native-dependency-build-failure-investigation-stage-card-20260807.md；git diff --check passed。
package_json_sha256=752f46d03f7fe87f744e4441a9f79fccae3d4e09ece129ee60a0ad19abcdf47a
package_lock_sha256=8ee89a15cc54eb532618cf011a30f5684cedf0aa0c026cb69378bc025ec58718
namespace_uid=0
namespace_gid=0
uid_map=0 1000 1
gid_map=0 1000 1
prebuild_expected_url=https://github.com/WiseLibs/better-sqlite3/releases/download/v11.10.0/better-sqlite3-v11.10.0-node-v137-linux-x64.tar.gz
prebuild_asset_classification=ABSENT_PUBLIC_ASSET; exact host HEAD=404 and production-shaped sandbox HEAD=404; prebuild-install fallback to node-gyp is expected for this locked package/runtime pair。
prebuild_sandbox_result=SandboxRunner namespace child reported uid=0,gid=0,status=404 for the exact URL; no proxy or host npm config was inherited。
node_headers_url=https://nodejs.org/download/release/v24.8.0/node-v24.8.0-headers.tar.gz
node_headers_sha256=db9ae39b4b8678d6d2a4bd8b299db2e2253dc32a1cdf7de7c339bebab228556c
node_headers_archive_owner_summary=Node v24.8.0 headers archive inspected with npm bundled tar@6.2.1; 3326/3326 entries were UID:GID 1000:1000. Representative entries included node-v24.8.0/include/node/v8-locker.h, zconf.h, v8config.h, and common.gypi, each 1000:1000。
namespace_uid_map=0       1000          1
namespace_gid_map=0       1000          1
minimal_extraction_reproduction=env -i PATH=/home/lionsol/.local/node24/bin:/usr/bin:/bin TZ=Asia/Shanghai /home/lionsol/.local/node24/bin/node /tmp/memory-engine-native-dependency-investigation-llF2oz/minimal-extraction-controller.cjs; same tar@6.2.1 node-gyp extraction path: tar.extract(file,strip=1,filter=.h/.gypi,onwarn,cwd)。
minimal_extraction_result=Host extraction as UID/GID 1000/1000 succeeded with 0 warnings. Production-shaped namespace extraction ran as 0/0 with the recorded maps; tar emitted 2726 TAR_ENTRY_ERROR warnings, all EINVAL invalid argument fchown, while node-gyp's onwarn contract marks extraction fatal。
failed_chown_uid_gid=archive owner 1000:1000; first captured target=/staging/namespace-extract/include/node/v8-locker.h; fchown(1000,1000) returned EINVAL, fallback chown(1000,1000) also returned EINVAL。
host_extraction_control=PASS; identical tar@6.2.1 extraction/filter/strip path outside user namespace, process UID/GID 1000/1000, 0 TAR_ENTRY_ERROR warnings。
ownership_root_cause=PROVEN: archive owner 1000:1000 -> tar DOCHOWN because archive owner differs from namespace process 0/0 -> fchown/chown requests an unmapped namespace UID/GID -> EINVAL -> node-gyp onwarn sets extractErrors and throws fatal extraction error. This is the first project-controlled failing boundary。
runtime_nodedir_layout_result=PASS; production-shaped /runtime contains node.h, common.gypi, config.gypi, and node_version.h; child identity was Node v24.8.0, ABI 137, use_prefix_to_find_headers=false. Header hashes: node.h=b1058412d2bfa5e05eb6bb6beebf3dd3a6b29708720af85a22352354e66237a0, common.gypi=3bc8687607f6b55588b05087915cf484652ba653a3ae384de17c7e770e34e63d, config.gypi=e6445074b36c13020b8d2d61f7777a950bf9bfba5d38b924a76fa82d7cc96263, node_version.h=68a9118d8b621f70c7f944b38b6ee46e320630bfd32cb6a10635a02b2e30948e。
candidate_node_gyp_configuration=Fixed descriptor env for npm.ci_candidate only: npm_config_nodedir=/runtime. Bound node-gyp@11.2.0 configDefs includes nodedir and its npm-invoked parser consumes npm_config_ options; caller argv/env input remains rejected. npm 11.6 emits an unknown-env-config warning but the current lifecycle path forwarded the value and generated nodedir=/runtime。
local_header_diagnostic_command=env -i PATH=/home/lionsol/.local/node24/bin:/usr/bin:/bin TZ=Asia/Shanghai /home/lionsol/.local/node24/bin/node /tmp/memory-engine-native-dependency-investigation-llF2oz/local-header-install-controller.cjs; source-wired run used production CommandRegistry, SandboxRunner, namespace/chroot/fixed env, inner diagnostic watchdog=840000ms and outer diagnostic watchdog=900000ms。
node_gyp_nodedir_evidence=source-wired candidate build/config.gypi contains nodedir=/runtime; generated Makefile contains -Dnode_root_dir=/runtime and -I/runtime/include/node/common.gypi; compiler depfile contains -I/runtime/include/node and /runtime/include/node/node.h. No downloaded Node headers/devdir appeared under the disposable staging root。
candidate_full_install_result=SUCCESS; source-wired fresh real-lockfile npm.ci_candidate exit 0; added 74 packages; final node_modules entry count=2568; npm debug log bytes=30241, sha256=d88cad6908f2d876399b2c613e5fb1e9a3553b95cedd415e6eb14f6f6d909f10。
candidate_full_install_duration_ms=179269
npm_ls_result=PASS; npm ls --all --omit=dev exit 0 and reported better-sqlite3@11.10.0 plus @lancedb/lancedb@0.29.0 dependency tree。
better_sqlite3_smoke=PASS; existing native-smoke-helper loaded better-sqlite3 and returned ok=true, available=true, sqlite_version=3.49.2。
lancedb_smoke=PASS; existing native-smoke-helper returned ok=true, available=true using disposable LanceDB smoke storage。
manifest_hashes_unchanged=PASS; before and after package.json=752f46d03f7fe87f744e4441a9f79fccae3d4e09ece129ee60a0ad19abcdf47a; package-lock.json=8ee89a15cc54eb532618cf011a30f5684cedf0aa0c026cb69378bc025ec58718。
process_cleanup_result=PASS; after extraction, diagnostic installs, smoke runs, E2E, runtime-authority tests, and full suite, final ps scan found no residual unshare, chroot, npm, node-gyp, gcc, g++, or related Node processes. No persistent mount namespace remained after process exit。
first_incorrect_boundary=Node-gyp header extraction ownership preservation in bundled tar@6.2.1, before native compilation; not registry DNS, not missing prebuild itself, and not compiler/build logic。
behavior_change=lib/runtime-authority/command-registry.js now gives only npm.ci_candidate the fixed npm_config_nodedir=/runtime binding. No timeout, namespace mapping, tar ownership behavior, lifecycle script, other sandbox operation, or host root changed。
changed_files=lib/runtime-authority/command-registry.js; test/runtime-authority-command-registry.test.js; docs/smoke-tests/native-dependency-build-failure-investigation-stage-card-20260807.md
security_invariants_preserved=Existing unshare user/mount/pid namespace, chroot, fixed environment, shell=false, path broker, command registry, read-only /runtime bind, exact tool identity, lifecycle scripts, fail-closed errors, and caller raw env rejection remain intact. Binding is immutable and internal; no new host root, proxy, cache authority, or arbitrary nodedir input was added。
targeted_tests=Before patch focused regression failed as intended: 6 passed / 1 failed because npm.ci_candidate env.npm_config_nodedir was undefined. After patch focused command-registry/sandbox/prepare set passed 19/19。
production_e2e=17 passed / 0 failed. A duplicate identical E2E invocation was accidentally started when the first session did not surface output; both exited, and the captured run passed all 17 tests without runtime/service/data access。
runtime_authority_tests=78 passed / 0 failed
static_check=613 files passed
full_suite=1831 passed / 0 failed / 8 skipped
runtime_mutation=false
config_mutation=false
service_operation=false
data_access=false
failed_real_claim_untouched=true
risks=prebuild-install's exact public asset is absent for better-sqlite3@11.10.0/Node ABI 137, so fallback remains expected; the earlier prebuild request timeout is a separate network finding. npm 11.6 warns that unknown env config nodedir may stop working in a future major npm; current bound node-gyp 11.2.0 formally parses npm_config_nodedir and the generated build evidence proves current behavior. The prior 120-second timeout was not changed. No runtime rollout or live prepare was performed。
commit_hash=not committed
tag=false
push=false
recommendation=PASS_WITH_FINDINGS; ownership root cause and the fixed /runtime local-header construction path are proven and fully validated. Keep prebuild availability, npm future-config compatibility, and the separate timeout finding as follow-up stages; do not perform runtime install/reload without separate authorization。
~~~

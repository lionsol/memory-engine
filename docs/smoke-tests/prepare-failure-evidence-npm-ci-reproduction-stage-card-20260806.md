# Prepare Failure Evidence + npm-ci Reproduction Source Fix Stage Card — 2026-08-06

> Status: `AUTHORIZED_FOR_CODEX_IMPLEMENTATION`
>
> This card authorizes bounded source, test, and documentation work only. It does
> not authorize another real plan, dry-run, prepare, verify, runtime install,
> reload, service operation, configuration mutation, database/session/memory
> access, tag, or push.

## Stage decision

Can the Candidate-Builder preserve actionable failure evidence before failed
staging cleanup, reproduce the real `npm ci` failure in a disposable non-runtime
environment, and apply only the minimal evidence-backed fix without weakening
sandbox, path, one-shot, or fail-closed guarantees?

## User value

A failed one-shot prepare must leave enough evidence to identify the first real
failure boundary. The current implementation correctly consumes the run ID and
cleans unpublished staging, but it deletes the npm debug log that is needed to
distinguish an npm, network, lifecycle, native-build, or sandbox defect.

## Current verified facts

### Source and repository

- Repository HEAD at stage authorization:
  `5723d05f046e92c0c9e04886e128f035925d61a1`.
- Source tree:
  `a4728e3b847738aaa9c538eaf1de3043399cdf2d`.
- Worktree was clean before this Stage Card was created.
- Candidate-Builder implementation is under:
  - `bin/prepare-runtime-authority.cjs`;
  - `lib/runtime-authority/`.

### Failed real prepare

- Failed run ID:
  `real-plan-dry-run-20260806T112843Z-5723d05`.
- Plan SHA-256:
  `fee1feeb757aefe4685f817aa91496dc1d9f533c9e2f09eb71c29dad426a18da`.
- Dry-run decision: `PASS`.
- Dry-run mutation count: `0`.
- Dry-run findings: empty.
- One-shot prepare exit code: `2`.
- Claim exists with `outcome=FAILED`.
- Failed staging root is absent.
- Final authority root is absent.
- Git, configuration, Gateway, and Console remained unchanged.

### Observed failure boundary

The first observed failing journal stage was:

```text
DEPENDENCIES_INSTALLED
└─ npm.ci_candidate
   └─ npm ci --omit=dev
      └─ npm error: Exit handler never called!
```

The npm message is not a sufficient root cause. npm reported a debug log at:

```text
/staging/npm-cache/_logs/2026-08-06T11_37_43_436Z-debug-0.log
```

The log was removed with failed staging cleanup. No conclusion may be drawn yet
about network, DNS, proxy, certificate, lifecycle scripts, native compilation,
Node/npm compatibility, or sandbox mounts.

### Existing coverage limitation

The production E2E fixture uses local synthetic file dependencies for
`better-sqlite3` and `@lancedb/lancedb`. It validates orchestration and native
smoke structure but does not exercise the real registry dependency tree and
real install scripts represented by the repository lockfile.

## In scope

1. Preserve bounded, structured command-failure evidence before failed staging
   cleanup, including stage/operation identity, exit code, stderr, and relevant
   npm debug-log content or an integrity-bound copy.
2. Reproduce the failure with the current real package manifest/lockfile in a
   disposable temporary authority parent that does not inspect or mutate the
   live OpenClaw runtime.
3. Apply a minimal root-cause fix only when the preserved evidence identifies
   the first incorrect boundary, and add deterministic regression coverage.

## Non-goals

- no reuse, cleanup, repair, or modification of the failed claim;
- no reuse of the failed plan or run ID;
- no real plan, dry-run, prepare, or authority publication;
- no active plugin install, reload, stop, start, or restart;
- no OpenClaw configuration mutation;
- no database, LanceDB, session, memory, agent-state, or customer-data access;
- no replacement of `npm ci` with `npm install` merely to bypass the failure;
- no `--ignore-scripts`, offline, unsafe-perm, root, network, path, or sandbox
  relaxation unless the captured first-cause evidence proves it is required and
  the security effect is explicitly reviewed;
- no Node/npm downgrade or upgrade as an unproven workaround;
- no new database table, config object, long-lived state machine, production
  diagnostic CLI, OpenSpec change, tag, or push.

## Required design properties

### Failure evidence

The implementation must satisfy all of the following:

- evidence is captured before `rmSync(paths.staging, ...)`;
- evidence is associated with the exact `run_id`, plan SHA-256, journal stage,
  command-registry operation ID, and command exit code;
- npm debug logs are selected deterministically and bounded by an explicit file,
  byte, and aggregate limit;
- truncation is explicit and integrity metadata is retained where practical;
- no environment secrets, configuration contents, operator files, memory,
  sessions, or arbitrary paths are swept into evidence;
- the failed staging tree is still removed on ordinary failure;
- the claim remains `FAILED` and the run ID remains consumed;
- failure-evidence capture failure must not hide or replace the original error;
- successful prepare output and published authority layout must remain unchanged.

Codex must inspect existing path-broker and owned-root contracts before choosing
where evidence is retained. Prefer the smallest existing-authority-compatible
surface. Do not invent a broad diagnostics directory without demonstrating why
stderr-bound structured evidence or a claim-bound sidecar is insufficient.

### Disposable reproduction

The reproduction must:

- run under `/tmp` or another disposable test root;
- use the committed `package.json` and `package-lock.json` identities;
- use the same bound Node/npm and sandbox path as production prepare;
- avoid the live persistent authority parent;
- avoid active/release plugin paths except read-only source inputs already
  permitted by the harness;
- create no durable claim outside its disposable parent;
- capture stdout, stderr, npm debug logs, exit status, and relevant mount/env
  facts without exposing unrelated host environment variables;
- be one-off or test-only unless a permanent test helper is clearly justified.

The first reproduction should not include a speculative fix. Reproduce and
record the first incorrect boundary first.

### Root-cause fix gate

A behavior fix may enter this stage only when all are true:

1. the disposable reproduction matches the real failure class;
2. preserved evidence identifies a concrete first incorrect boundary;
3. a focused test fails before the patch and passes after it;
4. the fix does not weaken isolation or fail-closed behavior.

If these conditions are not met, stop with `INSUFFICIENT_EVIDENCE`. Do not add a
fallback, retry loop, npm substitution, or environment expansion.

## Expected implementation areas

Codex should inspect, not blindly modify, at least:

- `lib/runtime-authority/prepare.js`;
- `lib/runtime-authority/sandbox.js`;
- `lib/runtime-authority/sandbox-child.js`;
- `lib/runtime-authority/command-registry.js`;
- `lib/runtime-authority/stage-handlers.js`;
- `lib/runtime-authority/evidence.js`;
- `lib/runtime-authority/path-policy.js`;
- `lib/runtime-authority/owned-root.js`;
- `test/runtime-authority-prepare.test.js`;
- `test/runtime-authority-sandbox.test.js`;
- `test/runtime-authority-command-registry.test.js`;
- `test/runtime-authority-production-e2e.test.js`.

The file list is an inspection boundary, not an instruction to edit every file.
Keep the patch minimal.

## Pass criteria

1. A deterministic failure-injection test proves that command identity and npm
   debug evidence survive staging cleanup, while the claim becomes `FAILED`,
   staging/final roots are absent, and the original error remains primary.
2. A disposable real-lockfile reproduction captures the first-cause evidence;
   any behavior fix is directly justified by that evidence and has a focused
   before/after regression test.
3. Targeted runtime-authority tests, static check, relevant documentation tests,
   and the full suite pass with no runtime/config/service/data mutation.

## Allowed mutations

Allowed:

- source files under `lib/runtime-authority/` and the CLI only if required;
- focused tests and test fixtures;
- this Stage Card and bounded current-state/devlog/handoff updates after results
  are known;
- disposable files under `/tmp` for reproduction;
- ordinary local test artifacts that are removed before completion.

Not allowed:

- `.run-claims` changes for the failed real run;
- live authority parent writes;
- active/release runtime changes;
- OpenClaw configuration/service/data changes;
- commit, tag, or push unless separately authorized.

## Stop conditions

Stop and report without speculative patching if any occurs:

- reproduction requires reading live DB/session/memory or modifying runtime;
- the first-cause log cannot be safely retained within bounded evidence rules;
- the proposed fix broadens sandbox roots, inherits the host environment, or
  permits arbitrary commands/paths;
- a second unrelated subsystem enters scope;
- a new production CLI, config object, DB table, or persistent state machine is
  proposed;
- the evidence points to an external npm defect but no project-side safe fix is
  proven;
- validation requires another real prepare;
- verification work expands beyond this failure decision.

## Validation sequence

Run the narrowest checks first:

1. focused new failure-evidence unit/integration test;
2. focused sandbox and command-registry tests;
3. production E2E tests;
4. all runtime-authority tests;
5. documentation/contract tests affected by the change;
6. `node bin/static-check.js`;
7. full `npm test` because shared runtime-authority behavior is affected;
8. `git diff --check` and clean generated-artifact review.

No real prepare is part of validation.

## Required Codex report

Codex must return:

```text
task_goal=
starting_head=
changed_files=
first_reproduction_command=
first_reproduction_result=
first_incorrect_boundary=
preserved_evidence_contract=
root_cause=
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

Include concise excerpts of the decisive npm debug evidence, not the entire log.
If root cause remains unproven, report `root_cause=INSUFFICIENT_EVIDENCE` and do
not implement a speculative behavior fix.

## Codex task packet

Use the following instruction verbatim or equivalently:

```text
Work in /home/lionsol/.openclaw/workspace/plugins/memory-engine.

Read AGENTS.md and
`docs/smoke-tests/prepare-failure-evidence-npm-ci-reproduction-stage-card-20260806.md`.

Implement only the authorized Prepare Failure Evidence + npm-ci Reproduction
Source Fix stage. Start by reproducing and preserving the first failure evidence;
do not guess the npm root cause. The failed real run
`real-plan-dry-run-20260806T112843Z-5723d05` and its FAILED claim are immutable
historical evidence and must not be modified, deleted, or reused.

Do not execute any real plan, dry-run, prepare, verify, install, reload, service,
configuration, database, session, memory, tag, or push operation. Use disposable
temporary roots for reproduction. Preserve the existing one-shot claim,
fail-closed cleanup, path broker, command registry, sandbox, and host-stability
contracts.

Run targeted tests first and the full suite before completion. Do not commit
unless Sol separately authorizes it. Return the exact report required by the
Stage Card.
```

## Stage status

```text
stage=Prepare Failure Evidence + npm-ci Reproduction Source Fix
authorization=granted
implementation_actor=Codex CLI
source_edits=not started by GPT
real_prepare_authorized=false
failed_run_reuse=false
runtime_install_authorized=false
tag=false
push=false
```

## Codex report — 2026-08-06

```text
task_goal=Preserve actionable failure evidence, reproduce the real lockfile npm-ci failure in a disposable production-shaped sandbox, and apply only an evidence-backed minimal fix.
starting_head=5723d05f046e92c0c9e04886e128f035925d61a1
changed_files=
- Existing failure-evidence patch preserved: lib/runtime-authority/command-registry.js, lib/runtime-authority/evidence.js, lib/runtime-authority/prepare.js, lib/runtime-authority/sandbox.js, lib/runtime-authority/command-failure.js, and their focused tests.
- Minimal root-cause fix: lib/runtime-authority/sandbox-child.js.
- Before/after sandbox regression: test/runtime-authority-sandbox.test.js.
- Persistent reproduction/report: docs/smoke-tests/prepare-failure-evidence-npm-ci-reproduction-stage-card-20260806.md.
first_reproduction_command=
Disposable one-off Node24 harness under /tmp using SandboxRunner with the production bindings. It copied only the current package.json and package-lock.json into a fresh candidate, then ran:
operation_id=npm.ci_candidate
executable=/home/lionsol/.local/node24/bin/node
argv=/home/lionsol/.local/node24/lib/node_modules/npm/bin/npm-cli.js --prefix <tmp>/staging/candidate ci --omit=dev --no-audit --no-fund --cache <tmp>/staging/npm-cache
cwd=<tmp>/staging/candidate
outer_env=env -i PATH=/home/lionsol/.local/node24/bin:/usr/bin:/bin LC_ALL=C TZ=UTC
requested_env={}
first_reproduction_result=
Fresh disposable root: /tmp/memory-engine-npm-ci-repro-20260806-Kp1nkS
package_json_sha256=752f46d03f7fe87f744e4441a9f79fccae3d4e09ece129ee60a0ad19abcdf47a
package_lock_sha256=8ee89a15cc54eb532618cf011a30f5684cedf0aa0c026cb69378bc025ec58718
bound_node=v24.8.0 (/home/lionsol/.local/node24/bin/node)
bound_npm=11.6.0 (/home/lionsol/.local/node24/lib/node_modules/npm/bin/npm-cli.js)
result=CommandExecutionError, operation_id=npm.ci_candidate, exit_code=2
stderr=npm error Exit handler never called!
debug_log=2026-08-06T13_06_45_514Z-debug-0.log, bytes=24608, sha256=6f4be0965d6b96846271998e6448c9d42689e0731613fcd1042420d5aee22203
decisive_debug_excerpt=12 http fetch GET https://registry.npmjs.org/npm attempt 1 failed with EAI_AGAIN; 211-214 recorded cwd=/staging/candidate, Linux WSL2, node v24.8.0, npm 11.6.0; 215 error Exit handler never called!
first_incorrect_boundary=
The sandbox namespace setup bound /etc but did not expose the target of the host /etc/resolv.conf symlink. In the chroot, /etc/resolv.conf pointed to /mnt/wsl/resolv.conf, while /mnt/wsl was absent; DNS lookup therefore returned EAI_AGAIN before npm could resolve/download the lockfile dependency tree. The npm Exit handler message was secondary, not the first failure boundary.
preserved_evidence_contract=
The existing failure-evidence implementation was not rewritten. It captures structured operation identity, exit code, bounded stdout/stderr, and deterministically selected bounded npm debug logs before failed staging cleanup; the original command error remains primary and staging cleanup remains fail-closed. The focused test `failed npm command preserves bounded evidence after staging cleanup` passed.
root_cause=Project-side sandbox resolver mount omission: a symlinked /etc/resolv.conf target was outside the chroot mount set. Host read-only checks showed /mnt/wsl/resolv.conf was present and getent resolved registry.npmjs.org, while the same selected DNS diagnostic inside the sandbox reported resolv readable=false, symlink=/mnt/wsl/resolv.conf, ENOENT, and EAI_AGAIN.
behavior_change=
`sandbox-child.js` now resolves a symlinked /etc/resolv.conf target, accepts only explicit system roots (/run, /var/run, /mnt/wsl for the sandbox target; /etc, /run, /var/run, /mnt/wsl for the source), verifies a regular file, and binds only that exact file read-only before the existing system mounts are remounted read-only. Regular resolver files are unchanged; unavailable or unsafe targets fail closed.
before_after_regression=
Before the source fix, `node --test test/runtime-authority-sandbox.test.js --test-name-pattern='resolver target'` failed with ENOENT opening /etc/resolv.conf (4 passed, 1 failed). After the fix, the same focused test passed (5 passed, 0 failed); the new resolver regression also passed in the focused 18-test runtime-authority set.
after_reproduction_result=
A fresh post-fix root `/tmp/memory-engine-npm-ci-repro-after-20260806-748JSg` ran the identical npm.ci_candidate command with the same manifest/lockfile hashes and fixed environment. Its npm debug log recorded registry HTTP 200 responses, including npm, better-sqlite3, @lancedb/lancedb, apache-arrow, and other tarballs, proving the DNS boundary was repaired. The existing 120-second SandboxRunner command limit then ended this long real install with `spawnSync /usr/bin/unshare ETIMEDOUT` after partial installation (62 node_modules entries); package.json and package-lock.json remained unchanged. No timeout change or speculative workaround was made.
security_invariants_preserved=
- No real plan, dry-run, prepare, verify, plugin install/reload, service operation, configuration mutation, database/session/memory access, tag, or push was executed.
- The historical FAILED claim and run ID were not read, modified, deleted, or reused.
- Namespace flags, chroot boundary, fixed child environment, path broker, command registry, one-shot claim consumption, failed cleanup, runtime read-only bind, and fail-closed behavior remain unchanged.
- The resolver change exposes one allow-listed system file read-only; it does not bind /mnt/wsl or any host directory broadly and does not inherit the host environment.
targeted_tests=18 passed / 0 failed
production_e2e=17 passed / 0 failed
runtime_authority_tests=77 passed / 0 failed
static_check=613 files passed
full_suite=1830 passed / 0 failed / 8 skipped
runtime_mutation=false
config_mutation=false
service_operation=false
data_access=false
failed_real_claim_untouched=true
risks=The post-fix real npm-ci run reached registry HTTP 200 but exceeded the pre-existing 120-second sandbox command limit; changing that limit is outside this stage and was deliberately not attempted. The root-cause fix itself is directly evidenced by DNS restoration and the before/after regression.
commit_hash=not committed (not authorized)
tag=false
push=false
recommendation=PASS_WITH_FINDINGS — failure evidence is durable, the first incorrect boundary is proven, and the minimal sandbox resolver fix is validated. Keep the timeout finding separate; do not perform runtime rollout or claim live behavior without separately authorized reinstall/reload verification.
```

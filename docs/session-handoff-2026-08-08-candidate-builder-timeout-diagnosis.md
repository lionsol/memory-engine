# memory-engine Session Handoff — Candidate-Builder Prepare Timeout Diagnosis

> Status: current session handoff; not a runtime authority and not an execution authorization.
>
> Business timezone: Asia/Shanghai.
>
> Handoff date: 2026-08-08.

## Purpose

This handoff closes the Candidate-Builder post-fix real-prepare session and transfers the next bounded diagnosis stage into a fresh session without relying on browser transcript recall. It distinguishes `current_fact`, `accepted_design`, and `historical_record` and records the anti-drift review performed at closeout.

## Roles and authorization boundary

- Sol is the owner and explicit authorizer for runtime operations and commits.
- GPT is planner/reviewer: freeze Stage Cards, inspect evidence, define gates, and issue only `PASS`, `PASS_WITH_FINDINGS`, `INSUFFICIENT_EVIDENCE`, or `STOPPED`.
- Codex CLI is the coder/diagnostic executor when separately authorized.
- Edi is an independent runtime verifier only when runtime work is separately authorized and Gateway is available.
- DevSpace is limited to read-only inspection and explicitly authorized Markdown writing; it is not the live runtime operation surface.
- A completed stage never authorizes the next stage automatically.
- No tag or push is authorized by this handoff.

## Repository authority at session closeout

### Current facts before closeout documentation edits

~~~text
HEAD=901e7d196b81ee530ea489504a07390d352cf0c5
subject=docs(runtime): freeze post-fix one-shot prepare
branch=main...origin/main [ahead 12]
origin/main=4c7ef07a52d5f8c86a522bd00f7f9d2a942fdca7
tag_at_HEAD=none
~~~

The last product-source change in this lineage is:

~~~text
97454ee70f47f8fd4421806f4a10100b78e27186
fix(runtime): bound npm ci sandbox timeout
~~~

The later commits `352958d...`, `d3ddf118...`, and `901e7d...` are docs/runtime-gate records and do not add product runtime code.

### Uncommitted closeout documentation

At handoff creation the following documentation changes are intentionally uncommitted because commit authorization was not granted in this session:

~~~text
docs/current-state.md
docs/devlog.md
docs/smoke-tests/npm-ci-post-fetch-native-build-timeout-diagnosis-stage-card-20260808.md
docs/session-handoff-2026-08-08-candidate-builder-timeout-diagnosis.md
~~~

The diagnosis Stage Card is `READY_FOR_COMMIT`, not committed and not executable authority. The new session must inspect `git status` before doing anything else and must not silently treat these files as committed state.

## Product-source fixes already committed

### `24eca45cef3aba5669eade2207a6eaadfc520a2c`

`fix(runtime): preserve prepare failures and expose resolver target`

- preserves bounded failure evidence without masking the primary prepare error;
- exposes the exact resolver symlink target required by the sandbox path.

### `bd39f8d9ba3625f42d447f9edd70451533e3887a`

`fix(runtime): use bound node headers for npm ci`

- binds candidate native builds to the already-bound Node runtime headers under `/runtime`;
- avoids node-gyp header extraction ownership failure inside the mapped-root namespace.

### `97454ee70f47f8fd4421806f4a10100b78e27186`

`fix(runtime): bound npm ci sandbox timeout`

Committed closed policy:

~~~text
npm.ci_candidate:
  inner_timeout_ms=300000
  outer_timeout_ms=330000

ordinary registered sandbox operations:
  inner_timeout_ms=120000
  outer_timeout_ms=120000

capability-probe:
  inner_timeout_ms=120000
  outer_timeout_ms=30000
~~~

Caller plan/CLI/env values cannot override the policy. Unknown operations remain fail-closed.

Post-fix verification recorded:

~~~text
focused timeout/prepare tests=20/20
production E2E=17/17
runtime-authority tests=79/79
static check=614 files
full Node24 Asia/Shanghai suite=1832 passed / 0 failed / 8 skipped
~~~

## Session objective and outcome

### Original stage decision

The session entered with a committed post-fix one-shot real-prepare Stage Card. The intended decision was whether one exact fresh plan could be dry-run-passed and then consumed exactly once by production `prepare`, ending either:

1. with a complete published offline authority; or
2. fail-closed with a permanently consumed `FAILED` claim and bounded evidence,

without changing active OpenClaw runtime/config/services/user data.

### Actual outcome

The stage ended on branch 2: **fail-closed prepare failure**.

Formal prepare outcome:

~~~text
STOPPED
~~~

No authority was published and no runtime installation/activation followed.

## Session execution chronology

### 1. Prepare Stage Card frozen

`docs/smoke-tests/post-fix-one-shot-real-prepare-stage-card-20260807.md` was committed at:

~~~text
901e7d196b81ee530ea489504a07390d352cf0c5
~~~

This became the exact dry-run/prepare repository HEAD for the subsequent real-plan attempts.

### 2. First fresh Gate-B dry-run under final HEAD

A fresh plan was generated and dry-run-passed:

~~~text
run_id=real-plan-dry-run-20260807T125522Z-901e7d1-86bbdab5
plan_sha256=8b987fcd56e896aef2ff6288680e5677b3c37f374724336607f7ef21e53a58af
decision=PASS
mutation_count=0
preflight_findings=[]
~~~

The plan expired before prepare authorization could be consumed. No claim, staging, final authority, or prepare evidence was created. The run must not be reused or have its timestamps rewritten.

### 3. Operator packet-mixup finding

While attempting to start another fresh Gate-B run, an expired prior Gate-C prepare precheck packet was accidentally executed. It failed at:

~~~text
PLAN_EXPIRED_OR_NOT_YET_VALID
~~~

This occurred before prepare execution, claim creation, staging, or final authority mutation. It was a procedural packet-selection error, not a product failure and not a consumed new Gate-B run.

### 4. Second fresh Gate-B dry-run

A new plan was generated under the same frozen HEAD and passed Gate B:

~~~text
run_id=real-plan-dry-run-20260807T141200Z-901e7d1-692f0934
plan_path=/home/lionsol/.openclaw/backups/memory-engine/runtime-authority-plans/real-plan-dry-run-20260807T141200Z-901e7d1-692f0934.json
plan_sha256=343e3ac48a99cc48c0d6047ea7feaca304392ef8496e02bddb7c61b210f4b097
created_at=2026-08-07T14:12:00.504Z
expires_at=2026-08-07T14:32:00.504Z

decision=PASS
mutation_count=0
preflight_findings=[]
dry_run_contract_pass=true
plan_parent_mutation_correct=true
~~~

Source/config/runtime/service/history and the plan SHA remained stable. No claim/staging/final authority was created by dry-run.

### 5. Separately authorized one-shot prepare

The final pre-prepare gate passed at:

~~~text
checked_at=2026-08-07T14:27:42.097Z
~~~

with the exact same HEAD/run/plan/SHA and the plan still unexpired.

Production prepare was invoked exactly once. It returned:

~~~text
prepare_exit_code=2
stderr=spawnSync /usr/sbin/chroot ETIMEDOUT
failure_operation_id=npm.ci_candidate
failure_command_exit_code=2
failure_journal_stage=DEPENDENCIES_INSTALLED
~~~

`failure_journal_stage=DEPENDENCIES_INSTALLED` identifies the stage being attempted when failure evidence was recorded; it does not mean dependency installation completed successfully.

## Immutable consumed-run evidence

### Older historical failed prepare

~~~text
run_id=real-plan-dry-run-20260806T112843Z-5723d05
plan_sha256=fee1feeb757aefe4685f817aa91496dc1d9f533c9e2f09eb71c29dad426a18da
claim_outcome=FAILED
claim_sha256=9e03ad3c0d65d5e419789cee9cfe4dc2fdaec0489ee01e6b6e3c95a79627a15d
~~~

Its historical staging/final authority roots remain absent. Do not repair, rewrite, delete, or repurpose it.

### Current failed prepare

~~~text
run_id=real-plan-dry-run-20260807T141200Z-901e7d1-692f0934
plan_sha256=343e3ac48a99cc48c0d6047ea7feaca304392ef8496e02bddb7c61b210f4b097
claim_outcome=FAILED
claim_sha256=83682f781f88b2c291942d5d439600b4f22c4aace9e27db80aacaa009f14e941
failure_evidence_sha256=f4544060abfa3ba34fd2a81371d3180337cc87c2faca62371204430fe4fd24af
~~~

Fail-closed end state:

~~~text
claim=FAILED
failure_evidence=present, mode 0600
staging=absent
final_authority=absent
authority.json=absent
checksums=absent
recovery_required=false
~~~

This run is permanently consumed. Never run `prepare` against it again.

## Runtime/config/service stability evidence

After the failed prepare:

~~~text
active_root=/home/lionsol/.openclaw/extensions/memory-engine
active_release=/home/lionsol/.openclaw/backups/memory-engine/releases/post-h6-v2-f887e18-20260802T124938Z
config_sha256=2ce0efff8aa0354458062e1dbdab25a14ccd1542dfa7028aa1807577fc83e3f7

Gateway:
  active/running
  PID=204419
  NRestarts=0

Console:
  active/running
  PID=693
  NRestarts=0
~~~

The post-prepare report recorded:

~~~text
source_stable=true
runtime_binding_stable=true
config_stable=true
service_stable=true
historical_claim_stable=true
verify_executed=false
runtime_install=false
~~~

No runtime install, reload/restart, config write, DB/session/memory access, AutoRecall change, tag, or push occurred.

## npm-ci timeout diagnosis already established

### Current fact

The failure timing is consistent with the committed inner watchdog actually firing, not with timeout-policy binding failure:

~~~text
claim_at=2026-08-07T14:27:51.577Z
npm_ci_log_start=2026-08-07T14:27:56.597Z
failure_evidence_at≈2026-08-07T14:32:57.909Z
~~~

The actual product policy is still:

~~~text
npm.ci_candidate inner=300000ms
npm.ci_candidate outer=330000ms
~~~

### Prior successful timing samples

~~~text
historical cold=179269ms
fresh cold=210551ms
fresh warm=175561ms
~~~

Those samples legitimately produced the current 300000/330000 product budget under the previously frozen formula. The failed real prepare is not a successful duration sample and must not be converted into one.

### New retained post-fetch evidence

The bounded npm log captured successful registry fetches including:

~~~text
@lancedb/lancedb   ≈3871ms
apache-arrow       ≈5189ms
@types/node        ≈5834ms
better-sqlite3    ≈13799ms
~~~

`better-sqlite3@11.10.0` has an install script. Earlier evidence established that Node `v24.8.0`, ABI `137` takes the node-gyp fallback path for this dependency in the relevant environment.

The current evidence does **not** yet prove whether the post-fetch/lifecycle/native-build path:

- was legitimately still progressing after 300 seconds; or
- was stalled/hung on a child process/resource boundary.

Therefore merely increasing 300000ms is not authorized.

## Closeout anti-drift review

### Product-goal drift

**No material product-goal drift found.**

The session remained inside the Candidate-Builder authority-publication objective. When the one-shot transaction failed, the stage ended `STOPPED`; continuation did not reuse the failed run or silently change the timeout. Creating a separate diagnosis decision is the correct mandatory drift response under `AGENTS.md`.

### Procedural drift / process finding

One stale prepare precheck packet was executed while the operator intended a fresh Gate-B packet. The expiry gate prevented all mutation. This is a bounded operational finding, not authorization for a new CLI, script, retry system, or state machine.

New-session operational discipline:

- treat every long execution packet as stage-bound;
- inspect whether `RUN_ID`/`PLAN_SHA256` are fixed before executing;
- a Gate-B generator must not contain an old fixed run ID;
- a Gate-C prepare packet must name the exact dry-run-passed immutable four-tuple.

Do not implement new automation merely because this copy/paste error occurred once.

### Documentation drift

The previous handoff dated 2026-08-06 ended before all real-plan work and is historical only. At closeout:

- `docs/current-state.md` was stale at the original Candidate-Builder implementation and omitted later source fixes;
- `docs/devlog.md` lacked the Aug-07/Aug-08 prepare evidence;
- no handoff covered the consumed failed run and the new diagnostic decision.

This session updated those documents in the worktree but did not commit them.

### Diagnosis-card logic correction

The first draft incorrectly treated reaching a 15-minute diagnostic ceiling as proof of `STALL_OR_HANG`.

That was corrected before handoff:

~~~text
15-minute ceiling reached
  -> stop the disposable run
  -> if direct stall evidence exists: STALL_OR_HANG
  -> if meaningful progress continues or evidence is ambiguous: INSUFFICIENT_EVIDENCE
~~~

A timeout ceiling is a safety boundary, not proof of a hang.

### Product-source vs docs-HEAD distinction

The diagnosis card now distinguishes:

~~~text
product-source baseline=97454ee70f47f8fd4421806f4a10100b78e27186
pre-card repository HEAD=901e7d196b81ee530ea489504a07390d352cf0c5
~~~

This prevents later docs-only commits from being mistaken for new product runtime behavior.

## Planned work compared with actual work

| Planned / expected step | Actual result | Closeout status |
| --- | --- | --- |
| Freeze one-shot prepare Stage Card | committed at `901e7d...` | complete |
| Generate fresh plan under final HEAD | done | complete |
| Exactly one read-only dry-run | passed; first plan later expired | complete |
| Do not reuse expired plan | respected | complete |
| Generate a second fresh plan only after expiry | done | complete |
| Separate prepare authorization | obtained | complete |
| Exactly one prepare for second plan | executed once | complete |
| Publish complete authority | did not occur | failed branch, expected fail-closed |
| Preserve FAILED claim/evidence | done | complete |
| Remove unpublished staging | done | complete |
| Leave active runtime/config/services unchanged | proven | complete |
| Do not auto-run verify/install | respected | complete |
| Determine why 300s failed | narrowed to post-fetch/lifecycle boundary, not fully classified | intentionally incomplete blocker diagnosis |
| Start source timeout fix | not authorized and not performed | correctly deferred |

## Remaining omissions / unresolved decisions

These are intentional unresolved items, not silently completed work:

1. The post-fetch/native-build behavior is not yet classified as `LEGITIMATE_SLOW` or `STALL_OR_HANG`.
2. No new product timeout value is selected or authorized.
3. No source fix exists after `97454ee...` for this new blocker.
4. The new diagnosis Stage Card is uncommitted and authorizes no execution by itself.
5. The closeout documentation updates are uncommitted.
6. No fresh real plan/dry-run/prepare may be attempted before the new diagnosis is completed and a later source decision, if any, is separately authorized.
7. `verify --authority`, runtime install/reload, AutoRecall, H6 canary, tag, and push all remain unauthorized.

## New diagnosis Stage Card

Path:

~~~text
docs/smoke-tests/npm-ci-post-fetch-native-build-timeout-diagnosis-stage-card-20260808.md
~~~

Status:

~~~text
READY_FOR_COMMIT
~~~

Single decision:

> When the production-shaped `npm.ci_candidate` crosses the existing 300-second inner boundary after registry fetches, is the remaining native/lifecycle work legitimately finite and progressing, or is it stalled/hung?

Boundaries:

- disposable root only;
- production-shaped CommandRegistry/SandboxRunner/sandbox-child path;
- finite diagnostic ceiling, maximum 15 minutes;
- bounded process/lifecycle observability;
- at most one second disposable confirmation only if the first run is ambiguous or materially inconsistent;
- no product source fix in the diagnosis stage;
- no runtime-authority transaction state;
- no real plan/dry-run/prepare/verify;
- no runtime/config/service/DB/session/memory mutation;
- no timeout enlargement merely because the 300-second run failed.

Possible diagnosis classifications:

~~~text
LEGITIMATE_SLOW
STALL_OR_HANG
INSUFFICIENT_EVIDENCE
~~~

GPT stage outcomes remain only:

~~~text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
~~~

## Correct next-session sequence

1. Read `AGENTS.md`.
2. Read `docs/current-state.md`.
3. Read this handoff.
4. Read `docs/smoke-tests/npm-ci-post-fetch-native-build-timeout-diagnosis-stage-card-20260808.md`.
5. Inspect `git status`, exact HEAD, `origin/main`, and the four closeout documentation changes. Do not assume they were committed after this handoff.
6. Review that the diagnosis-card classification correction is present.
7. Do **not** run diagnosis, real dry-run, prepare, verify, install, reload, or runtime mutation merely from this handoff.
8. The first owner decision in the new session should be the documentation/Stage-Card commit boundary. Commit/tag/push remain separately authorized.
9. Only after a clean frozen docs/source HEAD and separate Sol authorization may Codex execute the disposable diagnosis.
10. After diagnosis, GPT must issue a stage outcome before any source fix is designed or implemented.

## Concise state for the new session

~~~text
product_source_baseline=97454ee70f47f8fd4421806f4a10100b78e27186
pre_closeout_docs_HEAD=901e7d196b81ee530ea489504a07390d352cf0c5
origin_main=4c7ef07a52d5f8c86a522bd00f7f9d2a942fdca7
push=false
tag=false

current npm.ci_candidate policy=300000ms inner / 330000ms outer

latest real prepare run=real-plan-dry-run-20260807T141200Z-901e7d1-692f0934
latest real prepare outcome=FAILED / STOPPED
failure operation=npm.ci_candidate
failure reason=chroot inner timeout ETIMEDOUT
claim=FAILED
failure evidence=present
staging=absent
final authority=absent
recovery_required=false
active runtime/config/services=stable
verify=false
runtime install=false

next decision=post-fetch/native-build timeout diagnosis
new Stage Card=READY_FOR_COMMIT, uncommitted
diagnosis execution=NOT AUTHORIZED by this handoff
source timeout change=NOT AUTHORIZED
real plan/dry-run/prepare=NOT AUTHORIZED
verify/install/reload=NOT AUTHORIZED
~~~

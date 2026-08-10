# Session-Flush Reconciliation Runtime Qualification Retry R2 Stage Card — 2026-08-10

> Status: `FROZEN` — not committed; execution requires separate Sol authorization after commit.
>
> Retry scope: runtime qualification harness only. No product/source behavior change.
>
> Parent Stage Card: `docs/smoke-tests/session-flush-reconciliation-runtime-install-nonlive-qualification-stage-card-20260810.md`
>
> Parent Stage Card SHA256: `1df494937cf0d1e2d487c88682910be090f1f3a71befe1de7a908edfb598cb8e`
>
> Source implementation commit: `ac0e5f054551847e724be504bae80947abd7d675`
>
> Parent runtime Stage Card commit: `e84de07539d86737c9d719bb75bbed3ecab2359f`

## 1. Decision

Can the already-qualified immutable `ac0e5f0` runtime candidate be temporarily installed and non-live qualified under a corrected execution harness that preserves terminal continuity, persists evidence, guarantees the single planned R2 restoration after any candidate-install attempt, and isolates OpenClaw JSON from plugin log noise?

Choose exactly one result:

~~~text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
~~~

This retry does not reopen candidate construction, product implementation, persistent activation, or real-data reconciliation.

## 2. Why R2 exists

The parent execution completed:

~~~text
Phase A = PASS
Phase B = PASS
~~~

and therefore produced a persistent, offline-qualified candidate.

The parent Phase C did not yield usable candidate-active qualification evidence because the operator pasted a shell packet containing `exit` statements directly into an interactive WSL shell. A failure branch exited the shell itself, which closed the WSL window and interrupted visible evidence collection.

Post-interruption recovery probe established:

- repository authority remained `e84de07539d86737c9d719bb75bbed3ecab2359f`;
- Gateway was running and healthy;
- plugin was loaded from the R2 rollback release;
- active three old target hashes matched R2;
- active `session-flush-reconciliation.js` was absent;
- provenance files and package/lock matched R2;
- no maintenance process was running;
- checkpoint `lastRunAtMs` remained the scheduled `2026-08-10 03:30:00.022 +0800` run;
- therefore no scheduled checkpoint occurred during the interrupted transaction.

Parent stage outcome is frozen as:

~~~text
STOPPED
~~~

The failure is classified as an execution-harness defect, not a demonstrated memory-engine product defect.

## 3. Retry classification

This stage is a `retry R2` of runtime qualification only.

Allowed reason for retry:

~~~text
execution harness failed to preserve shell/evidence continuity
~~~

Not allowed as a reason to change:

- reconciliation semantics;
- source implementation;
- candidate contents;
- retrieval behavior;
- runtime config;
- cron behavior;
- data state.

No source coding substage is opened.

## 4. Fixed authorities

At freeze planning time:

~~~text
repository HEAD=
e84de07539d86737c9d719bb75bbed3ecab2359f

source implementation commit=
ac0e5f054551847e724be504bae80947abd7d675

rollback/base release=
/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2

existing qualified candidate=
/home/lionsol/.openclaw/backups/memory-engine/releases/session-flush-reconciliation-overlay-ac0e5f0-20260810-r1

active install path=
/home/lionsol/.openclaw/extensions/memory-engine
~~~

A later execution packet must bind the exact committed retry Stage Card HEAD and SHA256 in addition to these fixed authorities.

## 5. Candidate reuse decision

Decision:

~~~text
REUSE_EXISTING_QUALIFIED_CANDIDATE_AS_IMMUTABLE_ARTIFACT
~~~

Do not construct a new candidate.

Do not modify, chmod, reseal, repair, delete, rename, or overwrite the existing candidate.

Reuse is permitted only if preflight proves all frozen candidate identity conditions still hold.

Reason:

- the candidate already passed parent Phase B construction and offline qualification;
- current inspection proves it still exists;
- its four target hashes remain frozen;
- its delta over R2 remains exactly three modified runtime files plus one added runtime module;
- its root/directories remain mode `500` and target files mode `400`;
- creating another byte-equivalent candidate would add mutation without new evidence value.

If any candidate identity check fails, stop. Do not rebuild it under this retry.

## 6. Frozen candidate hashes

~~~text
bin/session-checkpoint.js
544dd01c33e1e4b435be4695df5b4dc28621223f5e76505a4d4298423a8a36dd

lib/checkpoint/orphan-repair.js
157e298a1a509f2aa19446223ab1334fee6114da10c3055d3a2542087476ff4f

lib/checkpoint/runtime.js
dbae65c9e0aa647d6cf94dab458cf5bec7115dbd6e6fbaa5307e1421ff0bb13a

lib/checkpoint/session-flush-reconciliation.js
d3d40da9e40f0fb3762d1953fda09b04c134e90096f29a94c8eb90ce6971c25a
~~~

The exact candidate delta over R2 must remain:

~~~text
modified bin/session-checkpoint.js
modified lib/checkpoint/orphan-repair.js
modified lib/checkpoint/runtime.js
added    lib/checkpoint/session-flush-reconciliation.js
~~~

No fifth runtime/source file is allowed.

## 7. Frozen R2 restoration hashes

~~~text
bin/session-checkpoint.js
1e39d12bcebe37728613b3b420ee7402ba0aa8833ae21fd8f58fa842075837e9

lib/checkpoint/orphan-repair.js
837587ef75174d8aefbd36d97839c3487b10d9b92a872ad6292e7f078b7a3035

lib/checkpoint/runtime.js
1ca5deba67cacc688fca844ca7c02dbdefdb510f9909ec75bd57f64d63965b62

lib/checkpoint/session-flush-reconciliation.js
ABSENT
~~~

Existing provenance files and package/lock must remain inherited from R2.

## 8. Candidate permission identity

Before runtime mutation, candidate must still prove:

~~~text
candidate root                    500
candidate/bin                     500
candidate/lib                     500
candidate/lib/checkpoint          500
three modified target files       400
new reconciliation module         400
owner/group                        lionsol:lionsol
~~~

Permission drift is a stop condition.

No permission mutation is authorized in R2 retry.

## 9. Runtime baseline required before retry

Before any Gateway stop:

1. exact repository HEAD and retry Stage Card SHA/commit must match the authorized packet;
2. worktree must be clean;
3. candidate immutable identity must pass Sections 5–8;
4. R2 rollback release must exist;
5. active runtime must be R2:
   - Gateway healthy;
   - plugin loaded;
   - `install.sourcePath` equals R2;
   - `install.installPath` equals active install path;
   - version `0.8.22`;
   - R2 target hashes restored;
   - new module absent;
6. Node24 must resolve to `/home/lionsol/.local/node24/bin/node`;
7. Node must be `v24.8.0` or another explicitly reviewed Node24 with ABI `137`;
8. candidate dependency closure must load `better-sqlite3` without rebuild/install;
9. AutoRecall effective state must remain disabled;
10. `session-checkpoint` cron must remain enabled at `30 3 * * *`, timezone `Asia/Shanghai`;
11. next checkpoint run must be more than 60 minutes away;
12. no `session-checkpoint`, `flush-session-rawlog`, `openclaw-memory`, reconciliation, or orphan-repair process may be running.

Any failure stops before Gateway mutation.

## 10. Harness design correction

R2 execution must not paste a transaction body containing top-level `exit` commands directly into the operator's interactive WSL shell.

Use one bounded transaction script executed as a child process of the interactive shell.

The child script may exit non-zero; the parent interactive shell must remain open.

The operator invocation must have the form semantically equivalent to:

~~~text
bash <fixed-temp-script-path>
RC=$?
echo R2_TRANSACTION_RC=$RC
~~~

The transaction script itself may use `exit`, because it is a child process.

The exact temporary script path must be fixed in the later execution packet.

Suggested fixed path:

~~~text
/tmp/memory-engine-runtime-qualification-retry-r2-20260810.sh
~~~

Creation of that one temporary script is an authorized harness mutation only during separately authorized execution.

The script must not be created inside the repository, active extension, rollback release, candidate release, memory directories, or OpenClaw config directories.

## 11. Persistent evidence log

R2 must preserve execution evidence independently of terminal rendering.

Fixed log path for a later execution packet should be:

~~~text
/tmp/memory-engine-runtime-qualification-retry-r2-20260810.log
~~~

Requirements:

- path must not already exist before execution;
- if it exists, stop rather than overwrite;
- all transaction stdout/stderr produced by the child harness must be appended/captured to this one log;
- operator terminal may mirror the log with `tee`, but persistent log is authoritative if terminal rendering is interrupted;
- the transaction must record its own final result marker;
- do not log secrets, provider tokens, embedding keys, message contents, memory contents, or broad environment dumps.

The log is bounded private transaction evidence outside the repository.

## 12. OpenClaw inspect JSON isolation

The parent/recovery harness observed plugin initialization/log text near `openclaw plugins inspect memory-engine --runtime --json` output. Merging stderr with stdout caused a later `jq` parse failure.

R2 must never use:

~~~text
openclaw ... --json 2>&1 | jq ...
~~~

for plugin identity.

Instead:

1. capture stdout to a dedicated temporary JSON file;
2. capture stderr to a separate bounded diagnostic file or the main transaction log;
3. run `jq` only on the stdout JSON file;
4. require `jq -e` parse success before trusting fields;
5. delete or retain temporary inspect JSON only according to the execution packet; no repository writes.

Fixed scratch JSON paths may be under `/tmp` and must not overlap memory/runtime data.

Plugin initialization log text on stderr is a finding, not itself a qualification failure, if JSON stdout remains valid and no prohibited data operation occurs.

## 13. Fail-safe restoration model

The central R2 correction is restoration reliability.

Once candidate installation is attempted, the transaction must enter:

~~~text
RESTORATION_REQUIRED=true
~~~

and must not clear that requirement until R2 restoration has been proven.

Use a child-script cleanup mechanism equivalent to `trap`/`finally` on:

~~~text
EXIT
INT
TERM
HUP
~~~

The cleanup logic must be idempotent within the single process, protected against recursive trap execution, and must attempt the single authorized R2 restoration when `RESTORATION_REQUIRED=true`.

The normal success path must also execute the same restoration routine before exit.

Candidate success never clears the restoration requirement.

## 14. Restoration attempt budget

Under one R2 authorization:

~~~text
candidate install attempts = maximum 1
R2 restoration installs    = maximum 1
~~~

The restoration routine must track whether the R2 install attempt has already occurred.

Do not make a second R2 install attempt from both normal flow and trap cleanup.

If the normal path restored R2 successfully, trap cleanup must recognize restoration complete and perform no second install.

If the one restoration attempt fails, stop and require a new recovery authorization.

## 15. Gateway behavior

Sol remains the runtime operator.

Allowed runtime sequence:

1. preflight with Gateway running healthy on R2;
2. stop Gateway;
3. install existing immutable candidate once;
4. start Gateway;
5. run candidate-active non-live qualification;
6. stop Gateway;
7. install R2 once;
8. start Gateway;
9. verify final R2 health/identity;
10. exit child transaction process and report.

If candidate install/start/qualification fails after candidate install was attempted, skip remaining candidate checks and go directly to the single R2 restoration routine.

Do not patch/reinstall candidate.

## 16. Candidate-active qualification

No user prompt, memory query, retrieval call, AutoRecall request, H6 turn, natural canary, synthetic retrieval probe, checkpoint execution, reconciliation, backfill, index, or memory tool call is allowed.

Verify only:

### 16.1 Plugin identity

- Gateway healthy;
- plugin loaded;
- version `0.8.22`;
- install path active extension;
- `install.sourcePath` equals existing immutable candidate.

### 16.2 Active byte parity

Active installed hashes must equal the four frozen candidate hashes.

Also prove:

- R2 provenance files remain unchanged;
- package.json remains R2;
- package-lock.json remains R2.

### 16.3 Module loadability

Under Node24, only require/import:

- `lib/checkpoint/session-flush-reconciliation.js`;
- `lib/checkpoint/orphan-repair.js`;
- `bin/session-checkpoint.js` with `require.main !== module`.

Do not invoke exported runtime/data operations.

Verify bounded constants/contracts such as:

~~~text
MAX_ENGINE_INSERTS_PER_CYCLE=500
MAX_LANCE_WRITES_PER_CYCLE=10
pure parser export exists
~~~

### 16.4 Pure parser contract

Use only synthetic in-memory Markdown.

Must prove:

- canonical `session_flush/raw_log` entry parses;
- nested ordinary body H2 headings do not split it;
- second true canonical entry remains distinct;
- provenance/category remain correct.

No file/DB access is required for this check.

### 16.5 Static orchestration identity

Read active `bin/session-checkpoint.js` as text and prove intended order:

~~~text
nightlyCheckpoint
→ reconcileSessionFlushManagedState
→ repairOrphanVectors({ scope: "session_flush" })
→ resolveConfigConflicts
~~~

Static source inspection only.

### 16.6 No scheduled checkpoint during candidate-active interval

Record checkpoint `lastRunAtMs` immediately before candidate activation and again before R2 restoration/final close.

A passing candidate-active interval requires the value to remain unchanged and no maintenance process to be observed.

Do not inspect Engine/Lance/Core contents merely to prove no reconciliation.

## 17. Mandatory R2 restoration

Regardless of candidate qualification outcome, if candidate installation was attempted, restore R2 before final stage close unless the single restoration attempt fails.

Final passing restoration evidence:

~~~text
Gateway=running healthy
plugin=loaded
version=0.8.22
install.sourcePath=R2 rollback/base release
install.installPath=active extension
~~~

and:

- three old active target hashes equal Section 7;
- active new reconciliation module is absent;
- provenance files equal R2;
- package/lock equal R2;
- checkpoint `lastRunAtMs` did not advance during candidate-active interval;
- no maintenance process remains.

A retry stage cannot pass if R2 restoration is unproven.

## 18. Real-data safety boundary

This R2 stage must not intentionally access or mutate real memory data.

Forbidden:

- execute `bin/session-checkpoint.js` main;
- call `nightlyCheckpoint()`;
- call `reconcileSessionFlushManagedState()` on real data;
- call scoped/global `repairOrphanVectors()` on real data;
- run `openclaw memory index`;
- run memory-engine sync/backfill/reindex;
- invoke production embeddings;
- write Lance;
- mutate Core DB;
- mutate Engine DB;
- mutate smart-add/episode/session files;
- inspect DB contents merely for reassurance.

The plugin may initialize normal runtime dependencies as part of Gateway/plugin load. That alone is not evidence of reconciliation.

## 19. No persistent activation

Even if candidate qualification fully passes, R2 must be the final active runtime.

This retry proves only temporary installability/loadability/non-live contract compatibility.

It does not authorize leaving the candidate installed across the next `03:30` checkpoint.

## 20. Explicit non-goals

Do not:

- modify source implementation;
- create a new candidate;
- change candidate bytes or permissions;
- change R2 rollback release;
- change `openclaw.json`;
- change cron;
- enable AutoRecall;
- change retrieval/query/FTS/vector/KG/fusion/ranking/topK/threshold/Card/gate behavior;
- run canaries;
- run Edi;
- run Codex;
- create OpenSpec/schema/config/CLI/ledger/queue/state machine;
- install npm dependencies or rebuild native modules;
- commit/tag/push during runtime execution;
- treat successful temporary qualification as persistent activation.

## 21. Allowed execution mutations

Only after separate R2 runtime execution authorization:

1. create one fixed child transaction script under `/tmp`;
2. create one fixed persistent transaction log under `/tmp`;
3. create bounded temporary inspect JSON/diagnostic files under `/tmp`;
4. stop/start Gateway as required by candidate transaction;
5. install existing immutable candidate once;
6. install fixed R2 release once for mandatory restoration;
7. remove bounded temporary harness scratch files only if the execution packet explicitly requires it.

No repository/runtime source/config/data mutation beyond the two plugin install transactions is authorized.

## 22. Stop conditions before candidate install

Stop without Gateway/runtime mutation if:

- execution authority drifts;
- worktree dirty;
- candidate identity/hash/delta/permissions drift;
- R2 active baseline drift;
- candidate or rollback path differs from fixed authorities;
- Node24/ABI/native load fails;
- AutoRecall unexpectedly enabled;
- checkpoint cron differs or next run is within 60 minutes;
- maintenance process is active;
- fixed log/script/scratch path collision cannot be safely resolved under packet rules;
- JSON isolation cannot be established.

Do not rebuild candidate.

## 23. Stop conditions after candidate install attempt

After candidate install is attempted, candidate qualification is failed/stopped if:

- install returns failure or ambiguous mutation state;
- Gateway cannot start/health check;
- plugin identity differs;
- active hashes differ;
- module/pure-parser/static checks fail;
- scheduled checkpoint begins;
- any prohibited real-data operation is observed;
- unplanned runtime/config mutation appears.

Then go directly to the single R2 restoration routine.

## 24. Restoration failure semantics

If the single R2 restoration attempt fails or final R2 identity cannot be proven:

- do not attempt a second reinstall under the same authorization;
- keep/put Gateway stopped if needed to prevent an unproven candidate from surviving to the next checkpoint;
- preserve execution log and candidate artifact;
- return `STOPPED`;
- require separate Sol recovery authorization.

## 25. Retry execution identity and count

The parent execution count is consumed and closed.

This R2 Stage Card creates a new execution identity only after:

1. Stage Card is committed under separate commit authorization;
2. Sol separately authorizes R2 runtime execution.

The later R2 execution packet must set:

~~~text
MAX_EXECUTIONS=1
~~~

and that count is independent of the consumed parent transaction.

The R2 count becomes consumed when the child transaction first performs a runtime mutation (normally Gateway stop immediately preceding candidate install) or another mutation boundary explicitly frozen in the later packet.

Read-only preflight does not consume it.

## 26. Required R2 execution report

Report at least:

- retry Stage Card path/SHA/commit/HEAD;
- source implementation commit;
- parent stopped transaction reference;
- existing candidate reuse decision;
- candidate exact hashes/delta/permissions;
- R2 active preflight identity;
- Node24/ABI/native closure;
- cron safety window and pre `lastRunAtMs`;
- child script path;
- persistent log path;
- confirmation interactive parent shell remained open after child result;
- candidate install result;
- candidate-active plugin identity;
- candidate-active four-file hashes;
- module-load result;
- pure parser result;
- static orchestration result;
- candidate-active checkpoint evidence;
- mandatory R2 restoration attempt/result;
- final R2 plugin identity/hashes/new-module absence;
- final Gateway state;
- final checkpoint evidence;
- stage outcome;
- exactly one successor recommendation at most.

## 27. Pass criteria

`PASS` requires all of:

1. immutable candidate identity requalified without mutation;
2. corrected child-process harness preserves operator shell continuity and persistent evidence;
3. candidate installed exactly once;
4. candidate Gateway/plugin healthy and exact identity proven;
5. byte/module/parser/static non-live checks pass;
6. no scheduled checkpoint/reconciliation/retrieval/data operation occurs;
7. R2 restored exactly once and final identity proven;
8. Gateway healthy on R2 at close;
9. persistent activation remains absent.

`PASS_WITH_FINDINGS` is allowed only for non-blocking harness/log observations that do not weaken these criteria.

`INSUFFICIENT_EVIDENCE` is allowed only when the transaction safely returns to R2 but a required qualification fact cannot be proven without violating the stage boundary.

`STOPPED` applies when a stop condition occurs, including any restoration failure or candidate qualification failure requiring rollback.

## 28. State semantics after PASS

A passing R2 stage establishes only:

~~~text
current_fact:
the ac0e5f0 candidate can be temporarily installed and non-live qualified
under Node24 using the corrected retry harness, and R2 can be restored.

current active runtime after stage:
R2 provenance release.

persistent activation:
NOT AUTHORIZED / NOT IMPLEMENTED.

real Core→Engine reconciliation:
NOT PERFORMED / NOT AUTHORIZED.

real Engine→Lance reconciliation:
NOT PERFORMED / NOT AUTHORIZED.
~~~

Do not describe the candidate as current active runtime after PASS.

## 29. Successor boundary

After R2 outcome, stop.

Do not automatically:

- persistently install candidate;
- run historical/live reconciliation;
- change cron;
- enable AutoRecall;
- run natural canary;
- tune retrieval;
- start Candidate-Builder;
- tag or push.

A later persistent-activation/real-lifecycle decision requires a new Stage Card and separate Sol authorization.

## 30. Authorization boundary at freeze

~~~text
Retry R2 Stage Card=FROZEN
Retry R2 Stage Card commit=NOT_AUTHORIZED
Retry R2 runtime execution=NOT_AUTHORIZED
Existing candidate reuse=ACCEPTED_DESIGN_FOR_THIS_RETRY
Existing candidate mutation=NOT_AUTHORIZED
New candidate construction=NOT_AUTHORIZED
Temporary candidate install=NOT_AUTHORIZED
Mandatory R2 restoration=authorized only inside later R2 execution packet
Persistent activation=NOT_AUTHORIZED
Real-data reconciliation=NOT_AUTHORIZED
AutoRecall enablement=NOT_AUTHORIZED
Commit/tag/push=NOT_AUTHORIZED
Retry R2 MAX_EXECUTIONS=not created/consumed until post-commit execution authorization
~~~

This Stage Card authorizes nothing by itself.

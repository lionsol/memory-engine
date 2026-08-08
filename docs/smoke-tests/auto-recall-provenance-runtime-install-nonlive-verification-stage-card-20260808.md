# AutoRecall Provenance Runtime Install + Non-Live Verification Stage Card — 2026-08-08
> Status: `FROZEN` — runtime execution requires separate Sol authorization after commit
>
> Source implementation commit: `1cd183ff12d055ba5c5ecd4bd0d9d1b98cdff23b`
>
> This card authorizes no runtime mutation by itself.

## Decision
Can the bounded AutoRecall candidate-provenance instrumentation from `1cd183ff...` be installed into the active OpenClaw runtime with an exact rollback authority and then verified non-live, without deploying unrelated retrieval changes?

Choose exactly one transaction result:

~~~text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
~~~

## Current verified baseline
- repository HEAD at planning time: `1cd183ff12d055ba5c5ecd4bd0d9d1b98cdff23b`;
- OpenClaw: `2026.6.9`;
- plugin: `memory-engine` `0.8.22`, status `loaded`;
- active install path: `/home/lionsol/.openclaw/extensions/memory-engine`;
- current rollback/source release: `/home/lionsol/.openclaw/backups/memory-engine/releases/post-h6-v2-f887e18-20260802T124938Z`;
- Gateway is currently running under Node 24;
- rollback release exists and its two target files match the current active extension byte-for-byte;
- active runtime does not yet contain the new provenance markers.

## Candidate strategy
Do **not** install the full repository checkout.

Build one persistent overlay candidate from the verified rollback release, then replace exactly these two files with the versions from `1cd183ff...`:

~~~text
lib/recall/hybrid-search.js
lib/recall/auto-recall-debug-metadata.js
~~~

Reason: the repository also contains an uninstalled `normalize-candidate.js` semantic change. Full-HEAD installation would deploy unrelated retrieval behavior and violates this stage boundary.

Candidate path is fixed to `/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808` and must not already exist. If it exists, stop rather than overwrite it.

## Candidate preflight contract
Before stopping Gateway, verify all of the following:
1. repository HEAD and Stage Card identity match the authorized packet;
2. rollback release and active install path both exist;
3. candidate starts as an exact copy of the rollback release;
4. after overlay, only the two authorized files differ from rollback;
5. candidate hashes for those two files equal the `1cd183ff...` source hashes;
6. `package.json` and `package-lock.json` remain identical to rollback;
7. Node24 can load the candidate dependency closure, including `better-sqlite3`;
8. AutoRecall configuration remains disabled before installation.

Any failure before Gateway stop ends the transaction without runtime mutation.

## Runtime transaction
Sol is the runtime operator.

If and only if candidate preflight passes:
1. record a bounded pre-install runtime/config baseline;
2. stop Gateway;
3. install the candidate once with the explicitly resolved OpenClaw CLI and `--force`;
4. verify install record points to the candidate path before starting Gateway;
5. start Gateway;
6. perform only the non-live verification below.

No second candidate install attempt is permitted under the same execution authorization.

## Non-live verification
Do not send a user prompt, memory query, AutoRecall request, H6 turn, natural canary, or synthetic retrieval probe.

Verify only:
- Gateway returns to running/healthy state;
- `openclaw plugins inspect memory-engine --runtime --json` reports plugin `loaded`;
- installPath remains `/home/lionsol/.openclaw/extensions/memory-engine`;
- sourcePath equals the new persistent candidate path;
- active installed target-file hashes equal the candidate/source hashes;
- all non-target candidate files remain inherited from the verified rollback release;
- active source contains `channel_candidate_provenance` and `fusion_candidate_provenance` markers;
- installed metadata projector can be imported under Node24 without touching OpenClaw data;
- an in-memory projector-only contract check returns bounded ID/count/truncation/fusion fields and no content/path/query fields;
- memory-engine config semantics remain unchanged and AutoRecall remains disabled.

The projector-only check must not open Core/Engine DBs, call retrieval, write `memory_events`, or invoke an OpenClaw hook.

## Rollback authority
Rollback target is fixed to:

~~~text
/home/lionsol/.openclaw/backups/memory-engine/releases/post-h6-v2-f887e18-20260802T124938Z
~~~

Rollback is authorized only inside this one transaction if a post-stop/install/start verification condition fails.

Rollback sequence:
1. ensure Gateway is stopped;
2. reinstall the fixed rollback release with `--force`;
3. start Gateway;
4. verify plugin `loaded`, sourcePath restored to rollback release, and the two active target-file hashes restored to baseline;
5. stop further work and report `STOPPED` or `PASS_WITH_FINDINGS` according to the failure point.

Do not modify memory data as part of rollback.

## Non-goals
Do not:
- install the entire repository checkout;
- deploy `lib/recall/hybrid/normalize-candidate.js` or any Candidate-Builder/runtime-authority source change;
- change query shaping, FTS/vector/recent/KG, fusion, ranking, `topK`, thresholds, Card/gate policy, or projection length;
- change AutoRecall enablement/allowlists/rollout;
- run live retrieval, H6, natural canary, synthetic retrieval, or memory tools;
- rebuild/reindex/backfill any memory index;
- mutate Core DB, Engine DB, LanceDB, sessions, memory files, or historical evidence;
- create another release mechanism, Candidate-Builder stage, OpenSpec, config object, DB schema, CLI, or state machine;
- commit, tag, or push during runtime execution.

## Pass criteria
1. Candidate construction proves the runtime delta is exactly the two provenance files over the current rollback release.
2. One install succeeds, Gateway/plugin recover healthy, active hashes/sourcePath prove the candidate is loaded, and projector-only telemetry contract passes without live retrieval or data mutation.
3. Config semantics remain unchanged, AutoRecall remains disabled, and no rollback is required.

## Stop conditions
Stop or rollback if:
- exact candidate delta cannot be proven;
- dependency/native ABI validation fails;
- current runtime/config differs materially from the frozen preflight assumptions;
- install record or active hashes do not match the candidate;
- Gateway/plugin health fails after installation;
- non-live contract verification would require a prompt, retrieval call, DB access, or event write;
- any unrelated retrieval/runtime subsystem enters scope.

## Allowed mutations
Only during separately authorized execution:
- create one new persistent overlay candidate release;
- stop/start Gateway;
- install candidate once;
- conditionally reinstall the fixed rollback release if required by a stop condition;
- write bounded private transaction evidence outside the repository if needed.

No repository source/doc edit, config policy edit, memory/index/data mutation, commit, tag, or push is authorized.

## Authorization boundary
Execution must bind the exact committed Stage Card, repository HEAD, Stage Card SHA256, fixed candidate path, fixed rollback release, and `MAX_EXECUTIONS=1`.

The Stage Card commit does not itself authorize runtime execution. After execution, report the result and stop; do not start a natural-use validation or retrieval-tuning stage under the same authorization.

# AutoRecall Provenance Runtime Install Retry R2 Stage Card — 2026-08-08

> **Status: FROZEN — execution requires separate post-commit Sol authorization**

## Decision
Can the previously approved provenance runtime overlay be constructed from the sealed rollback release and installed non-live by changing only candidate-construction mechanics, while preserving the failed first candidate as immutable evidence and keeping all product/runtime behavior boundaries unchanged?

## Prior failed transaction
The first runtime-install transaction is closed `STOPPED`.

Immutable failed candidate: `/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808`.

Verified facts:
- it is a byte-identical copy of the rollback release;
- overlay writing never began because the copied target files retained mode `0400`;
- Gateway was never stopped and plugin install never ran;
- active runtime remained loaded from the rollback release;
- the failed candidate must not be modified, deleted, reused, or overwritten.

## Fixed authorities
Source provenance commit: `1cd183ff12d055ba5c5ecd4bd0d9d1b98cdff23b`.

Rollback release: `/home/lionsol/.openclaw/backups/memory-engine/releases/post-h6-v2-f887e18-20260802T124938Z`.

New R2 candidate path: `/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2`.

The R2 path must not exist before execution. If it exists, stop without mutation.

## Scope
Only three things are in scope:
1. construct the new candidate from the sealed rollback release using bounded temporary owner-write permission on the two target files;
2. install that candidate once and restart Gateway;
3. perform the same non-live identity/privacy/telemetry-contract verification as the closed parent stage.

Authorized overlay files only: `lib/recall/hybrid-search.js` and `lib/recall/auto-recall-debug-metadata.js`.

## R2 candidate construction contract
1. Copy the rollback release to the new R2 path with metadata preserved.
2. Confirm the two copied target files initially match rollback bytes and mode `0400`.
3. Add owner-write permission only to those two copied files; do not chmod the rollback release or failed first candidate.
4. Replace only those two copied files with the exact versions from source commit `1cd183ff...`.
5. Restore both target files to mode `0400` before candidate qualification.
6. Prove the R2 candidate differs from rollback only in those two file contents.
7. Prove target-file ownership and final mode match rollback, and package/lock/native dependency closure remains inherited unchanged.
8. Verify Node24 can load `better-sqlite3` and import the candidate metadata projector.

No parent-directory permission change is expected. If directory permission changes or any third file mutation is required, stop for scope review.

## Runtime transaction
Sol remains the runtime operator.

If and only if R2 candidate qualification passes:
1. record bounded pre-install runtime/config identity;
2. stop Gateway;
3. install the fixed R2 candidate once with `openclaw plugins install <R2> --force` under the Node24 execution environment;
4. verify install record and active target-file hashes before Gateway start;
5. start Gateway;
6. perform only the non-live verification below.

No second R2 install attempt is permitted under the same authorization.

## Non-live verification
Do not send a prompt, memory query, AutoRecall request, H6 turn, natural canary, synthetic retrieval probe, or memory tool call.

Verify only:
- Gateway returns to running/healthy state;
- plugin status is `loaded`;
- installPath remains `/home/lionsol/.openclaw/extensions/memory-engine`;
- sourcePath equals the fixed R2 candidate path;
- active target-file hashes equal the `1cd183ff...` source hashes;
- active files expose both provenance markers;
- candidate/active metadata projector imports under Node24;
- projector-only in-memory contract proves channel IDs <=32, fusion pre/post IDs <=8, correct count/truncation, and no text/path/query/preview leakage;
- memory-engine config semantics remain unchanged and AutoRecall remains disabled.

The projector-only check must not open Core/Engine DBs, call retrieval, write `memory_events`, or invoke OpenClaw hooks.

## Rollback authority
Rollback remains fixed to the verified rollback release above.

If any post-stop/install/start condition fails:
1. ensure Gateway is stopped;
2. reinstall the fixed rollback release with `--force`;
3. start Gateway;
4. verify plugin `loaded`, sourcePath restored, active target-file hashes restored, config unchanged, and AutoRecall disabled;
5. stop further work and report the failed transaction.

Do not mutate memory data during rollback.

## Non-goals
Do not:
- modify/delete/reuse the failed first candidate;
- install the full repository checkout;
- deploy `normalize-candidate.js` or Candidate-Builder/runtime-authority changes;
- change retrieval/query/channel/fusion/ranking/topK/threshold/gate/capture/index policy;
- change AutoRecall enablement, allowlists, or rollout;
- run live/synthetic retrieval or H6;
- rebuild/reindex/backfill memory;
- mutate Core DB, Engine DB, LanceDB, sessions, memory files, or historical evidence;
- add config/schema/event/CLI/OpenSpec machinery;
- commit, tag, or push during runtime execution.

## Pass criteria
1. R2 candidate construction succeeds with an exact two-file content delta and restored sealed permissions.
2. One install succeeds; Gateway/plugin return healthy; runtime identity proves the R2 candidate is active; projector-only telemetry/privacy contract passes without data access.
3. Config remains unchanged, AutoRecall remains disabled, and rollback is not required.

## Stop conditions
Stop or rollback if:
- R2 path already exists;
- the failed first candidate or rollback release would need mutation;
- exact two-file delta or final sealed permissions cannot be proven;
- native dependency validation fails;
- current runtime/config materially differs from preflight;
- install record/active hashes/Gateway health do not match;
- verification would require retrieval, DB access, or another subsystem.

## Allowed mutations
Only during separately authorized execution:
- create the one fixed R2 candidate;
- temporarily chmod `u+w` and then restore `0400` on the two copied R2 target files only;
- stop/start Gateway;
- install R2 once;
- conditionally reinstall the fixed rollback release on failure;
- write bounded private transaction evidence outside the repository if needed.

No repository source/doc mutation, config policy edit, memory/index/data mutation, tag, or push is authorized during runtime execution.

## Stage outcomes
Use exactly one: `PASS`, `PASS_WITH_FINDINGS`, `INSUFFICIENT_EVIDENCE`, or `STOPPED`.

## Authorization boundary
Execution must bind the exact committed R2 Stage Card, exact repository HEAD, Stage Card SHA256, source commit, fixed rollback path, immutable failed-candidate path, fixed R2 candidate path, and `MAX_EXECUTIONS=1`.

This Stage Card authorizes nothing by itself. After execution, report and stop; do not start natural-use validation or retrieval tuning under the same authorization.

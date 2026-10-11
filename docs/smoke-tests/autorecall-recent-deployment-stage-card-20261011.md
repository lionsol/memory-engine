# AutoRecall Recent deployment

STAGE_ID: AUTORECALL_RECENT_DEPLOYMENT_20261011
Status: READY_TO_FREEZE / NOT EXECUTION-AUTHORIZED
MAX_EXECUTIONS: 1; one candidate install, at most one recovery install.
Reviewed source/helper HEAD: `d0a7b157013fa0c5a3e2e041cacc1fadf2fd15bc`.

The previous `74876a7` Stage Card binding became invalid when the repository HEAD changed. This is a replacement/re-freeze only; it does not reuse any prior execution authority. From the previously reviewed runtime HEAD through the current HEAD, there were no runtime/product source changes. Subsequent changes were limited to deployment evidence and callback correctness, including the candidate unexplained-drift latch.

## Decision and scope

Deploy the reviewed Recent I/O implementation with its covering index and determine whether the matching runtime is healthy. Natural traffic determines latency benefit.
In scope: the exact single Core index, the frozen candidate installation/Gateway stop-start, and existing read-only identity/health/plan/natural-timing acceptance.

Inherit Core target, exact index DDL, data/config/cron comparison contracts, quiescing, rollback restrictions and exclusions from `docs/smoke-tests/autorecall-recent-index-activation-stage-card-20261010.md` AS COMMITTED IN `985283ef3cd8627feca4477f2010a2d4180b6237`. Its historical fingerprint-source repair and candidate preparation are already complete and must not be replayed.

## Frozen execution inputs

- Candidate PACKAGE DIRECTORY: `/tmp/autorecall-recent-offline-candidate-20261010-UnVd6w/candidate`.
- Candidate manifest: `a24caeb5e984c64e27c1af35a2846295af50e0367e248300b4c8b04687af0863`.
- Native SHA256: `be4109c5b07514ade1a2e1452cbed9fca25cbb8d025b76fa2a81e21a91286a05`; better-sqlite3 11.10.0, Node ABI 137.
- Source/candidate runtime-build identity: `e23bcc6640fbad054de52a34c59e606569b788ad6f79f460f52caa19220680c9`; parity rechecked on the reviewed HEAD: 344 files, zero differences.
- Source-only helper: `docs/smoke-tests/autorecall-recent-install-step-20261011.sh`.
- Helper SHA256: `dbd2a87b29bd81a1d2fa6c0f43eb1f6e23b8533d09c3615fa8e6345ee4256dd7`.
- Deployment callbacks: `docs/smoke-tests/autorecall-recent-deployment-callbacks-20261011.sh`.
- Deployment callbacks SHA256: `dba24f65472c8c4cfc290a49ec5bb8b761859239f9c09a7166c1eab1d7c32ed9`.
- Node: `/home/lionsol/.local/node24/bin/node`.
- OpenClaw entrypoint: `/home/lionsol/.local/lib/node_modules/openclaw/openclaw.mjs`.

Do not rebuild/change candidate or dependencies. Before downtime, revalidate the exact HEAD/card/helper, full candidate manifest/native hash, runtime closure, current rollback snapshot and unconsumed stage ID. Missing/drifted inputs mean STOPPED.

## Execution

1. Establish a stable cwd outside the replaced extension and preserve a FRESH current runtime rollback artifact. Define the helper's facts and recovery-acceptance callbacks using the existing comparators. Set its explicit Node, entrypoint, cwd and quoted Node24-prefixed PATH. Source the bound helper once. All install calls use it; do not reconstruct a shell command or retry candidate.
2. Stop Gateway; capture FRESH quiesced Core/schema/config/cron/Engine/LanceDB baselines with the fixed tools. Create the authorized index once, only if absent. Require exact single-index schema delta and unchanged canonical content/schema identity/user_version. Verify actual SQL uses covering-index selection and primary-key text SEARCH. The standalone post-index capture is the immutable INSTALL baseline.
3. Call `autorecall_install_step <candidate> <fresh-rollback> <facts-callback> <recovery-acceptance-callback>` in explicit conditional control, preserving its return code and bounded result fields. Facts callbacks execute AFTER each child and independently inspect actual runtime plus all data/config/cron gates against the fresh INSTALL baseline. Classify unsupported observations as unknown; never infer pre-launch failure solely from exit 127. Core/Engine/LanceDB content/identity mismatches are unexplained; only the existing config bookkeeping allowance may be explained. Callback command failures must explicitly propagate; callback output must contain only the helper's three documented fact fields.
4. Recovery acceptance runs AFTER recovery facts, and must prove the previous runtime manifest matches the fresh rollback and all existing comparison gates pass. A candidate-stage confirmed semantic drift or topology drift remains an immutable STOPPED latch and permanently blocks recovery acceptance, regardless of later exact recovery or other successful facts. The candidate root `0755` to `0700` normalization remains the sole existing explained artifact exception; it is not an unexplained latch. Helper restart permission is a local step result; outer index/data/runtime gates still apply.
5. On candidate success, require frozen candidate parity, strict Core INSTALL invariant equality, and Engine/LanceDB/config/cron gates before starting Gateway. Confirm health/config validity, matching runtime and index presence after startup. On recovery, drop ONLY the exact index created by this execution with matching definition, then require Core equality to the fresh pre-index baseline and all rollback gates before restoring Gateway. No database backup overwrite or extra install is permitted. Unexplained changes or failed/incomplete recovery acceptance leave Gateway stopped for review.
6. Record activation/recovery time and a single outcome. Observe bounded metadata-only natural traces since activation, separating executed retrieval from skips and scored/fallback Recent from LIKE fallback. No synthetic request or provider call. No natural samples means performance PENDING; no immediate polling/retry loop.

The isolated import confidence warning remains a disclosed missing-Core fixture finding, not a waived production storage gate. No additional native/source experiment is needed before this operation.

## Three acceptance criteria

1. Exact single-index delta with unchanged Core content/identity/version and the required real covering-index/ID-SEARCH plan.
2. Matching healthy runtime and existing Core INSTALL, Engine/LanceDB, config and cron gates, or a safely closed rollback with failure reported.
3. Natural latency evidence after successful activation, or explicit performance PENDING.

Outcome: PASS / PASS_WITH_FINDINGS / INSUFFICIENT_EVIDENCE / STOPPED. A rollback is STOPPED, never successful deployment. Report consumed count, evidence location, indexes, runtime/data/config/cron gates, Gateway state and performance status, then stop.

## Freeze

Commit THIS CARD ONLY. Leave the three existing untracked documents untouched. The documentation-only commit becomes both STAGE_CARD_COMMIT and AUTHORIZED_REPOSITORY_HEAD; recheck runtime closure against the frozen candidate. Present Sol the exact commit and this stage binding with MAX_EXECUTIONS=1. Only Sol's original explicit authorization of that frozen binding permits production execution. Document status is not authority.

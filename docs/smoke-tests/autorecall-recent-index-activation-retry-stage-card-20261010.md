# AutoRecall Recent index activation: one corrective retry

STAGE_ID: AUTORECALL_RECENT_INDEX_ACTIVATION_RETRY_20261010
Status: READY_TO_FREEZE / NOT AUTHORIZED
MAX_EXECUTIONS: 1; at most one recovery install; no automatic candidate retry.
Reviewed product/ops source: `985283ef3cd8627feca4477f2010a2d4180b6237`.

## Decision and correction

Activate the reviewed Recent I/O change using the corrected native artifact and assess Recent latency in natural traffic. The previous production execution consumed its authorization and ended STOPPED / SAFE ROLLBACK. This is the single corrective production retry, not continuation of that consumed packet.

The first loss was ENVIRONMENT_FAILURE: the freshly built better-sqlite3 binary reproduced RemoveEnvironmentCleanupHook's env assertion during allocation-driven GC independently of memory-engine/OpenClaw. The corrected candidate uses the verified rollback-native binary, passed offline GC testing and isolated OpenClaw import, and did not change source code. No retrieval/gate/lifecycle workaround is included.

## Exact candidate binding

- Install source (the package directory, NOT its parent): `/tmp/autorecall-recent-offline-candidate-20261010-UnVd6w/candidate`.
- Manifest identity: `a24caeb5e984c64e27c1af35a2846295af50e0367e248300b4c8b04687af0863`.
- better-sqlite3: 11.10.0, Node ABI 137.
- Native SHA256: `be4109c5b07514ade1a2e1452cbed9fca25cbb8d025b76fa2a81e21a91286a05`.
- Offline report: `/tmp/autorecall-recent-offline-candidate-20261010-UnVd6w/evidence/offline-candidate-report.json`.
- Source/candidate runtime parity: true, zero differences; isolated import exit 0; actual installed native SHA matches; candidate manifest unchanged after import.

Do not rebuild this candidate, run npm ci in it, or change its dependencies. Recompute its manifest and native hash before downtime; missing/changed artifact or runtime parity mismatch is STOPPED, not permission to regenerate and continue.

## Scope, checks and recovery

Inherit the exact Core path, index DDL, permitted mutations, execution sequence and recovery limits from `docs/smoke-tests/autorecall-recent-index-activation-stage-card-20261010.md` AS COMMITTED IN `985283ef3cd8627feca4477f2010a2d4180b6237`, with these explicit substitutions:

1. Install the exact corrected artifact above instead of preparing another dependency-complete candidate. Capture a FRESH snapshot of the currently installed old runtime before this execution; old failed-run snapshots are historical evidence, not current baselines.
2. Capture FRESH quiesced Core/config/cron/Engine/LanceDB baselines using the fixed fingerprint tool. Index creation must change only the exact single schema index; canonical content/identity/user_version remain equal. Installation comparison uses the fresh post-index baseline and still requires strict invariant equality. Require real covering-index selection, bounded primary-key text fetch, matching runtime and healthy Gateway. After startup, check index presence; do not demand unchanged whole Core content after natural activity resumes.
3. Send no synthetic OpenClaw request and make no provider call for qualification. Observe only subsequent natural traces, distinguishing retrieval from skips and LIKE fallback from scored/fallback Recent. Activation may close while performance remains pending if no samples exist.

The three pass criteria are: bounded single-index delta and content safety; matching healthy installed runtime with existing config/cron/data gates; natural-trace evidence or an explicit performance-pending status.

The isolated import's confidence warning is a disclosed fixture finding: a memory_confidence table exists in the isolated Engine, while the isolated fixture lacks Core. This evidence proves native loading/import success, not full storage startup. It does not waive any production data/runtime gate or authorize creating/replacing production DBs.

Rollback: the inherited limit is one recovery install plus dropping only the matching index CREATED BY THIS EXECUTION. Preserve a stopped Gateway for unexplained content/identity changes; do not overwrite DBs to hide them. Failure classification, evidence and rollback are reported before any proposed successor. If this retry fails, STOP for review; do not create a third qualification attempt.

## Freeze and owner authorization

Commit this Stage Card only; leave existing unrelated untracked documents untouched. The ensuing documentation-only commit becomes STAGE_CARD_COMMIT and AUTHORIZED_REPOSITORY_HEAD. Record its exact SHA externally in the owner execution binding together with the candidate path/manifest/native SHA above and MAX_EXECUTIONS=1. Verify that its runtime dependency closure still matches the frozen candidate.

The prior production authorization is exhausted. Only Sol's explicit authorization of this new exact binding permits live execution. After execution, report one stage outcome and stop.

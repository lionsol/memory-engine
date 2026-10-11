# Gateway-only recovery after Recent deployment health failure

STAGE_ID: AUTORECALL_RECENT_GATEWAY_RECOVERY_20261011
Status: READY_TO_FREEZE / NOT EXECUTION-AUTHORIZED
MAX_EXECUTIONS: 1; one explicit Gateway start, at most one explicit stop on failure.
Reviewed repository HEAD: `d817555787e7ffdde641a3e66fcd284f4eb118d6`.

## Decision and scope

Restore Gateway service using the already installed candidate, without repeating deployment.
Drift-review decision: SIMPLIFY. The preceding deployment is STOPPED/consumed=1; installation/data gates passed, but its immediate health probe failed. Logs show the entry subsequently stopped the service with SIGTERM, not a proven prior process crash. Startup readiness remains an unconfirmed cause.

Three scope items: verify the installed artifact/current stopped state; start the existing Gateway service once with bounded read-only readiness checks; report health/status and preserve failure evidence.
No installation, recovery installation, DDL, index recreation, candidate/source/config/cron changes, synthetic request, provider call or deployment-entry invocation. Ordinary configured Gateway startup activity is not a quiesced data-identity experiment.

## Bound state and preflight

- Prior evidence: `/tmp/autorecall-recent-deployment-entry-QkU3cW/evidence`; preserve it unchanged.
- Active artifact: `/home/lionsol/.openclaw/extensions/memory-engine`.
- Prior installed v2 manifest: `/tmp/autorecall-recent-deployment-entry-QkU3cW/evidence/runtime-facts-1-installed.json`.
- Manifest file SHA256: `be331c91c99a18c4f22f8030e2ea6ff4bd26411d372fdd1e349adb63fe541cf9`.
- Active v2 exact identity: `0a3999c79bb03636e86777bc18abe46c75ea0e95108575de3faa267b3fd6a1d7`.
- Active root mode: `0700`. Fresh read-only review found a valid, topology-complete artifact EXACT equal to that manifest.
- Core: `/home/lionsol/.openclaw/agents/main/agent/openclaw-agent.sqlite`; target index `idx_memory_index_chunks_recent_cover` must remain absent.
- Node: `/home/lionsol/.local/node24/bin/node`; health/status CLI: `/home/lionsol/.local/bin/openclaw`.

Before consumption/start, verify Sol's original authorization, this card's exact commit/repository HEAD, tracked-file cleanliness and unconsumed Stage ID. Recheck the bound manifest file hash, fresh active v2 validity/topology completeness/EXACT equality, service inactive/dead and index absence using read-only access. Missing/mismatched evidence means STOPPED without start; do not adapt the operation.
Use the repository's existing v2 builder/comparator with Node24. Keep new evidence in a separate temporary directory; never overwrite preceding deployment evidence or rerun its entry/helpers.

## Single start and bounded readiness

Record consumed=1 immediately before exactly one `systemctl --user start openclaw-gateway`. Preserve its exit code and timestamp; a failed start is not retried.

After successful start, use at most FOUR `openclaw gateway health` read-only probes, each bounded by GNU `timeout` to 20 seconds with a 2-second kill grace. Wait at most 10 seconds between failed probes. The readiness deadline is 120 seconds from start returning; cap each probe/wait to the remaining budget. No blocking wait exceeds 20 seconds. Stop probing on first exit-0 health output with an `OK` result, or on deadline, exhausted attempts, observed service failure or a confirmed unsafe artifact change. Preserve each probe's separate stdout/stderr, exit code and timestamp. These health RPCs are service checks, not synthetic OpenClaw/model requests.

After health success, perform ONE `openclaw gateway status` check, bounded to 20 seconds plus a 2-second kill grace; require connectivity `ok`, config validity and service active/running. Recheck active v2 artifact against the same bound installed manifest and confirm the index remains absent. Do not require whole live databases to equal pre-start snapshots when legitimate startup activity occurs.

On success, leave Gateway running. On failed/incomplete acceptance after this operation's start, explicitly stop Gateway at most once, capture the stop result/final service state, and read at most 200 relevant startup-log records for this operation's time window. Confirmed unexplained semantic/topology drift blocks further start regardless of health. No automatic manual retry, install, DDL or configuration repair is authorized.

## Three acceptance criteria and closure

1. Bound installed artifact valid/topology-complete/EXACT; target index absent.
2. One service start produces successful bounded health, status/connectivity/config validity and active/running service.
3. Original deployment evidence preserved; start/probe/stop counts, timestamps, original first health failure and final service state reported.

Outcome applies to SERVICE RECOVERY only: PASS / PASS_WITH_FINDINGS / INSUFFICIENT_EVIDENCE / STOPPED. Report transient readiness failures even after success; do not rewrite the prior deployment's STOPPED outcome or consumed count. Recent covering-index deployment remains incomplete and performance PENDING. Report the result and stop; no natural-traffic investigation or successor activation is part of this operation.

## Freeze

Commit THIS CARD ONLY. Preserve the three existing untracked documents; do not modify source, entry/helpers or candidate. The card-only commit becomes STAGE_CARD_COMMIT and AUTHORIZED_REPOSITORY_HEAD. Present its full SHA for Sol's original explicit authorization. Previous consumed authority and this draft do not permit service start.

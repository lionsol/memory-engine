# Recent covering index activation on the installed candidate

STAGE_ID: AUTORECALL_RECENT_INDEX_ONLY_ACTIVATION_20261011
Status: READY_TO_FREEZE / NOT EXECUTION-AUTHORIZED
MAX_EXECUTIONS: 1
Reviewed source HEAD: `49af640dcafe528a8120bf7add71cbf39b0314f9`.

## Decision and three scope items

Activate the single covering index for the already installed, recovered candidate and observe natural retrieval metadata.
Drift-review decision: SIMPLIFY. Installation is complete; previous deployment/recovery packets are consumed. This operation has no install path and uses the tested continuous activation/recovery scripts.
Scope: exact Core index creation/acceptance; one quiesce/start cycle with bounded health/status; read-only final identity and natural-timing observation.

## Frozen bindings

| Input | Binding |
| --- | --- |
| Activation script | `/tmp/autorecall-recent-index-activation-continuous-20261011.sh` |
| Activation SHA256 | `87b7c4d326f8eacd9e5a6fc2b488dbff4a5677b35dc778012913bdd8682cf98a` |
| Gateway recovery runner | `/tmp/autorecall-recent-gateway-recovery-continuous-20261011.sh` |
| Recovery SHA256 | `a67310a5f7453b99b802cdbdc06d64771c23668bb9ee986034be5d84ea8b0f93` |
| Active artifact | `/home/lionsol/.openclaw/extensions/memory-engine` |
| Active v2 exact identity | `0a3999c79bb03636e86777bc18abe46c75ea0e95108575de3faa267b3fd6a1d7` |
| Installed manifest | `/tmp/autorecall-recent-deployment-entry-QkU3cW/evidence/runtime-facts-1-installed.json` |
| Installed manifest SHA256 | `be331c91c99a18c4f22f8030e2ea6ff4bd26411d372fdd1e349adb63fe541cf9` |
| Current Core | `/home/lionsol/.openclaw/agents/main/agent/openclaw-agent.sqlite` |

Node: `/home/lionsol/.local/node24/bin/node`; systemctl: `/usr/bin/systemctl`; OpenClaw: `/home/lionsol/.local/bin/openclaw`; timeout: `/usr/bin/timeout`.
Fresh v2 validity/topology completeness/EXACT equality to the installed manifest is required before stop and after successful startup. Preserve original deployment/recovery evidence.

## One continuous invocation

Verify Sol's original authorization binds this exact committed card/repository HEAD/Stage ID/MAX_EXECUTIONS=1, clean tracked files, both script hashes, manifest hash, active/running Gateway, expected active artifact and absent target index. Complete all command preparation before any stop. Missing/mismatched inputs or confirmed unexplained drift mean STOPPED without mutation.

Create a fresh private temporary run directory with separate evidence and rollback subdirectories. Bind activation variables explicitly: repository root; Node; current Core; active artifact; fresh run/evidence/rollback paths; systemctl; repository `package.json` for SQLite loading; existing fingerprint tool; exact recovery path/hash. Bind recovery commands to the host paths above and its budgets to 120000/4/20000/10000 milliseconds/attempts. Offline recovery stub, stop-command override and forced-DDL-failure hooks must be unset. Existing confirmed-drift evidence must not be suppressed.

Record consumed=1 immediately before invoking the activation script exactly ONCE. Do not edit/reconstruct/re-enter either script, call the old deployment entry, inspect source mid-run or introduce a manual pause after stop.
The script captures fresh rollback information before stop, captures quiesced Core baseline, creates the index once, verifies exact schema delta/content and actual `ISOLATED_RECENT_SHARED_SQL`, then invokes the bound real recovery runner once. The recovery window starts after start returns; health probes are at most four, each at most 20 seconds plus 2-second kill grace, waits at most 10 seconds, readiness deadline 120 seconds; status is once with a 20-second timeout plus 2-second grace.

The only DDL is:
```sql
CREATE INDEX idx_memory_index_chunks_recent_cover
ON memory_index_chunks(updated_at DESC, id ASC, path);
```

Allowed explicit service mutations: one initial stop and one start via the recovery runner; at most one additional failure stop. Allowed data mutations: one CREATE of the absent exact index and, on failure, one DROP of that index only when this run's ownership marker and exact definition match. No installation, candidate/dependency changes, database overwrite, configuration/cron edits, other index changes, synthetic requests or provider calls.

## Three acceptance criteria and closure

1. Quiesced Core canonical content/schema identity/user_version unchanged; exact single-index schema delta; actual bounded MATERIALIZED CTE plan uses the covering index and ID PK SEARCH for text projection.
2. Recovery health/status/config/connectivity pass, service active/running, final active v2 EXACT equality and exact target index present. On final artifact/index acceptance failure after a successful runner, stop at most once and safely remove only the owned matching index. Confirmed unexplained semantic/topology drift always blocks further start.
3. Preserve first failure and all child exit codes/counts. After successful activation, inspect existing natural metadata once, at most 200 records since activation; distinguish executed/skipped and scored/fallback Recent/LIKE fallback. No samples means performance PENDING.

On pre-recovery failure or failed recovery, do not add another start. Inspect cleanup result explicitly; if service is stopped and the owned index was removed, read-only compare Core to the quiesced pre-index baseline and require invariant equality plus quick_check=ok. Failed cleanup or incomplete evidence remains STOPPED and must be reported, never hidden behind the original failure.
Legitimate post-start writes are not compared mechanically to the quiesced Core snapshot. No polling natural traffic, rerunning installation or automatic successor operation is authorized.

Outcomes: PASS / PASS_WITH_FINDINGS / INSUFFICIENT_EVIDENCE / STOPPED. Report consumed count, evidence directory, CREATE/DROP/stop/start/health/status/install counts, index/plan/Core/artifact gates, final Gateway state, transient health failures and performance status; then stop.

## Freeze

Commit THIS CARD ONLY. Preserve the three existing untracked documents and both bound temporary scripts unchanged. The card-only commit becomes STAGE_CARD_COMMIT and AUTHORIZED_REPOSITORY_HEAD. Present its full SHA for Sol's original explicit authorization; this draft and prior consumed packets grant no execution authority.

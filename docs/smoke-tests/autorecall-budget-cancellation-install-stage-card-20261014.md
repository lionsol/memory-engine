# AutoRecall budget/cancellation install-only Stage Card

Status: READY_TO_FREEZE / NOT EXECUTION-AUTHORIZED

## Decision and value

Install the offline-qualified budget/cancellation artifact once, verify installation identity and quiesced data invariants, and restore a healthy Gateway. This activates bounded AutoRecall work; production cancellation behavior remains PENDING until suitable natural traces exist.

- STAGE_ID: AUTORECALL_BUDGET_CANCELLATION_INSTALL_20261014
- SOURCE_HEAD: 8491e4dc2b3b71fe8cccc480bbc4e89c6d94d878
- STAGE_CARD_PATH: docs/smoke-tests/autorecall-budget-cancellation-install-stage-card-20261014.md
- STAGE_CARD_COMMIT / AUTHORIZED_REPOSITORY_HEAD: the complete commit SHA obtained after committing only this card.
- MAX_EXECUTIONS: 1; record consumed=1 before the single entry invocation.
- Authority: Sol's original explicit authorization must bind that card commit, repository HEAD and execution count. This document grants no execution authority.

## Scope (three items)

1. Verify frozen bindings and prepare a fresh rollback copy of the actual active artifact before stopping Gateway.
2. Invoke the bound install-only entry once: stop, candidate install once, existing callback acceptance, and conditional continuous Gateway recovery.
3. Perform the post-run read-only identity/index checks and one bounded observation of natural AutoRecall metadata.

No DDL, index creation/deletion, deployment-entry replay, product edits, configuration/cron edits, synthetic requests or explicit provider calls. The existing Recent covering index is retained in every outcome.

## Frozen artifacts

Repository root: /home/lionsol/.openclaw/workspace/plugins/memory-engine

| Binding | Exact value |
| --- | --- |
| Entry | /tmp/autorecall-budget-cancellation-install-only-entry-20261013.sh |
| Entry SHA256 | 3b66529b20cb641ea51ff57bb0abed510859f971da77a4f6ce5d672204237e5d |
| Candidate | /tmp/autorecall-budget-cancellation-candidate-20261013-N1LtTJ/candidate-split |
| Candidate manifest | /tmp/autorecall-budget-cancellation-candidate-20261013-N1LtTJ/split-candidate-manifest-v2.json |
| Manifest SHA256 | 7af2be3273634a56fabdbb2f409b18a6b4f301ceceadd0de9d09e9deebe88333 |
| Candidate v2 exact identity | 37df33433707b3c5ee079fa9897596751e3b9d27ab5b06dcfccf85b915901b47 |
| Candidate native SHA256 | be4109c5b07514ade1a2e1452cbed9fca25cbb8d025b76fa2a81e21a91286a05 |
| Candidate source/runtime closure | 0e83e397606f5e585f503f1b566ffe173fb2f10bd50e7f3113057d275963e04a; 345 files, zero differences |
| Deployment callbacks | docs/smoke-tests/autorecall-recent-deployment-callbacks-20261011.sh |
| Callbacks SHA256 | dba24f65472c8c4cfc290a49ec5bb8b761859239f9c09a7166c1eab1d7c32ed9 |
| Install helper | docs/smoke-tests/autorecall-recent-install-step-20261011.sh |
| Helper SHA256 | dbd2a87b29bd81a1d2fa6c0f43eb1f6e23b8533d09c3615fa8e6345ee4256dd7 |
| Gateway runner | /tmp/autorecall-recent-gateway-recovery-continuous-20261011.sh |
| Runner SHA256 | a67310a5f7453b99b802cdbdc06d64771c23668bb9ee986034be5d84ea8b0f93 |
| Expected pre-install active v2 exact identity | 0a3999c79bb03636e86777bc18abe46c75ea0e95108575de3faa267b3fd6a1d7 |
| Node / native ABI | /home/lionsol/.local/node24/bin/node; v24.19.0 / 137; better-sqlite3 11.10.0 |

Offline evidence: six entry scenarios independently passed with real callbacks/comparators, temporary SQLite stores and stubbed host commands; Bash syntax passed. The 18 cancellation regressions and isolated OpenClaw import were previously qualified. Known full-suite failures remain recorded; this card does not claim a green full suite.

## Preflight and single call

Before any production stop/install, verify the authorized HEAD/card and all frozen hashes. Use a new evidence directory; preserve prior evidence. Build a fresh active v2 manifest and require the expected active identity above. Copy the actual active artifact into a new rollback directory, preserving bytes, permissions and hardlink topology; compare fresh active and rollback manifests EXACT/PASS. Freeze both reports and the rollback directory. A mismatch stops before entry; do not substitute an old rollback artifact.

Read-only verify current Core quick_check=ok and the existing index definition:
```sql
CREATE INDEX idx_memory_index_chunks_recent_cover
ON memory_index_chunks(updated_at DESC, id ASC, path)
```
Require this index to exist with the matching definition. Do not repair it in this stage.

Set the following AUTORECALL_INSTALL_ONLY_* variables explicitly for the one entry invocation:

| Suffix | Production value |
| --- | --- |
| REPO_ROOT | /home/lionsol/.openclaw/workspace/plugins/memory-engine |
| CORE_DB | /home/lionsol/.openclaw/agents/main/agent/openclaw-agent.sqlite |
| ENGINE_DB | /home/lionsol/.openclaw/memory/memory-engine/memory-engine.sqlite |
| LANCEDB_ROOT | /home/lionsol/.openclaw/memory/lancedb |
| CONFIG_PATH | /home/lionsol/.openclaw/openclaw.json |
| STATE_DB | /home/lionsol/.openclaw/state/openclaw.sqlite |
| CRON_STORE_KEY | /home/lionsol/.openclaw/cron/jobs.json |
| CRON_STORE | a new evidence-directory JSON output, produced only from STATE_DB |
| ACTIVE_ARTIFACT_ROOT | /home/lionsol/.openclaw/extensions/memory-engine |
| ROLLBACK_DIR | the newly captured, EXACT-qualified rollback directory |
| EVIDENCE_DIR | the new run evidence directory |
| OPENCLAW_CRON / GATEWAY_OPENCLAW | /home/lionsol/.local/bin/openclaw |
| NODE | /home/lionsol/.local/node24/bin/node |
| OPENCLAW_ENTRYPOINT | /home/lionsol/.local/lib/node_modules/openclaw/openclaw.mjs |
| INSTALL_CWD | a pre-created empty temporary directory |
| INSTALL_PATH | /home/lionsol/.local/node24/bin:/home/lionsol/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin |
| SYSTEMCTL / TIMEOUT | /usr/bin/systemctl / /usr/bin/timeout; verify these paths before entry |
| READY_WINDOW_MS / MAX_HEALTH | 120000 / 4 |
| HEALTH_TIMEOUT_MS / HEALTH_WAIT_MS | 20000 / 10000 |

Keep candidate, candidate-manifest and Gateway-runner defaults at the frozen paths. Invoke the SHA-bound entry exactly once with Bash. Do not invoke the underlying caller separately. After start, the continuous runner proceeds directly through health/status; no source inspection, planning or manual waiting is inserted.

The entry re-reads host cron SQLite before stop and before every candidate/recovery facts callback. Capture failure must not use an old JSON. The no-op DDL callback changes nothing. Core INSTALL baseline includes the existing index and is frozen once while quiesced; facts reuse it. Do not recapture that baseline after a child.

## Pass criteria (three claims)

1. Installation: candidate=1, recovery=0, outcome=candidate_success, entry_status=PASS, exit=0; actual active v2 artifact EXACT/PASS against the frozen candidate. No unexplained semantic/topology drift.
2. Quiesced acceptance: Core logical content/schema/invariant unchanged; Engine and LanceDB unchanged; config only the existing approved meta.lastTouchedAt exception; full enabled/disabled cron definitions and payloads equal to fresh baseline. Existing index remains present with its original definition; final read-only quick_check=ok.
3. Service: runner invoked once, Gateway active/running, health succeeds within the bound window, and status satisfies rpc.ok, valid CLI/daemon config, no config mismatch, service.loaded and runtime running. Post-run active artifact remains EXACT/PASS.

Natural observation is not a pass prerequisite: once, after successful activation, query at most 200 metadata rows from the activation timestamp. Use existing trace IDs, status, cancellation stage and scalar timing fields; do not read message text or trigger retrieval. Report unavailable/unsuitable samples as PENDING. Do not equate successful installation with proven latency improvement.

## Failure, recovery and stop

Preserve the first failure and original child exit codes. No entry/candidate retry.

- Pre-stop evidence/binding failure: STOPPED, no production stop/install.
- After-stop acceptance failure: follow only the existing helper's bounded branch. At most one recovery install; no manual recovery invocation. Confirmed unexplained semantic/topology or content drift always blocks Gateway restart, even if recovery later matches.
- Clean accepted recovery may run the continuous Gateway runner once. Deployment stays STOPPED; report gateway_recovery separately and preserve the original candidate failure/exit code.
- The helper's prelaunch-unchanged branch is not emitted by the frozen facts callback (launch_observed is unknown or yes). If it nevertheless appears, classify deployment STOPPED; it cannot satisfy candidate_success.
- Gateway runner failure: its bounded stop action applies; no second start or install. Existing index is never removed.
- After execution, report outcome, consumed count, candidate/recovery/runner counts, original/final exit codes, acceptance summaries, Gateway/index identity and evidence path, then stop. Any later production action requires a separate Sol decision and authorization.

Commit only this card. Preserve the four existing untracked documents and all frozen temporary artifacts.

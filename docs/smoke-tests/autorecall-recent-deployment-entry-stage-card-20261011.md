# AutoRecall Recent: single-entry deployment

STAGE_ID: AUTORECALL_RECENT_DEPLOYMENT_ENTRY_20261011
Status: READY_TO_FREEZE / NOT EXECUTION-AUTHORIZED
MAX_EXECUTIONS: 1; candidate install at most once, recovery install at most once.
Reviewed entry/source HEAD: `25c4b632982712ed13560abe4f44bb45f1b3afe7`.

## Decision and scope

Decision: activate the reviewed Recent runtime together with its covering index, verify health, and assess latency only from natural traffic.
Drift-review decision: SIMPLIFY. Prior first losses were execution/evidence failures; freeze the reviewed actual entry instead of constructing another driver or extending the helpers. All historical execution packets are consumed and grant no authority here.

Three scope items: the exact Core index; frozen candidate installation with Gateway stop/start and bounded recovery; existing read-only identity, health, query-plan and natural-timing acceptance.
Inherit data/config/cron comparison contracts, quiescing, rollback restrictions and exclusions from `docs/smoke-tests/autorecall-recent-index-activation-stage-card-20261010.md` at `985283ef3cd8627feca4477f2010a2d4180b6237`, and `docs/smoke-tests/autorecall-recent-deployment-stage-card-20261011.md` at `b04cca1738c92210e600802fd2db5b8e9cef4c28`. This card replaces their execution instructions with the single committed entry below; no historical preparation or execution is replayed.

## Frozen inputs

| Input | Binding |
| --- | --- |
| Entry | `docs/smoke-tests/autorecall-recent-deployment-entry-20261011.sh` |
| Entry SHA256 | `9a8875acc4e151bee59e635c9f7ad1c35ee0356e4ec5063efc66786987d42dac` |
| Install helper | `docs/smoke-tests/autorecall-recent-install-step-20261011.sh` |
| Install helper SHA256 | `dbd2a87b29bd81a1d2fa6c0f43eb1f6e23b8533d09c3615fa8e6345ee4256dd7` |
| Deployment callbacks | `docs/smoke-tests/autorecall-recent-deployment-callbacks-20261011.sh` |
| Callbacks SHA256 | `dba24f65472c8c4cfc290a49ec5bb8b761859239f9c09a7166c1eab1d7c32ed9` |
| Candidate package | `/tmp/autorecall-recent-offline-candidate-20261010-UnVd6w/candidate` |
| Candidate v1 identity | `a24caeb5e984c64e27c1af35a2846295af50e0367e248300b4c8b04687af0863` |
| Native SHA256 | `be4109c5b07514ade1a2e1452cbed9fca25cbb8d025b76fa2a81e21a91286a05` |
| Runtime-build identity | `e23bcc6640fbad054de52a34c59e606569b788ad6f79f460f52caa19220680c9` |

Production uses the entry's committed default host paths: current Core `/home/lionsol/.openclaw/agents/main/agent/openclaw-agent.sqlite`, Engine `/home/lionsol/.openclaw/memory/memory-engine/memory-engine.sqlite`, LanceDB `/home/lionsol/.openclaw/memory/lancedb`, active extension `/home/lionsol/.openclaw/extensions/memory-engine`, config `/home/lionsol/.openclaw/openclaw.json`, and cron state DB `/home/lionsol/.openclaw/state/openclaw.sqlite`.
Node is `/home/lionsol/.local/node24/bin/node`; OpenClaw entrypoint is `/home/lionsol/.local/lib/node_modules/openclaw/openclaw.mjs`.
Candidate/dependencies remain frozen. Entry rechecks fresh candidate manifest/native/parity and creates a fresh rollback snapshot.

## Single execution

Before invoking the entry, verify Sol's original authorization binds this card's exact documentation commit, identical repository HEAD, this Stage ID and an unconsumed MAX_EXECUTIONS=1. Verify all three script hashes and no tracked-file modifications; preserve the three existing untracked documents. Record consumed=1 before the invocation. Missing or changed inputs mean STOPPED without execution.

From the repository root, invoke exactly once, preserving the exit code:

```bash
AUTORECALL_ENTRY_EXPECTED_HEAD="<AUTHORIZED_REPOSITORY_HEAD>" \
bash docs/smoke-tests/autorecall-recent-deployment-entry-20261011.sh
```

The expected HEAD is the owner-authorized card-only commit, not the reviewed entry commit above. No other `AUTORECALL_ENTRY_*`, `AUTORECALL_DEPLOYMENT_*` or install-helper override is permitted in production. Do not edit, append, reconstruct, source as a replacement driver, re-enter or retry the entry/caller.

Allowed mutations are only: Gateway stop/start; one creation of the absent index below; one candidate install; at most one recovery install; and deletion of this execution's owned index only after its definition matches.

```sql
CREATE INDEX idx_memory_index_chunks_recent_cover
ON memory_index_chunks(updated_at DESC, id ASC, path);
```

The entry owns fresh cron capture before stop, quiesced baselines, DDL/plan verification, immutable `core-post-index.json`, child facts, outer gates, safe index cleanup and conditional Gateway restoration. Use its existing evidence. Failed cron capture must not consume stale JSON. Candidate root `0755 → 0700` is the sole explained artifact-mode exception; recovery artifact must match fresh rollback EXACT. Confirmed unexplained semantic/topology drift permanently blocks Gateway restart, even after exact recovery. Missing/invalid gates remain fail-closed; no database backup overwrite.

## Three acceptance criteria and closure

1. Exact single-index schema delta; Core canonical content/schema identity/user_version unchanged; actual covering-index selection and primary-key ID SEARCH for text fetch.
2. Installed candidate identity/parity and Core INSTALL, Engine, LanceDB, config and cron gates pass; Gateway health/config/status pass. Recovery is safe closure, never successful deployment.
3. After successful activation, make one bounded read-only inspection of existing natural trace metadata since activation (at most 200 records). Separate retrieval/skips and scored/fallback Recent/LIKE fallback. No samples means performance PENDING; health alone cannot prove latency benefit. Do not poll or generate traffic.

No synthetic requests, provider calls, candidate rebuilds, other indexes, cron edits, configuration-policy changes or extra runtime/data mutations. Preserve first-failure evidence and the original candidate exit code. Report consumed count, evidence directory, candidate/recovery invocation counts, index/identity gates, final Gateway state and performance status, then stop. Legitimate writes after Gateway startup are assessed separately from the quiesced INSTALL invariant.

Stage outcomes: PASS / PASS_WITH_FINDINGS / INSUFFICIENT_EVIDENCE / STOPPED. Normalize entry `STOPPED_ROLLED_BACK` to stage STOPPED with deployment_path=recovery. Failed or incomplete acceptance cannot be reported as deployment PASS.

## Freeze

Commit THIS NEW CARD ONLY; do not modify the entry, helpers, candidate or three existing untracked documents. That documentation commit becomes both STAGE_CARD_COMMIT and AUTHORIZED_REPOSITORY_HEAD. Return its full SHA to Sol for original explicit authorization. Card status and prior packets do not authorize production execution.

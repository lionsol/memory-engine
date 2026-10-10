# AutoRecall Recent covering index and source activation

STAGE_ID: AUTORECALL_RECENT_INDEX_ACTIVATION_20261010
Status: DRAFT / NOT AUTHORIZED
Reviewed retrieval source: `65bb8cff792d942ce3afb89d049cd2aee2b5c221`.
MAX_EXECUTIONS: 1. No automatic retry. At most one recovery installation.

## Decision and user value

Can the reviewed isolated Recent query select candidates through a covering index, with unchanged memory content and a healthy matching runtime? This addresses the observed 5.3–6.2 second Recent spikes; natural traffic determines actual latency benefit.

## Blocking source repair before freeze

`bin/core-deployment-logical-fingerprint.js` currently selects schema rows with `name LIKE 'memory_index_%'`, but not `tbl_name LIKE 'memory_index_%'`. The four actual chunk indexes (including the primary-key autoindex) are omitted. The intended new `idx_memory_index_chunks_recent_cover` is also omitted. Add the table-name predicate while retaining current selection rules. Do not loosen comparison or add an index-specific exclusion.

Add temporary native SQLite regression cases for an index named `idx_memory_index_chunks_recent_cover` and another arbitrary name on a protected table: CREATE, changed definition, and DROP must change schema surface/invariant and fail comparison; canonical content/owner identity/user_version remain equal. Repeated capture without mutation remains equal. Do not compare historical baselines produced by the previous incomplete schema query; regenerate both baselines with the fixed tool from the frozen revision.

Run the focused fingerprint test plus existing static/integrity checks. Keep the unrelated lifecycle static-regex failure as a disclosed finding. Then commit the repair and this Stage Card. Report the resulting exact HEAD/Stage Card commit and prepare the execution binding below. A document commit is not production execution authorization.

## In scope

1. One owner-controlled Core maintenance operation: add the exact covering index below to agent main's CURRENT physical Core table.
2. Install the frozen dependency-complete source artifact through OpenClaw, using the same Node24 runtime as Gateway; recover the previous installed artifact if necessary.
3. Read-only identity/health/query-plan checks and subsequent natural-traffic latency observations.

Non-goals: change gate, DIRECT_CARD, topK, Hint/defaults, FTS/Vector behavior, channel scheduling, persistent configuration or cron; synthetic OpenClaw requests; Core content mutation; weakening fingerprint comparisons.

## Allowed mutations after exact owner authorization

Core path: `/home/lionsol/.openclaw/agents/main/agent/openclaw-agent.sqlite`.

```sql
BEGIN IMMEDIATE;
CREATE INDEX idx_memory_index_chunks_recent_cover
ON memory_index_chunks(updated_at DESC, id ASC, path);
COMMIT;
```

Execute only when the file exists, the current table/columns match the reviewed schema, and this index name is absent. Use SQLite fail-on-error and finite busy timeout; a failed transaction must not be committed. No IF NOT EXISTS, ANALYZE, VACUUM, user_version update, schema-owner change or content write. This is external owner maintenance, never an engine Core write capability or an automatic recall-hook migration.

Also allowed: Gateway stop/start; one candidate install; at most one previous-artifact recovery install; creation of local evidence and immutable runtime snapshots. Require config equivalence under the EXISTING comparator's precise host-bookkeeping allowance and unchanged cron payloads; no expansion of those allowances. Engine/LanceDB mutation is not intended or allowed by this stage.

## Execution sequence

- Before downtime: verify bound HEAD and Stage Card are unchanged, check source/runtime baseline, preserve the exact current managed extension as the immutable rollback artifact, and prepare/validate a dependency-complete candidate using `docs/runtime-sync.md`. Work from a stable cwd outside the replaced extension. Bind exact artifact identities and paths in the execution report.
- Stop Gateway using its host-owned CLI. Establish a quiesced pre-index baseline with the fixed Core fingerprint tool, schema rows, config/cron and existing Engine/LanceDB fingerprints. Recheck the exact Core target and index absence.
- Create the index once. Capture a standalone post-index fingerprint and schema rows. Require canonical content, schema identity and user_version equality; schema diff must be exactly the single authorized index with the exact column order/directions and table. Do NOT require invariant equality across this intentional DDL and do NOT pass an unexpected comparison exit through an error trap.
- Run read-only EXPLAIN on the actual shared SQL through the current `chunks` compatibility view. Selection must use a covering index, body fetch must use ID SEARCH; no full physical table scan in selection. A bounded outer ORDER BY sort is acceptable. Use an empty archive list for the structural check; do not dump memory bodies or send a request to OpenClaw.
- The post-index snapshot is the immutable INSTALL baseline. Install the candidate once via `plugins install <validated-candidate> --force`. Before starting Gateway, require the fixed deployment comparison against this baseline to yield `deployment_invariant_equal=true`; Engine/LanceDB and config/cron gates must pass. Require source/runtime parity to the frozen candidate.
- Start Gateway, check health/config validity and parity, and record activation time. Confirm index presence after startup. Never require all Core content to remain frozen once natural Gateway activity resumes.
- Qualify performance using natural traces after this activation, clearly separating executed retrieval from skips. Report Recent stage/internal timings, FTS-empty/LIKE branch and hook latency. Residual LIKE scans, FTS or Vector delay are findings, not automatic follow-up changes.

## Pass criteria (three)

1. Exact single-index schema delta; canonical content, schema identity and user_version unchanged across index creation; strict deployment invariant unchanged across subsequent installation.
2. Real Core selection uses covering index and bounded primary-key body fetch; matching runtime, healthy Gateway, config/cron unchanged under existing contracts, Engine/LanceDB unchanged during the quiesced mutation window.
3. Natural executed traces are sufficient to assess the original Recent spike. If none are available, close activation only and report performance as pending; do not manufacture samples or promise a sub-second hook target.

## Stop and recovery

Stop on binding drift, missing rollback artifact, unexpected index/schema, query-plan failure, content/identity/version mutation, config/cron/data mismatch, install failure or unhealthy runtime. No candidate retry under this binding.

If only index/activation fails: keep Gateway stopped, reinstall the preserved previous artifact if installation began (at most once), then remove ONLY the new index whose definition still matches the stage-created index. Drop only if this execution created it. Require fixed Core comparison to the quiesced pre-index baseline, previous runtime parity and existing data/config/cron gates before restoring Gateway. Do not overwrite Core with a backup to conceal unexplained content changes; leave stopped and report such changes instead.

```sql
BEGIN IMMEDIATE;
DROP INDEX idx_memory_index_chunks_recent_cover;
COMMIT;
```

After successful activation, later natural latency findings do not trigger an unbounded rollback/retry loop. Report findings and stop for review.

## Binding to produce after freeze

```text
STAGE_ID=AUTORECALL_RECENT_INDEX_ACTIVATION_20261010
STAGE_CARD_PATH=docs/smoke-tests/autorecall-recent-index-activation-stage-card-20261010.md
STAGE_CARD_COMMIT=<exact committed revision>
AUTHORIZED_REPOSITORY_HEAD=<exact committed HEAD>
MAX_EXECUTIONS=1
```

Only Sol's subsequent explicit authorization of this exact frozen packet permits execution. Current authorization covers preparation only. After any execution, report PASS / PASS_WITH_FINDINGS / INSUFFICIENT_EVIDENCE / STOPPED and stop.

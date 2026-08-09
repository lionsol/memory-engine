# AutoRecall Provenance Natural Canary Retry R2 Stage Card — 2026-08-09

> **Status: FROZEN — execution requires separate post-commit Sol authorization**

## Decision
Can the already-created dedicated `main` session complete the previously approved bounded natural-use AutoRecall canary after correcting only execution/verifier defects, without changing the product question or retrieval behavior?

## Closed first attempt
The first natural-canary execution is closed `STOPPED` before AutoRecall enablement.

Verified facts:
- bootstrap succeeded and created the exact dedicated session;
- session ID is `ce1e425c-10f0-4393-8d76-75ec390dd58f`;
- session key is `agent:main:explicit:provenance-canary-ce1e425c-10f0-4393-8d76-75ec390dd58f`;
- agent ID is `main`;
- the bootstrap turn ran while AutoRecall was disabled and remains excluded from canary evidence;
- `openclaw.json` remained byte-identical to the pre-canary baseline;
- Gateway/runtime identity remained unchanged and healthy;
- no natural canary turn or scoped AutoRecall retrieval ran.

The first execution must not be replayed or represented as product evidence.

## Retry reason
The first execution stopped because the execution/verifier script had three defects:
1. it checked `openclaw sessions --json` rows using `id` instead of the actual `sessionId` field;
2. several closeout conditions used invalid multiline POSIX `[` syntax;
3. failure occurred before `BASE_EVENT_ID` was captured, so the closeout scope query used baseline `0` and incorrectly counted historical `recall_started` events as foreign canary traffic.

These are execution-mechanics defects only. They do not authorize source changes.

## Scope
Only three things are in scope:
1. reuse and verify the exact existing dedicated session, then capture a fresh event baseline before enablement;
2. temporarily enable AutoRecall only for `agentId=main` plus that exact session with `topK=1`, and run at most six genuine natural turns;
3. inspect bounded provenance/scope evidence and restore the exact pre-canary config.

Do not create a second bootstrap session or another canary session.

## Fixed session identity
Execution must verify the existing row by all three fields before mutation:

```text
agentId=main
sessionId=ce1e425c-10f0-4393-8d76-75ec390dd58f
sessionKey=agent:main:explicit:provenance-canary-ce1e425c-10f0-4393-8d76-75ec390dd58f
```

`openclaw sessions --agent main --json` must be evaluated using `sessionId` and `key`.

## Baseline ordering
Before any config mutation:
1. verify exact repository/Stage Card identity and clean worktree;
2. verify exact session ID/key/agent binding;
3. verify AutoRecall is disabled and pre-canary config identity matches the bound execution packet;
4. verify R2 plugin/runtime identity and Gateway health;
5. capture `BASE_EVENT_ID = max(memory_events.id)` from a read-only Engine DB connection;
6. only then back up and mutate config.

If the event baseline cannot be captured, stop without enabling AutoRecall.

## Temporary AutoRecall config
Only the AutoRecall object may be temporarily replaced with:

```json
{
  "enabled": true,
  "topK": 1,
  "timeoutMs": 8000,
  "agentAllowlist": ["main"],
  "sessionAllowlist": ["ce1e425c-10f0-4393-8d76-75ec390dd58f"],
  "triggerAllowlist": ["user"],
  "chatTypeAllowlist": ["interactive_user_chat"],
  "messageRoleAllowlist": ["user"],
  "cardFirstRuntime": { "enabled": false }
}
```

The exact pre-canary config must be backed up before mutation and restored byte-equivalently at closeout.

## Frozen product behavior
Do not change query shaping, focused-query logic, channel collection, FTS/vector/recent/KG behavior, fusion/ranking, category weights, confidence/gate thresholds, Card/gate logic, provenance fields/limits, capture/index/checkpoint behavior, or any source file.

No H6 replay, synthetic retrieval probe, forced memory question, or explicit instruction to call memory tools is allowed.

## Natural turns
Sol may provide at most six genuine task-relevant user turns in the dedicated session.

Stop early when one non-skipped AutoRecall retrieval persists provenance sufficient to answer the stage question.

If all six turns are skipped before retrieval or produce no qualifying provenance, close `INSUFFICIENT_EVIDENCE`; do not add a seventh turn.

## Provenance acceptance
At least one post-baseline `auto_recall_debug` event for the dedicated session must be non-skipped and correspond to a post-baseline `recall_started` trace.

Its new provenance fields must show:
- `channel_candidate_provenance` containing only `count`, `captured_count`, `truncated`, and `ids` per channel;
- at most 32 IDs per channel, each ID at most 16 characters;
- `fusion_candidate_provenance` containing only `pre_rerank_ids` and `post_rerank_ids`, each bounded to eight IDs;
- no text/body/preview/path/prompt/query/exact-fragment fields inside the new provenance objects.

A search that legitimately returns zero channels is evidence of execution but not sufficient by itself for PASS.

## Scope isolation
Only events with `id > BASE_EVENT_ID` count as canary evidence.

Other sessions may emit runtime-gate-denied skip telemetry after global hook registration. That is not leakage.

Scope leakage exists only if a post-baseline `recall_started` with `source=autoRecall` is recorded for a session other than the exact dedicated session.

Historical pre-baseline events must never be included in the isolation count.

## Closeout and shell contract
Closeout must run on success, error, interrupt, or insufficient evidence.

Shell conditions must use valid single-command `[[ ... ]]` expressions or equivalent valid Bash syntax; do not use multiline `[` constructs.

Closeout must:
1. restore exact pre-canary config bytes if config mutation may have occurred;
2. validate config and restart Gateway if required;
3. verify AutoRecall is disabled;
4. verify Gateway/plugin healthy and R2 runtime identity unchanged;
5. perform scope-isolation queries only against `id > BASE_EVENT_ID`;
6. report and stop.

## Allowed mutations
During separately authorized execution only:
- temporary config mutation and Gateway stop/start required to load it;
- up to six natural turns in the existing dedicated session;
- ordinary AutoRecall telemetry/event writes and existing safety-gated reinforcement naturally caused by those turns;
- exact config restoration.

No direct Core/Engine/LanceDB mutation, index rebuild, backfill, manual confidence edit, memory cleanup, source edit, commit, tag, or push is authorized.

## Pass criteria
1. Exact existing session identity and fresh pre-enable event baseline are verified.
2. At least one genuine non-skipped natural AutoRecall execution persists valid bounded/privacy-safe provenance, with no post-baseline foreign `recall_started` event.
3. Exact pre-canary config is restored, AutoRecall is disabled, and R2 runtime remains healthy/unchanged.

## Stop conditions
Stop and restore if session identity/config/runtime preflight differs, baseline capture fails, another session enters `recall_started`, provenance violates bounds/privacy, Gateway/plugin health degrades, or any retrieval/product/source change becomes necessary.

## Outcome
Use exactly one: `PASS`, `PASS_WITH_FINDINGS`, `INSUFFICIENT_EVIDENCE`, or `STOPPED`.

A PASS authorizes neither retrieval tuning nor broad AutoRecall rollout.

## Authorization boundary
Execution must bind the exact committed R2 Stage Card, exact repository HEAD, Stage Card SHA256, fixed session ID/key, exact pre-canary config identity, active R2 runtime identity, and `MAX_EXECUTIONS=1`.

This Stage Card authorizes nothing by itself. After execution, report and stop.
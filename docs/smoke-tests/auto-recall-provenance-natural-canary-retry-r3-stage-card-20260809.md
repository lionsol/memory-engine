# AutoRecall Provenance Natural Canary Retry R3 Stage Card — 2026-08-09

> **Status: FROZEN — execution requires separate post-commit Sol authorization**

## Decision
Can the existing dedicated `main` session complete one final natural-use AutoRecall provenance canary after correcting only the R2 interactive-stdin harness defect?

## Owner-approved anti-drift exception
Sol explicitly authorized creation of R3 and continuation of testing after R2 stopped before any genuine natural user turn.

This is a one-time product-level exception to the default third-verification-substage stop rule. It does not reopen retrieval design, H6, Candidate-Builder, or broad AutoRecall rollout.

No R4 is allowed for another harness retry. If R3 stops because of another execution-harness defect, close this canary chain and return to product-level review.

## Closed R2 attempt
R2 is immutable `STOPPED` execution history.

Verified facts:
- exact dedicated session remained valid;
- fresh baseline was captured at `memory_events.id=185`;
- scoped AutoRecall configuration loaded successfully;
- no genuine Sol natural question was submitted;
- the interactive `read` consumed remaining heredoc script input because the script itself was running via `bash -s <<'EOF'`;
- the string `STAGE_RESULT="INSUFFICIENT_EVIDENCE"` was accidentally sent as the first OpenClaw prompt;
- that accidental turn produced technically valid bounded provenance and no foreign `recall_started`, but it is not natural-use evidence;
- exact pre-canary config was restored, AutoRecall returned to disabled, and R2 runtime remained healthy.

Do not count R2's accidental prompt as a natural canary turn.

## Scope
Only three things are in scope:
1. reuse and verify the exact existing dedicated session and capture a fresh event baseline;
2. temporarily enable AutoRecall only for that exact `main` session with `topK=1`, then accept at most six genuine Sol questions read from `/dev/tty`;
3. inspect bounded provenance/scope evidence and restore the exact pre-canary config.

## Fixed session identity
Execution must verify all three fields before mutation:

```text
agentId=main
sessionId=ce1e425c-10f0-4393-8d76-75ec390dd58f
sessionKey=agent:main:explicit:provenance-canary-ce1e425c-10f0-4393-8d76-75ec390dd58f
```

Do not create another session or bootstrap turn.

## Mandatory interactive-input contract
The execution harness may still be delivered to Bash through a heredoc, but every natural question must be read explicitly from the controlling terminal:

```bash
IFS= read -r QUESTION </dev/tty
```

Do not use plain `read` from inherited stdin.

Before execution, the exact full harness must pass `bash -n`.

If `/dev/tty` is unavailable or not readable, STOP before sending a canary turn.

Reject and STOP before sending any `QUESTION` that exactly matches or begins like an execution-control line such as `STAGE_RESULT=`, `BASE_EVENT_ID=`, `exit `, `trap `, `MEMORY_ENGINE_`, or a heredoc terminator. This is a harness-safety check, not content filtering of ordinary user questions.

## Baseline ordering
Before any config mutation:
1. verify exact repository/Stage Card identity and clean worktree;
2. verify exact session ID/key/agent binding;
3. verify AutoRecall disabled and exact pre-canary config identity;
4. verify R2 plugin/runtime identity and Gateway health;
5. capture fresh `BASE_EVENT_ID=max(memory_events.id)` read-only;
6. only then create the config backup and mutate runtime config.

Only events with `id > BASE_EVENT_ID` count as R3 evidence.

## Temporary AutoRecall config
Replace only `plugins.entries.memory-engine.config.autoRecall` with:

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
Do not change query shaping, focused-query logic, FTS/vector/recent/KG collection, fusion/ranking, category weights, confidence/gate thresholds, Card/gate logic, provenance fields/limits, capture/index/checkpoint behavior, or source files.

No H6 replay, synthetic retrieval probe, forced memory question, or instruction to call memory tools is allowed.

## Natural turns
Sol may provide at most six genuine task-relevant user turns through `/dev/tty`.

An empty line is not a turn. `:stop` ends the stage without sending a prompt and yields `INSUFFICIENT_EVIDENCE` unless qualifying natural evidence already exists.

Stop early when one genuine non-skipped AutoRecall retrieval persists valid provenance sufficient to answer this stage.

If six genuine turns yield no qualifying provenance, close `INSUFFICIENT_EVIDENCE`; do not add a seventh turn.

## Provenance and scope acceptance
PASS requires at least one post-baseline `auto_recall_debug` for the dedicated session with `skipped=false` and a matching post-baseline `recall_started` trace.

Its provenance must satisfy the frozen contract: per-channel fields only `count/captured_count/truncated/ids`, at most 32 IDs per channel and 16 chars per ID; fusion fields only `pre_rerank_ids/post_rerank_ids`, at most eight IDs each; no text/body/preview/path/prompt/query/exact-fragment fields inside the new provenance objects.

A zero-channel search is execution evidence but not sufficient for PASS.

Other sessions may emit gate-denied skip telemetry. Scope leakage exists only if a post-baseline `recall_started` with `source=autoRecall` belongs to another session.

## Closeout
Closeout must run on success, error, interrupt, `:stop`, or insufficient evidence and must:
1. restore exact pre-canary config bytes if runtime mutation may have occurred;
2. validate config and restart Gateway as required;
3. verify AutoRecall disabled;
4. verify Gateway/plugin healthy and R2 runtime identity unchanged;
5. verify no post-baseline foreign `recall_started`;
6. report one outcome and stop.

## Allowed mutations
Only temporary AutoRecall config/Gateway stop-start, up to six natural turns in the existing session, ordinary resulting telemetry and existing safety-gated reinforcement, and exact config restoration are allowed.

No direct Core/Engine/LanceDB mutation, index rebuild, backfill, manual confidence edit, memory cleanup, source edit, commit, tag, or push is authorized during execution.

## Pass criteria
1. Existing session, fresh baseline, and `/dev/tty` interaction path are verified before any natural turn.
2. At least one genuine natural AutoRecall execution persists valid bounded/privacy-safe provenance with no post-baseline foreign `recall_started`.
3. Exact pre-canary config is restored, AutoRecall disabled, and R2 runtime healthy/unchanged.

## Outcome and stop
Use exactly one: `PASS`, `PASS_WITH_FINDINGS`, `INSUFFICIENT_EVIDENCE`, or `STOPPED`.

STOP on identity/config/runtime mismatch, baseline failure, unavailable `/dev/tty`, harness-control text reaching the question variable, provenance/scope violation, Gateway/plugin degradation, or need for any product/source change.

A PASS authorizes neither retrieval tuning nor broad AutoRecall rollout. R3 is the final dedicated canary retry; no R4 harness retry is authorized.

## Authorization boundary
Execution must bind the exact committed R3 Stage Card, exact repository HEAD, Stage Card SHA256, fixed session ID/key, exact pre-canary config identity, active R2 runtime identity, and `MAX_EXECUTIONS=1`.

This Stage Card authorizes nothing by itself. After execution, report and stop.
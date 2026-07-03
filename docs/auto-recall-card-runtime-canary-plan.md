# AutoRecall Card Runtime Canary Plan

## Status

P5 opt-in canary plan.

This document defines a local-only canary procedure for the card-first autoRecall runtime. It does not enable card-first runtime by default and does not recommend broad rollout.

## Purpose

P4 added card projection, replay preview, Console preview, and a gated runtime branch. P5 verifies whether card-first prompt supplements are useful in a real `edi` interactive session before considering any broader default.

The canary answers four questions:

1. Does card-first preserve useful recall context for `edi`?
2. Does it reduce raw log / tool output exposure compared with raw-text autoRecall?
3. Does the assistant still cite memory ids only when it actually relies on a card?
4. Do `auto_recall_debug` and `memory_injected` events clearly show `memory_card` disclosure mode?

## Non-goals

- Do not enable card-first runtime by default.
- Do not enable card-first runtime for `task-planner`.
- Do not enable card-first runtime for Codex CLI.
- Do not enable active-memory and memory-engine autoRecall together.
- Do not change retrieval ranking, KG/FTS/vector fusion, or eligibility gates.
- Do not call `memory_engine_get` automatically.
- Do not inject full memory content.
- Do not reinforce memory from card rendering, card injection, search result, or Console preview.
- Do not run this canary in background/system/tool-output chat contexts.

## Config schema

`openclaw.plugin.json` exposes the canary switch so a local config can opt in without violating the plugin config schema:

```json
{
  "autoRecall": {
    "enabled": true,
    "topK": 3,
    "timeoutMs": 8000,
    "cardFirstRuntime": {
      "enabled": true
    }
  }
}
```

Schema defaults remain safe:

```json
{
  "autoRecall": {
    "enabled": false,
    "topK": 3,
    "timeoutMs": 8000,
    "cardFirstRuntime": {
      "enabled": false
    }
  }
}
```

Runtime behavior is still additionally gated by `agentId=edi`. If the runtime gate resolves `task-planner`, Codex CLI, missing agent id, non-user role, or non-interactive chat type, card-first must not run.

## Preflight checklist

Before any live canary:

```bash
git diff --check
node --check index.js
node bin/run-auto-recall-card-runtime-smoke.js --json
node --test \
  test/auto-recall.test.js \
  test/auto-recall-debug-metadata.snapshot.test.js \
  test/auto-recall-runtime-gate.test.js \
  test/auto-recall-card-runtime-smoke.test.js \
  test/auto-recall-memory-card.test.js
```

Expected:

```text
card runtime smoke status = pass
card_first_runtime_enabled=false for default runtime
card_first_runtime_enabled=true only for edi with explicit flag
raw log / tool output body is withheld in card-first context
```

## Local canary steps

1. Keep current branch clean except the intended local config change.
2. Confirm active-memory is disabled or not injecting into the same turn.
3. Confirm `autoRecall.enabled=true` is already intentional for this local canary.
4. Add `cardFirstRuntime.enabled=true` only to the local `memory-engine` plugin config.
5. Restart or reload the OpenClaw gateway/plugin runtime.
6. Use only an `edi` interactive user chat.
7. Run a short task set of 5-10 prompts:
   - continue a known memory-engine task;
   - ask about a recent P4 decision;
   - ask about a prior debug issue;
   - ask a generic rewrite/summarize task that should not recall;
   - ask a raw-log-like debug question with explicit history signal.
8. For each answer, check whether the assistant cites memory ids only when it used a card.
9. Inspect events for disclosure mode.
10. Disable `cardFirstRuntime.enabled` immediately after the canary.

## Suggested canary prompts

Use a small fixed set so the raw-text baseline and card-first canary can be compared.

```text
继续 memory-engine P4 card-first runtime 的下一步，先回顾上次结论。
```

```text
我们之前为什么要让 cardFirstRuntime 默认关闭？
```

```text
是不是之前那个 memory-engine autoRecall focused query 问题？我这里又看到长日志了。
```

```text
请润色下面这段当前文本，不需要查历史：<paste current text>
```

```text
总结当前这段日志，不要引用历史：<paste current log>
```

Expected behavior:

- explicit history/project prompts may recall;
- generic current-text rewrite/summarize prompts should skip recall;
- card-first answers may cite memory ids only when relevant;
- long raw log bodies must not appear in card supplement.

## Event inspection

Inspect latest `auto_recall_debug` events for disclosure mode:

```sql
SELECT
  created_at,
  session_id,
  trace_id,
  json_extract(metadata_json, '$.card_first_runtime_enabled') AS card_first_runtime_enabled,
  json_extract(metadata_json, '$.auto_recall_disclosure_mode') AS auto_recall_disclosure_mode,
  json_extract(metadata_json, '$.focused_query') AS focused_query,
  json_extract(metadata_json, '$.injected_count') AS injected_count
FROM memory_events
WHERE event_type = 'auto_recall_debug'
ORDER BY created_at DESC
LIMIT 20;
```

Inspect latest `memory_injected` events:

```sql
SELECT
  created_at,
  session_id,
  trace_id,
  memory_id,
  json_extract(metadata_json, '$.card_first_runtime_enabled') AS card_first_runtime_enabled,
  json_extract(metadata_json, '$.disclosure_mode') AS disclosure_mode,
  json_extract(metadata_json, '$.category') AS category,
  json_extract(metadata_json, '$.reinforcement_allowed') AS reinforcement_allowed
FROM memory_events
WHERE event_type = 'memory_injected'
ORDER BY created_at DESC
LIMIT 20;
```

Expected for card-first turns:

```text
card_first_runtime_enabled = true
auto_recall_disclosure_mode = memory_card
disclosure_mode = memory_card
```

Expected for default or non-edi turns:

```text
card_first_runtime_enabled = false
auto_recall_disclosure_mode = raw_text
disclosure_mode = raw_text
```

## Pass criteria

The canary passes only if all of the following hold:

- `card_first_runtime_enabled=true` appears only in `edi` interactive user turns with explicit flag enabled.
- Plain-language guard: card_first_runtime_enabled=true appears only in `edi` interactive user turns.
- generic long-input rewrite/summarize prompts still skip recall.
- card-first context includes `## Auto Recall - memory cards`.
- card-first context does not include full original memory body text.
- raw-log-like and tool-output-like card summaries are withheld.
- answers do not cite memory ids unless the card was relevant.
- cited-id-only reinforcement behavior remains intact.
- no unexpected `memory_engine_get` call is triggered by the supplement itself.
- no Console preview action mutates memory or triggers reinforcement.

## Fail criteria

Stop the canary and roll back if any of these happen:

- card-first runs for `task-planner`, Codex CLI, missing agent id, non-user role, or non-interactive chat.
- full raw memory body, stack trace, timestamped raw log, or tool output appears in the prompt supplement.
- assistant cites memory ids mechanically without relying on them.
- reinforcement happens without an explicit cited memory id.
- active-memory and memory-engine autoRecall both inject into the same turn.
- `auto_recall_debug` lacks disclosure-mode observability.
- answer quality is materially worse than raw-text baseline for project-continuation turns.

## Rollback

Immediate config rollback:

```json
{
  "autoRecall": {
    "cardFirstRuntime": {
      "enabled": false
    }
  }
}
```

or remove `cardFirstRuntime` from local config.

Then restart or reload the OpenClaw gateway/plugin runtime.

Verify rollback:

```bash
node bin/run-auto-recall-card-runtime-smoke.js --json
```

and inspect fresh `auto_recall_debug` / `memory_injected` events. New live turns should report `raw_text` unless a local canary flag is intentionally re-enabled.

## Decision record template

After the canary, record a short decision:

```text
Date:
Canary config:
Prompt count:
Pass/fail:
Observed card_first_runtime_enabled events:
Observed memory_card disclosure events:
Citation quality:
Raw-log withholding:
Unexpected memory_engine_get calls:
Unexpected reinforcement:
Decision: keep experiment disabled / repeat canary / expand edi canary / reject card-first default
Notes:
```

## Recommendation

Keep `cardFirstRuntime.enabled=false` after the first canary. Treat card-first as experiment-only until at least one successful `edi` canary shows stable disclosure mode, acceptable answer quality, and clean citation/reinforcement behavior.

# Q6-D2 Exact-Session Real-Host Shadow Observation — Final Result

Date: 2026-09-19

## Final adjudication

```text
Q6-D2 =
STOPPED / CONSUMED / CLEAN CLOSEOUT

primary finding =
STABLE SESSION KEY / ROTATING RUNTIME SESSION ID MISMATCH

shadow mechanism qualification =
NOT REACHED

natural user turns actually sent =
1

Q6 shadow decisions observed =
0

one-shot authorization =
1 / 1 consumed

Q6-E =
NOT READY
```

## Transaction history

### Preactivation stop — 20:36 +08:00

The first authorized invocation stopped inside the packet's embedded `max_event_id()` Node expression.

```text
outcome=STOPPED_PREACTIVATION
execution_count_consumed=0
turns_sent=0
shadow activation=0
live mutation=0
```

The malformed expression was repaired, behavior-tested against temporary SQLite, and rebound without consuming the one-shot authority.

### Consumed transaction — 20:43 onward

The repaired invocation passed preflight:

```text
20:43:58 PREFLIGHT_BEGIN
20:44:29 PREFLIGHT_PASS base_event_id=736
20:44:29 EXECUTION_COUNT_CONSUMED=1
20:45:33 SHADOW_ACTIVE session=d31f1b79-d9cb-476a-8d4e-f70f892b1500
```

The operator then sent one genuine natural user turn in the OpenClaw chat identified by the stable key:

```text
agent:main:explicit:d31f1b79-d9cb-476a-8d4e-f70f892b1500
```

The user question was ordinary session-related usage rather than a memory-engine forcing prompt.

The packet observed no new Q6 shadow decision and stopped:

```text
21:04:02 STOP no_new_shadow_decision
21:04:02 CLOSEOUT_BEGIN
21:05:05 CLOSEOUT_PASS
```

Machine-readable transaction result:

```json
{
  "schema": "memory_engine_q6_d2_shadow_autorecall_transaction_result_v1",
  "outcome": "STOPPED",
  "reason": "see_transaction_log",
  "session_id": "d31f1b79-d9cb-476a-8d4e-f70f892b1500",
  "execution_count_consumed": 1,
  "max_executions": 1,
  "max_turns": 6,
  "turns_sent": 0,
  "closeout_ok": true
}
```

The result's `turns_sent=0` is the packet's confirmed-shadow-turn counter, not the number of actual operator user turns. The bounded evidence helper was invoked for one expected turn and reports `turns_sent=1`.

## Post-baseline event evidence

The bounded evidence scan covered events after:

```text
BASE_EVENT_ID=736
```

It found nine post-baseline events and zero Q6 shadow envelopes:

```text
shadow_decisions=0
search_executed(Q6 envelopes)=0
violations=[]
mechanism_pass=false
```

Read-only bounded event inspection proved that the natural user turn did execute AutoRecall under runtime session ID:

```text
acd96a23-5472-4b88-a2cd-f15277d3e58b
```

Observed path:

```text
recall_started
hybrid_search_observation (search_executed=true)
auto_recall_debug
memory_candidate_retrieved x3
recall_completed (candidate_count=3, injected_count=0)
```

Therefore:

```text
user turn reached AutoRecall = PROVEN
retrieval executed = PROVEN
candidate retrieval occurred = PROVEN
Q6 shadow envelope emitted = NO
```

This is not evidence that AutoRecall or retrieval failed.

## Stable-key identity finding

After the turn, OpenClaw's session store mapped:

```text
stable sessionKey =
agent:main:explicit:d31f1b79-d9cb-476a-8d4e-f70f892b1500

current runtime sessionId =
acd96a23-5472-4b88-a2cd-f15277d3e58b
```

Q6-D2 had activated shadow with:

```text
sessionAllowlist=[
  d31f1b79-d9cb-476a-8d4e-f70f892b1500
]
```

Thus the stable OpenClaw chat identity remained the same while its runtime session ID rotated.

Source review confirms the Q6-B/D2 implementation resolved shadow scope from a single value with this precedence:

```text
event.sessionId
event.session_id
event.sessionKey
ctx.sessionId
ctx.sessionKey
ctx.runId
```

Because `event.sessionId` was present, the stable `sessionKey` was not used for authorization matching.

Final finding:

```text
Q6-D2 SCOPE IDENTITY MODEL =
INCORRECT FOR RESUMED OPENCLAW CHAT

stable authorization identity =
sessionKey

runtime correlation identity =
sessionId
```

## Closeout

Closeout passed after the stop:

```text
CLOSEOUT_PASS
```

The exact pre-transaction config was restored and Gateway returned healthy.

Q6-D2 must not be replayed. Its one-shot authority is consumed.

## Successor decision

The bounded successor is Q6-D3 Stable Session-Key Shadow Scope.

D3 must:

- authorize exact shadow scope using a stable OpenClaw `sessionKey`;
- retain runtime `sessionId` for event/trace correlation;
- preserve backward compatibility with exact runtime session IDs;
- support more than one observed runtime session ID in read-only evidence if the stable key rotates again;
- keep exact-match/fail-closed semantics;
- make no change to retrieval/rerank/topK/card-first policy.

Q6-E remains not ready until useful real-host shadow evidence exists.

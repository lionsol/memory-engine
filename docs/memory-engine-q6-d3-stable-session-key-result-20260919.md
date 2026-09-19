# Q6-D3 Stable Session-Key Shadow Scope — Final Result

Date: 2026-09-19

## Final adjudication

```text
Q6-D3 =
PASS_WITH_FINDINGS / CLOSED

machine transaction outcome =
STOPPED / CONSUMED / CLEAN CLOSEOUT

stable-key mechanism =
PASS

deployment =
PASS / D3 INSTALLED

shadow apply suppression =
PASS

operator-protocol finding =
PRESENT

Q6-E =
READY FOR PRODUCT DECISION / NOT STARTED
```

## Transaction summary

The one-shot D3 transaction passed preflight and consumed its authorization:

```text
23:06:20 PREFLIGHT_BEGIN
23:07:03 PREFLIGHT_PASS base_event_id=751 runtime_session_id=acd96a23-5472-4b88-a2cd-f15277d3e58b
23:07:03 EXECUTION_COUNT_CONSUMED=1
23:08:45 SHADOW_ACTIVE key=agent:main:explicit:d31f1b79-d9cb-476a-8d4e-f70f892b1500 runtime_session_id=acd96a23-5472-4b88-a2cd-f15277d3e58b
```

The host-owned publication step installed D3 successfully before shadow activation.

## Real natural-turn evidence

Exactly one genuine natural user turn was sent in the bound OpenClaw chat before the first operator confirmation.

That turn produced exactly one Q6 shadow decision:

```text
TURN slot=1
decisions=1
violations=0
foreign=0
injected=0
reinforced=0
runtime_ids=1
```

Bounded evidence:

```text
shadow_decisions=1
search_executed=1
candidate_count=3
candidate_count_after_gate=0
would_inject_turns=0
no_injection_turns=1
foreign_q6_shadow_decision_count=0
memory_injected_on_shadow_trace_count=0
memory_reinforced_on_shadow_trace_count=0
recall_completed_on_shadow_trace_count=1
violations=[]
mechanism_pass=true
```

Latency for the observed search turn:

```text
retrieval_ms=8481
decision_ms=0
total_ms=8574
```

The DIRECT_CARD withholding reasons were:

```text
raw_log_low_coverage_no_exact x3
```

No DIRECT_CARD boundary error was observed.

## Stable-key qualification

The D3 transaction authorized shadow using the stable key:

```text
agent:main:explicit:d31f1b79-d9cb-476a-8d4e-f70f892b1500
```

The observed runtime session ID was:

```text
acd96a23-5472-4b88-a2cd-f15277d3e58b
```

The real user turn reached AutoRecall and emitted the Q6 shadow envelope under that runtime ID while authorization was based on the stable key.

Therefore the D2 identity-model defect is repaired:

```text
stable sessionKey authorization = QUALIFIED
runtime sessionId event correlation = QUALIFIED
```

No runtime session-ID rotation occurred during the single qualified natural turn, so multi-ID aggregation remains source-tested rather than additionally real-host-observed.

## Why the machine transaction reported STOPPED

At the second packet prompt, the operator pressed Enter **without sending a second OpenClaw user turn**.

The packet increments its internal `TURN_COUNT` immediately after Enter and then waits for a new Q6 decision. Because no second natural turn had actually been sent, no new decision was expected.

The packet consequently logged:

```text
23:13:33 STOP no_new_shadow_decision
```

This is an operator-protocol / packet-observability defect, not a stable-key mechanism failure.

The machine result therefore recorded:

```json
{
  "outcome": "STOPPED",
  "execution_count_consumed": 1,
  "turns_sent": 2,
  "rollback_attempted": 0,
  "closeout_ok": true
}
```

but `turns_sent=2` is not the true number of natural user turns. The true user-turn count, based on the operator clarification, is one.

The packet cannot independently prove that pressing Enter corresponds to a newly sent chat turn.

## Post-stop event note

A later Q6 shadow structural-skip envelope was written at approximately 23:13:37, after:

```text
23:13:33 STOP no_new_shadow_decision
23:13:33 CLOSEOUT_BEGIN
```

It carried:

```text
shadow_status=skipped
search_executed=false
structural_skip_reason=too_short_compact_le_8_words_le_2
apply_suppressed=true
```

Because it occurred after the transaction stop and the operator confirms that no second user question was sent, it is not counted as D3 slot-2 evidence and is not attributed to a user turn without additional content inspection.

## Closeout

Closeout passed:

```text
23:14:35 CLOSEOUT_PASS
```

Read-only post-closeout verification proved:

```text
autoRecall.shadow = absent/off
Gateway runtime = running
Connectivity probe = ok
D3 manifest installed = 4cee6de6...
D3 shadow source installed = 5566d2f1...
D3 lifecycle source installed = 3adf5a4e...
```

Therefore D3 remains installed in default-off shadow posture.

## Finding

The packet interaction protocol should not use bare Enter as the semantic assertion "one user turn was sent".

A future observation packet should require an explicit operator token such as:

```text
:sent
```

and reserve:

```text
:finish
```

for early closeout. This would not cryptographically prove a user turn occurred, but it would prevent accidental blank confirmation from being interpreted as a sent turn.

## Decision

Q6-D3 is closed `PASS_WITH_FINDINGS`.

The stable-session-key shadow authorization correction is real-host qualified for one genuine natural search turn.

The one-shot D3 authorization is consumed and must not be replayed.

Q6-E is now ready for product decision using:

- Q6-C offline qualification;
- Q6-D2 identity-model finding;
- Q6-D3 real-host stable-key mechanism evidence;
- the observed latency and withholding behavior.

Q6-E is not started automatically.

# Q6-D2 Exact-Session Real-Host Shadow Observation Stage Card — 2026-09-19

> **Status: OWNER AUTHORIZED / ONE-SHOT RUNTIME EXECUTION / SOURCE PACKET QUALIFIED**
>
> Owner authorization was granted on 2026-09-19 for exactly one Q6-D2 exact-session real-host shadow observation transaction. The authorization is non-reusable after the execution-consumed boundary and does not authorize Q6-E, Q7, plugin installation, registry repair, retrieval/rerank changes, memory-data mutation, push, or tag.

## 1. Decision

Can the already-implemented Q6 Shadow AutoRecall seam execute through the real OpenClaw host on one exact `main` session, persist bounded content-free decision/latency evidence, and suppress all apply-side effects while preserving non-shadow behavior?

Q6-D2 measures real-host mechanism/scope/latency shape only.

It does **not** estimate production false-positive rate, precision/recall, or production prevalence because the natural-turn sample has no independent labels.

## 2. Historical predecessor

Q6-D closed:

```text
STOPPED / CONSUMED / CLEAN CLOSEOUT
NO RUNTIME SHADOW EVIDENCE
```

Its failure was not a Q6 source-mechanism failure. Gateway rejected `autoRecall.shadow` because host plugin metadata was still pinned to a pre-Q6 installed manifest.

Q6-R1 subsequently closed:

```text
PASS_WITH_FINDINGS / CLOSED
PUBLICATION CONVERGED
ONE-SHOT AUTHORIZATION CONSUMED
```

Q6-R1 proved:

```text
repo manifest hash
=
installPath manifest hash
=
persisted plugin manifestHash
=
0ea09bfea5bb5d1f3532ed22c9e0ae9c1cfe64abd785f00a1458b8481b0b0a27
```

and installed Q6 runtime parity:

```text
lib/config/effective-hybrid-runtime-config.js
61ffb77fead2f4e83265af4d6c7eb28d247c8562ea6771f7fc03fa3df3b2bfb6

lib/recall/auto-recall-hook-lifecycle.js
9baa225f9a94752c94aec6fae92d9e663219a0565ecd0dec2aa35807b6815aa0

lib/recall/auto-recall-shadow.js
ee913beacc1b1ac103283846a82c0e19252240b9faa3e628e4acc21f3173ceef
```

Therefore Q6-D2 starts from a repaired schema/publication host state and performs **no plugin installation**.

## 3. Fixed Q6 runtime identity

Repository:

```text
/home/lionsol/.openclaw/workspace/plugins/memory-engine
```

Frozen Q6 source identity:

```text
Q6 latency-observability source commit
4f79a8c78fb68bb92294ea78a755293c8b62cbc4
```

Frozen runtime hashes:

```text
openclaw.plugin.json
0ea09bfea5bb5d1f3532ed22c9e0ae9c1cfe64abd785f00a1458b8481b0b0a27

lib/config/effective-hybrid-runtime-config.js
61ffb77fead2f4e83265af4d6c7eb28d247c8562ea6771f7fc03fa3df3b2bfb6

lib/recall/auto-recall-hook-lifecycle.js
9baa225f9a94752c94aec6fae92d9e663219a0565ecd0dec2aa35807b6815aa0

lib/recall/auto-recall-shadow.js
ee913beacc1b1ac103283846a82c0e19252240b9faa3e628e4acc21f3173ceef
```

Q6-D2 preflight must prove these hashes in both:

```text
sourcePath repo
installPath extension
```

and persisted registry metadata must still advertise the Q6 manifest hash.

## 4. Host publication precondition

Before the first runtime/config mutation, prove:

```text
install.source=path
install.sourcePath=/home/lionsol/.openclaw/workspace/plugins/memory-engine
install.installPath=/home/lionsol/.openclaw/extensions/memory-engine
install.version=1.0.0

persisted pluginId=memory-engine
persisted manifestPath=/home/lionsol/.openclaw/extensions/memory-engine/openclaw.plugin.json
persisted manifestHash=0ea09bfe...
persisted rootDir=/home/lionsol/.openclaw/extensions/memory-engine
persisted enabled=true
```

Any regression to the pre-Q6 `346969a5...` manifest is a preactivation STOP.

No registry refresh, plugin install/update, manual manifest copy or direct state-DB write is part of Q6-D2.

## 5. Runtime posture invariant

Before Q6-D2 activation and after closeout:

```text
autoRecall.enabled=true
autoRecall.topK=3
autoRecall.cardFirstRuntime.enabled=true
autoRecall.agentAllowlist=["main"]
autoRecall.triggerAllowlist=["user"]
autoRecall.chatTypeAllowlist=["interactive_user_chat"]
autoRecall.messageRoleAllowlist=["user"]

autoRecall.shadow absent/off

explicitSearchRerankProvider.enabled=true
explicitSearchRerankControl.enabled=false

recallHintRuntimeCanary absent/off
```

The exact pre-transaction config bytes are the rollback/closeout authority.

## 6. Exact-session binding

Q6-D2 uses exactly one explicit `agentId=main` session.

The authorized transaction is frozen to exactly this existing non-default `main` explicit session:

```text
Q6_D2_SESSION_ID=d31f1b79-d9cb-476a-8d4e-f70f892b1500
Q6_D2_SESSION_KEY=agent:main:explicit:d31f1b79-d9cb-476a-8d4e-f70f892b1500
```

Read-only authorization-time inspection proved this exact pair exists. OpenClaw 2026.7.1-2 has no empty-session creation command; creating a new session would require an agent turn and is intentionally avoided.

The packet still receives these values through environment bindings and preflight must re-prove the exact pair exists in:

```bash
openclaw sessions --agent main --json
```

The session key must not be:

```text
agent:main:main
```

Do not use cron/background/dispatcher/researcher/coding sessions.

One session only.

## 7. Execution limits

```text
MAX_EXECUTIONS=1
MAX_TURNS=6
MAX_GATEWAY_ACTIVATION_RESTARTS=1
MAX_GATEWAY_CLOSEOUT_RESTARTS=1

plugin installs=0
registry refreshes=0
sourcePath mutations=0
provider-family expansion=0
evaluation-provider calls=0
Core direct mutation=0
Engine direct mutation=0
LanceDB direct mutation=0
shadow sessions=1
```

A post-preflight execution attempt is non-reusable once the packet crosses its explicit execution-consumed boundary.

## 8. Preactivation contract

Before execution consumption:

1. Stage Card SHA and packet source binding pass.
2. repository HEAD equals packet commit and worktree is clean.
3. explicit Node24 runtime and OpenClaw 2026.7.1-2 entrypoint resolve.
4. Gateway is ready.
5. current normal config validates.
6. sourcePath/installPath and registry metadata satisfy Sections 3-4.
7. repo and installPath four Q6 runtime hashes match.
8. current product config satisfies Section 5.
9. exact session ID/key binding passes.
10. Engine DB exists and `BASE_EVENT_ID=max(memory_events.id)` is captured read-only.
11. exact pre-config bytes are copied into bounded evidence storage.
12. shadow is absent/off.

Any failure here is:

```text
STOPPED_PREACTIVATION
execution_count_consumed=0
```

### Authorization-time preactivation stop — 2026-09-19 20:36 +08:00

The first authorized packet invocation stopped during `max_event_id()` before `PREFLIGHT_PASS` and before the execution-consumed boundary because the embedded Node expression was missing one closing parenthesis:

```text
outcome=STOPPED_PREACTIVATION
execution_count_consumed=0
turns_sent=0
shadow activation=0
runtime/config mutation=0
```

This is a packet harness defect, not a Q6 runtime result. The existing one-shot Owner authorization remains unconsumed. The repair must execute the exact embedded `max_event_id()` snippet against a temporary SQLite fixture before the packet is rebound.

## 9. Activation sequence

After all preactivation gates pass:

1. mark the one execution consumed;
2. generate a candidate config that changes only:
   ```json
   {
     "autoRecall": {
       "shadow": {
         "enabled": true,
         "sessionAllowlist": ["<EXACT_SESSION_ID>"]
       }
     }
   }
   ```
3. prove removing the candidate `shadow` object yields the same normalized pre-config semantics;
4. stop Gateway;
5. copy the candidate config into the live config path;
6. run `openclaw config validate --json` **while Gateway is stopped**;
7. start Gateway;
8. wait for `Runtime: running` and `Connectivity probe: ok`;
9. re-prove repo/installPath Q6 hashes and registry publication parity;
10. prove the live shadow scope equals exactly the bound session;
11. emit `SHADOW_ACTIVE`.

This pre-start config validation is mandatory and directly guards against recurrence of the original Q6-D schema failure.

## 10. Natural-turn contract

At most six genuine user turns in the exact bound session.

Allowed:

- ordinary task-relevant questions;
- natural turns that retrieve no candidates;
- natural turns that gate/withhold all candidates;
- natural turns that produce `would_inject`.

Forbidden:

- benchmark prompts chosen to force known evidence;
- prompts naming Q6/debug/telemetry internals;
- prompts instructing memory-tool use;
- prompts targeting a known memory ID;
- synthetic traffic generated by the packet;
- a seventh turn to obtain a missing class.

After each operator-confirmed natural turn, the packet waits for exactly one new Q6 shadow decision envelope.

If zero or more than one new decision appears, stop and close out.

## 11. Evidence contract

Use:

```text
bin/q6-shadow-runtime-evidence.js
```

against only post-`BASE_EVENT_ID` `memory_events`, read-only.

Persistent Q6 envelope:

```text
memory_engine_q6_shadow_autorecall_decision_v1
```

Required mechanism invariants:

```text
mode=shadow
apply_suppressed=true
foreign_q6_shadow_decision_count=0
memory_injected_on_shadow_trace_count=0
memory_reinforced_on_shadow_trace_count=0
recall_completed injected_count=0
violations=[]
```

Allowed bounded observations:

```text
structural skip count
search-executed count
candidate-count distribution
candidate-after-gate distribution
would-inject-count distribution
would-inject turns
no-injection turns
withholding-reason counts
DIRECT_CARD boundary-error counts
retrieval/decision/total latency summaries
shadow-status counts
```

No prompt/query text, memory text, assistant answer, full canonical object, provider body, or arbitrary exception string is part of Q6-D2 evidence.

## 12. Early-stop rule

The operator may enter `:finish` before six turns.

Do not manufacture a missing outcome class.

At closeout, classify from the evidence actually observed.

## 13. Closeout

Closeout is mandatory after execution consumption, including any activation/observation failure.

1. stop Gateway best-effort;
2. restore the exact pre-config bytes;
3. validate the restored normal config;
4. start Gateway;
5. wait for ready;
6. prove exact restored config SHA;
7. prove Section 5 product invariants;
8. prove repo/installPath Q6 hashes;
9. prove persisted registry Q6 publication parity;
10. report closeout status.

No plugin reinstall is part of D2 closeout.

## 14. Result classification

### PASS

Requires:

```text
turns_sent > 0
shadow_decisions == turns_sent
search_executed > 0
violations = 0
foreign Q6 decisions = 0
injected/reinforced shadow-trace counts = 0
DIRECT_CARD boundary errors = 0
closeout = PASS
```

### PASS_WITH_FINDINGS

Mechanism/scope/apply suppression passes, but bounded DIRECT_CARD boundary-error diagnostics are observed.

### INSUFFICIENT_EVIDENCE

Examples:

- zero natural turns;
- no search-executed turn;
- the bounded natural sample is otherwise insufficient to characterize runtime shape.

This is not a failure.

### STOPPED

Use for mechanism/scope violations, ambiguous per-turn trace count, activation failure or closeout failure.

## 15. Interpretation boundary

A Q6-D2 PASS or PASS_WITH_FINDINGS proves only:

```text
real-host shadow mechanism executes
exact-session scope holds in the observed transaction
apply side effects are suppressed on observed shadow traces
bounded latency/runtime shape is observable
```

It does not prove:

```text
production false-positive rate
precision/recall
production prevalence
default-enable safety
superiority over current active policy
```

## 16. Authorization boundary

Current status:

```text
Q6-D2 =
OWNER AUTHORIZED
SOURCE PACKET QUALIFIED
ONE-SHOT RUNTIME EXECUTION AUTHORIZED
```

The authorization applies only to the exact session binding in Section 6 and only to the committed packet bound to this Stage Card. Once the packet logs `EXECUTION_COUNT_CONSUMED=1`, any retry or successor requires a new Owner authorization.

No authority is inherited from Q6-D or Q6-R1, and no authority flows forward to Q6-E or Q7.

## 17. Roadmap after D2

If a later separately authorized D2 transaction yields useful runtime evidence:

```text
Q6-E =
product decision based on Q6-C + Q6-D2 evidence
```

Q6-E still does not automatically select Statistical LTR or another learned policy.

Q7 remains separate and unauthorized.

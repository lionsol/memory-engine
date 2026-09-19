# Q6-D Exact-Session Real-Host Shadow Observation Stage Card — 2026-09-19

> **Status: FROZEN / OWNER EXECUTION AUTHORIZED / OPERATOR EXECUTION PENDING**
>
> Owner authorization received in the project session on 2026-09-19 for exactly one Q6-D exact-session real-host shadow observation transaction. This card narrows that authorization; it does not widen it.

## 1. Decision

Can the Q6 Shadow AutoRecall seam run through the real OpenClaw host on one exact `main` session, persist bounded content-free `would_inject` evidence and latency, and suppress every apply-side effect while leaving all non-shadow product behavior unchanged?

This stage measures runtime-shaped **observation prevalence/shape**, not ground-truth false-positive accuracy.

## 2. Fixed source authority

Repository:

```text
repo=/home/lionsol/.openclaw/workspace/plugins/memory-engine
Q6 source implementation=4f79a8c78fb68bb92294ea78a755293c8b62cbc4
Q6-A design=cea9da6b35cf1d1e09174b88c78416b8e957f719
Q6-B source seam=100c8377d888c710812e02931d12a6d90bbd269f
Q6-C offline qualification=9f56eab310d385794cee264cd51fcef73c44396a
MAX_EXECUTIONS=1
```

The Q6-D source implementation adds only the latency observability needed by this stage on top of the Q6-B seam.

Q6 runtime target files at the fixed source commit:

```text
lib/config/effective-hybrid-runtime-config.js
sha256=61ffb77fead2f4e83265af4d6c7eb28d247c8562ea6771f7fc03fa3df3b2bfb6

lib/recall/auto-recall-hook-lifecycle.js
sha256=9baa225f9a94752c94aec6fae92d9e663219a0565ecd0dec2aa35807b6815aa0

lib/recall/auto-recall-shadow.js
sha256=ee913beacc1b1ac103283846a82c0e19252240b9faa3e628e4acc21f3173ceef

openclaw.plugin.json
sha256=0ea09bfea5bb5d1f3532ed22c9e0ae9c1cfe64abd785f00a1458b8481b0b0a27
```

Latest repository-recorded pre-Q6 live source reference is `e40186d9387a33cf51a45cac9e982385b19cd212`. Its corresponding target-file baseline is:

```text
lib/config/effective-hybrid-runtime-config.js
sha256=57bd24a41ba6e514549e72c1f5fe745d30cda89c571316c790f23da2d1e2006e

lib/recall/auto-recall-hook-lifecycle.js
sha256=5f75439ea7acb0f0a03e3092f6f460b5ce46f6b70351b610e5beb551354b3a12

lib/recall/auto-recall-shadow.js
ABSENT

openclaw.plugin.json
sha256=346969a530ac8b6931bd4ec9d624016ca36ae394d47a79f9058bf037f602a735
```

The runtime operator must read the actual active runtime before mutation. If its source/target identity differs from the recorded pre-Q6 baseline, **STOP before candidate construction** and report drift; this authorization does not permit rebasing Q6-D onto an unknown live runtime.

## 3. Runtime posture that must remain invariant

Before Q6-D mutation, verify the currently recorded experimental posture:

```text
autoRecall.enabled=true
autoRecall.topK=3
autoRecall.cardFirstRuntime.enabled=true
autoRecall.agentAllowlist=["main"]
autoRecall.triggerAllowlist=["user"]
autoRecall.chatTypeAllowlist=["interactive_user_chat"]
autoRecall.messageRoleAllowlist=["user"]

explicitSearchRerankProvider.enabled=true
explicitSearchRerankControl.enabled=false

recallHintRuntimeCanary=absent/off
Gateway=READY
```

The exact pre-transaction memory-engine config bytes and semantic fingerprint must be captured before mutation.

Any drift in these product settings stops the transaction before mutation unless the drift is only host bookkeeping explicitly excluded from the semantic fingerprint.

## 4. Minimal transient candidate

Do **not** install the whole development checkout directly.

Construct exactly one immutable overlay candidate:

```text
candidate=$HOME/.openclaw/backups/memory-engine/releases/q6-shadow-autorecall-4f79a8c-20260919-r1
base=<exact preflight active plugin sourcePath>
```

Candidate construction:

1. candidate path must not already exist;
2. copy the exact preflight active runtime tree;
3. replace only the four Q6 target files listed in Section 2 from source commit `4f79a8c...`;
4. preserve package/lock/native dependencies from the active runtime;
5. verify the four target hashes exactly;
6. prove no other candidate file differs from the copied base.

No source edit, rebuild, package update or dependency install is authorized.

The candidate is **transient**. Q6-D does not authorize leaving it installed after closeout.

## 5. Exact-session binding

Q6-D uses exactly one explicit `agentId=main` session.

Preferred sequence:

1. while Q6 shadow is still disabled, create one dedicated explicit `main` session **without sending a model/user turn**;
2. verify its exact `sessionId` and `key` using `openclaw sessions --agent main --json`;
3. bind those values into the execution evidence before any shadow config mutation.

If the host cannot create or bind a dedicated session without first sending a user/model turn, the operator may bind exactly one existing dedicated non-default `main` session after proving its `sessionId` and `key`.

Do not use:

- `agent:main:main`;
- cron/background sessions;
- dispatcher/researcher/coding/codex sessions;
- more than one session.

The exact session ID/key is an execution-time binding and must be recorded before configuration mutation.

## 6. Preflight ordering

Before the first Gateway stop or config mutation, prove and record:

1. committed Stage Card path and SHA256;
2. exact repository HEAD and clean worktree;
3. source implementation commit `4f79a8c...`;
4. actual OpenClaw version and Node/runtime ABI;
5. active memory-engine plugin `loaded` status and exact `sourcePath`;
6. pre-Q6 active target-file hashes from Section 2;
7. Gateway `READY`;
8. exact pre-transaction config bytes + semantic fingerprint;
9. invariant experimental switches from Section 3;
10. exact session ID/key/agent binding;
11. fresh `BASE_EVENT_ID=max(memory_events.id)` using readonly Engine access;
12. candidate path absent.

Any ambiguity or mismatch stops with `STOPPED_PREACTIVATION` and consumes zero execution count.

## 7. Authorized runtime sequence

After preflight passes, consume exactly one execution:

1. construct the immutable four-file overlay candidate;
2. stop Gateway once;
3. install the candidate once with the existing qualified OpenClaw/Node24 runtime;
4. start Gateway and verify `READY`, candidate `sourcePath`, candidate hashes and unchanged config;
5. mutate only:
   ```json
   autoRecall.shadow = {
     "enabled": true,
     "sessionAllowlist": ["<EXACT_SESSION_ID>"]
   }
   ```
6. do not change any sibling AutoRecall field, `topK`, rerank switch, Recall Hint config or retrieval policy;
7. reload/restart Gateway only as required for the config to become effective;
8. verify effective config is valid and shadow scope contains exactly the bound session;
9. run at most **6 genuine natural task-relevant user turns** in that exact session;
10. collect only bounded post-baseline event evidence;
11. stop early only when evidence is sufficient to answer mechanism/scope/latency shape; do not manufacture a missing outcome class;
12. restore exact pre-transaction config bytes;
13. stop Gateway once;
14. reinstall the exact preflight runtime source once;
15. start Gateway and prove full closeout identity/health.

No second candidate install, second candidate construction, alternative session, or retry transaction is authorized.

## 8. Natural-turn contract

At most six turns.

Allowed:

- ordinary genuine questions/tasks a user would naturally ask;
- turns that happen to retrieve no candidates, gate-reject candidates, or produce `would_inject`.

Forbidden:

- replaying historical H6/Q4/Q5 benchmark prompts;
- synthetic prompts designed to force a known memory ID;
- mentioning Q6/debug/telemetry internals in the user question;
- instructing the model to call memory tools;
- adding a seventh turn to obtain a missing class.

A result with only `would_inject` or only `no_injection` outcomes is still valid observation evidence; report the limited shape rather than forcing balance.

## 9. Allowed telemetry

Q6-D authorizes persistence/readback only of existing bounded runtime events needed for this exact transaction.

For `memory_engine_q6_shadow_autorecall_decision_v1`, allowed fields are:

```text
schema
debug_type
mode
shadow_status
apply_suppressed
runtime_gate_allowed
runtime_gate_reason
structural_skip_reason
search_executed
focused_query_used
original_input_chars
focused_query_chars
candidate_count
candidate_count_after_gate
direct_card_selected_count
would_inject_count
would_inject_ids
candidate_decisions[].rank
candidate_decisions[].memory_id
candidate_decisions[].category
candidate_decisions[].final_score
candidate_decisions[].gate_pass
candidate_decisions[].gate_reason
candidate_decisions[].capability
candidate_decisions[].capability_reason
candidate_decisions[].selection_decision
candidate_decisions[].selection_reason
candidate_decisions[].would_inject
timings.retrieval_ms
timings.decision_ms
timings.total_ms
```

Also allowed for trace correlation:

- event id/type;
- session_id;
- trace_id;
- bounded memory_id;
- candidate_count/injected_count;
- existing bounded `recall_started`, `recall_completed`, candidate and gate metadata.

Do not export to repository evidence:

- prompt/query/focused-query text;
- memory/card body, title or summary;
- source path/source hint;
- full canonical object;
- session transcript;
- assistant answer body;
- provider response body;
- arbitrary exception message.

Repository report may contain counts, distributions, bounded reason codes and timing summaries only.

## 10. Q6-D mechanism acceptance

For every bound-session post-baseline Q6 shadow trace:

1. `mode=shadow`;
2. `apply_suppressed=true`;
3. `would_inject_count == count(candidate_decisions where would_inject=true)`;
4. `direct_card_selected_count == would_inject_count` for current card-first v1;
5. all timings are finite non-negative integers;
6. candidate decision count <= 32;
7. all projected memory IDs are <= 16 chars;
8. no forbidden text/content/path keys occur in the Q6 envelope;
9. matching `recall_completed.injected_count=0`;
10. no matching `memory_injected` event;
11. no AutoRecall-derived `memory_reinforced` authority may arise from the shadow turn.

A structural skip may have `search_executed=false`, zero candidates and zero timings.

## 11. Exact-session isolation

The shadow feature is in scope for exactly the bound session.

Required:

- every post-baseline `q6_shadow_decision` belongs to the bound session;
- no other session emits `q6_shadow_decision`;
- non-shadow sessions may continue their pre-existing active AutoRecall behavior because Q6-D does **not** disable global experimental AutoRecall;
- foreign ordinary `recall_started` / `memory_injected` events are not scope leakage unless they carry the Q6 shadow decision marker.

This distinction is mandatory because the experimental instance already has AutoRecall active before Q6-D.

## 12. Observation report

Report only observed sample shape, not a population estimate.

Minimum summary:

```text
turns_sent
shadow_decisions
structural_skips
search_executed
candidate_count distribution
candidate_count_after_gate distribution
would_inject_count distribution
would_inject turns
no_injection turns
DIRECT_CARD withholding reason counts
retrieval_ms min/median/p95/max
decision_ms min/median/p95/max
total_ms min/median/p95/max
shadow errors/timeouts
foreign q6_shadow_decision count
memory_injected on shadow traces
memory_reinforced from shadow authority
```

With <=6 natural turns, these are descriptive observations only.

Without independent labels, do **not** report:

- false-positive rate;
- precision/recall;
- answer quality;
- production prevalence probability.

## 13. Stop conditions

Immediately close and restore on:

- active runtime/source/hash/config preflight drift;
- inability to bind one exact session;
- candidate differs outside the four target files;
- Gateway/plugin not healthy after candidate install or config activation;
- invalid effective config;
- shadow scope contains anything other than the exact session;
- any shadow trace returns/prepends context;
- any shadow trace emits `memory_injected`;
- shadow creates reinforcement authority;
- Q6 envelope contains forbidden content/path/query fields;
- another session emits `q6_shadow_decision`;
- need for source/product/config changes outside the frozen delta;
- proposal for a seventh turn;
- any need for automatic retry/resume.

Use one outcome:

```text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
```

## 14. Mandatory closeout

Closeout runs on success, failure, interrupt or insufficient evidence.

It must:

1. restore exact pre-transaction config bytes;
2. validate config;
3. restore the exact preflight runtime source, not the Q6 candidate;
4. verify pre-Q6 target hashes;
5. verify candidate-only `auto-recall-shadow.js` is absent again if absent in the preflight runtime;
6. verify Gateway `READY`;
7. verify the pre-existing experimental switches are restored exactly;
8. verify repository remains at the authorized committed state and clean;
9. stop further Q6-D runtime testing.

Valid bounded telemetry rows created during the transaction are retained as observation evidence; closeout does not delete them.

## 15. Authorization boundary

This Owner authorization permits exactly the single transaction described above:

```text
MAX_EXECUTIONS=1
exact agent=main
exact sessions=1
natural turns<=6
candidate installs=1
rollback runtime reinstall=1
temporary shadow config mutation=1
exact config restoration=1
new provider families=0
new evaluation provider calls=0
Core/Engine/LanceDB direct mutation=0
source edits during transaction=0
push/tag=0
```

Existing provider/network activity naturally implied by the already-active AutoRecall retrieval path is not expanded by Q6-D. Q6-D does not authorize Recall Hint, an LLM judge, a new reranker call or a second retrieval for comparison.

Q6-D authorizes no persistent shadow activation and no post-stage candidate deployment.

# AutoRecall Provenance Natural Canary Stage Card — 2026-08-09
> **Status: FROZEN — execution requires separate post-commit Sol authorization**

## Decision
Can one tightly scoped natural-use AutoRecall canary prove that the newly deployed bounded candidate provenance is persisted on real runtime traffic, without replaying historical H6 prompts or changing retrieval behavior?

## Current authority
- repository source contains the provenance implementation committed at `1cd183ff12d055ba5c5ecd4bd0d9d1b98cdff23b`;
- active runtime is loaded from `/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2`;
- active runtime target-file hashes match the provenance source hashes;
- AutoRecall is currently disabled;
- OpenClaw's actual EDi runtime identity is `agentId=main`, not `edi`.

## Product question
This stage asks only whether real natural AutoRecall execution under one exact session persists the new provenance fields with the expected privacy/bounds contract and does not escape the intended runtime scope.
It does not attempt to prove retrieval quality, sufficient injection rate, or a retrieval-policy repair.

## Scope
Only three things are in scope:
1. create and bind one new explicit `main` session while AutoRecall is still disabled;
2. temporarily enable AutoRecall only for that exact agent/session with `topK=1` and run a bounded number of natural turns;
3. restore the exact pre-canary config and classify the resulting provenance evidence.

## Dedicated session binding
Before enabling AutoRecall:
- create one new explicit session for `agentId=main`;
- the bootstrap/control turn occurs while AutoRecall is disabled and is excluded from canary evidence;
- record the exact stored session ID and session key from `openclaw sessions --agent main --json`;
- bind that exact session ID in the execution packet and `autoRecall.sessionAllowlist`.

Do not reuse `agent:main:main`, cron sessions, H5/H6 sessions, or any existing project session.
## Temporary AutoRecall config
The canary configuration is limited to:

```json
{
  "enabled": true,
  "topK": 1,
  "timeoutMs": 8000,
  "agentAllowlist": ["main"],
  "sessionAllowlist": ["<EXACT_NEW_SESSION_ID>"],
  "triggerAllowlist": ["user"],
  "chatTypeAllowlist": ["interactive_user_chat"],
  "messageRoleAllowlist": ["user"],
  "cardFirstRuntime": { "enabled": false }
}
```

The exact pre-canary `memory-engine` config must be backed up and restored byte/semantic-equivalently at stage close.

## Frozen retrieval behavior
Do not change:
- query shaping or focused-query logic;
- FTS/vector/recent/KG collection behavior;
- fusion/ranking or category weights;
- confidence thresholds or gate coverage thresholds;
- `topK` anywhere except the temporary AutoRecall canary value `1`;
- Card/gate eligibility logic or 240-character result projection;
- capture/index/checkpoint/backfill behavior;
- provenance field definitions or limits.

## Natural-turn contract
After the scoped config is active:
- use only the dedicated session;
- Sol provides genuine task-relevant questions in normal language;
- do not copy/replay historical H6 prompts;
- do not ask synthetic diagnostic questions merely to force a known candidate;
- do not explicitly instruct EDi to call memory tools or mention provenance/debug internals;
- the bootstrap/control turn is never counted.

Run at most **6 natural user turns**.
Stop early once at least one non-skipped AutoRecall retrieval execution has persisted valid provenance and there is enough evidence to verify the stage question.

## Evidence contract
For in-scope turns inspect only bounded runtime evidence needed to establish:
- session/trace identity;
- AutoRecall started/completed/skip status;
- candidate/injection counts;
- `channel_candidate_provenance`;
- `fusion_candidate_provenance`;
- gate decision/rejection structure already allowed by the privacy projector;
- runtime origin/surface needed to distinguish AutoRecall from manual memory-tool traffic.

Do not export prompt bodies, memory bodies, private session transcripts, or unrestricted raw metadata into repository evidence.
## Provenance acceptance
At least one non-skipped AutoRecall execution must show persistent metadata containing:
- per-channel `count`, `captured_count`, `truncated`, and bounded short IDs;
- no more than 32 IDs per channel;
- fusion `pre_rerank_ids` and `post_rerank_ids` bounded to eight;
- no text/body/preview/path/prompt/query/exact-fragment leakage in the new provenance fields.

If all six natural turns are skipped before retrieval execution, classify `INSUFFICIENT_EVIDENCE`; do not manufacture a seventh or synthetic turn.

## Scope isolation
During the canary, evidence must show:
- only `agentId=main` plus the exact dedicated session can pass the runtime gate and reach `recall_started`/hybrid retrieval;
- other sessions may emit expected gate-denied skip telemetry while the global hook is enabled, but must not execute retrieval;
- task-planner, dispatcher, researcher, coding, and codex are not added to the allowlist;
- no broad AutoRecall rollout occurs.

## Allowed runtime mutations
During separately authorized execution only:
- create one dedicated session/bootstrap turn while AutoRecall is disabled;
- back up the exact current memory-engine config;
- apply the temporary AutoRecall config above and restart Gateway as required;
- run up to six natural turns in the dedicated session;
- permit in-scope AutoRecall telemetry plus expected gate-denied skip events from non-allowlisted traffic, and any existing safety-gated reinforcement naturally caused by the dedicated session;
- restore the exact pre-canary config and restart/verify Gateway.

No direct Core/Engine/LanceDB mutation, index rebuild, backfill, manual confidence edit, or memory cleanup is authorized.
## Closeout
Whether the evidence is PASS, insufficient, or stopped:
1. restore the exact pre-canary memory-engine config;
2. verify AutoRecall is disabled again;
3. verify plugin remains loaded from the R2 provenance candidate;
4. verify Gateway healthy;
5. stop further natural testing under this authorization.

## Pass criteria
1. Exact agent/session scoping is active and does not leak beyond the dedicated canary session.
2. At least one real non-skipped natural AutoRecall execution persists valid bounded/privacy-safe channel and fusion provenance.
3. The exact pre-canary config is restored with AutoRecall disabled and runtime identity still on the R2 candidate.

## Stop conditions
Stop and restore config if:
- session ID cannot be bound unambiguously before enablement;
- another agent/session reaches retrieval rather than a gate-denied skip;
- config or runtime identity differs from the frozen preflight;
- provenance leaks content/path/query fields or violates 32/8 bounds;
- Gateway/plugin health degrades;
- execution requires changing retrieval/gate/index/product logic;
- a seventh natural turn, synthetic probe, or historical H6 replay is proposed.

## Outcome
Use exactly one:

```text
PASS
PASS_WITH_FINDINGS
INSUFFICIENT_EVIDENCE
STOPPED
```

A PASS does not authorize retrieval tuning or AutoRecall rollout. If a later natural failure contains an independently established answer-bearing memory and valid provenance, first-loss attribution becomes a separate product-level decision.
## Authorization boundary
Execution must bind the exact committed Stage Card, exact repository HEAD, Stage Card SHA256, active R2 runtime identity, exact new session ID/key, exact pre-canary config identity, and `MAX_EXECUTIONS=1`.

This Stage Card authorizes nothing by itself. After execution, report the result and stop; do not start retrieval tuning, another canary, or broad AutoRecall rollout under the same authorization.

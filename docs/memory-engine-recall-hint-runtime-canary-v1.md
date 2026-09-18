# memory-engine Recall Hint runtime canary — RH-L2

Status: `RH-L2-A CONTROL SOURCE QUALIFIED / RH-L2-B PROVIDER SOURCE QUALIFIED / DEFAULT-OFF WIRED / ZERO-EGRESS UNTIL CANARY ACTIVATION / EXACT-SESSION FAIL-CLOSED / LIVE RUNTIME CANARY NOT AUTHORIZED`

## 1. Purpose

RH-L1 established two separate facts:

- real-provider sequential-vs-parallel execution materially reduced vector/full-semantic latency with zero provider errors and embedding concurrency reaching 3;
- RH-L1-E1 and RH-L1-E2 proved exact ordered candidate/top3 equivalence when numerical retrieval inputs are held fixed, including one shared real local LanceDB table.

Those findings do not by themselves authorize a live Recall Hint rollout. RH-L2-A first established the default-off exact-session control plane. RH-L2-B now adds a production-grade provider adapter and wires it only through that control plane; because the default canary is disabled and the provider policy returns `null` unless an enabled canary has a non-empty exact-session allowlist, the source remains zero-egress until a separately authorized runtime activation.

## 2. RH-L2-A boundary

RH-L2-A is a **control/observation seam only**. It does not create a Recall Hint producer, perform provider egress, change AutoRecall, deploy or reload the plugin, or activate parallel execution in any live session.

The plugin schema adds:

```json
{
  "recallHintRuntimeCanary": {
    "enabled": false,
    "sessionIds": [],
    "vectorExecutionMode": "sequential"
  }
}
```

The schema is closed to unknown fields. Effective config accepts the value only from the plugin/plugin-entry control layers, not from lower-priority broad host compatibility sources. Invalid values fail closed to the default-off configuration and make effective config invalid.

## 3. Exact-session scope

A canary request is eligible only when all of the following are true:

1. surface is the dedicated `memory_engine_search` path;
2. `recallHintRuntimeCanary.enabled === true`;
3. the configured exact `sessionIds` allowlist is non-empty;
4. the current tool call can be resolved through the existing `before_tool_call` registry to a trusted OpenClaw runtime session;
5. that exact trusted session identity is allowlisted.

Missing context, an empty allowlist, an untrusted context source, a non-matching session, or an invalid execution mode all deny provider authority. Query text, tool params and model-supplied values do not participate in the scope decision.

The lifecycle resolver is read-only: it peeks the existing tool-call scope and returns only bounded runtime identity fields. It does not consume the scope or expose the session identity through search results/observation metadata.

## 4. Execution-mode authority

Inside an eligible canary only, the control plane may select:

- `sequential`; or
- `parallel`.

The selected mode affects only a valid `recall_hint_v1` vector query plan. Historical H2/bounded multi-query behavior remains sequential.

Outside an eligible canary, Recall Hint provider authority is denied and the search proceeds through the original-query path. This means a future provider adapter cannot become globally active merely because it is present in production assembly.

For backwards-compatible source tests/benchmarks that inject a provider directly without a runtime-canary config, the historical injected-provider behavior is retained. Production assembly always supplies the explicit default-off canary config.

## 5. RH-L2-B provider source contract and zero-egress guarantee

RH-L2-B introduces a production provider adapter without importing benchmark execution machinery into the runtime path. The shared runtime-safe Recall Hint provider contract owns the exact prompt/schema identity, and the Q4 benchmark contract imports that shared identity so production and benchmark cannot silently drift.

Frozen production provider identity:

- provider: `SiliconFlow`;
- model: `deepseek-ai/DeepSeek-V4-Flash`;
- endpoint: `https://api.siliconflow.cn/v1/chat/completions`;
- revision: `null`;
- prompt version: `q4_recall_hint_producer_prompt_v1`;
- prompt SHA-256: `377cde9a388a2ba0115a20eb4132c6edb207b98ccfd4f5116f8ce64cb59aec95`;
- output-schema SHA-256: `237bf7f7b7601715f9030b134f725ff8cde4cf1d9392ec993d9b078f1661d5a2`.

Frozen runtime bounds:

- query <= `240` code points;
- prompt <= `8192` UTF-8 bytes;
- provider response <= `16384` bytes;
- provider-reported input <= `2048` tokens;
- output <= `256` tokens;
- adapter deadline = `2500ms`;
- automatic retry = `none`.

The adapter sends one OpenAI-compatible JSON request with `temperature=0`, `enable_thinking=false`, `response_format=json_object`, `stream=false`, then validates strict Recall Hint v1 output. It exposes only normalized Hint plus bounded input/output token counts and latency. Credential material is never included in adapter identity, debug or observation.

Production assembly now wires `recallHintProvider` through `createRecallHintRuntimeProviderPolicyV1`. That policy returns `null` unless all of the following hold before adapter construction: effective runtime config is valid, `recallHintRuntimeCanary.enabled === true`, and the exact-session allowlist is non-empty. Therefore the default configuration still creates no Recall Hint provider and performs no Recall Hint model egress. If a future canary is enabled without a credential, adapter construction fails closed with a credential error rather than falling through to an uncredentialed or alternate provider.

## 6. Bounded observation

Hybrid debug/observation can report only bounded Recall Hint control/provider facts:

- hint mode/status;
- whether the canary was in scope;
- a fixed canary decision reason;
- sequential/parallel execution mode;
- expansion count, bounded to 0..2;
- provider latency, bounded to 0..60000ms;
- provider input/output token counts, bounded numerically.

Observation does not persist:

- session IDs;
- tool-call IDs through Recall Hint metadata;
- query text;
- Hint field contents;
- candidate IDs;
- provider prompt/response content.

Traffic-origin telemetry remains governed by its existing separate bounded contract.

## 7. Verification

RH-L2-A/B focused verification covers:

- default-off and invalid-config behavior;
- exact-session allowlist acceptance/rejection;
- missing/untrusted runtime context fail-closed;
- provider not called outside scope;
- provider permitted only for the exact trusted session in injected tests;
- parallel mode selected only inside scope;
- lifecycle `before_tool_call` session binding;
- production policy is `null` while disabled/empty-scope and does not require a credential;
- enabled canary with missing credential fails closed;
- exact provider/model/endpoint plus Q4 prompt/schema hash identity reuse;
- single-request fake transport with no automatic retry;
- query/prompt/response/token bounds;
- 2.5s deadline and cancellation even if an injected transport ignores `AbortSignal`;
- bounded provider usage/latency observation without prompt/response/session/query content;
- Q4/RH-L1/Hybrid regression.

The enlarged regression set passes `169/169`; static check covers `817` files; test-integrity scans `368` files with `0` invalid; strict OpenSpec is `12/12` PASS; `git diff --check` passes. CodeGraph keeps the blast radius concentrated around Recall Hint/search/provider/observation paths. code-review-graph reports no affected stored execution flow; its helper-level test-gap hints include functions that are exercised through the positive/negative integration suite but are not associated by the graph parser.

## 8. Next boundary: RH-L2-C live exact-session canary

RH-L2-B is source-qualified, but **no live canary is authorized by that fact**. The next boundary is RH-L2-C and must be separately authorized against an exact clean source commit and an exact runtime/config packet.

The RH-L2-C authorization packet must precommit at minimum:

- one exact trusted OpenClaw session ID allowlist entry;
- `recallHintRuntimeCanary.enabled=true` only for that scope;
- explicit `vectorExecutionMode` (`sequential` or `parallel`);
- the frozen SiliconFlow/DeepSeek-V4-Flash provider identity above;
- no provider/model/endpoint/prompt/schema/topK/candidate-depth/reranker changes;
- no automatic retry;
- bounded observation fields only;
- a rollback operation that restores `enabled=false` and removes the canary session;
- no AutoRecall integration, no default explicit-search activation, no live DB/LanceDB mutation, no push/tag.

Source qualification does not authorize config mutation, plugin reload, deployment or provider egress. Those remain RH-L2-C runtime actions.

# memory-engine Recall Hint runtime canary — RH-L2

Status: `RH-L2-A CONTROL SOURCE QUALIFIED / RH-L2-B PROVIDER SOURCE QUALIFIED / RH-L2-C FIRST LIVE STOPPED AT TRUSTED CONTEXT GATE / RH-L2-C1 REAL-HOST VERIFIED / RH-L2-C RETRY STOPPED ON EMPTY HINT / RH-L2-C2 PREPARED / LIVE C2 NOT AUTHORIZED / RUNTIME FEATURE OFF`

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
4. the dedicated `memory_engine_search` tool factory receives a trusted OpenClaw `sessionId`/`sessionKey`, or the existing `before_tool_call` registry resolves the current `toolCallId` to a trusted OpenClaw runtime session;
5. that exact trusted session identity is allowlisted.

Missing context, an empty allowlist, an untrusted context source, a non-matching session, or an invalid execution mode all deny provider authority. Query text, tool params and model-supplied values do not participate in the scope decision.

RH-L2-C1 treats the OpenClaw plugin-tool factory context as the primary trusted session source for the dedicated `memory_engine_search` surface. OpenClaw 2026.7.1-2 defines that factory context as trusted and supplies `sessionId`/`sessionKey`; memory-engine closes over only the minimal session identity and passes it directly to the search executor. The existing lifecycle `before_tool_call` resolver remains a read-only fallback. If a factory context is present, it takes precedence over the fallback so a mismatched trusted factory session cannot be overridden by a different registry result. Query text, tool params, sender-like fields and model output are never accepted as identity.

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

## 8. RH-L2-C first live exact-session canary

Owner authorized one RH-L2-C live canary against source `4db3e20eaaf7e661ff604e540733a9fad689751f`. The live extension was deployed to that exact source, Gateway remained healthy, and the canary was limited to exact session `f8e20200-4593-4ce3-9435-868facfd9edb` with `vectorExecutionMode=parallel`.

The transaction executed exactly one `memory_engine_search` call with toolCallId `call_at8fxzaj1dhw5g83s7tns49n`. Engine observation `memory_events.id=590` recorded:

- `recall_hint.status=canary_blocked`;
- `canary_in_scope=false`;
- `canary_reason=trusted_runtime_context_missing`;
- `vector_execution_mode=parallel`;
- `expansion_count=0`;
- provider latency/token fields absent.

Therefore the canary is **STOPPED AT TRUSTED CONTEXT GATE**. Recall Hint provider execution and parallel vector execution were not reached, so the agent's ordinary `memory_engine_search` success does not qualify the canary. Recall Hint provider egress for this transaction was zero.

Deployment and rollback both passed. After evidence capture, `recallHintRuntimeCanary` was removed, config validated, Gateway was healthy, and the installed `4db3e20...` source remained live with the feature off.

The same observation also recorded `traffic_origin=unknown / missing_trusted_context`, showing that the prior control design's shared `before_tool_call` registry did not provide trusted context on this real CLI explicit-session plugin-tool path.

## 9. RH-L2-C1 trusted factory-context binding fix

RH-L2-C1 closes the live blocker without weakening exact-session policy or changing OpenClaw host code.

OpenClaw 2026.7.1-2 declares `OpenClawPluginToolContext` as trusted execution context and supplies `sessionId` / `sessionKey` to plugin-owned tool factories. Before C1, memory-engine registered `memory_engine_search` as a static tool, so this trusted per-session context was discarded and the canary depended solely on the hook registry.

C1 changes only the dedicated `memory_engine_search` registration to a tool factory. The factory:

- prefers exact `sessionId`, then exact `sessionKey`;
- projects only `source=openclaw_runtime` plus the bounded session identity;
- does not propagate sender, delivery, query, prompt or arbitrary factory fields;
- binds the current toolCallId only inside the executor;
- gives this factory context precedence over the lifecycle fallback;
- leaves legacy `memory_engine` action-search outside RH-L2 authority.

OpenClaw's descriptor cache is safe for this design: it caches descriptors, while cached-tool execution resolves the plugin factory again with the current tool context. Session-bound tool objects are therefore not reused across different sessions.

Positive/negative integration tests prove:

- exact trusted factory session allows the Recall Hint canary even when the `before_tool_call` resolver is absent;
- a mismatched factory session is denied even if the fallback resolver claims an allowlisted session;
- `sessionKey` is a fallback only when `sessionId` is absent;
- a contextless factory supplies no trusted runtime identity;
- tool surface and legacy search behavior remain unchanged.

The enlarged C1 regression passes `203/203`; static check covers `817` files; test-integrity scans `368` files with `0` invalid; strict OpenSpec is `12/12` PASS; `git diff --check` passes. CodeGraph identifies only the tool wrapper and Recall Hint tests as directly affected. code-review-graph reports `0` affected stored flows and risk `0.35`; its helper-level gaps are exercised through the integration tests above.

## 10. RH-L2-C retry result

Owner authorized one new exact-session retry after deploying source `07ad18d802e0179e66431c26bcc3f10fc9237ed3`. The retry used a fresh session and executed exactly one `memory_engine_search` call.

Engine observation `memory_events.id=602` proved that RH-L2-C1 fixed the prior live blocker:

- `recall_hint.mode=recall_hint_v1`;
- `canary_in_scope=true`;
- `canary_reason=session_allowlisted`;
- `vector_execution_mode=parallel`;
- provider latency `1400.05ms`;
- provider input `335` tokens;
- provider output `10` tokens.

The real provider therefore executed successfully inside the exact-session canary. However, the returned Hint was a valid empty Hint:

- `recall_hint.status=empty_hint`;
- `expansion_count=0`;
- no multi-query vector execution field was emitted.

The retry is therefore **STOPPED / PARALLEL NOT EXERCISED**, not PASS. It verifies the trusted factory-context fix and the production provider path, but it does not qualify live parallel vector execution.

The transaction executed exactly one search and one observation, had no automatic retry, rolled back `recallHintRuntimeCanary` to absent, and left Gateway healthy. The installed live source remains `07ad18d...` with Recall Hint feature off.

The retry observation still reports `traffic_origin=unknown / missing_trusted_context`. This is now a separate observability defect in the legacy traffic-origin hook path. It does not gate Recall Hint canary authority because RH-L2-C1 uses the trusted plugin-tool factory context directly.

## 11. Q4 bounded-context mismatch and RH-L2-C2 probe

Q4 producer qualification allowed the frozen query plus bounded caller context such as `active_project` and `recent_entities`. The production Recall Hint adapter currently calls the same frozen prompt/schema with `bounded_context={}`. Therefore the live empty Hint is not evidence that the Q4 producer contract regressed; the live runtime supplied less caller context than Q4 development/holdout execution.

RH-L2-C2 is consequently defined as an **execution-only synthetic probe**, not a quality reproduction and not a new Q4 claim. It does not change the prompt, provider, model, schema, topK, candidate depth, reranker or runtime context seam.

The probe is derived from frozen Q4 development case `q4c1-multi-03 / CedarIndex`:

```text
CedarIndex — 那个方案的选择理由和已知限制分别是什么？
```

This differs from the original Q4 case only by moving the frozen project anchor into the explicit query because production bounded context is empty. The probe is 33 code points, below the 240-code-point runtime bound.

The frozen Q4 producer output for this case was:

- project: `CedarIndex`;
- entity: `CedarIndex`;
- facets: `方案选择理由`, `已知限制`.

Under that already-frozen Hint, the current query-plan builder produces exactly two expansions, yielding the intended original + 2 expansion execution shape for the parallel vector path. C2 does **not** require the live provider to reproduce those exact fields; it requires only a valid non-empty Hint that creates one or two expansions.

## 12. Next boundary: RH-L2-C2 final parallel exercise

RH-L2-C2 is **not authorized** by this preparation work.

A live C2 transaction requires a new explicit Owner authorization bound to the clean source commit and a new exact session. It must:

- execute the frozen CedarIndex probe exactly once;
- keep `vectorExecutionMode=parallel`;
- preserve SiliconFlow / DeepSeek-V4-Flash / endpoint / prompt / schema identities;
- perform no automatic retry or replay;
- qualify only if `canary_in_scope=true`, `session_allowlisted`, provider telemetry is present, `expansion_count>=1`, and the live vector debug proves `vector_query_execution=parallel`;
- stop without retry on empty/no-expansion Hint, provider failure, canary block, or missing parallel evidence;
- remove the canary config immediately after evidence capture.

AutoRecall integration, default explicit-search activation, live DB/LanceDB mutation, push and tag remain outside RH-L2.

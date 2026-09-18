# memory-engine Recall Hint runtime canary — RH-L2

Status: `RH-L2-A CONTROL SOURCE QUALIFIED / ZERO-EGRESS / DEFAULT OFF / EXACT-SESSION FAIL-CLOSED / PROVIDER ADAPTER NOT WIRED / RUNTIME ACTIVATION NOT AUTHORIZED`

## 1. Purpose

RH-L1 established two separate facts:

- real-provider sequential-vs-parallel execution materially reduced vector/full-semantic latency with zero provider errors and embedding concurrency reaching 3;
- RH-L1-E1 and RH-L1-E2 proved exact ordered candidate/top3 equivalence when numerical retrieval inputs are held fixed, including one shared real local LanceDB table.

Those findings do not by themselves authorize a live Recall Hint rollout. Production assembly still has no Recall Hint provider adapter. RH-L2 introduces the minimum control plane required before any provider can be wired or any live canary can run.

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

## 5. Zero-egress source guarantee

RH-L2-A production assembly wires only:

- `recallHintRuntimeCanary`;
- the trusted `resolveExplicitSearchRuntimeContext` resolver.

It deliberately does **not** wire `recallHintProvider`. A source guard test asserts that `index.js` contains the control/resolver wiring and no `recallHintProvider:` binding.

Therefore RH-L2-A cannot introduce new Recall Hint model egress even if its source is installed. RH-L2-B must be separately implemented and qualified before any Recall Hint provider can exist in production assembly.

## 6. Bounded observation

Hybrid debug/observation can report only bounded Recall Hint control facts:

- hint mode/status;
- whether the canary was in scope;
- a fixed canary decision reason;
- sequential/parallel execution mode;
- expansion count, bounded to 0..2.

Observation does not persist:

- session IDs;
- tool-call IDs through Recall Hint metadata;
- query text;
- Hint field contents;
- candidate IDs;
- provider prompt/response content.

Traffic-origin telemetry remains governed by its existing separate bounded contract.

## 7. Verification

RH-L2-A focused verification covers:

- default-off and invalid-config behavior;
- exact-session allowlist acceptance/rejection;
- missing/untrusted runtime context fail-closed;
- provider not called outside scope;
- provider permitted only for the exact trusted session in injected tests;
- parallel mode selected only inside scope;
- lifecycle `before_tool_call` session binding;
- bounded observation privacy;
- production source guard proving no provider adapter is wired;
- Q4/RH-L1/Hybrid regression.

CodeGraph identifies the change as concentrated around Recall Hint/search lifecycle and observation paths. code-review-graph reports no affected stored execution flow; helper-level test-gap hints remain because internal closure/helper relationships are not fully associated, while the corresponding positive/negative behavior is exercised directly.

## 8. Next boundary: RH-L2-B

RH-L2-B is **not authorized by RH-L2-A**.

A future RH-L2-B source stage must provide a production-grade Recall Hint provider adapter without importing benchmark-only execution machinery into the runtime path. It must freeze:

- provider/model/endpoint identity;
- the already-qualified Recall Hint v1 prompt/schema identity;
- bounded request/response sizes;
- credential source and redaction;
- a runtime deadline/cancellation contract;
- per-call usage/latency observation that exposes no prompt/response content;
- zero automatic retry;
- canary-only authority through RH-L2-A.

After RH-L2-B source qualification, live activation still requires a separate exact runtime/config/deployment authorization. AutoRecall integration, default explicit-search activation, live DB/LanceDB mutation, push and tag remain outside RH-L2.

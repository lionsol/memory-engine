# Explicit Memory Get Owner Authority Contract v1

Status: `accepted_design` for a future source stage; source implementation and deployment are not authorized by this document.

Date: 2026-08-25

Repository facts:

- memory-engine design baseline: `586c0e662e784c5a489ddcc2ab42d92652dcb159`
- OpenClaw H2 source baseline: `755ff5d396102c5a93baacf2d3bf6187a4fea713`
- OpenClaw version: `2026.6.9`

This record freezes the explicit retrieval authority for `memory_engine_get`. It does not implement the contract, reopen DIRECT_CARD qualification, or start OpenSpec 4.4.

## Decision summary

### current_fact

- `memory_engine_search` and `memory_engine_get` are currently model-callable separate tools exposed by the main-agent tool allowlist.
- The current `memory_engine_get` path can return full memory content and source-location information without the D.3 `OWNER_EXPLICIT_ATTESTATION` authority boundary.
- OpenClaw H2 already carries a trusted `senderIsOwner` fact through the embedded agent run and into prompt-hook execution, but the plugin tool context does not currently expose that fact.
- DIRECT_CARD / OpenSpec 4.3 is closed. AutoRecall remains disabled, card-first remains disabled, and no active disclosure attestations are required by the current production baseline.

### accepted_design

1. `memory_engine_search` remains an `ACCEPTED_SEPARATE_CAPABILITY`. Its next source stage should reduce returned text to a bounded untrusted snippet plus retrieval metadata. Search scores, categories, source metadata, or snippets are not disclosure authority.
2. `memory_engine_get` becomes `OWNER_ONLY_EXPLICIT_FULL_CONTENT_RETRIEVAL` in a separate future source stage.
3. Positive get authority is the host-owned, same-run fact `context.senderIsOwner === true`, checked by exact boolean identity.
4. `memory_engine_get` does not consume `OWNER_EXPLICIT_ATTESTATION`; that authority remains specific to `DISCLOSURE_CARD` / DIRECT_CARD.
5. The smallest host contract is **H3-C realized with H3-B binding**: add an optional `senderIsOwner?: boolean` to the existing plugin factory context, populate it only from the trusted embedded-run fact, and bind an immutable snapshot to a plugin tool instance created for that run.
6. Direct Gateway/HTTP `tools.invoke` is not an Owner-audience proof for this contract. Unless a later host contract explicitly authenticates a current user-turn Owner audience, the plugin context for `memory_engine_get` is absent/non-authoritative on that path.

### historical_record

The preceding explicit-tool review classified the surfaces as mixed: search could remain a separate untrusted retrieval capability, while get had an authority-architecture gap. This document freezes the follow-up direction without rewriting that historical finding or claiming that the source migration has happened.

## 1. Explicit retrieval contract

### 1.1 `memory_engine_search`

Classification: `ACCEPTED_SEPARATE_CAPABILITY`.

The tool remains model-callable and distinct from DIRECT_CARD. It does not require a per-memory Owner attestation. It is an untrusted agent-internal retrieval surface: returned text may contain stale memory, prompt-injection content, raw-log-like material, or other content that the model must treat as untrusted.

The next source implementation should return only a bounded snippet and useful retrieval metadata. Metadata such as score, category, kind, source, or risk flags is evidence about retrieval, not permission to disclose. Search must not claim any of these production capabilities:

- `RAW_DISCLOSABLE`
- `DIRECT_CARD`
- `INTERNAL_AGENT_CONTEXT`

This record does not implement the bounded-search change.

### 1.2 `memory_engine_get`

Classification: `OWNER_ONLY_EXPLICIT_FULL_CONTENT_RETRIEVAL`.

The future consumer must authorize full-content access only when all of the following are true:

- the host supplied a context for the current agent run/tool execution;
- `context.senderIsOwner === true` evaluates true by exact boolean identity;
- the context was created from the host-authenticated Owner fact for that current run;
- the context was not supplied by tool parameters, plugin configuration, a session cache, or a caller-controlled metadata field.

The following are not authority and must never be used to promote the result to full content:

- `ctx.senderId`, requester IDs, session keys, session IDs, agent IDs, or channel/provider names;
- Gateway `operator.admin`, `operator.write`, or other scopes by themselves;
- WebChat/Control UI shape or a direct-message shape;
- prior command success, prior turns, telemetry, or model output;
- `main` agent identity, tool name, trigger, or configuration allowlists.

`false`, `undefined`, missing, non-owner, cron, heartbeat, subagent, and synthetic/internal execution without an explicit trusted Owner fact all fail closed. No cross-run or cross-turn authority cache is permitted.

This authority is deliberately not named `RAW_DISCLOSABLE`. It is an explicit, Owner-audience retrieval authority and is separate from the D.3 projection authority. The source migration must preserve the existing lookup and data-isolation guarantees; this contract does not silently add a second D.3 lifecycle/risk/attestation policy.

## 2. Minimum OpenClaw host contract

### 2.1 Existing seam and fact provenance

The trusted fact already exists before plugin tools are constructed on the embedded current-turn path:

`buildCommandContext` / trusted ingress
→ `get-reply-run` `FollowupRun.senderIsOwner`
→ embedded run parameters
→ `agent-tools` / `createOpenClawTools` options
→ plugin factory context construction
→ plugin tool instance

The H2 source currently exposes `senderIsOwner` in command and embedded-run/tool-construction option types, and `resolveOpenClawPluginToolInputs` constructs the `OpenClawPluginToolContext`. That context currently includes run/session/requester fields but no Owner-audience field. The narrow host seam is the construction of this existing plugin factory context: copy only the trusted embedded-run fact into an optional `senderIsOwner` field.

The host rule is:

`pluginContext.senderIsOwner = hostRunSenderIsOwner === true ? true : undefined`

The field is host-owned and read-only from the plugin's perspective. A plugin tool call cannot set or upgrade it.

### 2.2 Selected option: H3-C with H3-B binding

The selected additive contract is:

- extend `OpenClawPluginToolContext` with optional `senderIsOwner?: boolean`;
- populate it only while resolving tools for an embedded run whose trusted run fact is exactly true;
- require a future `memory_engine_get` registration to be a context-bound plugin factory, or an equivalent host-owned wrapper, so its execute closure captures the immutable per-run context;
- require the consumer to check `context.senderIsOwner === true` at the content boundary.

The current AgentTool execute callback remains its existing shape: `(toolCallId, params, signal?, onUpdate?)`. No model-provided argument, third execute argument, or global callback state is added. A future memory-engine consumer may pass a private context object to its own internal implementation, but that is a source-stage detail and not a caller-facing tool parameter.

The binding has these invariants:

- the snapshot is valid only for the tool instance/run for which the host created it;
- an owner-bearing tool instance must not be shared across runs or sessions;
- any host tool cache must resolve owner-bearing instances per run, or include the exact trusted context in its isolation key;
- no plugin or memory-engine state may persist the fact after the run;
- if the host cannot provide the fact, it must omit it rather than synthesize `true`.

The current memory-engine registration uses static tool objects. Therefore the future source migration must make the get tool context-bound (or use an equivalent host wrapper); adding a field to the host context alone does not authorize the current static consumer. That migration is not part of this design-only task.

### 2.3 Alternative comparison

| Option | Security and binding | Compatibility/cost | Decision |
| --- | --- | --- | --- |
| H3-A: add `context` to `execute` | Can be same-run if every dispatch path supplies the host context, but the current callback already has `signal` and `onUpdate` after `toolCallId, params`; inserting a third argument is order-sensitive, and adding a later argument changes the shared AgentTool API and every caller. | Broad public type and dispatch change; legacy plugins need compatibility handling. Direct Gateway callers would also need an explicit policy. | Rejected for v1. |
| H3-B: bind immutable context at construction | Strong same-run closure and no execute-signature change. Requires per-run tool construction/isolation and a context-aware consumer or wrapper. | Small consumer registration change; no broad callback migration. | Used as the binding mechanism. |
| H3-C: add `senderIsOwner` to existing plugin context | Small optional additive host API; compatible with existing factories and naturally carries the fact at the existing construction seam. | Requires the future get consumer to use a factory/wrapper instead of a static object. | Selected, realized through H3-B. |

This is a narrow Owner-audience field, not a generic authorization framework. It must not expose Gateway scopes or require memory-engine to reconstruct host identity.

## 3. Direct Gateway and HTTP invocation

OpenClaw direct `tools.invoke` paths eventually execute the same resolved `AnyAgentTool` callback machinery, but they do not represent the same authority surface as a model tool call in a current user turn.

The current H2 Gateway paths derive a `senderIsOwner`-like value from Gateway client scopes or HTTP request authentication for existing Gateway owner-only tool policy. In particular, `tools.invoke` requires operator authorization and the current Gateway resolver may use `operator.admin` for core-tool restrictions. Those facts prove operator access to the Gateway; they do not prove that the caller is the Owner audience for an exact current conversational turn.

Therefore the v1 host contract is explicit:

- embedded model-run plugin construction may carry the trusted current-turn `senderIsOwner` fact into plugin context;
- direct Gateway RPC/HTTP `tools.invoke` must not copy generic Gateway scope/authentication into the plugin `senderIsOwner` field for `memory_engine_get`;
- absent a separately designed host contract that authenticates a current user-turn Owner audience, direct invocation receives no positive get authority and fails closed;
- `operator.write` or `operator.admin` must not become an implicit memory-engine Owner allowlist.

This avoids granting full memory content to an HTTP/Gateway caller merely because it can invoke tools. A future direct operator retrieval contract, if needed, is a separate decision and must not be inferred from this one.

## 4. Consumer behavior and denial response

The future memory-engine registration should conceptually bind the host context and enforce the check at the first point before full-content lookup/return. It should use the exact predicate `context.senderIsOwner === true`; it should not inspect sender IDs, session fields, agent identity, channel, trigger, or tool params.

An unauthorized get should return a clear bounded authorization result rather than pretend that a valid Owner request was a missing memory. The recommended shape is:

`{ found: false, error: "owner_authorization_required", code: "MEMORY_GET_OWNER_AUTH_REQUIRED" }`

For the unauthorized result:

- do not perform a content lookup before the authority check;
- do not return memory text, title, source, path, line range, category, risk metadata, or a memory ID;
- do not return a partial snippet or existence-sensitive match list;
- use the same fixed bounded code for false, missing, non-owner, automated, and synthetic contexts.

For an authenticated Owner context, normal current-memory lookup semantics may return the requested full content and existing bounded fields. The response remains explicit retrieval, not a DIRECT_CARD projection and not a `safe_to_disclose` attestation result. Missing-memory and malformed-request behavior remains a separate existing lookup concern.

## 5. Threat and product assessment

### 5.1 Search and get are different surfaces

`memory_engine_search` currently places retrieved text and metadata in model-visible tool output. It is not direct user disclosure by itself, but the model can quote or summarize it into a later user response. Untrusted memory text can also carry prompt-injection instructions. The bounded-snippet direction reduces blast radius but does not turn search metadata or score into authority.

`memory_engine_get` currently provides a stronger disclosure capability: full content plus source/path/line information, including content classes that may be raw-log-like or suspected tool output. It is model-mediated disclosure when the model calls it, and it can also be direct disclosure when a Gateway tool caller receives the result. Because the current path does not receive a current-turn Owner proof, it is an authority-architecture gap rather than a DIRECT_CARD attestation failure.

An Owner-only get gate closes the audience gap for the explicit full-content surface without falsely claiming that it is the D.3 card authority. It also prevents an untrusted model turn, automated run, or generic Gateway scope from obtaining full content through this tool.

### 5.2 Option matrix

| Option | Security | Product usefulness | Cost/compatibility | Relationship to current decisions |
| --- | --- | --- | --- | --- |
| A. Leave both tools unchanged and document them separately | Preserves the current get bypass and model-mediated full-content risk. | Maximum compatibility. | Minimal implementation cost, but the known gap remains. | Insufficient for get; acceptable only as a temporary historical description. |
| B. Bounded search plus a stronger get boundary | Reduces search exposure and makes full-content access explicit. | Preserves search usefulness and Owner get usefulness. | Small search and get source stages; existing non-owner get callers change behavior. | This is the product shape frozen here. |
| C. Put both tools behind DIRECT_CARD Owner attestation | Strong per-memory authority, but conflates tool retrieval with a card projection. | Makes ordinary search/get cumbersome and may require attestations for interactive retrieval. | High migration and compatibility cost. | Rejected; D.3 authority remains bound to DIRECT_CARD. |
| D. Separate explicit-retrieval authority using host Owner fact | Controls the audience without per-memory card attestation; exact same-run and fail-closed when absent. | Good fit for explicit Owner get. | Small H2 context addition plus get registration/source migration. | Selected for get; separate from 4.3 and 4.4. |
| E. Remove/disable `memory_engine_get` from the effective model tool set | Immediately removes the model-mediated bypass. | Large loss of current functionality and compatibility. | Operationally simple but disruptive; direct paths still need review. | Contingency if source migration cannot be safely delivered, not the frozen v1 direction. |
| F. Project get output through `INTERNAL_AGENT_CONTEXT` | Could define a separate internal surface, but does not solve the missing host Owner fact by itself. | Potentially useful for future agent context. | New authority/taxonomy work and production integration. | HOLD / RESEARCH_ONLY; out of scope and must not start 4.4. |

The resulting classification is **MIXED**: search is an accepted separate capability with a bounded-output follow-up, while get is an authority-architecture gap that requires the Owner-only source migration before its current broad behavior can be treated as the accepted contract.

## 6. Compatibility and rollout boundary

The current shipped `memory_engine_get` behavior is broader than this contract. Changing it to Owner-only is a compatibility change for non-owner model turns and therefore requires a separately authorized source implementation stage and a separate deployment/reload decision.

The future qualification should be narrow and does not require another DIRECT_CARD `0 → 1 → 0` qualification:

- Owner-authenticated get returns the requested full content;
- false, missing, non-owner, cron, heartbeat, subagent, synthetic, and direct Gateway/HTTP contexts return the fixed no-content authorization result;
- no unauthorized response contains content, source location, or existence-sensitive metadata.

The following remain unchanged by this design:

- AutoRecall remains disabled in the current production baseline;
- DIRECT_CARD / OpenSpec 4.3 remains `PASS / RUNTIME QUALIFIED / CLOSED`;
- RAW_DISCLOSABLE / OpenSpec 4.4 remains unchecked and not started;
- `INTERNAL_AGENT_CONTEXT` remains `HOLD / RESEARCH_ONLY`;
- no new attestation, cache, database schema, Gateway scope, or protocol version is proposed.

No current-state or stabilization-plan edit is required: those documents can continue to record the current broad shipped tool behavior, 4.3 closed status, 4.4 unchecked status, and the explicit-tool follow-up. This record is the accepted design for a future source stage, not evidence that that stage has run.

## 7. Decision matrix

| Surface | Product direction | Source implementation | Deployment |
| --- | --- | --- | --- |
| `memory_engine_search` | Bounded separate retrieval | Not started | Not authorized by this document |
| `memory_engine_get` | Owner-only explicit full-content retrieval | Not started | Not authorized by this document |
| H3 host contract | H3-C plugin context field, bound per run using H3-B | Not implemented in either repository | Not authorized |
| DIRECT_CARD / OpenSpec 4.3 | Closed | Existing implementation remains unchanged | Existing qualification remains valid |
| RAW_DISCLOSABLE / OpenSpec 4.4 | Not started | Not started | Not authorized |
| `INTERNAL_AGENT_CONTEXT` | Hold / research-only | Not productionized | Not authorized |

## 8. Non-actions and authority boundaries

This design record does not modify source or tests, change OpenClaw, alter Gateway or configuration, read or write runtime databases/data, create attestations, enable AutoRecall, or authorize deployment. It does not add Owner inference, session state, cross-turn caching, or a generic authentication mechanism.

The next source stage must re-check the host contract against the exact H2 source commit before implementation. Until then, the current shipped get behavior remains a historical/current compatibility fact, not proof of compliance with this accepted future authority contract.

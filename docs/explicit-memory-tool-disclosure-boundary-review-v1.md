# Explicit Memory Tool Disclosure Boundary Review v1

Status: `INVESTIGATION / RECOMMENDATION ONLY`
Date: 2026-08-25
memory-engine review HEAD: `34c07856da3a0b001ab776b744452f6881d32020`
OpenClaw H2 read-only HEAD: `755ff5d396102c5a93baacf2d3bf6187a4fea713`

This record reviews the shipped `memory_engine_search` and
`memory_engine_get` explicit-tool surfaces. It does not authorize an
implementation, runtime change, configuration change, attestation, or a new
OpenSpec stage.

## Executive decision

### current_fact

The explicit tools are a separate retrieval capability from the D.3
`DIRECT_CARD` AutoRecall path:

- `memory_engine_search` returns Hybrid retrieval output, including bounded
  candidate text and retrieval metadata. It does not call the AutoRecall hard
  deny gate, the D.3 capability calculation, or the Owner attestation provider.
- `memory_engine_get` reads the current Core chunk and optional Engine
  metadata, and returns the complete stored text together with source/path and
  line-range metadata. It does not call the D.3 capability calculation or
  Owner attestation provider.
- The plugin manifest and registration expose all three names to the host
  registry: `memory_engine`, `memory_engine_search`, and `memory_engine_get`.
  The current project tool strategy gives the `main` model only
  `memory_engine_search` and `memory_engine_get`; the broad management router
  remains registered but is not a default `main`-model tool. Registry/catalog
  visibility and effective model visibility are separate facts.
- OpenSpec 4.3 remains `PASS / RUNTIME QUALIFIED / CLOSED`. OpenSpec 4.4
  remains unchecked and raw disclosure remains out of scope.

### classification

Overall classification: **MIXED**.

- `memory_engine_search`: **ACCEPTED_SEPARATE_CAPABILITY**, meaning the
  shipped explicit retrieval behavior remains in place and is not asserted to
  be D.3 user-disclosure authority. It still creates untrusted model-context
  and model-mediated disclosure risk that should be bounded by a future tool
  contract.
- `memory_engine_get`: **AUTHORITY_ARCHITECTURE_GAP requiring design before
  implementation**. Full content and source references are available without
  a host-authenticated audience fact or an explicit-tool disclosure authority.

This is not classified as an immediate source bug in this docs-only review:
the repository has intentionally shipped explicit tools as a separate manual
retrieval surface, and the OpenClaw plugin-tool execution contract does not
currently provide the trusted Owner fact needed for a safe authority patch.
If the product decision is changed to require every memory disclosure surface
to obey D.3, then `memory_engine_get` becomes a product violation and must be
reopened with an implementation decision.

### accepted_design

D.3 authority is closed for `DIRECT_CARD` AutoRecall. It must not be silently
extended to full-content explicit tools: a per-memory
`OWNER_EXPLICIT_ATTESTATION` bound to `DISCLOSURE_CARD` is not automatically an
authority for a user-requested full-content read or for untrusted
agent-internal context.

`INTERNAL_AGENT_CONTEXT` remains HOLD / RESEARCH_ONLY. This review therefore
does not create a production projection taxonomy or authorize a tool-output
projection through that surface.

### historical_record

The follow-up finding `EXPLICIT_MEMORY_TOOL_DISCLOSURE_BOUNDARY_NOT_UNIFIED`
was recorded after 4.3 qualification as a future tool-authority review. This
document supplies that review; it does not rewrite the historical D.3 source
or runtime qualification records.

## 1. Current memory-engine tool behavior

### Registration and effective exposure

`lib/tools/register-memory-engine-tools.js:1-5` defines the three tool names.
`lib/tools/register-memory-engine-tools.js:14-92` registers the same three
tools, and `openclaw.plugin.json:5-10` declares the same names under
`contracts.tools`.

The multi-action `memory_engine` tool accepts a `search` action at
`register-memory-engine-tools.js:36-61`; its implementation routes that action
to the same `createSearchRunner` used by the narrow wrapper
(`lib/tools/memory-engine-actions.js:120` and `:495-537`). The narrow wrapper is
therefore a separate host-visible name, not a separate disclosure authority.

The current effective-availability record is
`docs/agent-memory-tool-strategy.md:16-29`: `main` receives
`memory_engine_search` and `memory_engine_get`, while `memory_engine` remains a
registered management/action router and is not a default `main`-model tool.
`docs/current-state.md:45` records the same current fact and a prior runtime
observation. This investigation did not re-run Gateway or runtime visibility.

### `memory_engine_search`

The wrapper calls `retrievalPolicy.hybridSearch` and returns
`pool`, `channels`, `channel_sizes`, `debug`, and `results`
(`lib/tools/memory-engine-actions.js:500-537`). In the normal legacy Hybrid
projection, each result includes:

- a bounded 16-character `id`;
- `text` truncated to 240 characters;
- `path`, `category`, `confidence_mode`, `source_type`, `external_badge`,
  decay/archive eligibility, confidence, hits, and creation time;
- retrieval scores (`semantic_score`, `rrf_score`, `final_score`, boosts,
  similarity) and `sources`.

The exact field projection is `lib/recall/hybrid-search.js:121-144`.
When isolated canonical projection is active, results additionally carry
`memory_id`, `canonical_id`, `kind`, and category authority, but the displayed
text remains the bounded Hybrid candidate text
(`lib/recall/hybrid/canonical-result.js:29-62`). The returned `debug` also
contains bounded pre/post-rerank previews from
`lib/recall/hybrid-search.js:469-507`.

There is no dedicated D.3 `risk_flags` or `safe_to_disclose` authority in this
tool result. Category, source type, external badge, confidence, and retrieval
scores are metadata/evidence, not disclosure authorization. The wrapper does
not call `shouldInjectCandidate`, `evaluateDirectCardCapability`, a projection
authority, or an attestation provider. The focused wrapper test explicitly
proves that a `suspected_tool_output` candidate can pass through manual search:
`test/memory-engine-tool-wrappers.test.js:104-124`.

### `memory_engine_get`

The runner queries Core `chunks` by exact id prefix, joins Engine confidence
metadata, and returns the selected row at
`lib/tools/memory-engine-actions.js:570-675`. The returned `memory` includes:

- normalized lifecycle/category/confidence metadata;
- `source`, `start_line`, `end_line`, and `line_range`;
- the complete stored `text` at `:657-669`.

There is no AutoRecall hard deny, D.3 capability, projection validation, or
Owner attestation check in this path. The focused tests make the boundary
concrete: a `raw_log` row under a dreaming/tool-output-like path and text is
still returned by `memory_engine_get`
(`test/memory-engine-tool-wrappers.test.js:156-196`), and ordinary source plus
line-range metadata is returned at `:198-251`.

The Core/Engine accessors protect database topology, but read isolation is not
disclosure authority. `onMemoryEngineGetSuccess` at
`memory-engine-actions.js:671-673` is reinforcement/observation plumbing, not
an authorization decision.

## 2. OpenClaw H2 execution-authority seam

The source was inspected read-only at H2 commit
`755ff5d396102c5a93baacf2d3bf6187a4fea713`.

### Registration and execution contracts

`src/plugins/types.ts:2640-2643` defines `registerTool(tool, opts)`. The
options are tool names and optionality; there is no sender, Owner, audience, or
per-call authorization callback.

The optional plugin factory receives `OpenClawPluginToolContext` from
`src/plugins/tool-types.ts:14-59`. That context contains agent/session,
channel/delivery, sender id, filesystem, model, and config fields, but it does
not contain `senderIsOwner` or a host-authenticated Owner assertion. The
construction path is explicit in
`src/agents/openclaw-tools.plugin-context.ts:41-102`; its returned context
contains `requesterSenderId` but no Owner fact.

The normal agent tool callback is `AgentTool.execute(toolCallId, params,
signal, onUpdate)` at `packages/agent-core/src/types.ts:458-476`. It has no
invocation context. The extension-style `ToolDefinition` has a fifth
`ExtensionContext` argument (`src/agents/sessions/extensions/types.ts:526-533`),
but that context is a UI/session context and also has no `senderIsOwner`.
`src/agents/sessions/tools/tool-definition-wrapper.ts:26-28` only supplies that
extension context to extension tools; it does not add an Owner fact to plugin
tools.

### What H2 currently carries, and where it stops

The embedded agent construction receives `senderIsOwner` in the run options
(`src/agents/agent-tools.ts:1091-1094`). `createOpenClawTools` uses that fact
for host-owned message/channel behavior (`src/agents/openclaw-tools.ts:340-365`)
and the gateway resolver uses it for owner-only core-tool filtering
(`src/gateway/tool-resolution.ts:123-130,172-207`). It is not copied into
`OpenClawPluginToolContext`, so a memory-engine plugin factory or execute
callback cannot consume it as authority.

The Gateway `tools.invoke` adapters do have a trusted caller fact at their
entry points: RPC derives it from `client.connect.scopes` at
`src/gateway/server-methods/tools-invoke.ts:61-67`, while the HTTP path derives
it from authenticated request state at `src/gateway/tools-invoke-http.ts:71-87`.
That value reaches gateway tool resolution, but the final invocation calls the
tool with only `(toolCallId, params)` at
`src/gateway/tools-invoke-shared.ts:252-281`. It is not exposed to the plugin
tool callback.

Therefore the following distinctions are real:

- a tool being registered or model-visible is not proof of Owner audience;
- a model explicitly requesting a tool is not proof of Owner audience;
- `requesterSenderId`, session key, channel, provider, or config policy is not
  the H2 `senderIsOwner === true` fact;
- adding a plugin-side inference from those fields would violate the H2
  contract.

### Available policy scoping

OpenClaw can narrow effective tool availability by several dimensions:

- agent and session-derived agent id through
  `src/agents/agent-tools.policy.ts:407-440`;
- profile/provider/agent/group/subagent/inherited allow and deny lists through
  `src/gateway/tool-resolution.ts:69-170`;
- sender-identity policy through `src/agents/sender-tool-policy.ts:12-52`;
- group/channel/account/sender policy through
  `src/agents/agent-tools.policy.ts:497-572`;
- current run delivery/session values passed to
  `resolveOpenClawPluginToolsForOptions` at
  `src/agents/openclaw-plugin-tools.ts:64-137`.

These are useful visibility/policy controls, including current-turn
restriction, but they are not a substitute for a host-authenticated audience
fact. In particular, sender policy matches sender identity/configuration; it
does not establish Owner authorization for a disclosure.

## 3. Threat and product analysis

The following labels are review axes only, not a new production taxonomy.

| Surface | Current behavior | Disclosure and injection assessment |
| --- | --- | --- |
| `SEARCH_METADATA` | Search returns ids, categories, source type, confidence, scores, and channel evidence alongside its result envelope. | Useful for retrieval, but metadata is not a disclosure authority and can identify sensitive memory existence. |
| `SEARCH_SNIPPET` | Search returns candidate `text` up to 240 characters and debug previews up to 100 characters. | The snippet enters model context; it can be quoted or summarized to a user and can contain untrusted instructions. |
| `INTERNAL_AGENT_CONTEXT` | Tool result content is returned to the model; it is not D.3 `DIRECT_CARD` output. | Not direct user output at the first boundary, but model-mediated disclosure and prompt injection remain possible. The representation remains HOLD / RESEARCH_ONLY. |
| `FULL_CONTENT_REFERENCE` | `memory_engine_get` returns full text plus source/path/line range. | Highest risk: it is a full-content read with no per-memory disclosure authority and can return raw-log/tool-output material. |
| `DIRECT_CARD` | AutoRecall card mode uses the closed D.3 Owner-attested capability path. | This is the only currently qualified production card disclosure authority; the explicit tools do not consume it. |

For a normal model turn, `AgentToolResult.content` is explicitly documented as
text returned to the model (`packages/agent-core/src/types.ts:440-445`), so
tool output first enters internal agent context rather than being directly
sent as an assistant message. The model can nevertheless quote or summarize
it in the next assistant response. For a direct Gateway `tools.invoke` call,
the RPC/HTTP adapter returns the tool result to the authenticated caller, so
that surface must also be treated as a possible direct disclosure surface.

The risk is therefore not that `memory_engine_get` silently bypasses the D.3
AutoRecall code path; it never enters that path. The risk is that the shipped
explicit retrieval capability has a separate, weaker disclosure boundary than
the qualified `DIRECT_CARD` path.

## 4. Options

| Option | Security | Usefulness / compatibility | Cost and host changes | D.3 / 4.4 relationship |
| --- | --- | --- | --- | --- |
| A. Keep tools unchanged and document them as trusted retrieval | Preserves current behavior but leaves full-content and prompt-injection risk; documentation alone does not authorize disclosure. | Highest compatibility and usefulness. | No source or host change. | Cleanly separate from D.3, but does not close the `get` authority gap. It must not be described as safe user disclosure. |
| B. Reduce search to metadata/bounded snippet; require stronger authority for get | Reduces search exposure; `get` still needs a real authority boundary. Bounded text is not automatically safe from prompt injection. | Search remains useful; get compatibility changes only when its authority is enforced. | Memory-engine output projection plus a future authority seam for get; host fact needed for positive decisions. | Does not require 4.4 if limited to explicit retrieval and no raw-reference claim. |
| C. Put both tools behind the existing D.3 Owner-attestation boundary | Strong for the card authority, but the card attestation is bound to `DISCLOSURE_CARD`; it is not naturally a full-content tool authority. | Would make get semantics incompatible or force card-only results. | High; plugin and host execution changes, plus a new mapping between tool calls and card attestations. | Risks silently expanding D.3 into raw/full-content disclosure and therefore drifting toward 4.4. Not recommended. |
| D. Create a separate explicit-retrieval authority requiring a host-authenticated Owner audience, without per-memory card attestation | Best fit for full-content explicit reads if the authority is exact, event-local, fail-closed, and never inferred from session/channel/config. | Preserves an explicit retrieval workflow while making its disclosure semantics explicit. | Medium/high; requires a new host contract or a host-supported per-call authority context. No current plugin execute context is sufficient. | Can remain outside 4.3 and 4.4 if it is separately designed as explicit retrieval, not `RAW_DISCLOSABLE` or `DIRECT_CARD`. |
| E. Remove/disable memory_engine_get from the effective model tool set | Immediately removes the highest-risk model surface. | Significant compatibility loss; conflicts with the shipped/manual-tool contract. | Low source cost, but requires a deliberate host policy/config decision. | Does not reopen 4.4, but should be a product mitigation decision, not an incidental docs change. |
| F. Project tool output through INTERNAL_AGENT_CONTEXT | Could provide a bounded representation only if that representation and authority are independently designed. | Changes tool semantics and model behavior. | High; new projection/authority integration and host work. | Explicitly out of scope while INTERNAL_AGENT_CONTEXT is HOLD / RESEARCH_ONLY; not recommended in this review. |

## 5. Planner-facing recommendation

Adopt a **mixed B+D direction**, without changing source in this review:

1. Keep the shipped tools available under their existing explicit-tool names
   for compatibility, but document `memory_engine_search` as an untrusted,
   agent-internal retrieval surface rather than as user-disclosure authority.
   A future implementation should reduce its output to the smallest useful
   metadata/bounded-snippet contract and must not treat scores, category, or
   source metadata as safety authority.
2. Design a separate explicit-retrieval authority for
   `memory_engine_get`. The positive decision should require a trusted,
   current-turn host-authenticated Owner audience fact and the explicit-tool
   request context. It must fail closed for missing/non-owner/cron/heartbeat/
   subagent contexts, must not infer Owner from sender/session/channel/config,
   and must not use a cross-run cache.
3. Do not reuse `OWNER_EXPLICIT_ATTESTATION` wholesale for full-content get.
   The existing attestation remains correct for the exact D.3 card binding; a
   separate explicit-tool authority can decide whether a full read is allowed.
4. Do not remove `memory_engine_get` as an incidental cleanup. Option E is a
   possible temporary mitigation only after a product decision about the
   shipped manual-tool contract.
5. Do not implement Option F, add raw-reference semantics, or reopen OpenSpec
   4.4 as part of this finding.

This recommendation is an authority-design prerequisite, not implementation
authorization. The smallest safe next product decision is whether explicit
full-content retrieval is Owner-only, or whether a different trusted caller
class is intended. The current H2 tool callback contract cannot answer that
question for the plugin.

## 6. Evidence and non-actions

Primary evidence inspected:

- memory-engine registration and wrappers:
  `lib/tools/register-memory-engine-tools.js`,
  `lib/tools/memory-engine-actions.js`,
  `test/memory-engine-tool-wrappers.test.js`, and `openclaw.plugin.json`;
- OpenClaw H2 plugin/tool contracts:
  `src/plugins/types.ts`, `src/plugins/tool-types.ts`, `src/plugins/registry.ts`,
  `src/plugins/tools.ts`, `src/agents/openclaw-tools.plugin-context.ts`,
  `src/agents/openclaw-plugin-tools.ts`,
  `packages/agent-core/src/types.ts`;
- OpenClaw H2 tool policy and gateway invocation:
  `src/agents/agent-tools.ts`, `src/agents/agent-tools.policy.ts`,
  `src/agents/sender-tool-policy.ts`, `src/gateway/tool-resolution.ts`,
  `src/gateway/tools-invoke-shared.ts`,
  `src/gateway/server-methods/tools-invoke.ts`, and
  `src/gateway/tools-invoke-http.ts`;
- current effective-tool documentation:
  `docs/agent-memory-tool-strategy.md` and `docs/current-state.md`.

No source, test, OpenClaw, configuration, Gateway, database, data, runtime,
attestation, deployment, or OpenSpec task file was modified. No runtime or
live tool invocation was performed for this review.

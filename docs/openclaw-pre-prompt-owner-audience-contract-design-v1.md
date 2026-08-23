# D.3-D.4-H1 OpenClaw Pre-Prompt Owner Audience Contract Design

## Status and scope

- Check date: 2026-08-23.
- Repository HEAD at check: c621cc5c1d7968592990fcb8495032d768c7ef85.
- D.3-D.4-H1: PASS_WITH_FINDINGS / CONTRACT DESIGN FROZEN.
- Finding: OPENCLAW_AUTHORITATIVE_SOURCE_CHECKOUT_NOT_PRESENT_LOCALLY.
- D.3-D.4 source result: BLOCKED / NOT IMPLEMENTED.
- DIRECT_CARD production source migration: HOLD.
- Current blocker: PRODUCTION_OWNER_SELF_AUDIENCE_AUTHORITY_UNAVAILABLE_AT_PROMPT_INJECTION_BOUNDARY.
- D.3-D.4-H2 OpenClaw Pre-Prompt Owner Audience Source Implementation:
  CANDIDATE / NOT AUTHORIZED.

This record freezes a narrow design for a future host contract. It does not
modify OpenClaw, the global npm package, memory-engine source or tests, runtime
configuration, deployment, or the AutoRecall production path.

## Inherited boundary

D.3-D.3 OWNER_EXPLICIT_ATTESTATION proves that an authenticated Owner asserted
one exact Canonical source and one exact projection. It does not prove that the
audience of a later prompt is that Owner. Production disclosure must eventually
require both:

~~~~text
exact active Owner attestation
+ same-run host-authenticated senderIsOwner === true
+ projection validation
+ lifecycle/scope/risk hard-deny checks
~~~~

H1 addresses only the missing same-run host audience proof. Completing this
design does not change the D.3-D.4 blocker or authorize H2/source work.

## Source authority investigation

### Installed package

The installed package reports OpenClaw 2026.6.9 in:

/home/lionsol/.local/lib/node_modules/openclaw/package.json:2-14

Its package metadata points to the official upstream repository:

https://github.com/openclaw/openclaw.git

The global npm installation is not a Git working tree, contains one file under
src/, and is primarily compiled dist output. It is not a source-commit
authority and was not modified.

### Authoritative upstream checkout

The required temporary checkout of the official tag v2026.6.9 was attempted
outside this repository under /tmp. The attempt failed before checkout because
the environment could not resolve its configured proxy:

~~~~text
fatal: unable to access 'https://github.com/openclaw/openclaw.git/':
Could not resolve proxy: host.docker.internal
~~~~

No authoritative OpenClaw Git checkout is present locally. The upstream tag,
source tests, and any release-level equivalent fix therefore remain unverified
in this environment. Hash-bearing installed dist filenames below are cited
only as local installation evidence, never as stable API names. The background
issues openclaw/openclaw#80806 and openclaw/openclaw#84405 were not used as
authority because the network was unavailable; issue discussion cannot replace
versioned source and tests.

### Installed dist evidence

The stable SDK re-export is:

/home/lionsol/.local/lib/node_modules/openclaw/dist/plugin-sdk/types.d.ts:1-2

The installed type and runtime evidence resolves the requested symbols as
follows:

| Symbol | Installed evidence | Finding |
| --- | --- | --- |
| PluginHookBeforePromptBuildEvent | dist/plugin-sdk/hook-types-OPyYcRah.d.ts:47-50 | Current event contains only prompt and messages. |
| PluginHookAgentContext | dist/plugin-sdk/hook-types-OPyYcRah.d.ts:374-393 | Contains sender/session/run/channel fields, but no senderIsOwner. |
| AgentHarnessHookContext | dist/plugin-sdk/agent-harness-runtime-BFGBu9yU.d.ts:849-869 | Harness context also has no senderIsOwner. |
| buildAgentHookContextChannelFields | dist/plugin-sdk/agent-harness-runtime-BFGBu9yU.d.ts:204-213 | Builds channel/provider/sender fields only; it does not propagate Owner status. |
| buildAgentHookContext | dist/lifecycle-hook-helpers-PCMPYVvz.js:8-28 | Copies sparse run/session/model/channel facts and omits Owner status. |
| resolveAgentHarnessBeforePromptBuildResult | dist/plugin-sdk/agent-harness-runtime-BFGBu9yU.d.ts:878-883; runtime dist/agent-harness-runtime-Bk99eHl8.js:51-64 | Builds a prompt event with only prompt and messages, then calls runBeforePromptBuild. |
| resolvePromptBuildHookResult | dist/attempt.prompt-helpers-sRduNeAq.js:101-156 | Calls runBeforePromptBuild before returning prompt mutation fields. |
| runBeforePromptBuild | dist/hook-runner-global-jwCb7_e_.js:487-492; type dist/plugin-sdk/hook-runner-global-D8Hn0sTp.d.ts:71-75 | Runs the prompt-mutation hook. |
| runBeforeAgentRun | dist/hook-runner-global-jwCb7_e_.js:688-710; type dist/plugin-sdk/hook-runner-global-D8Hn0sTp.d.ts:86-87 | Remains a later pass/block gate. |

The installed selection runner confirms the ordering: prompt-build output is
merged into effectivePrompt at dist/selection-s2CqWVmM.js:13878-13898, the
model prompt is constructed at :14051-14082, and before_agent_run receives
senderIsOwner only at :14112-14124. The existing harness attempt constructs
its context without the Owner bit at dist/run-attempt-DQNz2JIH.js:8035-8045
and invokes the harness prompt helper at :8182-8187.

The installed CLI runner constructs a hook context without Owner status at
dist/cli-runner-BOYyOIRI.js:356-369 and has no local
resolveAgentHarnessBeforePromptBuildResult, resolvePromptBuildHookResult, or
runBeforePromptBuild call. Its current direct prompt-build coverage is
NOT APPLICABLE; it must not be presented as a positive audience path. The
CLI's later before_agent_run call at :737-751 does not change that conclusion.

No authoritative OpenClaw source test files were available in the global npm
package. H2 must obtain tests from the official checkout or an explicitly
authorized fork before implementation.

## Candidate contract comparison

| Option | Decision | Rationale |
| --- | --- | --- |
| A. Event-local senderIsOwner on before_prompt_build | ACCEPT | The value is a fact about the current prompt/request, is visible only to the hook that must decide before mutation, matches the existing before_agent_run name, and keeps the generic context narrow. |
| B. Add senderIsOwner to PluginHookAgentContext | REJECT AS PRIMARY / POSSIBLE INTERNAL SUPPORT ONLY | The context is shared by many lifecycle hooks. A message-scoped authentication fact would become visible to finalize/end/compaction and other hooks where it can be stale or semantically irrelevant. A private harness propagation field may still be needed internally. |
| C. Let before_agent_run mutate prompts | REJECT | This mixes a pass/block input gate with prompt construction, creates late-mutation risk, changes the existing result contract, and cannot repair a disclosure already injected. |
| D. Cache from message_received to before_prompt_build | REJECT | Cross-hook state introduces ordering, concurrency, retry, session-collision, expiration, and same-run binding failures. It is not a host-authenticated current-run proof. |
| E. Infer Owner from senderId, session, channel, DM, or config | REJECT | Identity and transport shape are not the host's authenticated Owner decision. Memory-engine must not reproduce host authorization. |
| F. Upgrade to a fixed formal OpenClaw release | CONDITIONAL PREFERENCE | Prefer a verified upstream release over a local fork if it contains an equivalent pre-prompt contract. The current installed version and upstream tag could not be source-verified here; upgrade and deployment require separate authorization. |

## Frozen public contract

Unless a formally verified upstream release already exposes a stricter
semantically equivalent contract, H2 should implement this event-local field:

~~~~ts
type PluginHookBeforePromptBuildEvent = {
  prompt: string;
  messages: unknown[];

  /**
   * Host-authenticated current sender ownership for this exact run/request.
   *
   * true:      host authenticated the current inbound sender as Owner.
   * false:     host authenticated the sender and determined non-Owner.
   * undefined: no current host-authenticated Owner proof is available.
   */
  senderIsOwner?: boolean;
};
~~~~

The semantic mapping is exact:

~~~~text
true      => positive OWNER_SELF audience proof may be considered
false     => current audience is not OWNER_SELF
undefined => proof unavailable
~~~~

Only this check may produce the positive audience input:

~~~~ts
const ownerAudienceAuthenticated = event?.senderIsOwner === true;
~~~~

The following are explicitly invalid substitutes:

~~~~ts
Boolean(event.senderIsOwner)
event.senderIsOwner !== false
event.senderId === configuredOwner
sessionIsDirect === true
~~~~

The field is an audience fact, not capability, attestation, projection, risk,
selector, lifecycle, or scope authority. It cannot by itself produce
CARD_DISCLOSABLE or DISCLOSE_CARD.

## Internal propagation contract

H2 must preserve these rules:

1. The value originates only from OpenClaw's already authenticated current-run
   input. It must not originate from a plugin parameter, prompt, candidate,
   session cache, telemetry, or prior turn.
2. The value is bound to the same execution as ctx.runId and the event being
   delivered to the hook.
3. A retry within one run may reuse the same immutable host fact. A new run
   must obtain a new host fact.
4. The tri-state must survive propagation: true, false, and absent/undefined
   are distinct outcomes.
5. An internal host parameter must not be overwritable by plugin input or a
   caller-supplied public field.
6. Conditional object construction must preserve explicit false:

~~~~ts
...(typeof params.senderIsOwner === "boolean"
  ? { senderIsOwner: params.senderIsOwner }
  : {})
~~~~

This is incorrect because it drops an authenticated non-Owner result:

~~~~ts
...(params.senderIsOwner
  ? { senderIsOwner: params.senderIsOwner }
  : {})
~~~~

The params in the correct example are host-internal run parameters, not
agent-callable plugin input.

## Runner coverage matrix

| Path | Current prompt-build path | Owner fact in current internal parameters | Future H2 behavior |
| --- | --- | --- | --- |
| Selection/chat runner | resolvePromptBuildHookResult in selection-s2CqWVmM.js:13878; prompt event currently has no Owner field. | selection-s2CqWVmM.js:14116-14124 already passes params.senderIsOwner to the later gate. | Add the same host fact to the earlier event before prompt mutation, preserving all three states. |
| Embedded/channel harness | resolveAgentHarnessBeforePromptBuildResult in agent-harness-runtime-Bk99eHl8.js:51-64; context is built by buildAgentHookContext. | run-attempt-DQNz2JIH.js:8035-8045 and AgentHarnessHookContext omit it. | Add a private harness propagation field, then construct the public event-local field. Do not broaden generic context. |
| CLI runner | Installed cli-runner-BOYyOIRI.js has no prompt-build resolver/call. | Later gate path has params.senderIsOwner at :737-751, but no pre-prompt hook path. | NOT APPLICABLE until a formal prompt-build path exists; if added, use the same contract. |
| Cron | No inbound Owner audience proof is established for the synthetic trigger. | No positive current sender fact. | Pass undefined; fail closed. |
| Heartbeat | May run without an inbound sender. | No positive current sender fact. | Pass undefined; fail closed. |
| Subagent | Must not inherit the initiating user's Owner audience. | Not applicable or absent. | Pass undefined; fail closed. |
| Retry/fallback | Same execution may retry prompt preparation. | Same-run immutable fact may be retained. | Reuse only for the same runId; never reuse across runs. |
| Group/channel | Transport context alone is not sufficient. | Use only a host-authenticated sender result when formally supplied. | Do not infer from channel, session, DM, or group shape. |

If a runner does not currently execute before_prompt_build, H2 must record it as
NOT APPLICABLE, not fabricate a positive coverage claim.

## Fail-closed and security boundary

For the future memory-engine consumer, absent or false audience proof must
remain non-authorizing:

~~~~text
senderIsOwner !== true
  => no OWNER_SELF audience proof
  => safe_to_disclose = false/absent
  => capability = RETRIEVAL_ONLY
  => selector = WITHHOLD
~~~~

Even senderIsOwner === true is only one input. The future consumer must still
require exact active attestation, exact projection validation, lifecycle and
scope checks, risk hard-deny checks, and the existing disclosure selector.
H1 does not implement or wire that consumer.

The generic PluginHookAgentContext must not gain this field as the primary
public design. Other lifecycle hooks must not receive a reusable Owner
authority merely because they share a context type. The host proof must not be
cached across sessions, turns, or requests.

## Conditional H2 source slices

These are implementation designs only and are not authorized by H1.

### H2-A — public hook type

Update the official OpenClaw public hook type/export and contract tests for the
event-local optional boolean. Preserve existing hook result and registration
compatibility.

### H2-B — selection runner propagation

Carry the authenticated host fact through the current run parameters into
resolvePromptBuildHookResult and the runBeforePromptBuild event. Preserve
explicit false; do not accept plugin/caller overrides. Add selection-runner
tests for event construction and ordering.

### H2-C — agent harness propagation

Extend the private AgentHarnessHookContext/construction boundary only as needed
to carry the same-run host fact into resolveAgentHarnessBeforePromptBuildResult.
Keep the public authority event-local and add embedded/harness tests.

### H2-D — compatibility and security tests

Test true, false, and missing values; same-run retry stability; new-run
non-reuse; plugin non-overwrite; cron/heartbeat/subagent fail-closed behavior;
selection/harness consistency; unchanged before_agent_run pass/block semantics;
no unnecessary Owner visibility for generic lifecycle hooks; and public API
backward compatibility.

### H2-E — memory-engine consumer

Only after H2 and a separately authorized D.3-D.4 consumer stage may
memory-engine use:

~~~~ts
const ownerAudienceAuthenticated = event?.senderIsOwner === true;
~~~~

That value must enter independent capability calculation and may not bypass
attestation, projection, lifecycle, scope, risk, or selector hard-denies.
H1 does not implement H2-E.

## Source authority prerequisite

Before H2 source implementation begins, all of the following must hold:

~~~~text
OPENCLAW_AUTHORITATIVE_SOURCE_CHECKOUT_AVAILABLE
~~~~

The checkout must be independent of memory-engine, point to the official
repository or an explicitly authorized fork, expose a verifiable baseline tag
or commit, have a clean worktree, and provide the authoritative build/test
commands. Development in the global npm installation is prohibited. Any
installation, upgrade, deployment, or Gateway operation requires separate
authorization.

If a formally verified upstream release already contains an equivalent
pre-prompt contract, prefer a controlled upgrade qualification design over a
local fork. H1 does not upgrade or deploy OpenClaw.

## Explicit non-actions

- No OpenClaw source, global npm package, or dist file was modified.
- No memory-engine source or test was modified.
- No fixture, report, runtime, configuration, Gateway, DB/data, or deployment
  operation was performed.
- AutoRecall was not enabled, no real attestation was created, and no frozen
  holdout or EDi run was performed.
- H2 was not started.

## Later authoritative-source correction

The H1 finding above is historical and is not rewritten. During the separately
authorized D.3-D.4-H2-E preflight, the authoritative OpenClaw source checkout
`/home/lionsol/src/openclaw-h2` was independently verified read-only at clean
commit `2e67ab06b6f7f1cf7655d0a8d508fc2a2ad78176`. Its source exposes
`PluginHookBeforePromptBuildEvent.senderIsOwner?: boolean`; the
`v2026.6.9` source does contain the CLI prompt-build path, and H2 covers that
path. The memory-engine consumer implementation is recorded in
`docs/direct-card-pre-prompt-owner-audience-consumer-implementation-v1.md`.

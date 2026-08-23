# D.3-D.4 DIRECT_CARD Production Disclosure Boundary Migration Blocker

## Decision record

- Check date: 2026-08-23.
- Repository HEAD at check: `f4feac1301271365f258ea217181af26a8f9972f`.
- Worktree at check: clean.
- `D.3-D.4`: **`BLOCKED / NOT IMPLEMENTED`**.
- `DIRECT_CARD` production source migration: **`HOLD`**.
- Blocker: **`PRODUCTION_OWNER_SELF_AUDIENCE_AUTHORITY_UNAVAILABLE_AT_PROMPT_INJECTION_BOUNDARY`**.

This is a blocker-evidence and OpenSpec state record. It does not implement
the production source migration, modify the OpenClaw host, authorize runtime
activation, or qualify deployment.

## Inherited D.3 boundary

The following are inherited records, not reopened decisions:

- `historical_record`: D.3-D.1 is `PASS_WITH_FINDINGS`; production migration
  remains held because the production safe-to-disclose authority input was
  missing.
- `accepted_design`: D.3-D.2 is `PASS / DECISION CLOSED`; the sole v1 positive
  authority is `OWNER_EXPLICIT_ATTESTATION`, bound to an exact Canonical source
  and exact `DISCLOSURE_CARD` projection with `OWNER_SELF` audience scope.
- `current_fact`: D.3-D.3 is `IMPLEMENTED / REPOSITORY-TESTED`. Its
  Engine-owned attestation store, exact validator/provider, deterministic
  Owner projection, and host-authenticated management boundary are present in
  repository source, but they are not wired into AutoRecall and no real
  attestation state exists.
- `accepted_design`: D.3-C still approves `DIRECT_CARD` as the first and only
  current production integration candidate. That product-entry decision does
  not establish prompt-audience authentication or source readiness.

## Production injection point

The memory-engine production hook remains the `before_prompt_build` path:

1. `lib/recall/auto-recall-hook-lifecycle.js:183` registers
   `api.on("before_prompt_build", ...)`.
2. The hook builds `autoRecallTrustedRuntimeContext` at lines 278-287 from
   agent, session, request, run, and trigger fields. It contains no trusted
   `senderIsOwner` or equivalent `OWNER_SELF` proof.
3. The hook formats `gatedResults` at lines 408-415 and returns
   `{ prependContext }` at line 533.
4. The legacy card-first formatter is therefore a prompt mutation produced by
   the prompt-build hook, before any later gate hook can supply an audience
   fact.

The current source remains unchanged by this decision. In particular,
`senderId`, agent identity, session identity, run identity, channel, trigger,
caller fields, candidate fields, and configuration booleans are not host
authentication and cannot be interpreted as `OWNER_SELF`.

## OpenClaw contract evidence

The installed package is OpenClaw `2026.6.9`, recorded in:

`/home/lionsol/.local/lib/node_modules/openclaw/package.json:2-4`.

The stable SDK type surface re-exports the hook types from
`/home/lionsol/.local/lib/node_modules/openclaw/dist/plugin-sdk/types.d.ts:1-2`.
The following build-hash file is cited only as evidence from this installed
package, not as a stable filename or API contract:
`/home/lionsol/.local/lib/node_modules/openclaw/dist/hook-types-Cz3fBvHt.d.ts`.

| Hook | Installed type evidence | Boundary consequence |
| --- | --- | --- |
| `before_prompt_build` | `PluginHookBeforePromptBuildEvent` has only `prompt` and `messages` (`hook-types-Cz3fBvHt.d.ts:47-50`). Its result can return `systemPrompt`, `prependContext`, `appendContext`, `prependSystemContext`, and `appendSystemContext` (`:51-65`). | This is the prompt-mutation boundary, but its event does not carry trusted `senderIsOwner`. |
| Hook context | `PluginHookAgentContext` includes `senderId`, channel, session, run, agent, and trigger fields (`:374-393`), but no `senderIsOwner`. | The plugin cannot derive a trusted Owner audience from this context. |
| `before_agent_run` | `PluginHookBeforeAgentRunEvent` includes optional `senderIsOwner` as the trusted sender identity bit (`:1044-1053`). `PluginHookBeforeAgentRunResult` is `InputGateDecision \| void` (`:1054-1055`). | The trusted bit arrives on a later gate hook, whose result does not provide prompt mutation fields. |
| Hook runner | `runBeforePromptBuild` returns `PluginHookBeforePromptBuildResult` while `runBeforeAgentRun` returns `GateHookResult<InputGateDecision>` (`hook-runner-global-DVhpFHEj.d.ts:71-87`). | The two capabilities are separated: prompt mutation is earlier; the Owner bit is later and gate-only. |

## Actual execution order

The installed dist source independently confirms the ordering:

1. `attempt.prompt-helpers-sRduNeAq.js:126-156` calls
   `runBeforePromptBuild({ prompt, messages }, hookCtx)` and returns its
   `prependContext` and system-context mutation fields.
2. `selection-s2CqWVmM.js:13878-13898` calls
   `resolvePromptBuildHookResult(...)` and prepends/appends that result to
   `effectivePrompt`.
3. The resulting model prompt is constructed at
   `selection-s2CqWVmM.js:14051-14082`.
4. Only afterward, at `selection-s2CqWVmM.js:14112-14124`, OpenClaw calls
   `runBeforeAgentRun(...)` and passes `senderIsOwner` as an optional field.
   The only handled result is the later block/pass decision at lines
   14143-14157; it cannot undo the earlier prompt mutation.

The equivalent preparation path also merges `hookResult.prependContext` and
system context at `prepare.runtime-Ck6Yc2OM.js:643-668` after calling
`resolvePromptBuildHookResult`.

Consequently, a `DISCLOSURE_CARD` returned by `before_prompt_build` can already
be present in the effective prompt before the same run's trusted
`before_agent_run.senderIsOwner` value is observed. The current host contract
does not expose a trusted `OWNER_SELF` audience proof early enough for a
positive production disclosure decision.

## Why the D.3-D.3 attestation is insufficient here

D.3-D.3's attestation proves that an authenticated Owner explicitly asserted
one exact Canonical source and one exact projection for the `DISCLOSURE_CARD`
surface with `OWNER_SELF` scope. It does not prove that the audience of the
current prompt is that Owner. The production decision must require both:

```text
exact active Owner attestation
+ same-run host-authenticated senderIsOwner === true
+ projection validation
+ lifecycle/scope/risk hard-deny checks
```

Without the same-run host proof, fail closed:

```text
safe_to_disclose = false/absent
capability = RETRIEVAL_ONLY
selector = WITHHOLD
```

The plugin must not reconstruct or cache this proof from `senderId`, session
keys, agent IDs, DM or channel type, configuration allowlists, prompt content,
model output, telemetry, or a prior run.

## Why an always-withhold pipeline is not migration completion

Submitting a production call path that can never positively establish
`OWNER_SELF` would only encode the missing host contract as a permanent deny.
It would not be a production migration: it would lack a valid positive path,
would not establish the required same-run audience boundary, and would make
the D.3-D.4 source result misleading. The current stage therefore records the
blocker and does not add an always-`WITHHOLD` production wiring.

## Required host contract to remove the blocker

The minimum required host contract is:

> OpenClaw must expose a host-authenticated OWNER_SELF audience proof before
> any prompt mutation that could contain disclosure content. The proof must be
> bound to the same run/request and must not be reconstructed or reused across
> turns by the plugin.

Removing the blocker requires a new explicit host/product authorization for
that contract and a subsequent D.3-D.4 source decision. This task does not
modify or remediate OpenClaw.

## Negative scope confirmation

- No production source was modified.
- No tests, fixtures, or historical reports were modified.
- No runtime, configuration, Gateway, deployment, or database/data operation
  was performed.
- AutoRecall was not enabled and no real attestation was created.
- No frozen holdout was run and EDi was not called.
- OpenSpec tasks 4.2, 4.3, and 4.4 remain unchecked.
- No next stage was started.

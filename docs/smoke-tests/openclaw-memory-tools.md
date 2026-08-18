# OpenClaw Memory Tools Smoke Tests

## Preconditions

- `memory-core` remains the OpenClaw standard memory substrate.
- `memory-engine` is installed and enabled as an enhancement layer, not as the `plugins.slots.memory` owner.
- Do not add `kind:"memory"` to memory-engine for this smoke test.
- Do not register `memory_search` or `memory_get` from memory-engine.
- Keep `memory-engine.config.autoRecall.enabled=false`.
- Keep `active-memory` disabled, or at minimum do not enable it together with memory-engine autoRecall unless dedup exists.
- Do not modify OpenClaw config during this runbook unless the operator explicitly intends to test a config change separately.

## Doctor And Inspect Commands

Run:

```bash
openclaw doctor
openclaw plugins inspect memory-engine --runtime --json
```

Optional local manifest check:

```bash
cat openclaw.plugin.json
```

## Expected Tool Availability

Registry contract — all three tools are registered:

- `memory_engine`
- `memory_engine_search`
- `memory_engine_get`

Main model effective contract — with global `tools.profile=coding` and a main-scoped `alsoAllow` only:

- `memory_engine_search`
- `memory_engine_get`

Management router contract:

- `memory_engine` remains registered for management/action compatibility.
- It is intentionally not exposed to the main model by default.

Other agents remain isolated and do not automatically inherit the main agent's search/get availability.

The policy boundary is intentionally narrow: do not switch the global profile to `full`, and do not broaden availability to `group:plugins` or `*`.

Expected standard memory-core tools stay separate:

- `memory_search`
- `memory_get`

Memory-engine must not expose:

- `memory_search`
- `memory_get`

## Expected Non-Shadowing Behavior

- OpenClaw standard memory lookup continues to use `memory_search` / `memory_get`.
- Memory-engine enhancement lookup uses `memory_engine_search` / `memory_engine_get`.
- `memory_engine` remains the management/action router and should not replace the narrow search/get pair.
- The memory-engine manifest must not shadow OpenClaw standard memory tools by reusing the `memory_search` / `memory_get` names.
- If registry inspection shows `memory_engine`, `memory_engine_search`, and `memory_engine_get`, while effective main-model inspection shows only the search/get pair, that is the expected non-shadowing state.

## Manual Smoke Cases

1. Standard substrate check:
   Use `memory_search` for an ordinary memory query and confirm the call path still targets memory-core rather than memory-engine.

2. Enhancement search check:
   Use `memory_engine_search` for a project-state or governance-oriented query and confirm the result carries memory-engine-style ids/metadata.

3. Narrow get check:
   Use `memory_engine_get` with an id returned by `memory_engine_search`.
   If an id prefix is ambiguous, retry with a longer prefix until the result resolves to a single match.

4. Non-shadowing check:
   Confirm memory-engine runtime inspection does not list `memory_search` or `memory_get` in its tool contract.

5. Dual-recall safety check:
   Confirm `active-memory` and memory-engine autoRecall are not both enabled.

6. Router scope check:
   Use `memory_engine` only for management or maintenance actions, not as a substitute for ordinary `memory_search`.

## Pass Criteria

- The registry contains `memory_engine`, `memory_engine_search`, and `memory_engine_get`.
- The main model effective tool set contains `memory_engine_search` and `memory_engine_get`, but not the management router.
- `memory_search` and `memory_get` are not exposed by memory-engine.
- Memory-engine does not shadow OpenClaw standard memory tools.
- Active-memory and memory-engine autoRecall are not both enabled.
- Ambiguous `memory_engine_get` id prefixes are handled by retrying with a longer prefix.

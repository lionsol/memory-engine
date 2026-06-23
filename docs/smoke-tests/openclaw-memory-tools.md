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

Expected memory-engine tool contract:

- `memory_engine`
- `memory_engine_search`
- `memory_engine_get`

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
- If runtime inspection shows only `memory_engine`, `memory_engine_search`, and `memory_engine_get` for the plugin, that is the expected non-shadowing state.

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

- `memory_engine`, `memory_engine_search`, and `memory_engine_get` are available.
- `memory_search` and `memory_get` are not exposed by memory-engine.
- Memory-engine does not shadow OpenClaw standard memory tools.
- Active-memory and memory-engine autoRecall are not both enabled.
- Ambiguous `memory_engine_get` id prefixes are handled by retrying with a longer prefix.

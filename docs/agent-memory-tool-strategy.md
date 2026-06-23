# Agent Memory Tool Strategy

## Current architecture

- memory-core is the OpenClaw standard memory substrate.
- memory-engine is an enhancement and governance layer.
- `memory_search` / `memory_get` belong to memory-core.
- `memory_engine_search` / `memory_engine_get` belong to memory-engine.
- memory_engine remains the management and action router.
- `memory-engine` does not own `plugins.slots.memory`.
- `memory-engine` must not shadow `memory_search` / `memory_get`.
- `active-memory` and memory-engine autoRecall are disabled by default.
- Do not enable `active-memory` and memory-engine autoRecall together unless explicit dedup is implemented.
- Do not add `kind:"memory"` just to make memory-engine impersonate the standard memory substrate.

## Tool selection

Use `memory_search` when:
- You need to search OpenClaw's standard memory files.
- You need broad recall from `MEMORY.md` / `memory/*.md`.
- You plan to follow up with `memory_get`.

Use `memory_get` when:
- You have a source path / line range from `memory_search`.
- You need to inspect the original memory text.

Use `memory_engine_search` when:
- You need memory-engine enhanced retrieval.
- You care about confidence, category, reranking, KG/vector signals, or lifecycle metadata.
- You are investigating project state, prior decisions, quality issues, checkpoint results, or memory-engine-managed records.

Use `memory_engine_get` when:
- You have a memory-engine result id.
- You need exact content, source path, or line range from an engine result.
- If an id prefix is ambiguous, retry with a longer id until `memory_engine_get` resolves a single match.
- Do not assume a short prefix is stable across runs or datasets.

Use `memory_engine` when:
- You need management actions such as status, quality evaluation, archive, conflict detection, add/update, or maintenance.
- Do not use the broad `memory_engine` action router for ordinary search if `memory_engine_search` is sufficient.

## Avoid

- Do not use `memory_engine_search` as a blind replacement for `memory_search`.
- Do not call both `memory_search` and `memory_engine_search` for every query.
- Do not enable active-memory and memory-engine autoRecall together unless dedup is implemented.
- Do not register or shadow OpenClaw standard `memory_search` / `memory_get`.
- Do not register `memory_search` or `memory_get` from memory-engine.
- Do not treat memory-engine as the replacement for `memory-core`.
- Do not treat `metadata_header` checkpoint rows as confirmed user messages unless role evidence exists.

## Recommended default behavior

1. For ordinary memory lookup, start with `memory_search`.
2. For project-state or memory-engine-specific lookup, start with `memory_engine_search`.
3. Use `*_get` only after search returns a concrete source/id.
4. Use `memory_engine` only for management or maintenance.

## Compatibility rules

- `memory-core` remains the OpenClaw standard memory surface even when memory-engine is installed.
- `memory-engine` may enhance retrieval, governance, quality, and maintenance, but it must not shadow OpenClaw standard memory tools.
- `memory_search` / `memory_get` stay in the `memory-core` namespace.
- `memory_engine_search` / `memory_engine_get` stay in the memory-engine namespace.
- Active-memory and memory-engine autoRecall should not both be enabled without dedup because they can inject overlapping recall results into the same turn.

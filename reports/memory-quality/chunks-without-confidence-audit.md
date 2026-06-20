# Chunks Without Confidence Audit

## Summary

- generated_at: 2026-06-20T04:35:36.506Z
- mode: read_only
- engine_db: /home/lionsol/.openclaw/memory/memory-engine/memory-engine.sqlite
- core_db: /home/lionsol/.openclaw/memory/main.sqlite
- chunks_without_confidence: 1504
- missing_category: 1504
- intersection_count: 1504
- only_without_confidence: 0
- only_missing_category: 0

## Dreaming

- count: 1338
- share: 0.8896
- retrieved_count_total: 29
- injected_count_total: 1
- chunks_ever_retrieved: 14
- chunks_ever_injected: 1

## Top Path Prefixes

- memory/dreaming/light: 1238 (0.8231)
- memory/dreaming/rem: 68 (0.0452)
- memory/2026-05-25.md: 34 (0.0226)
- memory/dreaming/deep: 32 (0.0213)
- memory/2026-05-24.md: 30 (0.0199)
- MEMORY.md: 15 (0.01)
- memory/2026-05-22-0903.md: 11 (0.0073)
- memory/2026-05-10-2037.md: 8 (0.0053)
- memory/2026-05-17.md: 6 (0.004)
- memory/2026-05-19-0957.md: 6 (0.004)

## Families

- dreaming: 1338 (0.8896)
- daily_memory: 144 (0.0957)
- curated_memory: 15 (0.01)
- project: 5 (0.0033)
- raw_log: 1 (0.0007)
- unknown: 1 (0.0007)

## Source Types

- memory: 1504 (1)

## Hypotheses

- [high] index_sync_backfill_scope_gap: The missing rows align with paths that are indexed by core but excluded from the current confidence backfill scope.
- [high] not_orphan_confidence_or_historical_leftover: These are live indexed chunks with matching core file records, not orphan confidence leftovers.
- [medium] dreaming_and_other_memory_files_never_entered_lifecycle: The current missing set suggests dreaming, daily-memory, curated-memory, project, and raw-log paths were never wired into confidence creation.

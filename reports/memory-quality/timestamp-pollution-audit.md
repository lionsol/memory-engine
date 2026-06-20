# Timestamp Pollution Audit

## Summary

- generated_at: 2026-06-20T14:50:20.789Z
- mode: read_only
- timestamp_pollution_total: 164
- default_scope_count: 57
- all_scope_count: 164
- lifecycle_owned_count: 57
- core_owned_count: 9
- generated_or_diagnostic_count: 98
- legacy_or_manual_count: 0
- unknown_count: 0
- retrieved_count_total: 156
- injected_count_total: 4
- entries_ever_retrieved: 9
- entries_ever_injected: 3
- created_before_raw_log_fix: 159
- created_after_raw_log_fix: 0
- unknown_fix_window: 5

## Owners

- memory_engine_generated_or_diagnostic: 98 (0.5976)
- memory_engine_lifecycle: 57 (0.3476)
- openclaw_core: 9 (0.0549)

## Families

- dreaming: 98 (0.5976)
- smart_add: 56 (0.3415)
- daily_memory: 9 (0.0549)
- episode: 1 (0.0061)

## Likely Sources

- generated_artifact: 89 (0.5427)
- smart_add_writer: 31 (0.189)
- checkpoint_input: 19 (0.1159)
- raw_log_parser: 8 (0.0488)
- healthcheck_note: 7 (0.0427)
- session_event_formatter: 5 (0.0305)
- autoRecall_trace: 4 (0.0244)
- unknown: 1 (0.0061)

## Hypotheses

- [medium] dominant_source_family: timestamp pollution is currently dominated by generated_artifact within dreaming paths
- [medium] mostly_historical_residue: no entries fall after the post-fix bucket boundary, suggesting timestamp pollution is mostly historical residue in the current snapshot
- [medium] retrieval_impact_present: timestamp-polluted memories are not purely dormant historical residue because some have retrieval/injection usage

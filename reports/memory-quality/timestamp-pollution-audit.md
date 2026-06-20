# Timestamp Pollution Audit

## Summary

- generated_at: 2026-06-20T15:05:45.897Z
- mode: read_only
- timestamp_pollution_total: 154
- default_scope_count: 56
- all_scope_count: 154
- lifecycle_owned_count: 56
- core_owned_count: 0
- generated_or_diagnostic_count: 98
- legacy_or_manual_count: 0
- unknown_count: 0
- retrieved_count_total: 146
- injected_count_total: 2
- entries_ever_retrieved: 8
- entries_ever_injected: 2
- created_before_raw_log_fix: 149
- created_after_raw_log_fix: 0
- unknown_fix_window: 5

## Owners

- memory_engine_generated_or_diagnostic: 98 (0.6364)
- memory_engine_lifecycle: 56 (0.3636)

## Families

- dreaming: 98 (0.6364)
- smart_add: 56 (0.3636)

## Likely Sources

- generated_artifact: 89 (0.5779)
- smart_add_writer: 31 (0.2013)
- checkpoint_input: 19 (0.1234)
- healthcheck_note: 6 (0.039)
- session_event_formatter: 5 (0.0325)
- autoRecall_trace: 4 (0.026)

## Hypotheses

- [medium] dominant_source_family: timestamp pollution is currently dominated by generated_artifact within dreaming paths
- [medium] mostly_historical_residue: no entries fall after the post-fix bucket boundary, suggesting timestamp pollution is mostly historical residue in the current snapshot
- [medium] retrieval_impact_present: timestamp-polluted memories are not purely dormant historical residue because some have retrieval/injection usage

Quality diagnostics are not cleanup instructions.

orphan_confidence:
- 可 dry-run
- 可 guarded apply
- 必须 backup + explicit confirm

chunks_without_confidence:
- ownership-aware diagnostic
- 不自动 backfill confidence/category

duplicate_exact:
- audit-only
- 不自动 delete
- cleanup 需要单独 guarded apply

timestamp_pollution:
- source audit + false-positive refinement
- 不自动 rewrite historical memory content

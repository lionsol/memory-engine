# Session checkpoint Core index contract

The checkpoint passes its explicit `targetDate` to `bin/sync-memory-index.js`. The result keeps two independent facts:

- `index_invocation` reports whether the existing OpenClaw memory manager (or its existing CLI fallback) returned successfully.
- `target_date_coverage` reports whether `memory/smart-add/<targetDate>.md` still has the same source snapshot after indexing and every canonical `session_flush` fingerprint in that file is present in Core chunk text for that exact path.

Only both a successful invocation and complete target-date coverage permit Engine reconciliation and LLM extraction. A missing file, failed post-read, missing Core path, absent/stale fingerprint, changed source snapshot, or unreadable Core evidence is incomplete. A non-zero chunk count is diagnostic only and is never sufficient evidence. Reports contain aggregate fingerprint counts only, not fingerprint values or source/chunk bodies. No Engine-to-Core write path is introduced; Core indexing remains owned by OpenClaw.

## Deployment notes

- `targetDate` selects the one file whose coverage is verified; it does **not** constrain index writes. `manager.sync()` and `openclaw memory index` use the configured OpenClaw memory-index scope. The plugin's diagnostic `file_scan` enumerates every Markdown file directly under `memory/smart-add` and `memory/episodes`; it is not a target-date write filter and is not a claim that OpenClaw only writes those paths.
- Core indexing may invoke the configured embedding implementation, including a remote provider. This source change adds no provider call of its own and does not bypass OpenClaw's indexing path.
- `sync-memory-index.js` has no independent operation timeout. The repository's recorded `session-checkpoint` cron boundary is `timeoutSeconds: 900` with `noOutputTimeoutSeconds: 180`; verify those values against the live scheduler before deployment. The checkpoint LLM request timeout is a separate setting (default 120 seconds) and does not bound the preceding Core index call.
- Complete Core coverage does not guarantee a summary. If the input budget clips or excludes entries, the checkpoint reports incomplete input and skips valid-summary completion; budget shortage must not be described as full recovery.

This contract has only isolated source/test validation in this change. It is not evidence of production indexing behavior or production performance.

# ADR: Memory-engine owns event-time metadata in an engine-side sidecar

- Status: Accepted
- Date: 2026-07-11

## Decision

The current core `chunks.event_at` migration is suspended. Memory-engine must not use `updated_at`, file mtime, batch-write time, import time, or smart-add path dates to invent event timestamps. The existing migration apply entry point is denied by the `denied_by_provenance_audit` gate, even when historical confirmation tokens are supplied.

Future event-time metadata belongs in a memory-engine-owned sidecar table, not in the OpenClaw core schema. The sidecar must preserve provenance, confidence, and evidence status without mutating core rows.

## Accepted Evidence

An exact event timestamp is accepted only when it comes from one of:

- A unique OpenClaw session transcript timestamp with exact chunk-id or equivalent exact message evidence.
- An explicit external timestamp with a verifiable source.
- An explicit human record with a verifiable source.

Smart-add path dates are at most `date_only` evidence and cannot become a fabricated timestamp. Legacy data may be represented as `exact`, `date_only`, or `unknown`; `unknown` is a valid state and must not be filled for completeness.

## Audit Basis

The 2026-06-15 provenance audit found 2,433 smart-add import/reindex rows with millisecond `updated_at` values concentrated into 112 seconds. The 2026-06-21 comparison found 3,229 flush-script/mixed rows with second-level `updated_at` values concentrated into four seconds. These are batch-write signatures, not reliable event dates. Session evidence did not validate the current recoverable pilot item.

The P45 reconciliation keeps the historical migration-impact count of 3,306 and reported recoverable count of 530 separate from the P44 provenance predicate of 3,229 rows and 267 exact session formula matches. The 77 row difference is UTC-date grouping versus the Asia/Shanghai day range. The 263 match difference is migration's historical union/recoverability count versus P44's exact session-formula-only count; 134 of the historical recoverable rows cannot be replayed from the current retained session corpus.

## Consequences

- Core migration dry-runs, provenance audits, evidence resolution, and label previews remain available and read-only.
- Core migration apply is unavailable until this ADR is explicitly superseded by a future decision and the gate is changed in code.
- Existing raw-log records retain their historical fields; no automatic event-time backfill is performed.
- Future sidecar work must define its schema and write guard before any apply workflow is introduced.

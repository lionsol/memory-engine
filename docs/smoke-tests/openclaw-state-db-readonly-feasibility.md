# OpenClaw State-DB Read-Only Feasibility

## Scope

This is a synthetic-only feasibility harness for B8-A7-R2B. It tests whether an independent `node:sqlite` read-only connection could read a committed `installed_plugin_index` row without observable database, WAL, SHM, journal, sidecar, or directory changes. It does not implement a production reader and does not read OpenClaw state.

The harness is implemented in `lib/ops/sqlite-readonly-feasibility.js` and exposed by `bin/run-openclaw-state-db-readonly-feasibility-smoke.js`. It does not import OpenClaw, memory-engine, a plugin loader, or a database runtime from the host.

## Why `readOnly=true` Is Necessary but Not Sufficient

Every reader scenario opens the synthetic database with `readOnly: true`, and write attempts are expected to be rejected. That option alone does not prove that SQLite will avoid all filesystem side effects, that a WAL-aware reader will see the latest committed row, or that an immutable URI is safe for a concurrently changing database. The harness fingerprints the database, sidecars, and directory entries before and after each read and treats any observable change as a blocker.

The harness does not claim that filesystem fingerprints prove absence of lower-level write syscalls. A non-blocked synthetic result is therefore only:

```text
B8-A7-R2B filesystem-observable feasibility=PROVISIONAL / SYSCALL PROOF REQUIRED
```

## Synthetic-Only Safety Boundary

The runner creates a private temporary directory using the `memory-engine-r2b-*` prefix and uses only `r2b-synthetic-state.sqlite`. It accepts only `--json`; it does not accept a database path, state directory, or positional argument. It does not read related environment variables, execute an OpenClaw command, load a plugin, read configuration, access either production database, initialize LanceDB, install/reload anything, or write a report outside its stdout.

The temporary directory is removed in a `finally` block on success and failure. Absolute temporary paths and synthetic install paths are not included in the report.

## Fixture Schema

Each scenario creates the following synthetic table:

```sql
CREATE TABLE installed_plugin_index (
  index_key TEXT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL,
  host_contract_version TEXT NOT NULL,
  compat_registry_version TEXT NOT NULL,
  migration_version INTEGER NOT NULL,
  policy_hash TEXT NOT NULL,
  generated_at_ms INTEGER NOT NULL,
  refresh_reason TEXT,
  install_records_json TEXT NOT NULL,
  plugins_json TEXT NOT NULL,
  diagnostics_json TEXT NOT NULL,
  warning TEXT,
  updated_at_ms INTEGER NOT NULL
);
```

The fixed synthetic record is `index_key=plugin-registry` and `plugin_id=memory-engine-synthetic`. Its install and source paths are synthetic placeholders and are never real runtime paths.

## Fingerprint Method

Before and after every reader operation, the harness records relative path, existence, file type, mode, inode, link count, byte size, `mtime_ns`, `ctime_ns`, and SHA-256 for files. Stat values use BigInt nanosecond precision and are serialized as strings to avoid unsafe integer conversion. It includes the database, `-wal`, `-shm`, `-journal`, and directory entries. Access time is intentionally excluded because a normal read may update it without representing a content or metadata write. Failed opens and queries still produce an after fingerprint and comparison.

The report separates:

```text
new_files
deleted_files
content_changed_files
metadata_changed_files
sidecar_created
observable_write_detected
```

Any relevant fingerprint change is observable-write evidence and blocks the feasibility result.

## WAL/SHM Risk Model

The matrix includes a clean rollback-journal database, a WAL database with an uncheckpointed committed row and existing WAL/SHM files, and a WAL copy with the SHM file absent. The reader must see the latest committed WAL row and must not create or change any sidecar. A changed SHM file is reported and fails the zero-write requirement; it is not treated as harmless coordination.

The WAL experiment is synthetic and does not prove behavior against an OpenClaw database. Freshness is proven only by an exact distinct revision marker: checkpointed `checkpointed-A` versus WAL-committed `wal-committed-B`, not by a positive timestamp or a shared install path. It only identifies the facts that a future reader authorization would need to reproduce under syscall tracing.

## Immutable Risk Model

The `immutable-live-wal` scenario compares a normal WAL-aware read-only reader with an `immutable=1` URI read, then performs a post-open writer mutation from revision B to revision C while both readers remain open. Normal reader freshness requires B initially and C after the mutation. Immutable initial or post-open query failure, or failure to verify the synthetic table shape, blocks the required scenario. Immutable behavior is classified with location proof first, then query errors, then revision observations: A-to-A and B-to-B are retained stale snapshots, while B-to-C is a post-open update. It is never a production-reader candidate even if it sees C. Reader phase 1 and phase 2 fingerprints are compared separately so the writer's B-to-C mutation is not classified as reader write evidence. Both connection targets are verified with `database.location()`.

The following rule remains mandatory regardless of the synthetic result:

```text
immutable=1 must not be used against a live concurrently mutable OpenClaw state database unless immutability is independently guaranteed
```

## Scenario Matrix

| Scenario | Required observation |
|:---|:---|
| `missing-database` | Read-only open does not create the database or sidecars. |
| `rollback-journal` | Query sees the committed row; SQL writes and DDL are rejected; files are unchanged. |
| `wal-latest-committed-row` | Latest committed WAL row is visible; WAL/SHM changes block. |
| `wal-without-shm` | Open/query result and any SHM creation or WAL change are recorded explicitly. |
| `non-writable-directory` | Keep a WAL/SHM fixture open, enforce ordinary-user directory permissions where possible, and record permission/filesystem evidence; otherwise report `SKIPPED`, not pass. |
| `immutable-live-wal` | Compare normal and immutable visibility across a post-open B-to-C mutation, verify both locations, separate reader phase fingerprints, and retain the immutable safety rule. |

## Decision Rules

The decision is immediately blocked if any required scenario is blocked or skipped, if a reader creates or changes database/WAL/SHM/journal files, if the latest committed WAL row is not visible, if a read-only open requires directory write access, or if a required result is inconclusive.

The SQL probe reports independent `INSERT`, `UPDATE`, `DELETE`, and DDL rejection; all four must be true for `sql_write_rejected=true`:

```text
sql_write_rejections={insert, update, delete, ddl}
```

The immutable scenario constructs a URL with `pathToFileURL()` and an explicit `immutable=1` query parameter, verifies the synthetic table, and records normal and immutable revisions separately. If URI semantics cannot be proven, it blocks rather than silently falling back.

The only non-blocked result is provisional:

```text
B8-A7-R2B filesystem-observable feasibility=PROVISIONAL / SYSCALL PROOF REQUIRED
```

This harness can never emit `FEASIBLE`, `ACCEPTED`, or an authorization to implement a production reader. A blocked result is:

```text
B8-A7-R2B standalone read-only live state-DB reader feasibility=BLOCKED / ZERO-WRITE OR FRESHNESS NOT PROVEN
```

## Experimental Evidence Record

The EDI synthetic run recorded this environment:

```text
Node=v24.8.0
NODE_MODULE_VERSION=137
SQLite=3.50.4
HEAD=908c846
```

The scenario summary was:

```text
missing-database=PASS
rollback-journal=PASS
wal-latest-committed-row=BLOCKED / existing SHM content changed
wal-without-shm=BLOCKED / SHM created
non-writable-directory=BLOCKED / existing SHM content changed
immutable-live-wal=BLOCKED / normal reader modified SHM; immutable reader retained checkpointed-A
```

The freshness evidence was:

```text
normal reader:
  initial=wal-committed-B
  post-update=wal-post-open-C

immutable reader:
  initial=checkpointed-A
  post-update=checkpointed-A
  behavior=retained-stale-snapshot
  candidate_allowed=false
```

The current decision is:

```text
B8-A7-R2B synthetic harness verification=EXPERIMENTAL EVIDENCE VALID / ASSERTION ALIGNMENT IMPLEMENTED / EDI CLOSURE PENDING
B8-A7-R2B standalone read-only live state-DB reader feasibility=BLOCKED / ZERO-WRITE OR FRESHNESS NOT PROVEN
synthetic syscall trace=NOT REQUIRED FOR R2B FEASIBILITY DECISION
synthetic syscall trace diagnostic execution=NOT AUTHORIZED
standalone production reader=NOT AUTHORIZED
real OpenClaw state-DB access=NOT AUTHORIZED
host remediation execution=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

Directory non-writability does not imply that an existing SHM file cannot be modified. Filesystem fingerprints already establish observable SHM writes; a syscall trace may diagnose the mechanism but is not required to reject the current zero-write design.

## EDI Execution Instructions

EDI may run the synthetic-only command after reviewing the source and contract tests:

```bash
node bin/run-openclaw-state-db-readonly-feasibility-smoke.js --json
npm run smoke:openclaw-state-db-readonly
```

EDI must preserve the JSON result, record the Node and SQLite versions, review every scenario and blocker, and separately arrange a synthetic-only syscall trace if the filesystem-observable result is not blocked. EDI must not substitute a real state database, an OpenClaw CLI command, a plugin import, or a loaded runtime for this experiment.

## Result Template

```text
schema_version:
generated_at:
node_version:
node_module_version:
sqlite_version:
scenario_summary:
observable_write_detected:
latest_committed_wal_row_visible:
decision:
blockers:
syscall_trace_status:
```

## Continuing Authorization Boundary

```text
B8-A7-R2B synthetic feasibility harness=MODULE-BOUNDARY FIXES IMPLEMENTED / EDI RE-VERIFICATION PENDING
previous EDI run=FAILED BEFORE HARNESS ENTRY / NON-AUTHORITATIVE
synthetic syscall trace=NOT AUTHORIZED
standalone production reader=NOT AUTHORIZED
real OpenClaw state-DB access=NOT AUTHORIZED
host remediation execution=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

This document does not authorize a production reader, OpenClaw state access, remediation execution, an evidence epoch, sustained runtime, or legacy fallback removal.

External references describe upstream semantics only and are not local experiment evidence:

* [Node `node:sqlite`](https://nodejs.org/api/sqlite.html)
* [SQLite WAL](https://www.sqlite.org/wal.html)
* [SQLite URI filenames](https://www.sqlite.org/uri.html)

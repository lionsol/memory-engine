# L2 Database Boundary Closure — Implementation Design

> Status: `Implemented / source verified / deployed runtime qualified / CLOSED`
>
> Scope: close the remaining L2 Core / Engine runtime boundary and record its final qualification. This design does not authorize future deployment or persistent runtime activation.

## Decision

Ordinary production memory-engine runtime must not receive or open an Engine connection with OpenClaw Core attached.

The production data-access contract becomes:

```text
Core reads     -> isolated readonly Core handle
Engine reads   -> isolated Engine handle
Engine writes  -> isolated writable Engine handle
Core mutation  -> no direct production DB writer
                 explicit OpenClaw memory index sync only after source-file writes
```

Legacy combined Engine+attached-Core access may remain only for historical tests, offline audits/probes, or explicitly bounded maintenance compatibility. It must be unreachable from normal plugin/runtime wiring.

## Pre-change first-loss

Before this closure, production assembly created `database.withDb` through `withEngineDb()`. `openEngineDb()` attached Core as schema `core`, so `withDb` was a combined handle even when a caller only needed Engine state.

Production plugin wiring then uses that handle for:

- startup Engine table initialization and legacy event migration;
- memory event writes;
- AutoRecall reinforcement;
- memory-engine `add`, `cite`, `update`, `status`, `archive`, `kg-bridge`, `detect-conflicts`;
- `memory_engine_get`;
- Hybrid `withLegacyDb` fallback.

Hybrid isolated readers already exist and focused isolation tests pass. The closure therefore removes production access to the transitional handle rather than inventing another DB abstraction.

## L2 pass contract

L2 Database Boundary Closure passes when all four statements hold.

### 1. Production runtime has no combined DB capability

`index.js` and the canonical CLI service must not inject a combined `withDb`/`openEngineDb` capability into normal business logic.

Production Engine operations use `withEngineDbIsolated`; Core reads use `withCoreDbReadonly`.

### 2. Production Hybrid is isolated-only

The production `withHybridDbAccessScope` exposes only:

```text
withCoreDb
withEngineDb
capabilities
```

It does not expose `withLegacyDb`.

KG/Recent guard failure in the production isolated scope must fail closed / return no candidates rather than execute legacy combined SQL.

Legacy fallback code may remain reachable only through the legacy compatibility adapter used by tests/offline tooling.

### 3. Cross-store operations are split explicitly

Operations that currently rely on one SQL JOIN across Core and Engine must be rewritten as bounded read/merge/write steps.

Examples:

- `add`: Core reads indexed chunk ids -> Engine reads tracked ids -> Engine inserts missing lifecycle rows.
- `get`: Core prefix lookup -> Engine metadata lookup -> deterministic in-memory merge/order.
- `status`: Core id/count snapshot -> Engine lifecycle snapshot -> in-memory missing-confidence count.
- startup legacy memory-event migration: Core readonly legacy event read -> Engine-only insert transaction.
- conflict detection: Engine candidate-pair selection -> Core readonly text/path enrichment -> Engine conflict-flag update.

No cross-store atomicity is claimed. Core is source/index authority and Engine metadata is eventually consistent by existing reconciliation design.

### 4. Core writers are explicit and bounded

Normal runtime does not write Core SQLite directly.

The sanctioned normal writer is:

```text
canonical source file write
  -> explicit OpenClaw memory index / manager.sync
  -> Core index updated by OpenClaw-owned writer
```

Direct Core SQLite writers are maintenance-only exceptions:

- `core-chunk-time-migration` apply is permanently suspended by a fail-closed gate;
- `stale-quarantined-chunk-cleanup` is an explicit standalone cleanup CLI with apply confirmation and backup, not imported by production plugin/runtime entrypoints.

A static boundary test should fail if a direct writable Core module becomes reachable from normal production entrypoints.

## Implementation slices

### Slice A — Production DB runtime API

Change `lib/runtime/db-runtime.js` so the canonical runtime exposes explicit methods:

```text
withCoreDb
withEngineDbReadonly
withEngineDbWritable
withHybridDbAccessScope
```

Do not expose the combined `withDb` as a production business capability.

`lib/db/engine-db.js` may remain temporarily as a legacy/maintenance compatibility module while production imports move away from it.

### Slice B — Hybrid production hard closure

Change `createIsolatedHybridDbAccessScope()` so production access does not require or return `withLegacyDb`.

Keep a separate legacy adapter path only for compatibility tests/offline callers that explicitly supply `runtime.withDb` and do not use the production isolated scope.

Channel policy:

```text
production explicit isolated scope + isolation guard failure
  => fail closed / empty affected channel
  != legacy fallback
```

Do not require physical deletion of all legacy fallback code for L2.

### Slice C — Tool/action isolation

Refactor `createMemoryEngineExecute()` to consume explicit Core and Engine accessors.

Engine-only actions:

```text
cite
update
archive
kg-bridge
```

Cross-store actions:

```text
add
status
detect-conflicts
```

`search` already routes through Hybrid and follows Slice B.

For backwards-compatible unit fixtures, a legacy combined accessor may remain as a test-only fallback in the action factory, but production wiring must provide explicit isolated accessors and a static production-wiring test must prove the combined fallback is unreachable.

### Slice D — Get isolation

Refactor `memory_engine_get`:

1. query matching Core rows through readonly Core;
2. query Engine lifecycle metadata for candidate ids;
3. merge deterministically in memory;
4. preserve existing ambiguity and managed/external normalization semantics.

No combined SQL JOIN.

### Slice E — Startup/event/AutoRecall Engine-only writes

Use writable isolated Engine for:

- `ensureMemoryEngineTables`;
- event insertion;
- reinforcement prefix resolution / `batchReinforce`;
- normal Engine lifecycle mutations.

Refactor `migrateLegacyMemoryEventsFromCore` to accept separate Core-readonly and Engine-writable access instead of reading `core.memory_events` through an attached schema.

### Slice F — Conflict detection isolation

Split `detectRelatedConflicts` into storage-neutral phases:

1. select candidate id/category/confidence/hit pairs from Engine;
2. load Core text/path for involved ids through readonly Core;
3. calculate overlap in memory;
4. update Engine conflict flags.

The standalone Nightly Maintenance ownership change for preference conflicts remains separate later work; this slice only removes the combined DB dependency.

## Compatibility and non-goals

This L2 closure does not:

- delete `openEngineDb()` immediately;
- remove every audit/probe/migration `ATTACH` statement;
- execute the historical B8-B 30-day legacy-code removal gate;
- change retrieval ranking or candidate semantics;
- enable AutoRecall;
- enable mutating Nightly Maintenance;
- modify the Core schema;
- create a new database or canonical-memory table;
- deploy/reinstall the plugin.

The distinction is deliberate:

```text
L2 closure = normal production runtime cannot use combined DB
B8-B removal = physically delete legacy fallback compatibility code
```

The former is required now. The latter is not.

## Verification

Minimum source-level verification:

1. focused isolated DB + Hybrid tests remain green;
2. tool/get/action tests prove explicit isolated accessors;
3. startup schema/event migration tests prove Core readonly + Engine writable split;
4. conflict detection tests prove equivalent pair/flag behavior with split access;
5. static production-wiring test proves `index.js` and CLI service do not inject production combined DB access;
6. static Core-writer boundary test proves normal runtime entrypoints do not import direct writable Core maintenance modules;
7. full test suite because DB/runtime/tool/retrieval shared behavior changes.

Source verification was followed by the final separately authorized runtime qualification recorded below. This design does not authorize future deployment or persistent runtime activation.

## Implementation result — 2026-08-18

Source-level closure is complete in the current worktree:

- `createMemoryEngineDbRuntime()` no longer exposes combined `withDb` / `openDb`; it exposes isolated `withCoreDb`, `withEngineDbReadonly`, and `withEngineDbWritable`.
- production Hybrid isolated scope no longer exposes `withLegacyDb`; explicit production guard failure suppresses legacy fallback while direct legacy audit/test callers retain compatibility behavior unless they explicitly disable it.
- plugin and canonical CLI wiring no longer inject combined DB access into Hybrid or action paths.
- `memory_engine.add`, `status`, `get`, startup legacy-event migration, AutoRecall reinforcement, and conflict detection split Core and Engine work explicitly.
- Console storage/memory/metrics/trace paths use isolated Core/Engine access and preserve unified Engine + legacy Core event semantics.
- current `nightly-maintenance-command.cjs` uses isolated handles with Engine readonly during `--dry-run`; no Core ATTACH remains.
- normal production entrypoint static tests keep direct writable Core maintenance modules unreachable.

Verification:

```text
git diff --check=PASS
Node 24 full suite: total=1875 pass=1867 fail=0 skipped=8
```

No plugin reinstall, Gateway mutation, or persistent activation was performed by the source change itself. The final deployed runtime qualification was completed separately and is recorded below.

## Final runtime qualification result — 2026-08-18

`PASS` — **L2 COMPLETE** at active runtime source parity `64596f4`. Gateway was `READY`; `AutoRecall=false`; Hybrid runtime had `KG_ACCESS_MODE=isolated`, `RECENT_ACCESS_MODE=isolated`, and production legacy fallback `0`. The current Nightly dry-run isolated topology passed, and no unexpected memory/confidence mutation was observed.

## Independent tool-policy observation

This observation is historical/pre-existing and has no causal relationship to L2 DB boundary qualification: `tools.catalog` registration is complete, while `tools.profile=coding` causes `tools.effective` to filter tools from the `main` model. No `alsoAllow` or config change is authorized; this is an independent future product-policy decision.

### Subsequent resolution

After L2 closure, main-only `memory_engine_search` / `memory_engine_get` availability was runtime-qualified `PASS`, resolving the tool-policy gap without altering the historical L2 evidence or its causal classification.

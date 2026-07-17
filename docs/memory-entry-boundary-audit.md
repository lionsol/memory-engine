# Memory Entry Boundary Audit

## Scope and target boundary

This document establishes the P1-A Step 2 baseline for memory-engine entrypoints. It is an inventory and governance contract; it is not the legacy entrypoint migration.

The target architecture is:

```text
OpenClaw tools / approved CLI adapters / scheduled entrypoints
                         ↓
              canonical action/service layer
                         ↓
        isolated Core readonly / Engine access
```

The canonical runtime action layer for the plugin is:

```text
lib/tools/memory-engine-actions.js
```

`index.js` bootstraps the plugin and injects dependencies. `lib/tools/register-memory-engine-tools.js` declares the tool surface. Neither is an alternate action implementation.

Production entrypoints must not:

- implement a second add/search/update/archive/status/diagnose action stack;
- treat `~/.openclaw/memory/main.sqlite` as a writable business database;
- bypass the canonical action/service layer;
- silently fall back to old business logic when the canonical entrypoint is unavailable;
- create multiple business-implementation forks by copying scripts.

## Entrypoint inventory

| Path | Classification | Current status | Follow-up |
| --- | --- | --- | --- |
| `index.js` | plugin bootstrap | canonical | Retain; dependency injection and registration orchestration only |
| `lib/tools/register-memory-engine-tools.js` | tool registration | canonical | Retain; declaration-oriented registration only |
| `lib/tools/memory-engine-actions.js` | runtime action layer | canonical runtime | Retain; continue auditing DB access and action/service boundaries |
| `bin/memory-engine.js` | legacy production CLI | legacy compatibility shim | P1-A Step 4: retain compatibility while extracting the shared service |
| `skills/scripts/memory-engine.js` | legacy skill CLI | legacy compatibility shim | P1-A Step 4: retain compatibility while extracting the shared service |
| `bin/memory-engine-cli.js` | transitional/admin CLI | partially migrated | P1-A Step 4: extract shared service or refactor as an adapter |
| `bin/nightly-maintenance.js` | legacy lifecycle entrypoint | unsafe legacy | P1-A Step 5: migrate to canonical maintenance service |
| `bin/nightly-maintenance-command.cjs` | explicit maintenance command | conditionally allowed | Keep outside plugin runtime; later converge with canonical maintenance service |

The first seven rows are the required baseline inventory. The command-safe nightly file is also registered because it is a production-like scheduled/administrative entrypoint present in `bin/`.

### Canonical runtime uniqueness

`lib/tools/memory-engine-actions.js` is the unique canonical action layer for the current plugin runtime. The registration module may expose the action schema and wrappers, but it must not grow a second implementation. `bin/memory-engine-cli.js` is not declared canonical: it remains a transitional/admin adapter until service extraction is complete.

### Legacy entrypoint baseline

The following is the remaining explicitly known legacy production bypass:

- `bin/nightly-maintenance.js`

P1-A Step 3 removed the duplicated business implementations from the two memory-engine CLI paths. Both now directly invoke `bin/memory-engine-cli.js`, preserve argv/environment/stdin/stdout/stderr and child status, and fail closed when the canonical CLI is unavailable. They remain compatibility entrypoints, not canonical action layers.

## Maintenance utility exception

Not every script that reads Core DB data is a production violation. The following utility classes may remain as maintenance tools:

- audit;
- probe;
- migration;
- preview;
- cleanup;
- repair;
- benchmark;
- export;
- reconciliation.

The exception applies only when all of these conditions hold:

1. The file's purpose is explicit from its name and documentation.
2. It is not called implicitly by plugin runtime, tool registration, or an ordinary skill.
3. Any write operation has an explicit apply/confirmation mechanism or follows an existing safety protocol.
4. The default mode is read-only whenever practical.
5. The DB path is configurable or obtained through a shared resolver.
6. The file is not presented as an ordinary production CLI.
7. The file is not used as a legacy fallback.

The static contract therefore treats clearly named `audit`, `probe`, `migration`, `preview`, `cleanup`, `repair`, `benchmark`, `export`, and reconciliation utilities as conditionally allowed. It still tracks production-like names such as `memory-engine*` and `nightly-maintenance*`, even when they contain maintenance operations.

## Static contract

`test/memory-entry-boundary-contract.test.js` is deliberately a pure source/document test. It reads only the repository files and checks:

- all baseline entrypoints are registered in this document;
- canonical runtime files do not hard-code the Core DB path;
- tool registration stays declarative and does not open/attach SQLite;
- the two legacy memory-engine files remain explicitly classified as compatibility shims and are included in the migration scope;
- new production-like files in `bin/` or `skills/scripts/` cannot appear without inventory registration;
- canonical runtime uniqueness is stated without falsely promoting the transitional/admin CLI;
- missing-canonical-entrypoint behavior is fail-closed, with no silent legacy fallback and no copied business logic in a shim.

This is an inventory guard plus the Step 3 shim contract. It does not promote the transitional/admin CLI to the final canonical service.

## Fail-closed rule

If the canonical entrypoint is missing, the caller must fail closed. It must not silently fall back to an old business implementation. A legacy shim must not copy business logic; it may only delegate, propagate arguments/environment, or fail with an explicit error.

## Explicit non-goals for P1-A Step 2 baseline

The following were non-goals of the completed Step 2 inventory baseline; they remain useful historical scope markers:

This phase does not:

- replace legacy files;
- delete commands;
- migrate nightly maintenance;
- change help text or exit codes;
- change the database schema;
- remove attached-Core compatibility;
- disable KG or Recent fallback;
- modify AutoRecall;
- access a real database.

Step 3 changes only the two legacy CLI files and their inventory/test contracts. It does not modify the transitional/admin CLI, nightly lifecycle, runtime actions, retrieval, fallback, schema, or database behavior.

## Planned migration order

```text
P1-A Step 2  inventory + contract (completed)
P1-A Step 3  legacy CLI thin shim (completed)
P1-A Step 4  canonical/admin CLI service extraction
P1-A Step 5  nightly lifecycle migration
P1-A Step 6  final entrypoint audit
```

P1-A is not closed: the transitional/admin CLI and nightly lifecycle still require the later migration steps.

## Audit findings after Step 3

- The two memory-engine CLI scripts are compatibility shims that directly invoke `bin/memory-engine-cli.js`; their duplicated business logic was removed in P1-A Step 3.
- `bin/nightly-maintenance.js` is a legacy lifecycle implementation with direct Core DB access.
- `bin/memory-engine-cli.js` is transitional/admin and still contains its own DB orchestration; it is not the canonical runtime layer.
- `bin/nightly-maintenance-command.cjs` is a separately registered command-safe maintenance path and must remain explicitly invoked rather than implicitly loaded by runtime registration.
- No additional unregistered production-like file was accepted into this baseline inventory.

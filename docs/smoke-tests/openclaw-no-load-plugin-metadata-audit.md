# B8-A7-R2A OpenClaw No-Load Plugin Metadata Source Audit

> **B8-A7-R2A existing OpenClaw metadata API=BLOCKED / REVIEW FIXES IMPLEMENTED**
>
> **B8-A7-R2B standalone read-only state-DB reader feasibility=NOT STARTED**
>
> **host remediation execution=NOT AUTHORIZED**
>
> **B8-A7 sustained runtime authorization=WITHHELD / REMEDIATION REQUIRED**
>
> **B8-A7 sustained runtime window=NOT AUTHORIZED**
>
> **B8-B removal=NOT AUTHORIZED**

## Scope

This is a static source audit of the locally installed OpenClaw 2026.6.9 package. It determines whether a report-only reader could obtain the installed memory-engine runtime path, source path, version, and installation time without loading plugin code or accessing runtime storage.

The audit did not execute an OpenClaw command, import OpenClaw plugin discovery or loader modules, import memory-engine, access either memory database, initialize LanceDB, refresh or repair registry state, modify configuration, or start a runtime.

The stable source references below use logical source module and function names. Current hashed files under openclaw/dist/ are implementation artifacts, not a long-term filename contract.

## Local OpenClaw Identity

The inspected installation root is:

~~~text
/home/lionsol/.local/lib/node_modules/openclaw
~~~

The audit inspected its package.json, bundled dist/ modules, declaration files, and source-region annotations such as:

~~~text
src/plugins/plugin-registry-snapshot.ts
src/plugins/installed-plugin-index-store.ts
src/plugins/installed-plugin-index-record-reader.ts
src/plugins/installed-plugin-index-types.ts
src/config/paths.ts
src/state/openclaw-state-db.paths.ts
src/plugins/status-snapshot.ts
~~~

## Candidate Source

The candidate API is the logical loadPluginRegistrySnapshotWithMetadata() path in src/plugins/plugin-registry-snapshot.ts, with loadPluginRegistrySnapshot() as its snapshot-only wrapper. The plugin registry CLI delegates to inspectPersistedInstalledPluginIndex(), which is not a pure metadata read and is explicitly outside this audit's allowed operations.

The installed-index record reader exposes the logical helpers:

~~~text
resolveInstalledPluginIndexStorePath()
resolveInstalledPluginIndexStateDatabaseOptions()
resolveLegacyInstalledPluginIndexStorePath()
readPersistedInstalledPluginIndexInstallRecordsSync()
~~~

These names identify the inspected implementation only. They are not an accepted no-load interface.

## Static Call-Path Evidence

The relevant path is:

~~~text
loadPluginRegistrySnapshotWithMetadata()
  -> readPersistedInstalledPluginIndexSync()
       -> readPersistedInstalledPluginIndexFromSqlite()
            -> openOpenClawStateDatabase()
            -> db.prepare(SELECT ... FROM installed_plugin_index ...)
  -> stale-source/policy/metadata checks
  -> loadInstalledPluginIndexWithDiscovery() when persisted data is missing or stale
~~~

The install-record recovery path also calls:

~~~text
loadInstalledPluginIndexInstallRecordsSync()
  -> readPersistedInstalledPluginIndexForRecords()
       -> openOpenClawStateDatabase()
       -> db.prepare(SELECT ... FROM installed_plugin_index ...)
~~~

The concrete persisted-index helper path is:

~~~text
readPersistedInstalledPluginIndexFromSqlite()
  -> openOpenClawStateDatabase()
~~~

The inspected openOpenClawStateDatabase() implementation does not establish a passive file-reader contract. It opens a DatabaseSync connection without readOnly=true, calls ensureOpenClawStatePermissions, configures SQLite connection pragmas, calls ensureSchema, and caches the connection. These permission, WAL/pragmas, schema, and connection-cache operations are outside the Phase 0 no-load boundary even when the eventual query is a read.

The plugin registry command calls inspectPersistedInstalledPluginIndex(), which reads persisted state and builds a current index for comparison. It is therefore not a pure file metadata API, regardless of the command name inspect.

## Registry Path Resolution

The current canonical installed-plugin index is not a JSON file. The static path chain is:

~~~text
resolveStateDir(env)
  -> OPENCLAW_STATE_DIR when set
  -> ~/.openclaw when present
  -> legacy ~/.clawdbot when that is the existing state directory
  -> ~/.openclaw as the default

resolveOpenClawStateSqlitePath(env)
  -> <resolved state root>/state/openclaw.sqlite

resolveInstalledPluginIndexStorePath(options)
  -> explicit options.filePath when supplied
  -> resolveOpenClawStateSqlitePath(...)
~~~

The legacy JSON path is:

~~~text
<resolved state directory>/plugins/installs.json
~~~

but the implementation marks explicit JSON store paths as retired and directs migration through the shared SQLite state database. It is not the current authoritative store. No path is selected from a guessed ~/.openclaw filename, a conventional extensions directory, or a first-match filesystem search.

## Snapshot Schema

The recognized installed-index schema is version 1 with migration version 1. The persisted index contains:

~~~text
version
hostContractVersion
compatRegistryVersion
migrationVersion
policyHash
generatedAtMs
refreshReason
installRecords
plugins
diagnostics
~~~

An installed plugin record contains, among other validated fields:

~~~text
pluginId
manifestPath
manifestHash
rootDir
origin
enabled
startup
contributions
compat
packageName
packageVersion
packageJson
installRecordHash
packageInstall
~~~

The nested install record can contain:

~~~text
source
sourcePath
installPath
version
installedAt
resolvedVersion
integrity
shasum
gitCommit
package and marketplace provenance
~~~

installPath, sourcePath, version, and installedAt are persisted install-record facts when present. enabled is derived from the normalized plugin configuration and policy when the current index is built. Manifest contributions, package metadata, and effective activation state are not all equivalent to persisted install facts.

## No-Load Side-Effect Audit

The existing OpenClaw registry/snapshot API fails the required Phase 0 pure-file contract:

* the canonical persisted index is read from SQLite through openOpenClawStateDatabase() and SQL preparation;
* that helper opens the state database without an explicit readOnly=true contract and may ensure permissions, configure SQLite pragmas, ensure schema, and cache a writable connection;
* loadPluginRegistrySnapshotWithMetadata() performs stale policy, source, manifest, package, diagnostics, config-path, bundled-root, and recovered-install checks;
* missing or stale persisted data falls back to loadInstalledPluginIndexWithDiscovery();
* the discovery path reads plugin roots and manifests and is a plugin discovery path, not a proven passive file reader;
* inspectPersistedInstalledPluginIndex() builds a current index for comparison rather than returning only persisted bytes;
* refresh and doctor paths can migrate, repair, or write state and are explicitly disallowed here.

The inspected code does not provide a proven path satisfying all of:

~~~text
does not import plugin entrypoint
does not call plugin discovery
does not register plugin
does not initialize plugin
does not execute plugin package code
does not access memory-engine/core DB
does not initialize LanceDB
does not mutate registry/state/config
~~~

SQLite-backed metadata does not by itself prove that plugin code is loaded. The demonstrated blockers are the existing helper's database-open/permission/schema/WAL behavior and the snapshot loader's discovery fallback. No-load has not been proven for the existing API.

## Authority and Staleness Analysis

The persisted index is intended by OpenClaw to be authoritative installation metadata for its own registry policy, and its schema validates the plugin id and install record shape. It is not sufficient for this remediation baseline because:

* its canonical storage is a SQLite state database, not a pure file;
* loadPluginRegistrySnapshotWithMetadata() treats policy mismatch, missing source/manifest files, mismatched bundled roots, stale diagnostics, missing config-path activation metadata, stale manifest/package signatures, and missing recoverable install records as reasons to use derived discovery;
* policyHash, compatRegistryVersion, migrationVersion, file signatures, and generated time can make a persisted record stale;
* installPath and sourcePath are optional nested strings and do not by themselves establish an acceptable absolute canonical path or a resolved symlink policy;
* a persisted record can lag the installed directory, while determining the current truth requires checks that may enter discovery or loaded-runtime behavior.

Pure-file checks that could be deferred to a future reader include ordinary-directory status, canonical path resolution, symlink policy, package/build identity, and file existence. They cannot repair a missing, stale, or policy-mismatched registry, and they cannot turn the current SQLite-backed implementation into a pure-file source.

## Decision

~~~text
B8-A7-R2A existing OpenClaw metadata API=BLOCKED / REVIEW FIXES IMPLEMENTED
B8-A7-R2B standalone read-only state-DB reader feasibility=NOT STARTED
host remediation execution=NOT AUTHORIZED
~~~

The current OpenClaw registry/snapshot API is not acceptable for Phase 0:

~~~text
Existing OpenClaw registry/snapshot API=BLOCKED FOR PHASE 0
~~~

Do not use:

~~~text
openclaw plugins inspect
openclaw plugins list
openclaw plugins registry
conventional ~/.openclaw/extensions paths
current config guesses
filesystem search selecting the first memory-engine directory
~~~

## Fail-Closed Blockers

The following blockers apply to a future reader until a supported source is identified:

~~~text
registry path is not a pure-file source
canonical registry requires SQLite state access
no-load property is not proven
missing/stale registry requires derived discovery
registry policy mismatch may require refresh
installPath/sourcePath are optional nested metadata
installPath symlink policy is not established for a reader
registry state can be missing, malformed, or unsupported
~~~

If any future reader cannot resolve and validate all required metadata, it must return:

~~~text
installed runtime metadata=no-load source unavailable
Phase 0 result=blocked
host remediation execution=NOT AUTHORIZED
~~~

## R2B Registration

The next phase is registered but not implemented:

~~~text
B8-A7-R2B: standalone read-only OpenClaw state-DB reader feasibility audit
standalone read-only state-DB reader feasibility=NOT ASSESSED
~~~

Its future audit must cover:

~~~text
node:sqlite readOnly=true
file-must-exist behavior
WAL and SHM behavior
schema-version validation
fixed index_key
policyHash and generatedAt staleness
duplicate/malformed records
absolute installPath validation
symlink policy
zero writes and zero discovery
~~~

## Conditional Future Reader Design

No reader is implemented by this audit. A standalone read-only OpenClaw state-DB reader may be feasible, but its feasibility is NOT ASSESSED. It must not be inferred from the existing helper and is not authorized by this document. If R2B proves a safe implementation, a report-only reader may accept an explicit, already-resolved state database path and an expected plugin id of memory-engine.

Its output contract would be:

~~~text
schema_version
checked_at
source_type
registry_path
registry_sha256
registry_byte_count
registry_schema_version
plugin_id
install_path
source_path
installed_version
installed_at
valid
blockers
~~~

The reader must read only one explicitly authorized ordinary file, never output the registry body or other plugin records, omit secrets, avoid OpenClaw loader imports and CLI execution, and never refresh, migrate, repair, write state, or guess paths. Duplicate records, schema ambiguity, missing fields, non-absolute/unresolvable paths, missing directories, and unresolved symlink policy must fail closed.

## Continuing Authorization Boundary

This audit only determines the status of the existing metadata API and registers R2B. It does not authorize implementing or executing a reader, changing configuration, installing/reloading the plugin, creating a scheduler, enabling an evidence epoch, starting A7, or entering B8-B.

~~~text
B8-A7-R2A existing OpenClaw metadata API=BLOCKED / REVIEW FIXES IMPLEMENTED
B8-A7-R2B standalone read-only state-DB reader feasibility=NOT STARTED
host remediation execution=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD / REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
~~~

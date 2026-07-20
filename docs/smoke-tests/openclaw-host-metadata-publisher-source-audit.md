# B8-A7-R3B Host Integration-Point Source Audit

## Scope

This is a source-only audit of the locally installed OpenClaw `2026.6.9` implementation. It does not execute OpenClaw, import its modules, load memory-engine, access host state, create a manifest, or modify configuration. Built `dist` filenames contain content hashes and are evidence for this installed build only; the function and source-region names are the durable references.

The audit asks whether the host currently has a credible integration point that can publish the R3A ordinary-file manifest without loading plugin entrypoints or accessing plugin runtime state.

## Audited Files and Functions

The following installed-build files and source regions were read statically:

```text
dist/plugins-install-command-*.js
  runPluginsInstallAction / runPluginInstallCommand
dist/plugins-install-persist-*.js
  persistPluginInstall
dist/plugins-install-record-commit-*.js
  commitPluginInstallRecordsWithWriter
  commitPluginInstallRecordsWithConfig
dist/plugins-update-command-*.js
  runPluginUpdateCommand
dist/plugins-uninstall-command-*.js
  runPluginUninstallCommand
dist/plugins-cli.runtime-*.js
  runPluginsEnableCommand
  runPluginsDisableCommand
  runPluginsRegistryCommand
dist/plugins-registry-refresh-*.js
  refreshPluginRegistryAfterConfigMutation
dist/installed-plugin-index-records-*.js
  writePersistedInstalledPluginIndexInstallRecords
dist/installed-plugin-index-store-*.js
  refreshPersistedInstalledPluginIndex
  writePersistedInstalledPluginIndexToSqlite
dist/installed-plugin-index-record-reader-*.js
  resolveInstalledPluginIndexStorePath
  loadInstalledPluginIndexInstallRecords
dist/plugin-registry-*.js
  loadPluginRegistrySnapshotWithMetadata
  loadInstalledPluginIndexWithDiscovery
dist/installed-plugin-index-*.js
  loadInstalledPluginIndexWithDiscovery
dist/server-startup-plugins-*.js
  prepareGatewayPluginBootstrap
dist/state-migrations-*.js
  runLegacyStateMigrations
  migrateLegacyInstalledPluginIndex
```

OpenClaw package identity observed during the audit:

```text
version=2026.6.9
source=installed dist build
execution=none
```

## Evidence Table

| Area | Evidence | Result |
| --- | --- | --- |
| install lifecycle | `runPluginInstallCommand` calls `persistPluginInstall`; records are committed and registry refresh follows | FOUND |
| update lifecycle | `runPluginUpdateCommand` commits changed install records and refreshes the registry | FOUND |
| uninstall lifecycle | `runPluginUninstallCommand` removes the record, removes the planned directory, then refreshes the registry | FOUND |
| enable/disable lifecycle | `runPluginsEnableCommand` and `runPluginsDisableCommand` mutate config and refresh policy state | FOUND |
| authoritative writer | `writePersistedInstalledPluginIndexToSqlite` is the shared SQLite index writer | FOUND for existing index; BLOCKED for R3A manifest |
| plugin-load independence | refresh and snapshot paths can enter discovery; startup path explicitly loads runtime plugins | BLOCKED |
| startup reconciliation | legacy migration exists, but no normal startup R3A manifest publication hook was found | BLOCKED |
| atomic publication hook | no host call to the R3A ordinary-file atomic publisher or equivalent was found | BLOCKED |

## Lifecycle Ownership

### Install

The install command is host-owned. The install flow reaches `persistPluginInstall`, which receives the host-computed `pluginId` and `params.install` record, merges it into the install-record map, and calls `commitPluginInstallRecordsWithConfig`. That commit path writes the persisted installed-plugin index through `writePersistedInstalledPluginIndexInstallRecords` and then `refreshPluginRegistryAfterConfigMutation` is called.

The record is therefore produced by the host install command, not by the memory-engine entrypoint. However, the complete command path also performs package/manifest handling and registry refresh. The source does not provide a separate no-load publication phase whose side effects are limited to an R3A manifest.

### Update

`runPluginUpdateCommand` loads the current records, updates selected plugin installs, commits changed records through the same install-record commit helper, and calls `refreshPluginRegistryAfterConfigMutation` when the plugin result changes. This is a usable lifecycle observation point, but not an existing R3A publisher contract.

### Uninstall

`runPluginUninstallCommand` loads records, builds a plugin snapshot for planning, removes the selected record, commits the config/index mutation, applies directory removal, and refreshes the registry. The pre-removal snapshot itself uses the normal plugin registry machinery, so plugin-load independence is not proven for the complete uninstall path.

### Enable and Disable

`runPluginsEnableCommand` and `runPluginsDisableCommand` update effective config and call `refreshPluginRegistryAfterConfigMutation` with `reason: "policy-changed"`. These paths know plugin identity and effective enabled state, but they do not publish an ordinary-file manifest and do not change installation facts such as version or install path.

## Existing Authoritative Writer

The existing persisted index writer is:

```text
writePersistedInstalledPluginIndexInstallRecords
  -> refreshPersistedInstalledPluginIndex
  -> writePersistedInstalledPluginIndex
  -> writePersistedInstalledPluginIndexToSqlite
  -> runOpenClawStateWriteTransaction
```

The writer owns the shared `installed_plugin_index` SQLite row. It writes `installRecords`, `plugins`, diagnostics, policy/version fields, and timestamps. The record map can contain `installPath`, `sourcePath`, `version`, `installedAt`, and enabled/config state, but the persisted index is an OpenClaw SQLite registry/index, not the R3A manifest.

The writer has multiple host callers for install, update, uninstall, migration, and compatibility flows. They converge on the same SQLite writer, but no ordinary-file manifest write is present. Therefore:

```text
single authoritative existing index writer=FOUND
single authoritative R3A manifest publisher=NOT FOUND
```

## Plugin-Load Boundary

The persisted index can be read by `readPersistedInstalledPluginIndexFromSqlite`, but the normal registry path does more than read it. `loadPluginRegistrySnapshotWithMetadata` checks policy, source roots, diagnostics, manifest/package signatures, and recoverable records. On missing or stale persisted data it calls `loadInstalledPluginIndexWithDiscovery`.

`refreshPluginRegistryAfterConfigMutation` calls `refreshPluginRegistry`, then invalidates runtime discovery by dynamically importing the plugin loader module. The startup path `prepareGatewayPluginBootstrap` consumes plugin metadata and proceeds to `loadGatewayStartupPluginRuntime` for configured startup plugins. That is an explicit runtime-load boundary.

Consequently, the existing registry refresh/snapshot flow cannot be used as proof of a no-plugin-load R3A publisher. A future publisher would need to consume host-owned install mutation data before registry discovery/runtime loading, or have a separately audited host callback with a strict no-load contract.

## Registry and Index Mechanisms

| Mechanism | Location / owner | Read path | Write path | Freshness model | Classification |
| --- | --- | --- | --- | --- | --- |
| persisted installed-plugin index | shared OpenClaw state SQLite, host-owned | `readPersistedInstalledPluginIndexFromSqlite` / record reader | `writePersistedInstalledPluginIndexToSqlite` | schema, policy hash, source/package signatures, diagnostics, generated time | persisted authoritative index for current OpenClaw registry |
| derived installed-plugin index | `loadInstalledPluginIndexWithDiscovery` | registry snapshot fallback | rebuilt by registry refresh | current filesystem/discovery inputs | derived cache/index, not authoritative manifest source |
| plugin registry snapshot | `loadPluginRegistrySnapshotWithMetadata` | persisted when fresh, otherwise derived | memoized in process; refreshes persisted index through registry refresh | memo key plus persisted invalidation checks | runtime snapshot, not R3A publication |
| legacy `plugins/installs.json` | legacy path handled by migration/doctor compatibility | legacy JSON reader when explicitly selected | migration/doctor paths | migration policy | retired compatibility source, not current publisher |

The state-directory resolver uses `resolveStateDir`, with `OPENCLAW_STATE_DIR` override and default/legacy state-directory selection. The installed index resolver maps that state target to the shared SQLite path. This confirms the existing index ownership model, but does not provide a real manifest path for R3A.

## Startup Reconciliation

`runLegacyStateMigrations` can call `migrateLegacyInstalledPluginIndex`, but this is a migration/repair path for legacy state, not a normal startup publisher for the R3A file. It can perform state migration and is not a proof of an atomic ordinary-file manifest publication hook.

`prepareGatewayPluginBootstrap` runs startup maintenance and then builds plugin activation state. For a normal gateway it proceeds to `loadGatewayStartupPluginRuntime`, which crosses the plugin runtime load boundary. No preceding call was found that reconciles authoritative install records into an R3A manifest before registry-ready/runtime loading.

Therefore:

```text
startup publisher hook absent
startup reconciliation for R3A=NOT FOUND
```

## Decision

The audit found real host lifecycle owners and a shared persisted SQLite index writer, but did not find a credible host-side R3A manifest publisher that is both atomic ordinary-file publication and independently proven not to enter discovery/plugin runtime paths. It also found no normal startup reconciliation hook for that manifest.

```text
B8-A7-R3B host publisher source=NOT FOUND / BLOCKED
```

This is a source-audit conclusion only. It does not authorize a host change, a reader, a manifest path, or a runtime experiment.

## Remaining Blockers

```text
R3B_HOST_MANIFEST_PUBLISHER_NOT_FOUND
R3B_NO_PLUGIN_LOAD_BOUNDARY_PROVEN
R3B_STARTUP_PUBLISHER_HOOK_ABSENT
R3B_ATOMIC_PUBLICATION_HOOK_ABSENT
R3B_REAL_METADATA_PATH_NOT_AUTHORIZED
```

The next design must identify one authoritative host writer, define publication timing for install/update/uninstall/enable/disable and authoritative absence, perform same-filesystem atomic replacement, and reconcile before registry-ready without importing plugin entrypoints or invoking discovery solely to publish metadata.

## Authorization Boundary

```text
B8-A7-R3A synthetic manifest contract=PASSED
B8-A7-R3B host integration source audit=NOT FOUND / BLOCKED
real host publisher=NOT AUTHORIZED
production manifest consumer=NOT AUTHORIZED
real OpenClaw metadata path=NOT AUTHORIZED
host integration=NOT STARTED
host remediation execution=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

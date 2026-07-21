# B8-A7-R5 OpenClaw Host Plugin Metadata Publisher Integration Design

> **Status: Accepted strict-profile reference / upstream implementation not planned for the personal deployment**
>
> Date: 2026-07-21
>
> Source baseline: installed OpenClaw `2026.6.9` dist and official `openclaw@2026.7.1-2` npm package
>
> Applicability update: the active single-operator route is [`adr/personal-deployment-safety-profile.md`](adr/personal-deployment-safety-profile.md). This design is retained for a future multi-user, unattended, or externally controlled deployment.

## Scope

This document defines the upstream OpenClaw host-core integration required by the strict R4 ownership profile. It specifies the publication target model, durable state, semantic commit boundary, ordinary-file contract, lifecycle integration, startup reconciliation barrier, failure semantics, test matrix, and upstream patch decomposition.

It does not modify OpenClaw, create a fork or worktree, publish a real manifest, implement a production memory-engine consumer, change runtime configuration, install or reload a plugin, start a sustained runtime window, or authorize B8-B removal.

## Decision Summary

The upstream design is:

```text
owner=OpenClaw host core
publication targets=explicit host-configured required plugin ids
source of install truth=durable installed-plugin install records
source of policy truth=committed host-owned plugin policy config
cross-storage coordination=SQLite durable publication outbox
file form=one canonical ordinary-file snapshot per required plugin id
startup behavior=mandatory reconciliation before plugin metadata discovery or runtime loading
consumer behavior=read-only and fail closed
```

The existing registry refresh path, plugin loader, plugin runtime, memory-engine entrypoint, direct SQLite reader, and filesystem discovery are not publication mechanisms.

Current stage state:

```text
B8-A7-R4 strict host ownership architecture=PASSED / CLOSED / REFERENCE ONLY
B8-A7-R5 strict host publisher integration design=PASSED / CLOSED / REFERENCE ONLY
B8-A7-R6 personal deployment safety profile=ACCEPTED
OpenClaw upstream implementation=NOT REQUIRED / NOT PLANNED FOR PERSONAL PROFILE
OpenClaw source modification=NOT AUTHORIZED
real host publisher=NOT REQUIRED FOR PERSONAL PROFILE
production manifest consumer=NOT REQUIRED FOR PERSONAL PROFILE
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

## Inspected Upstream Boundaries

The `2026.7.1-2` package still uses these logical source regions:

```text
src/plugins/installed-plugin-index-store.ts
src/plugins/installed-plugin-index-records.ts
src/plugins/installed-plugin-index-record-reader.ts
src/plugins/plugins-install-record-commit.ts
src/cli/plugins-registry-refresh.ts
src/plugins/plugin-registry-snapshot.ts
src/gateway/server-startup-config.ts
src/gateway/server-startup-plugins.ts
src/state/openclaw-state-schema.generated.ts
```

Observed behavior:

```text
commitPluginInstallRecordsWithWriter
  writes installed_plugin_index
  updates retained managed npm markers
  commits config
  rolls back index and marker changes on ordinary config-commit failure

refreshPluginRegistryAfterConfigMutation
  is best effort
  converts failures to warnings
  may rebuild registry state
  may enter discovery
  may dynamically import the plugin loader for cache invalidation

loadGatewayStartupConfigSnapshot
  calls readConfigFileSnapshotWithPluginMetadata
  may resolve plugin metadata and derived registry state before plugins.bootstrap

loadInstalledPluginIndexInstallRecords
  reads persisted install records
  also merges filesystem-recovered managed npm records
  is not an authority-only publication input

prepareGatewayPluginBootstrap
  performs startup maintenance
  builds activation state and plugin lookup
  reaches loadGatewayStartupPluginRuntime
```

Consequences:

- The low-level `installed_plugin_index` SQLite writer is too early to publish.
- Registry refresh is not an authoritative or fail-closed publication boundary.
- Inserting a barrier only before `prepareGatewayPluginBootstrap` is too late because plugin metadata resolution may already have entered discovery during config snapshot loading.
- The upstream change must split host-owned config/policy loading from plugin-metadata-dependent validation and discovery.
- Publication must read only durable persisted install records. It must not use `loadInstalledPluginIndexInstallRecords` or another helper that merges filesystem-recovered records; recovery becomes authoritative only after the host commits it through migration or repair.

## Design Invariants

The implementation must preserve all of these invariants:

```text
single authority
  OpenClaw host core is the only writer of authority and publication state

no plugin execution
  publication never imports or executes a plugin entrypoint

no publication-driven discovery
  publication never invokes plugin discovery to reconstruct authority

committed-state only
  ordinary files are never written from prepared or intermediate host state

crash detectability
  a crash between host-state commit and file replacement leaves durable work

idempotent retry
  retrying the same authority generation preserves generation and publication id

explicit absence
  required but missing or uninstalled plugins receive tombstones

orthogonal policy
  disabled means installed plus disabled, not absent

read-only consumer
  the consumer never repairs publication state

startup gate
  required publication mismatches block the dependent startup path
```

## Publication Target Policy

Publication must not expose every plugin path by default. OpenClaw should add a host-owned, plugin-independent configuration surface equivalent to:

```json
{
  "plugins": {
    "hostMetadata": {
      "requiredPluginIds": ["memory-engine"]
    }
  }
}
```

The exact public config spelling may change during upstream review, but the semantics are fixed:

- default is an empty list;
- ids are normalized and duplicate-free;
- malformed ids fail config validation;
- the list is readable without plugin manifests or plugin discovery;
- required ids remain meaningful when the plugin is disabled, absent, broken, or uninstalled;
- runtime-only auto-enable decisions do not modify authoritative publication policy;
- publication targets include current required ids and existing non-retired publication rows so uninstall and retirement can be reconciled.

Removing a plugin id from the required list is not file deletion. It produces one final `publication_state=retired` generation. The final file remains as an explicit terminal state and is rejected by an active production consumer. Automatic deletion is outside the R5 MVP.

## Host-Owned Path Contract

The proposed generic path contract is:

```text
<resolved OpenClaw state directory>/plugins/host-metadata/v2/<plugin-id-sha256>.json
```

Where:

```text
plugin-id-sha256=lowercase SHA-256 of the exact normalized UTF-8 plugin id
```

Requirements:

- the host resolves the state directory;
- the consumer receives an explicitly authorized final path and expected plugin id;
- no first-match filesystem search is permitted;
- no raw plugin id is used as a path component;
- publication directory mode is `0700` on POSIX;
- final file mode is `0600` on POSIX;
- temporary files are created in the same directory and filesystem;
- a valid final manifest must contain the expected exact plugin id.

This path is a proposed production contract. It is not active or authorized until accepted and implemented upstream.

## Production Manifest Contract v2

R3A proved the atomic ordinary-file algorithm, but its synthetic v1 state model must not be promoted unchanged. The production envelope separates authority, publication, installation, policy, and publication requirement state.

Representative installed state:

```json
{
  "schema_version": 2,
  "contract": "openclaw.host-plugin-install-metadata/v2",
  "plugin_id": "memory-engine",
  "authority": {
    "state": "available",
    "host_state_id": "64 lowercase hex characters",
    "generation": "7",
    "authority_sha256": "64 lowercase hex characters",
    "committed_at": "2026-07-21T00:00:00.000Z"
  },
  "publication": {
    "state": "active",
    "publication_id": "64 lowercase hex characters",
    "published_at": "2026-07-21T00:00:00.000Z"
  },
  "installation_state": "installed",
  "policy_state": "enabled",
  "install": {
    "metadata_complete": true,
    "missing_fields": [],
    "install_path": "/absolute/installed/path",
    "source_path": "/absolute/source/path",
    "version": "0.8.22",
    "installed_at": "2026-07-21T00:00:00.000Z",
    "install_record_sha256": "64 lowercase hex characters"
  },
  "absence_reason": null,
  "policy_hash": "64 lowercase hex characters"
}
```

Representative authoritative absence:

```json
{
  "schema_version": 2,
  "contract": "openclaw.host-plugin-install-metadata/v2",
  "plugin_id": "memory-engine",
  "authority": {
    "state": "available",
    "host_state_id": "64 lowercase hex characters",
    "generation": "8",
    "authority_sha256": "64 lowercase hex characters",
    "committed_at": "2026-07-21T00:10:00.000Z"
  },
  "publication": {
    "state": "active",
    "publication_id": "64 lowercase hex characters",
    "published_at": "2026-07-21T00:10:00.000Z"
  },
  "installation_state": "absent",
  "policy_state": "not_applicable",
  "install": null,
  "absence_reason": "uninstalled",
  "policy_hash": "64 lowercase hex characters"
}
```

Required state rules:

```text
installation_state=installed
  install is non-null
  absence_reason is null
  policy_state is enabled, disabled, or unknown

installation_state=absent
  install is null
  absence_reason is uninstalled or install-record-missing
  policy_state is not_applicable

publication.state=retired
  represents removal from requiredPluginIds
  is not installation absence
  must be rejected by an active consumer

disabled-by-host-policy
  is not a valid absence reason
```

The producer must not require live plugin manifest reads. `manifest_sha256` is therefore not an authoritative required field in v2. Runtime/source file identity remains a later consumer-side baseline operation after the published install path has been accepted.

If an installed record lacks a required consumer field, the host publishes the honest installed state with:

```text
metadata_complete=false
missing_fields=[sorted exact field names]
```

The host must not guess missing paths, versions, or timestamps. A memory-engine production consumer must reject incomplete installed metadata.

## Canonical Bytes and Hashes

The v2 canonical serializer retains R3A rules:

```text
UTF-8
lexicographically sorted object keys
array order preserved
two-space JSON
one trailing newline
no BOM
no NUL
maximum 64 KiB
```

Hashes and identifiers:

```text
install_record_sha256
  SHA-256 of canonical safe install-record fields

authority_sha256
  SHA-256 of canonical authority input excluding publication timestamps and ids

generation
  per-plugin monotonic integer stored as a decimal string in the manifest

publication_id
  SHA-256(host_state_id + NUL + plugin_id + NUL + generation + NUL + authority_sha256)

policy_hash
  host-owned hash of durable normalized plugin policy inputs
```

Reconciliation of the same authority content must not increment generation or change publication id.

## Durable Host State

OpenClaw should add a singleton host-publication identity, a semantic commit journal, and immutable per-plugin generation rows. A single mutable row per plugin is insufficient because a prepared next generation must not overwrite the last committed or published generation.

Proposed logical schema:

```text
host_plugin_metadata_state
  state_key TEXT PRIMARY KEY
  schema_version INTEGER NOT NULL
  host_state_id TEXT NOT NULL
  created_at_ms INTEGER NOT NULL
  updated_at_ms INTEGER NOT NULL

host_plugin_metadata_commits
  commit_id TEXT PRIMARY KEY
  reason TEXT NOT NULL
  phase TEXT NOT NULL
  previous_config_hash TEXT
  expected_config_hash TEXT NOT NULL
  committed_config_hash TEXT
  previous_install_records_json TEXT
  previous_install_records_sha256 TEXT
  next_install_records_sha256 TEXT
  prepared_at_ms INTEGER NOT NULL
  config_committed_at_ms INTEGER
  completed_at_ms INTEGER
  last_error_code TEXT
  updated_at_ms INTEGER NOT NULL

host_plugin_metadata_publications
  plugin_id TEXT NOT NULL
  generation INTEGER NOT NULL
  commit_id TEXT NOT NULL
  authority_sha256 TEXT NOT NULL
  desired_manifest_json TEXT
  desired_manifest_sha256 TEXT
  publication_id TEXT NOT NULL
  publication_state TEXT NOT NULL
  phase TEXT NOT NULL
  expected_policy_hash TEXT NOT NULL
  authority_observed_at_ms INTEGER
  published_at_ms INTEGER
  published_manifest_sha256 TEXT
  last_error_code TEXT
  updated_at_ms INTEGER NOT NULL
  PRIMARY KEY (plugin_id, generation)
```

Allowed semantic commit phases:

```text
prepared
config_committed
completed
aborted
```

Allowed publication generation phases:

```text
prepared
committed
published
aborted
```

Allowed `publication_state` values:

```text
active
retired
```

Generation rows are immutable authority attempts. A later prepared generation never replaces the previous published row. Aborted generations remain auditable and their numbers are not reused; monotonic generation may therefore contain gaps.

The semantic commit journal retains enough previous install-record state to restore the pre-commit ledger after a crash when the actual config still matches `previous_config_hash`. If the actual config matches `expected_config_hash`, startup may finalize the prepared next state. If it matches neither, recovery is ambiguous and must fail closed.

The exact desired canonical manifest bytes are persisted when a generation becomes committed. Prepared rows retain canonical authority inputs and hashes but are not publishable. This avoids inventing a final authority timestamp before the matching config commit has been proven. Retry and recovery use the persisted exact desired canonical manifest bytes rather than re-deriving mutable inputs.

The host state id is randomly generated once and persisted. It distinguishes a publication namespace from copied or stale ordinary files originating from a different host state database.

## Semantic Commit Protocol

Publishing inside a SQLite transaction is forbidden. The design uses a semantic commit journal, immutable generation rows, and a three-phase protocol.

The existing `writePersistedInstalledPluginIndexToSqlite` transaction must be refactored so the installed index update, semantic commit journal, and prepared generation rows are written in one SQLite transaction. Writing them through separate transactions is not equivalent.

### Phase 1: prepare authority

In the same SQLite transaction that updates the installed plugin index:

```text
capture previous and next install-record hashes
retain previous install-record JSON when rollback may be required
capture previous and expected config hashes
create one semantic commit_id
compute next target authority from next persisted install records and next durable policy
compare with the latest non-aborted authority_sha256
allocate a new monotonic generation only when authority changes
write generation phase=prepared
write semantic commit phase=prepared
```

Prepared rows are not publishable and the prior published generation remains intact.

### Phase 2: resolve and finalize semantic commit

After the matching config commit returns successfully:

```text
verify the committed config hash and expected policy hash
mark the semantic commit config_committed
materialize and persist exact final canonical manifest bytes
set authority_observed_at_ms
set generation phase=committed
```

If the ordinary config commit fails normally, one SQLite rollback transaction restores the previous installed records, marks the semantic commit aborted, and marks its prepared generations aborted.

Crash recovery compares the captured config snapshot with the journal:

```text
actual config hash == expected_config_hash
  finalize the next state

actual config hash == previous_config_hash
  restore previous install records when required
  abort the prepared semantic commit and generations

actual config hash matches neither
  ambiguous cross-storage state
  do not publish
  fail closed for required targets
```

This journal is necessary because install records no longer live in normal config. A prepared next installed index cannot be accepted or rolled back safely from policy hashes alone.

### Phase 3: publish committed bytes

For each committed generation:

```text
validate final path and directory
write exact desired_manifest_json to an exclusive same-directory temporary file
fsync temporary file
rename over final file atomically
fsync parent directory
verify final bytes/hash and identity
record published_at_ms, published_manifest_sha256, phase=published
mark the semantic commit completed when all required generations are published
```

If rename succeeds but the process crashes before marking the generation published, startup verifies the final hash and marks the existing generation published without rewriting or incrementing it.

## Startup Reconciliation Barrier

The startup sequence must be refactored into two config phases. The first is the no-plugin-metadata host-policy snapshot phase.

Required order:

```text
1. config.host-policy-snapshot
   parse the same config bytes/includes/environment inputs
   validate host-owned plugin policy and requiredPluginIds
   do not load plugin metadata
   do not invoke discovery

2. plugins.host-metadata.reconcile
   read only persisted install_records_json from host state
   do not merge filesystem-recovered managed npm records
   resolve semantic commit journals and prepared/committed/published generations
   derive required absence and retirement generations
   publish and verify all required active targets
   fail closed on unresolved or ambiguous required targets

3. config.plugin-metadata-completion
   perform plugin-metadata-dependent validation
   allow persisted registry use or derived discovery under existing rules

4. plugins.bootstrap
   build lookup and activation state

5. plugin runtime loading
```

The implementation should refactor the current config reader so the same captured config bytes and hash are reused across phases. Reading the config twice and silently accepting a different second snapshot is not acceptable.

The barrier must occur before the current `readConfigFileSnapshotWithPluginMetadata` path can call `resolvePluginMetadataSnapshot`, because that path may fall back to derived discovery.

Runtime-only plugin auto-enable occurs after the authoritative publication policy phase. It must not mutate `policy_state` in the host metadata manifest.

## Lifecycle Integration

The upstream coordinator must be called by semantic mutation owners rather than by registry refresh.

### Install, update, uninstall, migration

`commitPluginInstallRecordsWithWriter` is the primary convergence point for managed install-record mutations. It should create the semantic commit journal and prepared generation rows in the same SQLite transaction as the installed index update, finalize them after config commit, and publish committed rows after finalization. The current store API must be refactored because a second SQLite transaction would leave an undetectable gap.

Uninstall must publish an `uninstalled` tombstone for a still-required id. Directory deletion success or failure may be recorded in command diagnostics, but it must not turn an uncommitted record removal into a published absence.

Migration and compatibility import paths that write install records must use the same coordinator or be reconciled before startup proceeds.

### Enable and disable

Config-only policy mutations need a semantic wrapper separate from `refreshPluginRegistryAfterConfigMutation`:

```text
commitPluginPolicyMutationWithHostMetadata
  prepare semantic journal and next policy generations
  commit config
  finalize committed policy generations
  publish committed rows
  then perform best-effort registry refresh/cache invalidation
```

Registry refresh remains operational cache work and is not part of authority publication success.

### Manual configuration changes and reload

Startup reconciliation covers changes made while OpenClaw was stopped. A live config reload that changes durable plugin policy must run the same host-metadata reconciliation before applying plugin activation changes for required ids.

### Retirement

Removing an id from `requiredPluginIds` writes and publishes one terminal `publication_state=retired` generation. It does not delete the file and does not claim the plugin is absent.

## Failure Semantics

Required active targets are fail closed.

```text
command mutation committed, publication pending
  command must not report clean success
  durable committed row remains retryable
  diagnostic identifies plugin id and generation

startup required target mismatch
  gateway must stop before plugin metadata discovery and plugin runtime loading

non-required retired target failure
  may be diagnostic-only after its terminal state has already been published

malformed or missing final file
  reconcile from committed desired bytes
  never ask the consumer to repair

prepared journal matches expected config hash
  finalize the next authority generation

prepared journal matches previous config hash
  restore previous persisted install records when required
  abort the prepared generations

prepared journal matches neither config hash
  recovery is ambiguous
  never publish
  fail closed

host SQLite unavailable
  required publication cannot be proven
  startup fails closed
```

The publisher must emit stable machine-readable error codes. Raw config, install-record bodies, paths for unrelated plugins, and secrets must not be included in general logs.

## Security Requirements

The host publisher must retain the R3A file algorithm and add target/path controls:

```text
strict normalized plugin ids
SHA-256 filename mapping
0700 publication directory on POSIX
0600 files on POSIX
exclusive temporary-file creation
O_NOFOLLOW when supported
regular-file validation
symlink rejection
hardlink/link-count rejection where supported
same-directory rename
file fsync and parent-directory fsync
final descriptor identity verification
64 KiB maximum
no sibling temp-file consumption by readers
```

Windows publication may use the same canonical and atomic contract, but A7 production consumer authorization remains POSIX/WSL-only until equivalent ownership, reparse-point, link, and ACL evidence is separately proven.

## Proposed Upstream Modules

Logical module split:

```text
src/plugins/host-plugin-metadata-contract.ts
  schema, canonical serializer, validation, hashes

src/plugins/host-plugin-metadata-paths.ts
  state-root path and plugin-id hash mapping

src/plugins/host-plugin-metadata-store.ts
  SQLite identity and outbox rows

src/plugins/host-plugin-metadata-coordinator.ts
  prepare/finalize/reconcile state machine

src/plugins/host-plugin-metadata-publisher.ts
  atomic ordinary-file replacement and verification

src/plugins/host-plugin-metadata-startup.ts
  pre-discovery startup barrier
```

Expected existing integration regions:

```text
src/state/openclaw-state-schema.generated.ts
src/plugins/installed-plugin-index-store.ts
src/plugins/plugins-install-record-commit.ts
src/cli/plugins-registry-refresh.ts
src/gateway/server-startup-config.ts
src/gateway/server-startup-plugins.ts
config schema and plugin policy normalization modules
```

No publisher code belongs in memory-engine.

## Test Matrix

Upstream implementation is not acceptable without tests covering at least:

```text
contract
  canonical v2 installed, absent, disabled, incomplete, and retired states
  duplicate/invalid ids and unsupported state combinations
  stable hashes, generation, and publication id

store
  state-id creation
  prepared/committed/published transitions
  generation increments only on authority change
  exact desired bytes retained across retry

semantic commit
  config success
  config failure rollback
  crash after prepare before config commit
  crash after config commit before committed mark
  crash after committed mark before file write
  crash after rename before published mark

lifecycle
  install
  update
  uninstall tombstone
  enable
  disable without absence
  migration/import
  manual config change at restart
  retirement

startup order
  no plugin metadata resolution before reconciliation
  no discovery before reconciliation
  no plugin loader import before reconciliation
  required failure blocks startup
  successful reconciliation permits existing startup path

filesystem
  orphan temp ignored
  failed write preserves old final
  atomic old/new generation separation
  malformed final repaired only by host
  symlink and hardlink rejection
  permission enforcement
  final hash and descriptor identity

scope and privacy
  only configured required ids published
  unrelated install records absent from files and logs
  no secrets
```

Tests must include fault injection at each durable transition. A happy-path smoke alone is insufficient.

## Upstream Patch Decomposition

A reviewable upstream change should be split into bounded patch sets.

### Patch 1: contract and durable store

```text
config schema for requiredPluginIds
v2 canonical contract
path resolver
state identity and outbox schema
pure store/state-machine tests
feature remains inactive by default
```

### Patch 2: semantic lifecycle integration

```text
install/update/uninstall/migration coordinator integration
config-only enable/disable coordinator
publication diagnostics
fault-injection tests
```

### Patch 3: startup barrier

```text
split no-plugin-metadata config phase
startup reconciliation before resolvePluginMetadataSnapshot
reload-path reconciliation
startup-order tests proving no discovery or loader import
```

### Patch 4: documentation and operator surfaces

```text
host configuration documentation
status/diagnostic reporting
recovery guidance
explicit statement that registry refresh is not the authority publisher
```

The upstream pull request description must state that the feature is default-off, host-owned, independent of memory-engine runtime loading, and intended as a generic no-load metadata publication contract.

## Dormant Strict-Profile Implementation Gate

This gate is inactive for the current personal deployment. If a future decision reactivates the strict platform profile, an isolated upstream implementation worktree may be authorized only after review confirms:

```text
exact upstream repository and base commit
config key naming
v2 schema freeze
SQLite migration strategy
startup config-phase refactor plan
cross-platform support boundary
fault-injection plan
no memory-engine production consumer work in the same change
```

A future strict-profile implementation review must not authorize installation into the active OpenClaw environment, Gateway reload, real manifest publication, sustained runtime activation, or B8-B removal merely because an upstream patch is implemented or locally tested.

## Authorization Boundary

```text
B8-A7-R5 strict host publisher integration design=PASSED / CLOSED / REFERENCE ONLY
B8-A7-R6 personal deployment safety profile=ACCEPTED
OpenClaw fork/worktree=NOT REQUIRED / NOT PLANNED
OpenClaw source modification=NOT AUTHORIZED
upstream pull request=NOT REQUIRED / NOT PLANNED
real host publisher=NOT REQUIRED FOR PERSONAL PROFILE
production manifest consumer=NOT REQUIRED FOR PERSONAL PROFILE
runtime configuration change=NOT AUTHORIZED
plugin install/reload=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

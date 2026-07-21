# ADR: OpenClaw owns authoritative plugin metadata publication

- Status: Accepted
- Date: 2026-07-21
- Decision scope: B8-A7-R4 Metadata Ownership Decision Review

## Context

B8-A7 needs a no-load, read-only source for the installed memory-engine runtime identity before any sustained runtime evidence window can be authorized. The source must remain usable without importing plugin entrypoints, entering plugin discovery, accessing plugin runtime state, or causing observable writes from the consumer.

The evaluated routes produced the following results:

```text
R2A existing OpenClaw metadata API
  BLOCKED: canonical metadata is in shared state SQLite and the normal snapshot path may enter discovery

R2B direct read-only SQLite consumer
  BLOCKED: normal read-only access observed SHM filesystem changes, while immutable access did not observe later WAL generations

R3A host-published ordinary-file manifest
  PASSED / CLOSED for the synthetic file contract and atomic algorithm only

R3B existing host publisher source audit
  NOT FOUND / BLOCKED
```

R3B found host-owned install, update, uninstall, enable, and disable lifecycle functions and the shared `installed_plugin_index` SQLite writer. It did not find an ordinary-file R3A publisher, a pre-runtime startup reconciliation hook, or an atomic host publication boundary.

A static re-audit of the official OpenClaw `2026.7.1-2` npm package on 2026-07-21 reached the same conclusion as the installed OpenClaw `2026.6.9` audit. The newer package still documents and implements the shared SQLite `installed_plugin_index` as the canonical install ledger. It retains `commitPluginInstallRecordsWithWriter`, `writePersistedInstalledPluginIndexToSqlite`, `refreshPluginRegistryAfterConfigMutation`, `prepareGatewayPluginBootstrap`, and `loadGatewayStartupPluginRuntime`, but contains no R3A ordinary-file publisher or startup publication barrier.

The `2026.7.1-2` package evidence inspected for this decision was:

```text
package=openclaw@2026.7.1-2
npm integrity=sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g==
npm shasum=4583b987ea7277230ce1c7b2b8535d3e219f57ac
inspection=static package extraction only
installation=not performed
gateway/runtime execution=not performed
```

## Decision

OpenClaw host core owns authoritative plugin-install metadata and any ordinary-file publication derived from it.

The selected architecture is:

```text
Option A: OpenClaw upstream host publisher
```

The following alternatives are rejected:

```text
Option B: memory-engine shadow publisher
  REJECTED because it creates duplicate authority, cannot run reliably while the plugin is absent or disabled,
  cannot cover every host mutation path, and reintroduces freshness and startup-order problems.

Option C: direct SQLite/index consumption
  REJECTED by the R2B zero-write versus freshness result.
```

A separately owned host extension point is acceptable only when it is installed, invoked, versioned, and governed by OpenClaw core; runs when memory-engine is absent or disabled; executes before discovery and runtime loading; and cannot be registered or replaced by memory-engine. Such an extension point is functionally part of Option A, not a shadow publisher.

## Authority Model

The host owns two independent authoritative dimensions:

```text
installation facts
  committed installed-plugin index and install records

policy facts
  committed normalized plugin configuration and effective host policy
```

Memory-engine is a strict read-only consumer. It must not reconstruct authority from directory scans, plugin discovery, the first matching install path, current runtime registration, or a direct SQLite read.

## Production State Model

The R3A synthetic contract proved its file algorithm, but its synthetic v1 state model is not approved unchanged for production. In particular, `disabled-by-host-policy` must not be represented as installation absence.

A production schema must separate at least:

```text
authority_state:
  available
  unavailable

installation_state:
  installed
  absent
  null when authority_state=unavailable

policy_state:
  enabled
  disabled
  unknown
  null when not applicable
```

Required semantics are:

```text
uninstalled
  -> authority_state=available
  -> installation_state=absent
  -> explicit absent reason=uninstalled

authoritative install ledger contains no record after host reconciliation
  -> authority_state=available
  -> installation_state=absent
  -> explicit absent reason=install-record-missing

disabled by host policy
  -> authority_state=available
  -> installation_state=installed
  -> policy_state=disabled

authoritative state cannot be read, validated, or reconciled
  -> authority_state=unavailable
  -> not installation absence
```

Deleting the final manifest is not an absence protocol. A missing file, malformed file, stale generation, publication failure, or unsupported schema must fail closed.

## Publication Ownership

OpenClaw host core owns:

```text
manifest namespace and exact path
schema version and compatibility policy
authority revision
generation
publication identity
canonical serialization
atomic temporary write and same-filesystem replacement
file and parent-directory ownership and permissions
publication retry
startup reconciliation
rollback and recovery
publication diagnostics
```

Memory-engine owns only:

```text
read-only descriptor access
file identity and permission validation
schema and canonical-byte validation
publication identity and freshness checks
fail-closed reporting
```

The exact production path remains unauthorized until an upstream implementation review. It must be a fixed host-resolved path in host-owned state, not a path selected by memory-engine, plugin discovery, environment guessing, or filesystem search.

## Commit and Publication Boundary

The low-level SQLite writer is not the publication boundary.

In both inspected OpenClaw versions, `commitPluginInstallRecordsWithWriter` writes the persisted installed-plugin index before committing the matching config and restores the previous index if config commit fails. In `2026.7.1-2`, retained managed npm marker changes are also part of this rollback sequence. Publishing immediately after `writePersistedInstalledPluginIndexToSqlite` could therefore expose an intermediate state that is not yet a completed semantic host commit.

`refreshPluginRegistryAfterConfigMutation` is also unsuitable. Registry refresh failure is warning-only, the path can enter registry rebuilding or discovery, and runtime cache invalidation dynamically imports the plugin loader.

The host must introduce a semantic publication coordinator whose inputs are committed install records and committed normalized policy state. It must not require plugin discovery or plugin runtime state.

The required durable sequence is:

```text
1. Commit authoritative host state and a durable publication intent/revision.
2. Build canonical metadata only from that committed authority.
3. Publish through the R3A atomic replacement algorithm.
4. Durably mark the authority revision as published.
5. Permit registry-ready/runtime loading only when committed and published revisions agree.
```

A process crash between the host-state commit and file replacement must leave a durable pending or revision mismatch that startup reconciliation can detect. Atomic rename alone prevents partial files but does not solve this cross-storage crash window.

## Lifecycle Requirements

Publication must cover every authoritative mutation path, not only individual CLI commands.

At minimum:

```text
install
  publish the committed installed state

update
  publish a new installed generation after the complete semantic commit

uninstall
  publish an explicit absent tombstone after authoritative record removal

enable/disable policy changes
  preserve installation_state=installed and update policy_state

startup reconciliation
  reconcile committed authority and publication before plugin lookup, discovery-driven activation,
  or loadGatewayStartupPluginRuntime
```

The same coordinator must cover migration, doctor/repair, compatibility import, startup detection of externally changed configuration, and future host callers that mutate the authoritative install ledger or effective policy.

## Generation and Identity

The host owns generation and publication identity.

Required rules are:

```text
generation
  changes only when authoritative plugin metadata changes
  is monotonic within the host-owned manifest namespace

publication_id
  binds plugin id, schema, authority revision, generation, and canonical content
  remains stable across retries of the same authority revision

published_at
  records the authoritative commit/publication event for that revision
  is not rewritten merely because startup reconciliation repeats the same publication

authority revision
  is durable and comparable with the host's publication-complete revision
```

The consumer must never invent or increment any of these values.

## File Security and Recovery

The production publisher must preserve the R3A algorithm and security requirements:

```text
canonical UTF-8 JSON
exclusive no-follow temporary creation
0600 final-file permissions
host ownership
regular-file validation
hardlink and link-count rejection
64 KiB maximum unless a future schema explicitly changes it
file fsync
same-directory, same-filesystem rename
parent-directory fsync
old final snapshot preserved until successful replacement
```

The host also owns parent-directory creation, mode, ownership, cleanup of abandoned temporary files, recovery after failed replacement, and diagnostics. The consumer must not repair, delete, rename, chmod, or otherwise mutate publication state.

## Startup Ordering

Publication reconciliation must complete before OpenClaw declares plugin metadata ready or enters plugin lookup, discovery-driven activation, or plugin runtime loading.

The inspected `prepareGatewayPluginBootstrap` path currently proceeds from startup maintenance into activation configuration, plugin lookup, and `loadGatewayStartupPluginRuntime` without an R3A publication barrier. An upstream change is therefore required.

A best-effort warning is insufficient. Failure to reconcile authoritative and published revisions must fail closed for the dependent runtime authorization path.

## Upstream Requirement and Blocking Effect

An upstream OpenClaw change is required for the selected architecture.

The lack of an upstream publisher is not a permanent theoretical impossibility, but it is a current hard blocker for B8-A7. memory-engine must not bypass it with a shadow publisher, direct SQLite reader, runtime callback, or guessed path.

Current decision state:

```text
B8-A7-R4 metadata ownership decision=ACCEPTED / OPTION A REQUIRED
OpenClaw upstream host publisher=REQUIRED
memory-engine shadow publisher=REJECTED
direct SQLite/index consumer=REJECTED
real host publisher=NOT AUTHORIZED
production manifest consumer=NOT AUTHORIZED
host integration implementation=NOT STARTED
B8-A7 sustained runtime authorization=WITHHELD
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

## Consequences

- R3A remains `PASSED / CLOSED` for the synthetic file contract and atomic algorithm only.
- R3B remains `COMPLETE` with `host publisher source=NOT FOUND / BLOCKED`; it must not be described as not started.
- The next implementation stage, if separately authorized, belongs upstream in OpenClaw host core.
- A production schema review must supersede the synthetic v1 state model before a real publisher or consumer is implemented.
- No OpenClaw host changes, manifest publication, production consumer, runtime configuration, plugin install/reload, sustained runtime window, or B8-B removal is authorized by this ADR.

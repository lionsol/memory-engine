# OpenClaw Host-Published Plugin Metadata Manifest

## Scope

R3A defines a synthetic ordinary-file metadata contract that could later be published by the host. The implementation is limited to `lib/ops/synthetic-host-plugin-metadata-manifest.js` and a report-only synthetic smoke. It does not modify the host, resolve a real metadata path, implement a production consumer, or access host state.

## Proven Range

The synthetic harness proves only the internal file algorithm and contract:

```text
synthetic atomic replacement
synthetic read-only consumer
schema and hash validation
tombstone behavior
file identity checks
zero consumer writes
```

The publisher uses a temporary file opened with exclusive creation, no-follow when supported, mode `0600`, complete canonical bytes, file `fsync`, same-directory `rename`, and parent-directory synchronization where supported. It never truncates or deletes the final snapshot first. Fixed fault points verify that an old final snapshot remains readable until a successful rename.

The consumer opens only the fixed final filename with a read-only descriptor, checks regular-file, symlink, link-count, mode, owner, size, device, inode, `mtime` and `ctime` identity, then validates the complete canonical bytes. It does not inspect sibling temporary files, install paths, source paths, or attempt repair. Consumer reads are fingerprinted with atime excluded; successful reads must show no observable file changes.

## Manifest Schema

The envelope is versioned and canonical:

```json
{
  "schema_version": 1,
  "contract": "openclaw.host-plugin-install-metadata/v1",
  "plugin_id": "memory-engine",
  "generation": "1",
  "publication_id": "64 lowercase hex characters",
  "published_at": "2026-07-20T00:00:00.000Z",
  "state": "installed",
  "authority": {
    "type": "openclaw-host-installed-plugin-index",
    "revision": "synthetic-authority-revision-A",
    "updated_at": "2026-07-20T00:00:00.000Z"
  },
  "install": {
    "install_path": "/synthetic/runtime/memory-engine",
    "source_path": "/synthetic/source/memory-engine",
    "version": "0.0.0-synthetic",
    "installed_at": "2026-07-20T00:00:00.000Z",
    "manifest_sha256": "64 lowercase hex characters",
    "install_record_sha256": "64 lowercase hex characters"
  },
  "absent_reason": null
}
```

Installed state requires lexical absolute install/source paths and does not read either path. Absent tombstones require `install=null` and `absent_reason` equal to `uninstalled`, `disabled-by-host-policy`, or `install-record-missing`. A missing final file is not an absent tombstone and fails closed.

The canonical serializer sorts object keys lexicographically, preserves array order, emits UTF-8 two-space JSON with one trailing newline and no BOM. Before `JSON.parse`, the consumer scans the original JSON text and rejects duplicate keys with `manifest_duplicate_key`; it also rejects files over 64 KiB, invalid UTF-8, NUL, alternate whitespace/order, trailing data, and unsupported schema or state combinations.

## Tombstone Behavior

Uninstall or authoritative absence must publish a complete tombstone through the same atomic replacement protocol. Deleting the manifest is not an uninstall protocol because deletion cannot distinguish never-published, publisher failure, stale removal, or authoritative absence. Installed A followed by absent B leaves only the valid absent B snapshot visible to a new consumer.

## Synthetic Scenario Coverage

The smoke covers valid installed and absent snapshots, installed-to-absent replacement, orphan and interrupted temporary files, failed replacement preserving the old snapshot, old-descriptor versus new-final atomic replacement, malformed/canonical/schema failures, oversized files, symlink and hardlink identity failures, consumer zero-write fingerprints, CommonJS require isolation, and external-argument rejection. Each scenario records `expected_valid`, `actual_valid`, and `expected_block`; expected invalid fixtures are PASS when the consumer rejects them, and only unexpected failures contribute to the global decision. Consumer fingerprints are restricted to the final manifest and its temporary-manifest artifacts, not unrelated sibling files.

## Not Proven

R3A does not prove:

```text
OpenClaw has an appropriate publisher integration point
host publisher can access authoritative install state without discovery
final real metadata path
host lifecycle hooks
startup reconciliation
install/update/uninstall publication
production ownership and permissions
production freshness
```

## Future Host Publisher Obligations

A future host integration must provide:

```text
single authoritative writer
publish after install/update/uninstall
publish tombstone for absence
startup reconciliation before registry-ready
same-filesystem atomic replacement
no plugin entrypoint import
no plugin discovery solely for manifest publication
no memory-engine/core DB access
no secrets
```

These are design obligations only. R3A does not implement or authorize them.

## Synthetic Path and Module Boundary

The smoke creates only a `memory-engine-r3a-*` temporary root and the fixed `memory-engine.install-metadata.json` final name. Its CommonJS bin wrapper rejects unknown and external path arguments before lazy-importing the ESM library. Requiring the wrapper exports `main` without running the smoke. No host command, environment variable, database module, child process, plugin loader, discovery code, or runtime integration is used.

## Decision and Authorization

The only permitted synthetic decisions are:

```text
B8-A7-R3A synthetic manifest contract=BLOCKED / ATOMICITY OR READ-ONLY CONTRACT NOT PROVEN
B8-A7-R3A synthetic manifest contract=PASSED / HOST INTEGRATION SOURCE AUDIT REQUIRED
```

Even `PASSED` means only that the synthetic contract and file algorithm are internally coherent. It does not mean production ready, host integration accepted, or A7 authorized.

Current state:

```text
B8-A7-R2B synthetic harness verification=PASSED / CLOSED
B8-A7-R2B standalone read-only live state-DB reader feasibility=BLOCKED / ZERO-WRITE OR FRESHNESS NOT PROVEN
B8-A7-R3A host-published metadata manifest synthetic contract=SECOND REVIEW FIXES IMPLEMENTED / EDI VERIFICATION PENDING
real host publisher=NOT AUTHORIZED
production manifest consumer=NOT AUTHORIZED
real metadata path resolution=NOT AUTHORIZED
host integration source audit=NOT STARTED
host remediation execution=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

# Separate runtime artifact content and topology identity

## Stage decision

Determine whether installer-induced internal hardlink splitting can be accepted without weakening artifact safety.

## Why

The historical v1 artifact identity combines semantic tree fields and internal hardlink membership. An installer may expand internal hardlink groups while preserving every semantic file and directory field. A safe acceptance rule must distinguish that controlled split from merges, cross-group relinking, external references, and semantic drift.

## What changes

- Preserve `memory-engine-runtime-artifact-manifest-v1`, its `identity`, and all existing v1 tests unchanged.
- Add an isolated v2 manifest with separate semantic/content, hardlink-topology, and exact identities.
- Validate candidate and installed trees independently, fail closed for unsafe entries and incomplete topology, and classify transitions with a closed enum.
- Apply an explicit `exact` policy by default and an explicit `allow_internal_hardlink_split_v1` policy only for split-only transitions.
- Add read-only v2 build/compare CLI surfaces and synthetic filesystem tests.

## Non-goals

This change does not modify the installer, runtime copy, Gateway, Console, OpenClaw configuration, database, memory data, release state, or installation automation. It does not add path exceptions for better-sqlite3, redefine v1 identity, or authorize a runtime transaction. It does not read or modify the historical runtime evidence tree.

## Compatibility rule

v1 remains the historical exact identity contract. v2 is additive and does not overload the v1 `identity` field. A future installation must use a newly frozen candidate and a separately authorized transaction; source completion is not runtime completion.

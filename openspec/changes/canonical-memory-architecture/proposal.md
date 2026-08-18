## Why

Phase 2.5 needs one stable semantic boundary before read-only adapters, downstream projections, and later reconciliation work add more policy around the same Core chunk. The finalized contract in `docs/canonical-memory-object-contract.md` closes the ownership, identity, category, temporal, failure, and eligibility ambiguities without changing runtime behavior.

## What Changes

- Establish the Canonical Memory Object as a read-only semantic composition, not a third store.
- Define the Phase 2.5 sequence from contract through isolated read-only adapter, projection unification, and separately governed reconciliation integration.
- Keep eligibility policy that lacks a unique deterministic baseline deferred to 2.5-C.
- Record explicit non-goals for schema, runtime, ranking, AutoRecall, and multi-agent authority boundaries.

## Capabilities

### New Capabilities

- `canonical-memory-architecture`: Phase 2.5 canonical object contract and the A/B/C/D architecture boundaries.

### Modified Capabilities

- None.

## Impact

- Authoritative contract: `docs/canonical-memory-object-contract.md`.
- Future read-only adapter and projection consumers must use exact Core identity and isolated Core/Engine access.
- Future reconciliation integration is a separate persistent-write decision and is not authorized by this change.
- This change adds only the read-only adapter source and tests; it adds no production consumer wiring, runtime configuration, database schema, migration, plugin installation, or Gateway operation.

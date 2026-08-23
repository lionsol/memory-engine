# D.3-D.3 DIRECT_CARD Owner-Attested Authority Source Implementation

> Decision date: 2026-08-23
>
> Scope: authorized source implementation and repository tests for the
> Owner-attested authority source. AutoRecall disclosure migration and runtime
> activation remain outside this stage.

## Result

- D.3-D.3 source implementation: **`IMPLEMENTED / REPOSITORY-TESTED`**
- Owner management boundary: **implemented in source**
- runtime deployment: **not performed**
- real attestation state: **not created**
- production AutoRecall migration: **`HOLD`**
- D.3-D.4: **`CANDIDATE / NOT AUTHORIZED`**

D.3-D.3 implements the authority source needed by the later production
boundary. It does not wire the provider into AutoRecall, the production
selector, formatter, telemetry, or reinforcement path. D.3-C's
`DIRECT_CARD` product-entry approval remains intact, but source migration is
still blocked until the later boundary work is separately authorized.

## Current implementation facts

### Engine-owned store

`lib/db/schema.js` now creates the Engine-only
`disclosure_attestations` table and indexes. The table is not attached to Core
and does not reuse `memory_confidence`, `memory_events`, source Markdown,
legacy card policy, telemetry, or provenance as positive authority.

The persisted binding contains exact:

- `memory_id` and `canonical_id`;
- `source_content_hash`;
- `surface=DISCLOSURE_CARD`;
- the actual artifact `projection_schema_version`;
- the actual artifact `projection_kind=legacy_memory_card_v1`;
- exact projection/baseline hash;
- `projection_adapter_version`;
- `authority_kind=OWNER_EXPLICIT_ATTESTATION`;
- `audience_scope=OWNER_SELF`;
- attestation schema version;
- policy version `direct_card_owner_attestation_v1`; and
- explicit `active` or `revoked` state with bounded timestamps.

The table has no inferred backfill. Existing memories are absent by default.
Asserting an already-active exact binding is idempotent; revoking an already
revoked exact binding is idempotent; explicit Owner assert can reactivate a
revoked exact binding. A changed source, projection payload, identity, adapter
version, or policy/schema version produces a different exact binding.

Read-only provider/status paths only query the table. They do not call schema
initialization and do not create tables or write rows.

### Contract, hash, and provider

`lib/recall/disclosure/owner-attestation.js` defines the closed attestation
contract, deterministic attestation ID, exact validator, Engine store
operations, and bounded authority provider.

The provider reuses
`computeDisclosureCardBaselineProjectionHash()`; it does not introduce a
second projection hash algorithm. Because that hash intentionally excludes
provenance, `projection_adapter_version` is bound and validated separately.

Missing, malformed, unavailable, inactive/revoked, stale, or mismatched
records fail closed. An exact active match returns only bounded
`OWNER_SELF`-scoped evidence with `safe_to_disclose=true`. It does not return
`CARD_DISCLOSABLE`, `DISCLOSE_CARD`, selector output, or any lifecycle/scope/
risk bypass.

### Canonical-only projection

`lib/recall/disclosure/owner-attestable-projection.js` adds the dedicated
`projectCanonicalMemoryToOwnerDisclosureCardArtifact(canonicalMemory)` entry
point. It accepts only the current Canonical Memory, invokes the existing
projection behavior without a runtime candidate, validates the result, and
returns only the bounded artifact.

The terminology boundary is explicit:

```text
surface        = DISCLOSURE_CARD
projection_kind = legacy_memory_card_v1
```

The fabricated `projection_kind=DISCLOSURE_CARD` combination is not stored or
validated. No generic projector behavior was changed, and no full
`canonical.source.text`, `get_token`, capability, or selector decision is
returned.

### Host-authenticated Owner command

`index.js` registers the non-agent `/memory-disclosure` command through
`api.registerCommand()` with:

```text
requireAuth: true
requiredScopes: ["operator.write"]
exposeSenderIsOwner: true
```

The handler independently requires both `ctx.isAuthorizedSender === true` and
`ctx.senderIsOwner === true` before any Canonical or Engine read. It supports
only:

- `preview <memory_id>`;
- `assert <memory_id> <projection_hash>`;
- `status <memory_id>`; and
- `revoke <attestation_id>`.

Preview and assert rebuild the current Canonical-only projection server-side.
Assert writes only after the supplied 64-character hash exactly matches the
fresh projection hash. Status is bounded to one exact memory. Revoke targets
one exact deterministic attestation ID. Wildcards, `all`, bulk approval,
category/path approval, future-version approval, and broad current/future
authorization are rejected.

The command is registered separately from all agent tools. No attestation
operation was added to `memory_engine`, `memory_engine_search`,
`memory_engine_get`, action enums, tool schemas, or `MEMORY_ENGINE_TOOL_NAMES`.

## Verification boundary

The repository tests cover Engine/Core isolation, schema idempotence, no
inferred backfill, exact persistence, revoke/reassert, every binding and state
mismatch, invalid artifacts, deterministic hashes, source/payload invalidation,
read-only provider fail-closed behavior, positive scoped evidence without
capability/selector output, command authorization, bounded preview, stale and
wrong hash no-write behavior, exact revoke/reassert, malformed arguments, and
unchanged agent tool surfaces.

Tests use temporary or in-memory databases only. No frozen holdout was run.
No real Core/Engine database or runtime memory state was read or modified.

## Deferred boundary

`D.3-D.4 DIRECT_CARD Production Disclosure Boundary Migration` is
**`CANDIDATE / NOT AUTHORIZED`**. It must separately decide and implement the
production canonical acquisition, capability/lifecycle/scope/risk boundary,
selector, formatter, and actual-selection telemetry migration. This stage does
not begin that work and does not enable AutoRecall or `cardFirstRuntime`.

# D.3-D.2 DIRECT_CARD Safe-to-Disclose Authority Decision

> Decision date: 2026-08-23
>
> Scope: docs/OpenSpec-only architecture decision. No source, test, runtime,
> configuration, database/data, deployment, or holdout operation is authorized
> by this record.

## Decision status

- `D.3-D.2 AUTHORITY DECISION = PASS / DECISION CLOSED`
- `DIRECT_CARD` production source migration = `HOLD`
- Blocker: `PRODUCTION_DISCLOSURE_ATTESTATION_PROVIDER_NOT_IMPLEMENTED`
- `D.3-C` product interpretation and its `DIRECT_CARD` product-entry approval
  are not revoked.

The D.3-C entry decision identifies `DIRECT_CARD` as the first and currently
only production integration candidate. D.3-D.1 then found that product entry
does not mean source readiness. D.3-D.2 closes the authority decision by
freezing the required v1 authority owner and exact binding, while leaving the
provider itself unimplemented. This decision therefore does not authorize
source migration, runtime activation, deployment, or configuration/data
changes.

## Fact classification

### `current_fact`

The actual production AutoRecall path remains the legacy card-first flow:

```text
lib/recall/auto-recall-hook-lifecycle.js
  -> hybridSearch()
  -> shouldInjectCandidate()
  -> gatedResults
  -> formatAutoRecallCardContext()

auto-recall.js
  -> buildAutoRecallCardContext()
  -> projectCandidateToMemoryCard()
  -> isInjectableMemoryCard()
```

Production Hybrid search already performs isolated Core/Engine canonical reads
within its bounded path, but its public result is a reduced retrieval result.
Full `canonicalMemory.source.text` must not be added to the generic Hybrid
result. The production path is not wired to `ProjectionArtifact`, the D.3
disclosure capability boundary, or `selectDisclosureCandidates()`.

The D.3 production symbols
`projectCanonicalMemoryToDisclosureCardArtifact()`,
`createRecallCandidateEnvelope()`, and `selectDisclosureCandidates()` have no
real AutoRecall production caller. Current `safe_to_disclose` values occur
only in offline/synthetic `policy_context` or evaluation labels. There is no
production authority provider that can attest target-surface disclosure safety.

The frozen C.3 first-run evidence remains historical representation and
capability evidence: `direct_safe` had projection valid `4/4`, surface safe
`4/4`, and `CARD_DISCLOSABLE` `4/4`; `redactable_secret` had projection valid
`4/4`, surface safe `0/4`, and `INTERNAL_CONTEXT` `4/4`. A
`redactable_secret` runtime candidate can have empty `risk_flags` while the
secret risk exists only in synthetic `policy_context`; an empty artifact risk
list therefore cannot be treated as complete safety authority.

### `accepted_design`

For v1, the only positive `safe_to_disclose` authority is
`OWNER_EXPLICIT_ATTESTATION`. The attestation is produced by a
host-authenticated Owner management action for one exact projection binding.
Memory Engine may persist and validate that attestation in a future dedicated
state boundary, but it must not infer safety from retrieval, provenance, or
representation metadata.

An attestation is necessary for `CARD_DISCLOSABLE`, not sufficient by itself.
Lifecycle, scope, risk, projection validation, and every other hard-deny
condition remain independently enforced.

### `historical_record`

D.3-D.1 is `PASS_WITH_FINDINGS` with production source migration `HOLD`.
The C.3 holdout and D.3-C first-run reports are immutable evidence records;
neither creates production authority. D.3-C.16 accepted bounded extractive
`INTERNAL_AGENT_CONTEXT` representation only when caller-supplied ranges are
already correct and did not prove automatic range selection or capability.

## v1 authority owner

The sole positive authority kind is:

```text
OWNER_EXPLICIT_ATTESTATION
```

It must be created by an authenticated, non-agent-callable Owner management
boundary. Ordinary agent tools, `memory_engine.add`, AutoRecall, projectors,
selectors, retrieval code, Codex, and EDi must not create or modify a positive
attestation. Assert and revoke operations must not be exposed as ordinary
agent-callable `memory_engine` actions. A caller-supplied or self-reported
authority value is unauthenticated evidence and fails closed.

Memory Engine's future role is limited to storing the attestation in
Engine-owned state and validating its exact binding and active/revoked state.
The Engine must not turn a missing fact into a positive decision, infer safety
from a source class, or broaden a binding to other memories, projections,
audiences, or future versions.

## Exact attestation binding

Every v1 attestation must bind all of the following fields:

| Binding field | Required value or meaning |
| --- | --- |
| `memory_id` | Exact Canonical Memory identifier |
| `canonical_id` | Exact canonical identity paired with the memory |
| `source_content_hash` | Hash of the exact canonical source content |
| `surface` | `DISCLOSURE_CARD` |
| `projection_schema_version` | Exact schema version of the validated artifact |
| `projection_kind` | `DISCLOSURE_CARD` |
| exact projection/baseline hash | Hash of the exact projected representation |
| `authority_kind` | `OWNER_EXPLICIT_ATTESTATION` |
| `audience_scope` | `OWNER_SELF` |
| policy/attestation schema version | Exact versions used to interpret the decision |
| state | Explicit `active` or `revoked` state |

The exact projection/baseline hash must cover the current `ProjectionArtifact`:

- projection schema version;
- projection kind;
- `memory_id`;
- `canonical_id`;
- `source_content_hash`;
- surface; and
- exact payload.

The existing `computeDisclosureCardBaselineProjectionHash()` provides a
reusable implementation of this exact binding semantic. This decision does
not modify that function or any other source. Its current hash material is the
projection identity/content baseline; policy and provenance versions remain
separately bound attestation fields as required above.

## Fail-closed contract and invalidation

For any candidate, the following must all hold before a positive capability is
possible:

```text
Canonical Memory
  -> DISCLOSURE_CARD ProjectionArtifact
  -> projection validation
  -> exact OWNER_EXPLICIT_ATTESTATION validation
  -> other lifecycle/scope/risk hard-deny checks
  -> DisclosureCapability = CARD_DISCLOSABLE
  -> selector = DISCLOSE_CARD
```

Any one of the following conditions produces the fail-closed result
`safe_to_disclose = false/absent`, capability `RETRIEVAL_ONLY`, and selector
`WITHHOLD`:

- no attestation;
- unauthenticated or caller-supplied authority;
- revoked or inactive attestation;
- `memory_id`, `canonical_id`, source hash, or projection hash mismatch;
- surface, projection kind, schema version, or policy/attestation version
  mismatch;
- audience scope that cannot be authenticated as `OWNER_SELF`; or
- ProjectionArtifact validation failure.

Changes to Canonical source content, projection payload, projection identity,
or any bound schema/policy version automatically invalidate the old
attestation. Matching must be exact; no loose matching, silent repair, or
automatic migration is allowed. Owner attestation cannot bypass lifecycle,
scope, risk, projection-validation, or other hard-deny rules.

## Rejected positive authorities

The following are explicitly not v1 positive `safe_to_disclose` authority:

- caller-supplied `safe_to_disclose`;
- `memory_engine.add` or `toolCallId`;
- `agent_smart_add`, manual, or checkpoint provenance;
- `is_protected`;
- category or path/source allowlists;
- retrieval score or rank;
- legacy `disclosure_level`, `can_inject_card`, or `get_token`;
- an empty `ProjectionArtifact.risk_flags` value;
- `memory_events` or telemetry metadata;
- prompt, model, or LLM assertion;
- a detector/classifier without independent qualification and product
  authorization; or
- source Markdown annotation by itself.

A detector may eventually provide risk evidence or a candidate recommendation,
but it cannot produce v1 positive authority until a separate product decision
and qualification establish that authority boundary.

## Persistence and Owner operation boundary

Future implementation requires a dedicated Engine-owned attestation state. It
must not reuse `memory_confidence`, `is_protected`, `memory_events`, or source
Markdown as an authority store. Existing memories are unasserted by default
and therefore withhold. No backfill may infer attestations from old fields,
provenance, telemetry, or historical product decisions.

The future authenticated Owner management boundary may:

1. show the current exact `DISCLOSURE_CARD` projection and its binding;
2. explicitly assert that exact binding; and
3. explicitly revoke that exact binding.

It must not offer a broad “authorize all current or future memory” operation.
Assert and revoke are management operations, not ordinary agent-callable
memory actions.

## Production migration disposition

`DIRECT_CARD` remains the only production integration candidate because it has
both representation evidence and `CARD_DISCLOSABLE` evidence in the frozen
C.3 direct-safe cases. That evidence does not supply the missing production
attestation provider. Accordingly:

- D.3-D.2 is closed as an authority decision;
- production source migration remains `HOLD`;
- no legacy card injection, raw text injection, or `get_token` fallback may
  substitute for missing authority; and
- `RETRIEVAL_ONLY` and `INTERNAL_CONTEXT` cannot cross this direct-card
  disclosure path.

## Next candidate

`D.3-D.3 DIRECT_CARD Owner-Attested Authority Source Implementation` is
`CANDIDATE / NOT AUTHORIZED`.

Only a separate authorization may begin implementation of:

- a dedicated Engine attestation store;
- an authenticated non-agent management boundary;
- an exact binding/hash validator;
- a production capability provider; and
- focused tests.

D.3-D.3 must not be started by this decision. This record creates no table,
schema, migration, persistent state, detector, classifier, fixture, evaluator,
runtime mechanism, or source implementation.

## Scope closure

This decision changes only documentation/OpenSpec state. It does not:

- modify `lib/**`, `auto-recall.js`, `index.js`, `test/**`, fixtures, or reports;
- run a frozen holdout;
- create a detector, classifier, schema, table, or persistent state;
- deploy, change configuration, restart Gateway, run EDi, or enable AutoRecall;
- read or modify runtime DB/data; or
- authorize D.3-D.3, OpenSpec 4.2 source migration, or runtime qualification.

`RAW_REFERENCE` and `RAW_DISCLOSABLE` remain reserved and disabled.

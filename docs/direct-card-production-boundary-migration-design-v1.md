# DIRECT_CARD Production Boundary Migration Design v1

Status: `D.3-D.1 DESIGN = PASS_WITH_FINDINGS`

Direct-card production source migration: `HOLD`

Blocker: `PRODUCTION_SAFE_TO_DISCLOSE_AUTHORITY_MISSING`

Decision date: 2026-08-23

Scope: docs/OpenSpec-only design record. This packet freezes the production
boundary design discovered after the D.3-C product-entry decision. It does
not modify production source or tests and does not authorize runtime,
deployment, configuration, Gateway, EDi, database, data, or AutoRecall
operations.

## 1. Decision summary

`DIRECT_CARD` remains the first, and currently only, production integration
candidate accepted by the D.3-C product interpretation. D.3-D.1 nevertheless
finds that the required production authority input for source migration does
not exist:

```text
D.3-D.1 DESIGN                         PASS_WITH_FINDINGS
DIRECT_CARD PRODUCTION SOURCE MIGRATION HOLD
BLOCKER                                 PRODUCTION_SAFE_TO_DISCLOSE_AUTHORITY_MISSING
```

This finding does not revoke the D.3-C product-entry approval. It separates
product-entry approval from source readiness: representation evidence and a
candidate integration direction exist, but a production target-surface
`safe_to_disclose` authority provider has not been designed as an authenticated
production source or implemented.

The next product question is therefore D.3-D.2, not source implementation.

## 2. Decision-critical source evidence

### 2.1 Actual legacy card-first flow

The inspected production flow is:

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

The hook calls the retrieval policy, filters the returned results through the
legacy `shouldInjectCandidate()` gate, and passes `gatedResults` to the legacy
formatter. `buildAutoRecallCardContext()` then projects each result into a
legacy Memory Card and filters it with `isInjectableMemoryCard()`.

The legacy formatter still renders `disclosure_level` and may render
`get_token`. That is the current compatibility path, not the D.3 authority
boundary.

### 2.2 Hybrid canonical read boundary

Production `hybridSearch()` already runs inside the isolated read-only hybrid
DB scope. In the isolated path it reads Core and Engine data through separate
read handles, and its canonical-result projection calls
`getCanonicalMemoriesByIds()` with the scoped Core and Engine accessors.

The public Hybrid result is intentionally reduced. `projectHybridResultFromCanonical()`
returns exact identity fields and bounded retrieval/presentation metadata; its
`text` is limited to the bounded candidate representation. It does not expose
`canonicalMemory.source.text` or attach the complete Canonical Memory to the
generic Hybrid result. The future card boundary must preserve this separation.

### 2.3 D.3 production-symbol caller status

The following D.3 symbols have no real AutoRecall production caller:

- `projectCanonicalMemoryToDisclosureCardArtifact()`;
- `createRecallCandidateEnvelope()`; and
- `selectDisclosureCandidates()`.

Their current references are source definitions, offline evaluators/shadow
paths, or tests. D.3-D.1 therefore designs a migration of the existing legacy
card-first source path; it does not replace an already-wired D.3 production
selector.

### 2.4 Current `safe_to_disclose` authority gap

`safe_to_disclose` currently exists only in offline/synthetic policy context or
evaluation labels:

- the shadow evaluator copies `candidate.label.safe_to_disclose` into its
  bounded capability context; and
- the projection-aware evaluator maps synthetic
  `policy_context.current_safe_to_disclose` into the shadow capability helper.

There is no production safe-to-disclose authority provider that authenticates
the target surface, exact Canonical Memory identity, and exact projected
payload. The current legacy admissibility path instead evaluates legacy card
policy fields and canonical/risk context. Neither path is a production D.3
authority provider.

### 2.5 Frozen C.3 first-run evidence

The C.3 first-run evidence provides the following bounded comparison:

| Synthetic family | Projection valid | Surface safe | Capability |
| --- | ---: | ---: | --- |
| `direct_safe` | 4/4 | 4/4 | `CARD_DISCLOSABLE` 4/4 |
| `redactable_secret` | 4/4 | 0/4 | `INTERNAL_CONTEXT` 4/4 |

This evidence supports the distinction between representation validity/safety
and capability. It does not provide a production authority source.

### 2.6 Artifact risk flags are not complete safety authority

For `redactable_secret`, the synthetic `runtime_candidate.risk_flags` may be
empty while the secret risk exists only in synthetic `policy_context`.
Therefore an empty `ProjectionArtifact` `risk_flags` array cannot be interpreted
as `safe_to_disclose=true`. Artifact risk metadata is representation metadata
and preserved evidence; it is not a complete target-surface safety authority.

### 2.7 Current telemetry and reinforcement boundary

The current hook computes `injectedIds`, `reinforcementAllowedIds`,
`memory_injected`, `recall_completed.injected_count`, and turn-state injection
state from `gatedResults` before the formatter has established which cards are
actually selected and rendered. A legacy card projection can then filter a
candidate after those values have been recorded.

This is a source-migration defect boundary, not a runtime operation in this
stage. The future implementation must make these states selection-derived.

## 3. Frozen production-boundary design

### 3.1 Canonical acquisition

After the query/gate boundary, the future card-first path must:

1. use the candidate's exact full `memory_id`; a bounded display `id` is not a
   canonical acquisition key;
2. remain inside the existing `withHybridDbAccessScope` read-only boundary;
3. call `getCanonicalMemoriesByIds()` for the selected candidate IDs;
4. perform one bounded Core `IN` read and one bounded Engine `IN` read for the
   batch;
5. validate the candidate `canonical_id` against the canonical identity read
   back for that `memory_id`;
6. withhold each unresolved, malformed, or identity-mismatched candidate
   individually; and
7. withhold the complete batch when the canonical read itself fails.

The canonical acquisition path must not add `canonicalMemory.source.text` to
the generic Hybrid result. Full canonical source is read only within the
bounded production boundary that needs it to derive and validate the
`DISCLOSURE_CARD` artifact.

### 3.2 Production safety authority

`CARD_DISCLOSABLE` requires a trusted, target-surface-specific
`safe_to_disclose` authority. At minimum, the authority evidence must bind:

- exact `memory_id`;
- exact `canonical_id`;
- exact `source_content_hash`;
- surface `DISCLOSURE_CARD`;
- projection kind;
- projection payload or representation hash;
- policy/provenance version; and
- the `safe_to_disclose` decision.

No such production authority provider exists today. The following are not
substitutes:

- an evaluation label;
- synthetic `policy_context`;
- a caller-supplied boolean;
- legacy `disclosure_level`;
- legacy `can_inject_card`;
- legacy `get_token`;
- retrieval rank or score;
- selector convenience logic;
- `ProjectionArtifact.risk_flags` alone; or
- a source-path/category allowlist alone.

Missing, invalid, expired, or identity/hash-mismatched authority evidence must
resolve to:

```text
capability = RETRIEVAL_ONLY
selector   = WITHHOLD
```

### 3.3 Projection and capability order

The frozen order is:

```text
Canonical Memory
  -> DISCLOSURE_CARD ProjectionArtifact
  -> projection validation
  -> authorized safe_to_disclose evidence
  -> DisclosureCapability
  -> CARD_DISCLOSABLE only
  -> selector
  -> DISCLOSE_CARD / WITHHOLD
```

Projection validation checks representation structure, identity, provenance,
surface bounds, and forbidden fields. It must not authorize disclosure.
Capability is the permission boundary; the selector is selection-only.

### 3.4 Candidate envelope and selector

The future production envelope must:

- omit `canonical.source.text` and other full canonical body content;
- avoid using legacy policy fields as capability authority;
- carry exact canonical identity;
- carry bounded retrieval evidence;
- carry the validated `DISCLOSURE_CARD` `ProjectionArtifact`; and
- carry the independently calculated capability result.

Only `CARD_DISCLOSABLE` candidates may reach a disclosure selection. Any
`RETRIEVAL_ONLY`, `INTERNAL_CONTEXT`, or missing/invalid capability result must
be `WITHHOLD`. The selector may choose `DISCLOSE_CARD` or `WITHHOLD`, but may
not generate, clean, redact, summarize, or re-project content.

The existing `createRecallCandidateEnvelope()` is a useful no-source-text
shape reference, but its legacy `policy` and `card` fields are not the target
D.3 authorization boundary and it currently has no production AutoRecall
caller.

### 3.5 Formatter

The future formatter may consume only the bounded card payload from a
`DISCLOSE_CARD` selection and its already-authorized identity. It must:

- not call a projector;
- not read raw candidate text;
- not output `get_token`;
- not fall back to `formatAutoRecallContext()` or raw text on error; and
- not use `disclosure_level` or `can_inject_card` as a second authorization
  decision.

The `DISCLOSURE_CARD` ProjectionArtifact payload does not contain `get_token`.
It must not be added for compatibility with the legacy formatter.

### 3.6 Telemetry and reinforcement

The following future states must be calculated only from actual
`DISCLOSE_CARD` selections:

- prompt-supplement cards;
- `injectedIds`;
- `reinforcementAllowedIds`;
- `memory_injected` events;
- `recall_completed.injected_count`; and
- turn-state injection count.

Gated-but-withheld candidates must not be recorded as injected and must not
receive citation reinforcement authority. A candidate being retrieved,
passing the legacy gate, or being present in a projection is not evidence that
it was disclosed.

## 4. Rejected shortcuts

The following shortcuts are explicitly rejected:

- attaching full Canonical Memory to Hybrid results;
- driving production capability from a synthetic `safe_to_disclose` label;
- interpreting empty `artifact.risk_flags` as safe;
- restoring legacy `get_token`;
- using legacy `can_inject_card` or `disclosure_level` as capability;
- creating an always-`WITHHOLD` dead production pipeline merely to satisfy the
  call graph; and
- introducing a detector, LLM classifier, DB schema, persistent safety flag,
  or data backfill in this stage.

## 5. Conditional future source slices

These slices are conditional implementation design only. They are not
authorized or executed in D.3-D.1.

**Prerequisite:** a separately approved and validated production
`safe_to_disclose` authority provider must exist first.

### Slice A — production capability and envelope

Potential files:

- `lib/recall/disclosure/disclosure-capability.js`;
- `lib/recall/disclosure/candidate-envelope.js`;
- `lib/recall/disclosure/disclosure-selector.js`; and
- focused disclosure tests.

### Slice B — bounded direct-card production boundary

Potential files:

- `lib/recall/disclosure/direct-card-production-boundary.js`;
- `lib/canonical/read-adapter.js` only if an existing API cannot satisfy exact
  batch acquisition; and
- focused boundary tests.

### Slice C — AutoRecall formatter/lifecycle integration

Potential files:

- `auto-recall.js`;
- `lib/recall/auto-recall-hook-lifecycle.js`; and
- lifecycle, telemetry-privacy, formatter, and regression tests.

Source migration must not begin until the prerequisite authority decision is
separately authorized. No source slice, capability provider, fixture,
evaluator, detector, or runtime mechanism is created by this record.

## 6. Next candidate

`D.3-D.2 DIRECT_CARD Safe-to-Disclose Authority Decision`

Status: `CANDIDATE / NOT AUTHORIZED`

D.3-D.2 must answer one question:

> Who produces production `safe_to_disclose` authority, and how is that
> authority bound to exact Canonical Memory source and the
> `DISCLOSURE_CARD` projection?

D.3-D.2 must not be started automatically. This record does not create an
implementation, fixture, evaluator, detector, DB schema, persistent safety
state, or runtime mechanism.

## 7. Mutation boundary

D.3-D.1 made no changes to:

- `lib/**`;
- `auto-recall.js`;
- `index.js`;
- `test/**` or fixtures;
- reports;
- configuration;
- Gateway/EDi/runtime state; or
- DB/data/persistent state.

No frozen one-shot holdout was rerun. Runtime verification is
`NOT APPLICABLE`. The only intended repository changes are this design record,
the current-state/roadmap updates, and the OpenSpec design/tasks bookkeeping.

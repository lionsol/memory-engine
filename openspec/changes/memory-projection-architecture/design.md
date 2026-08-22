## Phase D.3-A architecture boundary

D.3-A is architecture/design work only. It closes the conceptual boundary
between Canonical Memory, projection generation, projection validation,
disclosure capability, and selection. It does not change production source or
runtime behavior.

## Current implementation evidence

### Canonical authority

`lib/canonical/memory-object.js` composes the exact-id Canonical Memory Object
from Core-owned source data and optional Engine-owned lifecycle state. Canonical
v1 owns semantic identity, source, classification, lifecycle, and content hash.
Eligibility and presentation policy intentionally remain downstream.

### Existing vector projection

`lib/canonical/vector-projection.js` is already a clean consumer projection:

`Canonical Memory -> VectorProjection -> Lance row`

It binds exact `memory_id`, `canonical_id`, and source content hash; derives a
bounded text representation; and carries no disclosure, scope, or get
permission. D.3 treats this as the reference pattern for representation without
authorization.

### Existing Memory Card projection mixes responsibilities

`lib/recall/auto-recall-memory-card.js` currently performs several jobs in one
path:

- candidate/canonical projection into a MemoryObject;
- risk-flag inference;
- safe-summary/title construction;
- `disclosure_level` selection;
- `can_inject_card` and `can_get_full_content` policy derivation;
- Memory Card presentation construction.

This was useful as the P4 card model, but it means the projector is partly a
representation layer and partly a policy/authority layer.

A concrete divergence is intentional in old code but architecturally important:
raw-log/tool-output-like content can be replaced by generic withheld summary
text while the legacy card policy can still produce `memory_card` and a
full-content get token. By contrast, the D.2 offline admissibility controller
classifies those same risk flags as disclosure-blocking. This does not prove a
current runtime incident—AutoRecall remains default-off and D.2 is not
production integrated—but it proves that policy ownership is duplicated.

### Candidate envelope and selector

`createRecallCandidateEnvelope()` intentionally omits canonical source text and
copies only bounded canonical metadata, retrieval evidence, card projection,
and card policy. The current selector has only `WITHHOLD` and `DISCLOSE_CARD`
outcomes. It does not project content itself.

### Shadow capability

The v1.1 shadow evaluator adds a capability gate ahead of the unchanged
selector. `CARD_DISCLOSABLE` requires a valid projection plus the other v1.1
predicates; `INTERNAL_CONTEXT` and `RETRIEVAL_ONLY` cannot be upgraded by the
selector. This direction is retained.

### Evidence limitation of the D.2 v2 fixture

The v2 evaluation adapter creates a fixed synthetic bounded card:

- constant synthetic title/summary;
- risk flags copied from the candidate context;
- `memory_card` disclosure level;
- no actual canonical source payload.

Therefore `safe_to_disclose=false` in D.2 is a candidate-level evaluation label,
not evidence that a particular sanitized projected payload is unsafe or safe.
D.2-C.11 proves the value of capability gating; it cannot answer whether a new
projection transform can recover safe useful disclosure.

## Target architecture

```text
Canonical Memory
     |
     | semantic authority
     v
Projector(surface, bounded runtime metadata)
     |
     v
ProjectionArtifact
     |
     +--> Projection Validation
     |      - schema / identity binding
     |      - canonical content-hash provenance
     |      - surface content bounds
     |      - forbidden-field leakage
     |
     v
Capability Calculation / Authorization
     |      - lifecycle
     |      - scope
     |      - canonical risk/artifact state
     |      - validated projection assessment
     |      - safe_to_disclose for the target surface
     v
Authorized Projection
     |
     v
Selector
     |
     +--> WITHHOLD
     `--> selected surface artifact
```

The ordering is important: projection may transform representation, but it does
not grant permission. Capability/authorization decides whether the particular
projection may cross the target boundary. Selection happens last and cannot
upgrade either representation or permission.

## ProjectionArtifact contract

D.3 defines a projection artifact as a deterministic derived representation,
not a second semantic memory object. The minimum common envelope is:

```text
projection_schema_version
projection_kind
memory_id
canonical_id
source_content_hash
surface
payload
provenance
```

The exact payload schema is surface-specific. A projection artifact MUST NOT
carry authoritative lifecycle/category/source values that conflict with
Canonical Memory. Runtime rank/score/trace may be attached as non-semantic
metadata when a surface requires it, but they cannot change canonical identity
or capability.

## Surface taxonomy

### VECTOR_INDEX

Existing non-disclosure index representation. It is governed by indexing/write
policy rather than DisclosureCapability. Its current canonical vector projector
remains valid and does not need to be rewritten merely for architectural
uniformity.

### INTERNAL_AGENT_CONTEXT

A bounded representation usable only by an authorized internal context path.
It is not a user-visible card and cannot carry raw-disclosure authority merely
because an agent may reason over it. A later implementation must define its
payload and bounds before it can be evaluated.

### DISCLOSURE_CARD

The bounded Memory Card surface. It requires `CARD_DISCLOSABLE`; projection
validation alone is insufficient. The card projector may summarize or redact
representation, but such transformation does not authorize disclosure. Any
sanitized card must be independently assessed for the `DISCLOSURE_CARD`
surface and pass capability calculation.

### RAW_REFERENCE

Reserved boundary corresponding to future raw/full-content access. D.3-A does
not define a raw payload projector or enable `RAW_DISCLOSABLE`. Existing get
mechanisms remain outside this phase.

## Safe-to-disclose semantics

D.3 preserves the v1.1 ownership rule: `safe_to_disclose` belongs to capability
calculation, not retrieval or selector policy.

D.3 clarifies its scope: for a disclosure decision it is a predicate about the
candidate **for the target disclosure surface**, evaluated from authorized
canonical context and the validated projection assessment. It is not a global
statement that every possible representation of a canonical memory is either
safe or unsafe forever.

This clarification does not by itself convert any current
`safe_to_disclose=false` candidate to `CARD_DISCLOSABLE`. A new projection must
produce new projection-aware evidence before such authorization can exist.

## Projection validation vs safety authorization

These are separate checks.

Projection validation answers whether a projection is structurally valid and
bounded for its surface. Examples:

- exact canonical identity is preserved;
- source content hash provenance is present when required;
- a card has required fields;
- forbidden full-body fields are absent;
- size/content constraints are respected.

Capability authorization answers whether the valid projection may be used on
the target surface. A perfectly valid card can still be unauthorized because
of lifecycle, scope, risk, or `safe_to_disclose=false`.

## Policy ownership target

The target D.3 architecture removes permission decisions from pure projection
code. In particular, future projection artifacts should not be the authority
for:

- `can_inject_card`;
- `can_get_full_content`;
- scope allowance;
- raw/full-content access;
- capability upgrades.

Legacy MemoryObject/Card fields may remain during migration for compatibility,
but they are not the target authority. Removal or deprecation requires a later
source implementation and parity review; D.3-A changes no runtime contract.

## Selector responsibility

The selector receives already-authorized projections and decides only whether
to select or withhold them under bounded retrieval/presentation criteria. It
must not:

- generate a sanitized representation;
- reinterpret raw content;
- recompute semantic risk authority;
- convert `INTERNAL_CONTEXT` to `CARD_DISCLOSABLE`;
- infer raw access from a card/get token.

## Evaluation architecture

The frozen D.2 v2 fixture remains immutable historical evidence for the binary
capability-gate question.

A later D.3 projection evaluation requires a separate dataset/fixture contract
that is frozen before projector tuning. The frozen D.3-C.1 case boundary stores
at least:

```text
canonical_memory
runtime_candidate
policy_context
projection_surface
answer_bearing
expected_projection_valid
surface_safety.forbidden_literals
semantic_preservation.required_literals / required
current_v1_1.expected_capability / expected_disclosure_authority
```

The fixture stores independent validity, safety, and semantic-preservation
acceptance constraints; `expected_projection_valid` is a contract-level case
constraint, not a projector-specific predicted payload. It does not store a
projector-specific expected surface-safety boolean or a projector output. A future evaluator computes
`actual_surface_safe` and `actual_semantic_preserved` from the actual projected
payload or bounded projection features. Those values are evaluator evidence,
not frozen fixture labels.

The evaluation must be capable of distinguishing:

1. permanently non-disclosable content;
2. internally usable but non-card-authorized content;
3. content for which a concrete bounded projection is safe;
4. projection failures or semantic-loss cases.

The D.2 holdout must not be relabeled, extended, or used as a tuning corpus for
this purpose.

## Migration sequence

### D.3-A — Architecture contract

Document projection ownership, target surfaces, projection validation,
capability interaction, selector responsibility, and the evidence limitation of
D.2. No production source implementation.

### D.3-B — Projection contract/source model

Under a separate source implementation decision, add a pure projection-artifact
contract and validators/adapters with focused tests. Prefer adapters around
existing vector/card code before rewrites. Do not integrate with runtime.

#### Frozen source implementation packet

D.3-B is bounded to one new pure source module plus focused tests and this
OpenSpec/current-roadmap bookkeeping. The source module may:

1. define the common `ProjectionArtifact` envelope and the four known surfaces;
2. adapt the existing canonical vector projector to `VECTOR_INDEX` without
   changing the vector projector or Lance materializer;
3. adapt the existing canonical-aware Memory Card projector to
   `DISCLOSURE_CARD`, carrying presentation data but not legacy permission/get
   authority;
4. validate exact canonical identity/content-hash binding, surface-specific
   payload bounds, forbidden full-body leakage, and forbidden capability/policy
   authority fields;
5. fail closed for `INTERNAL_AGENT_CONTEXT` and `RAW_REFERENCE` until those
   payload contracts are separately designed.

D.3-B MUST NOT modify `auto-recall.js`, the existing Memory Card projector,
vector writer/materializer, D.2 selector/admissibility/capability source,
fixtures, Gateway/runtime/configuration, databases, or persistent data. A
valid projection artifact remains representation evidence only and cannot
produce `CARD_DISCLOSABLE`, `RAW_DISCLOSABLE`, `can_inject_card`,
`can_get_full_content`, or equivalent permission authority.

D.3-B passes when focused tests prove deterministic adapters, exact canonical
binding, cross-surface fail-closed behavior, card full-body leakage rejection,
and rejection/absence of capability or permission fields while existing
canonical vector/card regression tests remain green.

#### D.3-B source implementation status

D.3-B is `SOURCE IMPLEMENTED / VERIFIED`. `lib/canonical/projection-artifact.js`
defines the v1 common artifact envelope, the four explicit surfaces, exact
canonical identity/content-hash validation, and adapters around the existing
canonical vector and canonical-aware Memory Card projectors. The new
`DISCLOSURE_CARD` artifact deliberately carries presentation fields only: it
omits legacy `disclosure_level`, `get_token`, `can_inject_card`,
`can_get_full_content`, reinforcement, capability, and `safe_to_disclose`
authority. The validator rejects those authority fields if introduced later.

`VECTOR_INDEX` preserves the existing vector representation without changing
its projector or Lance materializer. `INTERNAL_AGENT_CONTEXT` and
`RAW_REFERENCE` are recognized surfaces but fail closed as
`surface_not_implemented`; D.3-B does not invent payload contracts for them.
No production source imports the new artifact module. `auto-recall.js`, the
existing Memory Card projector, the D.2 selector/admissibility/capability path,
fixtures, runtime, configuration, databases, and persistent data are unchanged.

Focused projection plus existing canonical vector/card tests passed `20/20`;
D.2 disclosure regressions passed `44/44`; `npm run check` passed over `671`
files; and strict OpenSpec validation passed. These are source/offline results,
not runtime qualification or production adoption.

### D.3-C — Projection-aware offline evaluation

#### D.3-C.1 — Projection-aware holdout contract freeze

D.3-C.1 is **`HOLDOUT CONTRACT FROZEN / NOT YET EVALUATED`**. The independent
synthetic fixture `memory-projection-holdout-v1` contains 24 rows across six
families, with four rows per family and a 2/2 answer-bearing balance. Every row
targets `DISCLOSURE_CARD` and carries a valid synthetic Canonical Memory v1,
bounded runtime projection input, and bounded v1.1 policy context.

The contract keeps projection representation, capability permission, and
selection separate. In particular, `surface_safety.forbidden_literals` and
`semantic_preservation.required_literals` are independent acceptance
constraints, while current v1.1 capability/disclosure authority remains a
separate label. The `capability_blocked` answer-bearing cases permit a future
`projection_feasible_but_capability_blocked` result: satisfying projection
constraints cannot upgrade `RETRIEVAL_ONLY` to `CARD_DISCLOSABLE`.

The D.2 v2 fixture remains immutable and is not reused as projection-safety
evidence. At the C.1 freeze boundary no projection evaluation had run. The
subsequent first run is recorded under D.3-C.3; no projector, capability,
selector, runtime, configuration, DB/data, Gateway, or AutoRecall mutation is
part of C.1.

#### D.3-C.2 — Projection-aware evaluator

D.3-C.2 is **`SOURCE IMPLEMENTED / NOT YET FORMALLY EVALUATED`**. The pure
`projection-aware-evaluator.js` accepts caller-supplied synthetic rows, invokes
the existing canonical-aware disclosure-card projector, re-validates the
returned artifact, and evaluates only the validated bounded card payload.
Surface safety and semantic preservation are computed from deterministic
normalized string literals; no source body, provenance, capability metadata,
selector, retrieval, DB, network, or LLM path is used.

The evaluator adapts only the bounded `policy_context` to the existing
`explainShadowCapability()` helper after actual projection validation. A valid
projection therefore cannot upgrade capability. Case results and aggregate
metrics expose actual capability/authority separately from structural validity,
surface safety, semantic preservation, and useful projection. Projection or
capability errors fail closed with bounded reason codes and no raw exception or
payload excerpts.

C.2 tests use handcrafted synthetic rows only. Before the separate C.3
execution, the frozen 24-row C.1 fixture had not been read for evaluation, and
no production threshold is defined by this implementation.

#### D.3-C.3 — Frozen projection-aware evaluation

D.3-C.3 is **`FIRST-RUN EVIDENCE RECORDED / AWAITING PLANNER ADJUDICATION`**.
At `b62121773966dea56102661c1dfc45105a50bf2e`, the frozen 24-row fixture was
passed through `evaluateProjectionAwareFixture(rows)` exactly once without
changing the C.1 fixture, freeze record, projector, capability source,
selector, or runtime path. The run produced 24/24 valid projections, 24/24
projection-validity expectation matches, 20/24 surface-safe projections,
8/12 answer-bearing semantic-preservation results, 6/12 useful projections,
2 CARD-authorized useful projections, and 4 useful projections blocked by
capability. Capability and disclosure-authority expectation matches were both
24/24. The bounded case and family evidence is recorded in
`reports/memory-projection-holdout-v1-first-run-20260822.md`.

This is evidence only: no PASS/FAIL/READY threshold or product interpretation
is assigned here. Product interpretation remains a separate Planner decision
and no D.3-D production/runtime authority follows from this run.

#### D.3-C.4 — Projection strategy taxonomy and decision record

D.3-C.4 is **`PROJECTION STRATEGY TAXONOMY DEFINED`** and is an
docs/OpenSpec-only architecture decision. The accepted design direction is
recorded in `docs/memory-projection-strategy-taxonomy-v1.md`.

The taxonomy freezes `DIRECT_CARD`, `REDACTED_CARD`, `SUMMARIZED_CARD`,
`INTERNAL_CONTEXT_PROJECTION`, and `REFERENCE_ONLY` as representation strategy
names, not capability states. Canonical Memory remains semantic authority;
ProjectionArtifact validation remains the structural/provenance/surface-bound
check; capability remains authorization; and selector remains selection.
Projection success cannot grant `CARD_DISCLOSABLE`, change lifecycle or scope
authority, or bypass capability.

The C.3 evidence interpretation is bounded: the current artifact contract had
no structural failure on the frozen synthetic holdout, current v1.1 capability
matched the frozen expected contract `24/24`, and the current card
representation showed specific surface-safety and semantic-preservation gaps.
The first future research priority is a separately bounded `REDACTED_CARD`
offline prototype decision, followed separately by possible
`INTERNAL_AGENT_CONTEXT` design research for raw/tool output. C.4 authorizes
neither implementation. D.3-D production integration remains unchecked and
separately unauthorized.

#### D.3-C.5 — REDACTED_CARD offline prototype

D.3-C.5 is **`REDACTED_CARD OFFLINE PROTOTYPE IMPLEMENTED / NOT INDEPENDENTLY EVALUATED`**.
`lib/recall/disclosure/redacted-card-prototype.js` provides a pure,
representation-only prototype that starts from the existing canonical-aware
`DISCLOSURE_CARD` projection, applies an explicit bounded field-specific plan,
and validates the resulting candidate payload with the existing artifact
validation machinery.

The prototype uses the fixed replacement `[REDACTED]`, permits directives only
for `title`, `summary`, `salience_reason`, and `source_hint`, and fails closed
for malformed plans, forbidden fields, missing exact targets, baseline
projection failure, or candidate validation failure. Canonical identity,
category, kind, confidence, and risk flags remain unchanged. No content
detection authority is introduced: the caller supplies the redaction plan.

The result is a `REDACTED_CARD` strategy candidate, not a new formal
`ProjectionArtifact` kind and not a capability state. It carries no capability,
safe-to-disclose, disclosure-authority, selector, lifecycle, or scope decision.
The C.1 fixture and C.3 first-run report were not reused for tuning or
evaluation; existing production projector, evaluator, capability, selector,
and runtime paths remain unchanged.

The next bounded decision is independent offline evaluation evidence for this
prototype. C.5 does not claim redaction safety, production readiness, or
authorization to implement secret detection or runtime integration.

### D.3-D — Production integration

Only after D.3-C evidence and a separate product decision may production
capability/admissibility/selector/card paths be migrated. Deployment, Gateway,
AutoRecall, configuration, database/data mutation, and runtime qualification
remain separately authorized.

## Risks / trade-offs

- **Architecture duplication:** adding a new universal projector framework could
  over-engineer the already-correct vector path. Mitigation: define a common
  contract, not a mandatory rewrite.
- **Policy leakage:** keeping legacy policy fields during migration may continue
  to look authoritative. Mitigation: explicitly mark target authority and test
  adapters before removal.
- **Fixture overfitting:** reusing D.2 labels to justify sanitization would be
  invalid evidence. Mitigation: new projection-aware frozen evaluation.
- **Semantic loss:** aggressive sanitization can be safe but useless. Mitigation:
  evaluate answer-bearing/semantic preservation independently from safety.
- **Capability erosion:** a projector could become a backdoor capability
  upgrade. Mitigation: selector/projector never authorize; capability remains a
  separate gate after projection validation.

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

#### D.3-C.6 — Independent REDACTED_CARD holdout freeze

D.3-C.6 is **`INDEPENDENT REDACTED_CARD HOLDOUT FROZEN / NOT YET EVALUATED`**.
The fresh synthetic `redacted-card-holdout-v1` fixture has 12 rows across six
families, with two rows per family and one answer-bearing/non-answer-bearing
row per family. Its plans are intended-valid instances of the closed C.5 plan
schema and cover all four allowed presentation fields.

The fixture freezes only caller-supplied projection inputs, explicit redaction
plans, and independent acceptance constraints: forbidden literals,
answer-bearing semantic anchors, and expected structural compatibility. It does
not store expected candidate payloads, rewritten fields, full artifacts,
replacement output, capability expectations, or disclosure authority. It has
no capability label because this contract tests representation transformation
only.

`lib/recall/disclosure/redacted-card-holdout.js` is a pure contract validator
that does not import the prototype, projection artifact, evaluator, capability,
selector, storage, network, or LLM paths. C.6 did not call the prototype and
did not evaluate the new fixture. The C.1 fixture, C.3 report, and C.5 unit
literals remain outside the new holdout's design inputs.

The next bounded decision is **D.3-C.7 — pure independent REDACTED_CARD
evaluator**, which is not authorized by C.6. D.3-D production integration
remains separately unauthorized.

#### D.3-C.7 — Pure independent REDACTED_CARD evaluator

D.3-C.7 is **`PURE INDEPENDENT REDACTED_CARD EVALUATOR IMPLEMENTED / FROZEN HOLDOUT NOT YET EXECUTED`**.
`lib/recall/disclosure/redacted-card-evaluator.js` accepts only caller-supplied
in-memory rows that pass the C.6 contract. It builds a baseline
`DISCLOSURE_CARD`, invokes the existing representation-only prototype, and
computes bounded evidence for transform success, structural compatibility,
surface safety, semantic preservation, protected-field preservation, and
unplanned presentation-field drift.

The evaluator returns no candidate or baseline payload, canonical memory,
runtime input, capability, disclosure authority, selector decision, or get
token. Its aggregate metrics use answer-bearing rows as the denominator for
semantic-preservation and useful-projection rates. It has no filesystem,
fixture, DB, retrieval, network, LLM, capability, selector, or runtime
dependency and reports an explicit offline side-effect contract.

C.7 tests use only handcrafted C7 synthetic rows, including a generated
12-row/six-family contract-valid set for the full-contract API. The frozen C.6
fixture was not opened or evaluated, no evaluation report was generated, and
the prototype, holdout validator, capability, selector, and production paths
remain unchanged. The next bounded decision is **D.3-C.8 — one-shot execution
of the frozen C.6 holdout**, which is not authorized by C.7.

#### D.3-C.8 — One-shot independent REDACTED_CARD evaluation

D.3-C.8 is **`PASS / FIRST-RUN EVIDENCE ACCEPTED`** by Planner adjudication.
At the immutable C.7 execution HEAD, the frozen 12-row C.6 fixture was passed
through `evaluateRedactedCardFixture(rows)` exactly once. The bounded result
recorded 12/12 transform successes, 12/12 structural-compatibility matches,
12/12 surface-safe results, 6/6 answer-bearing semantic-preservation results,
12/12 protected-field-preservation results, 12/12 no-unplanned-drift results,
and 6 useful answer-bearing projections. All six frozen families contributed
two cases and one useful answer-bearing result.

The complete bounded evidence is recorded in
`reports/redacted-card-holdout-v1-first-run-20260822.md`. This result is
representation evidence only: it creates no capability or production
authority, defines no PASS/FAIL threshold, and does not authorize source,
fixture, runtime, configuration, DB/data, or deployment changes. The next
decision is the D.3-C.9 authority-boundary design; no production integration
follows automatically.

#### D.3-C.9 — Redaction Plan Authority & Safety Boundary

D.3-C.9 is **`REDACTION PLAN AUTHORITY BOUNDARY DEFINED`** and is a
docs/OpenSpec-only architecture decision. The decision record is
`docs/redaction-plan-authority-boundary-v1.md`.

C.9 separates Risk Authority, Redaction Directive Authority, and
Transformation. Existing object-level risk flags can justify withholding,
review, or lower capability, but cannot synthesize an exact field/literal
directive. The current `projectRedactedCardCandidate()` executes only an
explicit bounded plan; no literal-level production authority source is
currently implemented.

The runtime `redactEvidenceText()` helper is limited to runtime evidence
capture sanitization and is not a Canonical Memory, redaction-directive, or
`DISCLOSURE_CARD` authority. Future authority candidates are
`STRUCTURED_SOURCE_ANNOTATION`, `EXPLICIT_REDACTION_DIRECTIVE`, and research-only
`DETERMINISTIC_DETECTOR_EVIDENCE`; no LLM or risk-flag authority is defined.

Future authoritative directives must bind exact field/literal evidence to
`memory_id`, `canonical_id`, `source_content_hash`, and a target surface, and
must fail closed when stale. The discussion is surface-specific to
`DISCLOSURE_CARD`; successful redaction does not clear risk or grant capability.
No production envelope, detector, resolver, capability, selector, runtime,
configuration, DB/data, or deployment change is part of C.9.

The C.9 decision record is closed without implementing a literal-level
production authority source. The next bounded contract is D.3-C.10.

#### D.3-C.10 — Structured Redaction Evidence Contract

D.3-C.10 is **`STRUCTURED REDACTION EVIDENCE CONTRACT IMPLEMENTED / OFFLINE
ONLY / NOT PRODUCTION AUTHORITY`**. The pure module
`lib/recall/disclosure/redaction-evidence-contract.js` defines a closed schema
v1 for identity-bound, surface-bound, baseline-bound evidence. It validates
exact `DISCLOSURE_CARD` identity and baseline projection binding, deterministic
SHA-256 representation hashes, bounded authority kinds and evidence references,
exact presentation-field targets, duplicate rejection, and stale evidence.

`STRUCTURED_SOURCE_ANNOTATION`, `EXPLICIT_REDACTION_DIRECTIVE`, and
`DETERMINISTIC_DETECTOR_EVIDENCE` are structurally representable kinds only;
detector evidence remains research-only. Structural validity is not production
authorization, and the module has no resolver, detector, plan conversion,
redaction application, capability, selector, runtime, configuration, DB/data,
or deployment behavior. The baseline artifact is supplied by the caller; C.10
does not create a projector or accept a runtime candidate.

The C.10 source contract is closed without implementing resolution or
authenticated evidence origin. The next bounded decision is D.3-C.11.

#### D.3-C.11 — Redaction Evidence Resolution Semantics

D.3-C.11 is **`REDACTION EVIDENCE RESOLUTION SEMANTICS DEFINED`** and is a
docs/OpenSpec-only architecture decision. The decision record is
`docs/redaction-evidence-resolution-semantics-v1.md`.

C.11 defines semantics for future multi-envelope interpretation without
implementing a resolver. Every input must first pass C.10 against the same
canonical identity and baseline projection; any malformed, stale, mismatched,
unsupported, overlapping, or order-dependent claim invalidates the entire set.
No invalid claim may be silently dropped, and no partial redaction may be
salvaged.

`authority_kind` remains claim classification rather than authenticated
authority identity. `STRUCTURED_SOURCE_ANNOTATION` and
`EXPLICIT_REDACTION_DIRECTIVE` are authority-eligible future candidates, not
automatic production precedence; `DETERMINISTIC_DETECTOR_EVIDENCE` remains
research-only and may only be retained as non-authoritative corroboration.
Exact field/literal duplicates are corroboration, distinct fields may coexist,
and overlapping or order-dependent targets are conflicts. The taxonomy is
`INVALID_EVIDENCE_SET`, `CONFLICTING_EVIDENCE_SET`,
`NON_AUTHORITATIVE_EVIDENCE_ONLY`, and
`CONSISTENT_AUTHORITY_ELIGIBLE_SET`; the last remains neither an
`AuthorizedRedactionPlan` nor capability/selector authority.

C.11 also records that positive claims do not prove complete sensitive-content
coverage, and resolution does not clear risk, change lifecycle/scope, set
`safe_to_disclose`, grant `CARD_DISCLOSABLE`, or choose a selector outcome.
No resolver, detector, authority-origin authentication, production plan
source, capability, selector, runtime, configuration, DB/data, or deployment
change is part of C.11.

The redaction branch is closed at C.11 and does not create a resolver stage.
The next bounded decision is the separate `INTERNAL_AGENT_CONTEXT` design for
raw/tool output; trusted-origin production work remains a future D.3-D product
decision.

#### D.3-C.12 — INTERNAL_AGENT_CONTEXT Representation Design

D.3-C.12 is **`INTERNAL_AGENT_CONTEXT REPRESENTATION BOUNDARY DEFINED`** and
is a docs/OpenSpec-only architecture decision. The decision record is
`docs/internal-agent-context-representation-design-v1.md`.

C.3 evidence for both `raw_log` and `tool_output` was projection-valid `4/4`
and surface-safe `4/4`, but answer-bearing semantic preservation was `0/2`
and useful projection was `0`; both had expected capability
`RETRIEVAL_ONLY`. This demonstrates a current `DISCLOSURE_CARD`
semantic-preservation gap only. It does not authorize `INTERNAL_CONTEXT`, and
the current generic withheld `safeSummary` behavior for risky card content
remains an intentional card safety mechanism.

C.12 freezes three separate terms: `INTERNAL_CONTEXT_PROJECTION` is a
representation strategy, `INTERNAL_AGENT_CONTEXT` is a projection surface,
and `INTERNAL_CONTEXT` is a capability state. The first research direction is
a bounded deterministic extractive, source-faithful representation, not an
abstractive summary or LLM rewrite. `SUMMARIZED_CARD` and `REFERENCE_ONLY`
remain separate strategies; `RAW_REFERENCE` remains a separate unimplemented
surface.

Future internal payloads must be bounded, provenance/identity-bound,
explicitly data-only and untrusted, preserve relevant structure and risk
metadata, and carry explicit truncation/segmentation evidence. They must not
carry capability, selector, get-token, raw-disclosure, or execution authority.
Internal evidence must remain separate from system/developer/tool
instructions, and future consumers must interpret instruction-like content as
data only. C.12 does not freeze a final payload schema, content-role field,
segment selector, numeric bound, prompt wrapper, or runtime integration.

The current expected capability remains `RETRIEVAL_ONLY`; projection
feasibility does not change it. The scope is limited to `raw_log` and
`tool_output`, not `sensitive_source`, `dreaming_artifact`, or cross-agent
material. Future offline evaluation must separately measure structural
validity, boundedness, source faithfulness, semantic preservation,
instruction/data isolation, risk/provenance preservation, and absence of
capability authority. No fresh fixture or production threshold is created.

#### D.3-C.13 — INTERNAL_AGENT_CONTEXT Projection Contract Prototype

D.3-C.13 is **`INTERNAL_AGENT_CONTEXT PROJECTION CONTRACT PROTOTYPE IMPLEMENTED / OFFLINE ONLY / NOT CAPABILITY AUTHORIZED`**. The existing `ProjectionArtifact` module now exposes a pure `INTERNAL_AGENT_CONTEXT` adapter and validator; no second artifact framework was introduced.

The prototype accepts only a closed caller selection containing ordered,
non-overlapping JavaScript code-unit character ranges over
`canonicalMemory.source.text` plus bounded caller-supplied risk flags. Segment
text is always derived by the adapter from the canonical source slice; callers
cannot submit segment text or an external body. The prototype bounds segments
to four, each segment to 1024 characters, total selected text to 2048
characters, risk flags to 16 entries, and each flag to 64 characters. It
preserves `\t`, `\n`, and `\r`, and rejects other control/format/non-printing
characters without normalization.

The payload is a closed v1 contract with
`content_role: "untrusted_evidence"`, inherited canonical category/kind and
identity/provenance binding, source/selection counts, explicit full-selection
state, source-derived segments, and value-preserved caller risk metadata.
Validation rechecks the source slices and recursively rejects authority/policy
fields. `content_role` is representation semantics only; it is not an
`INTERNAL_CONTEXT` capability, user disclosure, selector decision, or runtime
instruction channel. `RAW_REFERENCE` remains recognized but unimplemented,
and `REFERENCE_ONLY` remains outside this source change.

C.13 includes handcrafted contract tests only. It does not implement a segment
detector or selector, summarizer, LLM, production caller, capability/selector
change, runtime consumer, or holdout. The current `DISCLOSURE_CARD` projector
and its risky-content withholding behavior remain unchanged.

#### D.3-C.14 — Independent INTERNAL_AGENT_CONTEXT Holdout Freeze

D.3-C.14 is **`INDEPENDENT INTERNAL_AGENT_CONTEXT HOLDOUT FROZEN / NOT YET EVALUATED`**. The fresh `internal-agent-context-holdout-v1` JSONL contract contains 12 synthetic rows across six families, with two balanced rows per family and one answer-bearing row per family. The fixture uses the independent `IACH1_` namespace and was created after the C.13 prototype; C.13 unit literals and the C.1/C.6 fixtures were not reused.

The pure validator at `lib/recall/disclosure/internal-agent-context-holdout.js` independently enforces the closed row, canonical-memory, caller-supplied range, risk-flag, label, family-balance, source-slice, and source-full-selection contracts. It does not import or call the C.13 projector, read a fixture, perform evaluation, access capability/selector/runtime/storage/network/LLM facilities, or freeze expected output. The freeze test binds the exact fixture SHA, old fixture immutability, independent bounds, no-authority labels, and fail-closed mutation cases.

C.14 freezes acceptance constraints only: source-derived semantic anchors must be inside selected ranges, instruction-like literals are labeled as data evidence, expected risk flags mirror selection metadata, and full-source selection is recorded as a representation fact. It does not produce measured projection results, capability labels, runtime authority, or a production readiness claim. No evaluator execution occurred.

The next bounded candidate is **D.3-C.15 Pure Independent INTERNAL_AGENT_CONTEXT Evaluator — CANDIDATE / NOT AUTHORIZED BY C.14**. It must keep the frozen C.14 fixture unevaluated until separately authorized and must not add runtime/capability/selector wiring.

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

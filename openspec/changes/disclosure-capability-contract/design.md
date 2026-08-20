## Phase 1.1 contract boundary

This change is documentation-only. It refines the capability boundary needed
after the Phase D.2-B product architecture finding and the D.2-C.7 shadow
result without changing any runtime module. The contract is a design
authority for a future implementation, not an implementation or evaluation
claim.

## DisclosureCapability v1.1

`DisclosureCapability v1.1` is a derived policy state associated with a
candidate-level canonical memory context. Its state is one of:

- `RETRIEVAL_ONLY`: retrieval may make the candidate available for inspection,
  but it is not authorized for internal context, card disclosure, or raw
  disclosure.
- `INTERNAL_CONTEXT`: the candidate may be used by an authorized internal
  context path, but it is not authorized for user-visible card or raw
  disclosure.
- `CARD_DISCLOSABLE`: the candidate may be represented by a bounded Memory
  Card only when lifecycle is active, the projection is valid, scope is
  allowed, risk is acceptable, and `safe_to_disclose=true`. It is not
  raw/full-content authority.
- `RAW_DISCLOSABLE`: reserved for a separately authorized future path. It is
  disabled by default in the current system.

The capability state is not a ranking score and is not inferred solely from
retrieval availability. `RAW_DISCLOSABLE` is not a default or fallback state.

### Capability predicate and ownership

`safe_to_disclose` is an input/predicate owned by disclosure capability
calculation. It is not retrieval eligibility, a selector heuristic, or a
presentation-formatting choice. The capability calculation combines it with
active lifecycle, valid projection, allowed scope, and acceptable risk before
granting `CARD_DISCLOSABLE`.

`safe_to_disclose=false` does not by itself deny retrieval. A sensitive or
unsafe candidate that remains usable for authorized internal context is
`INTERNAL_CONTEXT`; a blocked or otherwise unusable candidate is
`RETRIEVAL_ONLY`. Neither state may be upgraded by selection.

## Authority rules

Canonical Memory is the semantic authority for identity, classification,
lifecycle, scope, and canonical content. Disclosure capability is a derived
policy state calculated from authorized canonical/admissibility inputs,
including the `safe_to_disclose` predicate. It does not create a second
semantic memory model.

The selector receives only capability-authorized candidates. It is a
presentation decision only: it may withhold a candidate or choose among
candidates already marked `CARD_DISCLOSABLE`; it MUST NOT upgrade a
capability. In particular, the following transition is forbidden:

`INTERNAL_CONTEXT -> CARD_DISCLOSABLE`

Retrieval evidence, missing semantic evidence, a prompt classifier result, or
selector convenience cannot authorize that transition. A future capability
calculator must fail closed when required authority inputs are unavailable.

## Responsibility boundary

### Admissibility

Future admissibility policy/capability calculation is responsible for
calculating or validating the capability state from lifecycle, scope, risk,
artifact, projection, and `safe_to_disclose`. The current admissibility
implementation is unchanged by this contract.

### Selector

The selector is responsible for choosing among `CARD_DISCLOSABLE` candidates
and returning a bounded card presentation or withholding the candidate. It is
not responsible for inventing capability or resolving semantic history
authority.

### Projection

Future projection logic is responsible for creating the safe representation
permitted by the capability state. Card projection cannot expose raw content;
raw projection remains reserved for a separately authorized capability.

## Evaluation boundary

Future candidate-level evaluation should provide and compare:

- `expected_capability`;
- `expected_disclosure`;
- the observed capability and presentation decision.

It should not treat prompt intent, `task_intent`, `recall_intent`, history
regexes, or semantic classifier accuracy as the capability authority. Retrieval
availability and disclosure authorization must be measured separately.

## Evidence boundary

This v1.1 update is an architecture contract only. It is not a capability
implementation, an offline evaluation result, a shadow re-evaluation, or
runtime authorization. No selector, evaluator, fixture, configuration,
database, data, or runtime behavior changes follow from this document.

## Migration stages

### Stage 1 — Capability contract v1.1

Define and review the capability states, `safe_to_disclose` predicate,
authority rules, responsibility boundaries, and evaluation fields. This is the
current stage. No source, fixture, runtime, or data change is included.

### Stage 2 — Offline evaluator update

With a separately approved evaluation contract, update candidate-level offline
evaluation to carry expected capability and the `safe_to_disclose` predicate.
This must not tune existing selector behavior and must not be treated as
runtime authorization.

### Stage 3 — Shadow re-evaluation

Run a separately approved offline shadow re-evaluation against the updated
contract. Its result remains evidence for review and does not authorize
runtime adoption.

### Stage 4 — Runtime integration after explicit authorization

Only a separate product decision and explicit runtime authorization may add a
capability calculator or connect capability to production admissibility,
projection, or selector flow. Raw access remains disabled unless separately
authorized; no stage in this change grants that authority.

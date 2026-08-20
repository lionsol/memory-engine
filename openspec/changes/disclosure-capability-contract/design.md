## Phase 1 contract boundary

This change is documentation-only. It captures the capability boundary needed
after the Phase D.2-B product architecture finding without changing any
runtime module. The contract is a design authority for a future implementation,
not an implementation claim.

## DisclosureCapability v1

`DisclosureCapability v1` is a derived policy state associated with a
candidate-level canonical memory context. Its state is one of:

- `RETRIEVAL_ONLY`: retrieval may make the candidate available for inspection,
  but it is not authorized for internal context, card disclosure, or raw
  disclosure.
- `INTERNAL_CONTEXT`: the candidate may be used by an authorized internal
  context path, but it is not authorized for user-visible card or raw
  disclosure.
- `CARD_DISCLOSABLE`: the candidate may be represented by a bounded Memory
  Card. It is not raw/full-content authority.
- `RAW_DISCLOSABLE`: reserved for a separately authorized future path. It is
  disabled by default in the current system.

The capability state is not a ranking score and is not inferred solely from
retrieval availability. `RAW_DISCLOSABLE` is not a default or fallback state.

## Authority rules

Canonical Memory is the semantic authority for identity, classification,
lifecycle, scope, and canonical content. Disclosure capability is a derived
policy state calculated from authorized canonical/admissibility inputs. It
does not create a second semantic memory model.

The selector is a presentation decision only. It may withhold a candidate or
choose among candidates already marked `CARD_DISCLOSABLE`; it MUST NOT
upgrade a capability. In particular, the following transition is forbidden:

`INTERNAL_CONTEXT -> CARD_DISCLOSABLE`

Retrieval evidence, missing semantic evidence, a prompt classifier result, or
selector convenience cannot authorize that transition. A future capability
calculator must fail closed when required authority inputs are unavailable.

## Responsibility boundary

### Admissibility

Future admissibility policy is responsible for calculating or validating the
capability state from lifecycle, scope, risk, artifact, projection, and other
explicitly authorized policy inputs. The current admissibility implementation
is unchanged by this contract.

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

## Migration stages

### Stage 1 — Contract only

Define and review the capability states, authority rules, responsibility
boundaries, and evaluation fields. This is the current stage. No source,
fixture, runtime, or data change is included.

### Stage 2 — Offline shadow evaluation

With a separately approved evaluation contract, add candidate-level shadow
evaluation of expected capability versus observed capability and disclosure.
The evaluation must remain offline, must not tune existing selector behavior,
and must not be treated as runtime authorization.

### Stage 3 — Runtime integration after explicit authorization

Only a separate product decision and explicit runtime authorization may add a
capability calculator or connect capability to production admissibility,
projection, or selector flow. Raw access remains disabled unless separately
authorized; no stage in this change grants that authority.

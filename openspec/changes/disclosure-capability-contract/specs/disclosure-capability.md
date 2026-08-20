## ADDED Requirements

### Requirement: Disclosure Capability v1.1 has explicit bounded states

The contract MUST define `DisclosureCapability v1.1` with
`RETRIEVAL_ONLY`, `INTERNAL_CONTEXT`,
`CARD_DISCLOSABLE`, and reserved `RAW_DISCLOSABLE` states. Raw disclosure MUST
remain disabled by default.

#### Scenario: Retrieval is not card authority

- **WHEN** a candidate is available from retrieval only
- **THEN** its capability is not treated as card or raw disclosure authority

### Requirement: Card capability requires safe disclosure inputs

`CARD_DISCLOSABLE` MUST require active lifecycle, valid projection, allowed
scope, acceptable risk, and `safe_to_disclose=true`. The
`safe_to_disclose` predicate MUST be owned by disclosure capability
calculation, not retrieval eligibility, selector heuristics, or presentation
formatting.

#### Scenario: Unsafe disclosure is not card authority

- **WHEN** `safe_to_disclose=false` for an otherwise retrievable candidate
- **THEN** the candidate MUST NOT receive `CARD_DISCLOSABLE` capability

### Requirement: Unsafe does not automatically deny retrieval

`safe_to_disclose=false` MUST NOT by itself deny retrieval. A sensitive or
unsafe but internally usable candidate MUST map to `INTERNAL_CONTEXT`; a
blocked or unusable candidate MUST map to `RETRIEVAL_ONLY`.

#### Scenario: Internal use remains distinct from card disclosure

- **WHEN** a candidate is unsafe for card disclosure but remains usable by an
  authorized internal context path
- **THEN** its capability is `INTERNAL_CONTEXT`, not `RETRIEVAL_ONLY` or
  `CARD_DISCLOSABLE`

### Requirement: Capability and presentation are separate authorities

Canonical Memory MUST remain semantic authority, capability MUST be a derived
policy state, and the selector MUST be a presentation decision only over
capability-authorized candidates. The selector MUST NOT upgrade a capability
state.

#### Scenario: Internal context cannot be upgraded by selection

- **WHEN** a candidate has `INTERNAL_CONTEXT` capability
- **THEN** the selector cannot treat it as `CARD_DISCLOSABLE` without a
  separately authorized capability calculation

### Requirement: Capability responsibilities are bounded

Admissibility/capability calculation MUST own future capability calculation or
validation, including `safe_to_disclose`; the selector MUST choose only among
card-authorized candidates, and projection MUST create only the
representation permitted by capability.

#### Scenario: Raw disclosure remains reserved

- **WHEN** a candidate is selected for automatic disclosure
- **THEN** only a permitted bounded card representation may be exposed;
  `RAW_DISCLOSABLE` is not a default fallback

### Requirement: Evaluation is capability-level and offline before migration

Future evaluation MUST compare expected capability and expected disclosure at
candidate level. It MUST NOT use prompt intent, `task_intent`,
`recall_intent`, or semantic classifier accuracy as disclosure capability
authority.

#### Scenario: Capability evaluation is independent of prompt taxonomy

- **WHEN** a candidate evaluation row is scored
- **THEN** capability and disclosure outcomes are compared without converting
  prompt intent labels into disclosure authority

### Requirement: The v1.1 update remains contract-only

This update MUST be treated as architecture contract documentation only. It
MUST NOT be represented as an implementation, shadow evaluation result, or
runtime authorization.

#### Scenario: Contract refinement does not change behavior

- **WHEN** this v1.1 document is updated without a separately authorized
  implementation
- **THEN** selector, evaluator, fixtures, AutoRecall, configuration, data, and
  runtime behavior remain unchanged

### Requirement: Runtime integration requires explicit authorization

The contract-only and offline-shadow stages MUST NOT change runtime behavior.
Any production capability integration MUST be a separately authorized stage.

#### Scenario: Contract documentation does not enable disclosure

- **WHEN** this OpenSpec change is present without a separately authorized
  implementation
- **THEN** AutoRecall, selector behavior, raw access, configuration, and
  runtime deployment remain unchanged

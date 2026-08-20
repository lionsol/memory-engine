## ADDED Requirements

### Requirement: Capability states do not imply automatic upgrades

`DisclosureCapability v1.1` MUST distinguish retrieval availability, internal
context use, bounded card disclosure, and reserved raw disclosure. A selector
MUST NOT promote a lower capability to a higher disclosure capability.

#### Scenario: Missing capability authority fails closed

- **WHEN** the required capability inputs are unavailable
- **THEN** no card or raw disclosure authority is inferred from retrieval or
  selector output alone

### Requirement: Safe disclosure is a capability predicate

`CARD_DISCLOSABLE` MUST require active lifecycle, valid projection, allowed
scope, acceptable risk, and `safe_to_disclose=true`. The
`safe_to_disclose` predicate MUST belong to capability calculation rather than
retrieval eligibility, selector heuristics, or presentation formatting.

#### Scenario: Unsafe candidates remain non-card-authorized

- **WHEN** `safe_to_disclose=false`
- **THEN** the candidate cannot be assigned `CARD_DISCLOSABLE`

### Requirement: Unsafe and blocked states remain distinct

`safe_to_disclose=false` MUST NOT automatically deny retrieval. A sensitive or
unsafe but internally usable candidate maps to `INTERNAL_CONTEXT`, while a
blocked or unusable candidate maps to `RETRIEVAL_ONLY`.

#### Scenario: Internal context is not retrieval denial

- **WHEN** an unsafe candidate remains usable by an authorized internal path
- **THEN** its capability is `INTERNAL_CONTEXT` and not a card authority

### Requirement: The capability contract remains offline until authorized

Stage 1 MUST be the v1.1 documentation-only contract, Stage 2 MUST be an
offline evaluator update, and Stage 3 MUST be shadow re-evaluation. None of
these stages authorizes runtime integration, AutoRecall enablement, or raw
access.

#### Scenario: Offline findings do not enable production

- **WHEN** an offline capability evaluation produces a result
- **THEN** the result remains evidence for review and does not mutate runtime
  policy or data

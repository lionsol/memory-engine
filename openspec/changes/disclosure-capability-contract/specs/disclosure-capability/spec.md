## ADDED Requirements

### Requirement: Capability states do not imply automatic upgrades

`DisclosureCapability v1` MUST distinguish retrieval availability, internal
context use, bounded card disclosure, and reserved raw disclosure. A selector
MUST NOT promote a lower capability to a higher disclosure capability.

#### Scenario: Missing capability authority fails closed

- **WHEN** the required capability inputs are unavailable
- **THEN** no card or raw disclosure authority is inferred from retrieval or
  selector output alone

### Requirement: The capability contract remains offline until authorized

Stage 1 MUST be documentation-only and Stage 2 MUST be offline shadow
evaluation. Neither stage authorizes runtime integration, AutoRecall
enablement, or raw access.

#### Scenario: Offline findings do not enable production

- **WHEN** an offline capability evaluation produces a result
- **THEN** the result remains evidence for review and does not mutate runtime
  policy or data

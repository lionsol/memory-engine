## 1. Disclosure Capability Contract — Phase 1.1

- [x] 1.1 Document the retrieval, internal-context, card, and raw capability states.
- [x] 1.2 Define canonical, capability, admissibility, selector, and projection authority boundaries.
- [x] 1.3 Define candidate-level evaluation fields independent of prompt intent taxonomy.
- [x] 1.4 Record the four-stage migration plan and explicit runtime authorization boundary.
- [x] 1.5 Record the Phase D.2-B architecture finding without changing source or fixtures.
- [x] 1.6 Validate the OpenSpec and documentation-only repository checks.
- [x] 1.7 Promote `safe_to_disclose` to the capability predicate and define its internal-context versus retrieval-only mapping.
- [x] 1.8 Record the v1.1 evidence boundary without treating the shadow result as an implementation or authorization.

## 2. Future stages — not started

- [ ] 2.1 Update the offline evaluator contract to carry capability and `safe_to_disclose` inputs.
- [ ] 2.2 Run a separately authorized offline shadow re-evaluation.
- [ ] 2.3 Obtain explicit authorization before any runtime capability integration.

This v1.1 change is contract-only. It does not implement capability
calculation, change selector/admissibility behavior, execute evaluation,
enable raw access, authorize runtime, or mutate configuration, databases, or
data.

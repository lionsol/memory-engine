## 1. Phase 2.5-A — Contract finalization

- [x] 1.1 Finalize `docs/canonical-memory-object-contract.md` with exact Core field mappings, exact-id failure behavior, category authority, kind mapping, temporal rules, and deferred eligibility boundaries.
- [x] 1.2 Add contract regression assertions covering identity, ownership, category, kind, temporal, runtime evidence, eligibility, and A/B/D boundaries.
- [ ] 1.3 Keep the finalized contract and this OpenSpec change as the references for all later Phase 2.5 work.

## 2. Phase 2.5-B — Read-only Canonical Adapter

- [ ] 2.1 Implement the adapter only with isolated readonly Core and Engine handles; do not add a canonical table, schema migration, or production wiring in the design phase.
- [ ] 2.2 Implement exact-id, fail-closed lookup and valid external-object behavior for absent Engine rows.
- [ ] 2.3 Prove Core field mapping, category authority chain, closed kind mapping, supported episode-date relation, and no-`text_inference` behavior with fixtures.

## 3. Phase 2.5-C — Projection Unification

- [ ] 3.1 Migrate Recall, Memory Card, and vector-facing semantic normalization to consume the Canonical Memory Object.
- [ ] 3.2 Keep query/ranking/channel/agent/citation evidence downstream and establish deterministic eligibility policy before adding any canonical eligibility field.
- [ ] 3.3 Demonstrate compatibility parity before removing duplicated semantic inference.

## 4. Phase 2.5-D — Reconciliation Integration

- [ ] 4.1 Define Core-to-Engine-to-Lance reconciliation around exact Core/canonical identity without creating a third store.
- [ ] 4.2 Obtain separate explicit owner authorization for persistent writes, migration, runtime activation, and rollout before implementation or qualification.
- [ ] 4.3 Add DB-boundary, rollback, and persistence evidence appropriate to the authorized write path.

## 5. Non-goal and safety review

- [ ] 5.1 Confirm no phase task enables AutoRecall, changes ranking in A/B, changes multi-agent ACL, grants Lance authority, or treats this OpenSpec as persistent-write authorization.

## 1. Phase 2.5-A — Contract finalization

- [x] 1.1 Finalize `docs/canonical-memory-object-contract.md` with exact Core field mappings, exact-id failure behavior, category authority, kind mapping, temporal rules, and deferred eligibility boundaries.
- [x] 1.2 Add contract regression assertions covering identity, ownership, category, kind, temporal, runtime evidence, eligibility, and A/B/D boundaries.
- [x] 1.3 Keep the finalized contract and this OpenSpec change as the references for all later Phase 2.5 work.

## 2. Phase 2.5-B — Read-only Canonical Adapter

- [x] 2.1 Implement the adapter only with isolated readonly Core and Engine handles; do not add a canonical table, schema migration, or production wiring.
- [x] 2.2 Implement exact-id, fail-closed lookup and valid external-object behavior for absent Engine rows.
- [x] 2.3 Prove Core field mapping, category authority chain, closed kind mapping, supported episode-date relation, and no-`text_inference` behavior with fixtures.

## 3. Phase 2.5-C — Projection Unification

- [x] 3.1 Establish canonical-aware Recall, Memory Card, Hybrid, and vector projection paths; persistent Lance writer adoption remains Phase 2.5-D.
  - [x] 3.1a Add canonical-aware Memory Card/MemoryObject projection with legacy candidate-only compatibility preserved.
  - [x] 3.1b Canonicalize Hybrid public results and propagate exact memory identity after ranking, with legacy prefix compatibility preserved.
  - [x] 3.1c Define the canonical vector projection and Lance-row materializer without changing Lance authority, schema, model, or writes.
- [x] 3.2 Keep query/ranking/channel/agent/citation evidence downstream; eligibility remains downstream projection policy and Canonical v1 adds no eligibility fields.
- [x] 3.3 Complete final parity review for C1/C2/C3 before removing duplicated semantic inference; retain the identified long-text add-path drift as a finding.

## 4. Phase 2.5-D — Reconciliation Integration

- [x] 4.1 Implement the three direct Core-to-Engine-to-Lance writers around exact Core/canonical identity without creating a third store; persistent runtime execution remains separate.
- [x] 4.1a Phase 2.5-D.1: correct `memory_engine add` source identity observation with exact readonly Core before/after ID delta; keep `chunks_added` independent of Engine backfill/lifecycle-row existence and preserve one-direct-write Lance behavior.
- [x] 4.2a Owner authorized this Phase 2.5-D source implementation.
- [x] 4.2a-D.1 Owner authorized this source/tests/commit-only correction; no runtime deployment, Gateway restart, real Core/Engine/Lance mutation, second live add, reconciliation, AutoRecall, config, or ranking change is included.
- [ ] 4.2b Obtain separate Owner authorization for persistent runtime/data execution, deployment, migration, qualification, and rollout.
- [ ] 4.3 Add DB-boundary, rollback, and persistence evidence appropriate to the authorized write path.

## 5. Non-goal and safety review

- [x] 5.1 Confirm no phase task enables AutoRecall, changes ranking in A/B, changes multi-agent ACL, grants Lance authority, or treats this OpenSpec as persistent-write authorization.

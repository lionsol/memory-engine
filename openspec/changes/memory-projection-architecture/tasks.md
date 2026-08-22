## 1. Phase D.3-A architecture contract

- [x] 1.1 Inventory current Canonical Memory, vector projection, Memory Card projection, disclosure envelope/selector, and v1.1 shadow capability boundaries.
- [x] 1.2 Record the current policy-ownership duplication between legacy Memory Card projection and D.2 disclosure admissibility/capability logic.
- [x] 1.3 Define projection as representation rather than authorization and preserve Canonical Memory as semantic authority.
- [x] 1.4 Define the initial projection surfaces: `VECTOR_INDEX`, `INTERNAL_AGENT_CONTEXT`, `DISCLOSURE_CARD`, and reserved `RAW_REFERENCE`.
- [x] 1.5 Separate projection validation from disclosure capability authorization and selector responsibility.
- [x] 1.6 Record that the frozen D.2 v2 fixture cannot prove sanitized-projection safety because it uses a fixed synthetic bounded card.
- [x] 1.7 Keep D.3-A documentation-only: no production source, runtime, config, DB/data, Gateway, or AutoRecall mutation.

## 2. Phase D.3-B projection contract/source model

- [x] 2.1 Freeze a source implementation packet for a pure `ProjectionArtifact` contract and surface-specific validation boundary.
- [x] 2.2 Prefer adapters around existing canonical vector/card projectors before any broad rewrite.
- [x] 2.3 Remove new permission decisions from projector APIs; legacy policy fields remain outside the new artifact authority and existing production APIs are unchanged.
- [x] 2.4 Add focused tests proving exact canonical identity/provenance binding, surface bounds, forbidden full-body leakage rejection, and no capability upgrade.
- [x] 2.5 Keep production/runtime consumers unchanged unless separately authorized.

## 3. Phase D.3-C projection-aware offline evaluation

- [ ] 3.1 Define and freeze a new projection-aware evaluation contract without modifying the D.2 v2 holdout.
- [ ] 3.2 Include actual projected payload or bounded projection features sufficient to evaluate projection validity and target-surface safety.
- [ ] 3.3 Label safety and semantic preservation separately so a safe-but-useless projection cannot count as a utility success.
- [ ] 3.4 Evaluate whether concrete safe projections recover useful disclosure while keeping unsafe disclosure at zero.
- [ ] 3.5 Do not tune production heuristics or projector logic against the frozen evaluation set after freeze.

## 4. Phase D.3-D production integration

- [ ] 4.1 Require a separate Planner/Owner product decision after D.3-C evidence.
- [ ] 4.2 Migrate production capability/admissibility/selector/card paths only under separately authorized source work.
- [ ] 4.3 Treat deployment, Gateway operations, AutoRecall enablement, configuration, DB/data mutation, and runtime qualification as separately authorized operations.
- [ ] 4.4 Keep `RAW_DISCLOSABLE` / raw-reference enablement out of scope unless explicitly reopened as its own product decision.

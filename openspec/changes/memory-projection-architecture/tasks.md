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

- [x] 3.1 Define and freeze a new projection-aware evaluation contract without modifying the D.2 v2 holdout (`D.3-C.1: HOLDOUT CONTRACT FROZEN / NOT YET EVALUATED`).
- [x] 3.2 Freeze canonical/runtime projection inputs and bounded target-surface safety/semantic acceptance constraints; actual projected payload/features remain evaluator output (`D.3-C.1`).
- [x] 3.3 Label safety and semantic preservation separately so a safe-but-useless projection cannot count as a utility success (`D.3-C.1`).
- [x] 3.4 Implement pure projection-aware evaluator with bounded case results, capability separation, aggregate metrics, and handcrafted synthetic tests (`D.3-C.2: SOURCE IMPLEMENTED`).
- [x] 3.5 Execute the frozen 24-row projection-aware evaluation once without projector/fixture tuning (`D.3-C.3: FIRST-RUN EVIDENCE RECORDED / AWAITING PLANNER ADJUDICATION`; report `reports/memory-projection-holdout-v1-first-run-20260822.md`).
- [ ] 3.6 Treat projector, capability, selector, runtime, and both frozen fixtures as an ongoing immutable constraint after C.1 freeze; verify by diff/SHA at each future evaluation rather than marking this constraint complete.
- [x] 3.7 Define the projection strategy taxonomy and decision record from C.3 evidence (`D.3-C.4: PROJECTION STRATEGY TAXONOMY DEFINED`; docs/OpenSpec-only, no implementation).
- [x] 3.8 Implement the bounded `REDACTED_CARD` representation-only prototype with handcrafted synthetic tests (`D.3-C.5: REDACTED_CARD OFFLINE PROTOTYPE IMPLEMENTED / NOT INDEPENDENTLY EVALUATED`).
- [x] 3.9 Freeze the independent `REDACTED_CARD` holdout without reusing the frozen C.1 holdout or C.5 unit literals (`D.3-C.6: INDEPENDENT REDACTED_CARD HOLDOUT FROZEN / NOT YET EVALUATED`).
- [x] 3.10 Implement the pure independent `REDACTED_CARD` evaluator against the C.6 contract (`D.3-C.7: PURE INDEPENDENT REDACTED_CARD EVALUATOR IMPLEMENTED / FROZEN HOLDOUT NOT YET EXECUTED`).
- [x] 3.11 Execute the C.6 frozen holdout exactly once after the C.7 evaluator decision (`D.3-C.8: PASS / FIRST-RUN EVIDENCE ACCEPTED`; report `reports/redacted-card-holdout-v1-first-run-20260822.md`).
- [x] 3.12 Define Redaction Plan Authority & Safety Boundary (`D.3-C.9: REDACTION PLAN AUTHORITY BOUNDARY DEFINED`; docs/OpenSpec-only, no detector or production wiring).
- [x] 3.13 Implement the pure Structured Redaction Evidence Contract (`D.3-C.10: STRUCTURED REDACTION EVIDENCE CONTRACT IMPLEMENTED / OFFLINE ONLY / NOT PRODUCTION AUTHORITY`; no resolver, detector, or production wiring).
- [x] 3.14 Define Redaction Evidence Resolution Semantics (`D.3-C.11: REDACTION EVIDENCE RESOLUTION SEMANTICS DEFINED`; docs/OpenSpec-only, no resolver, authority authentication, or production wiring).
- [x] 3.15 Define the `INTERNAL_AGENT_CONTEXT` Representation Design (`D.3-C.12: INTERNAL_AGENT_CONTEXT REPRESENTATION BOUNDARY DEFINED`; docs/OpenSpec-only, no projector, capability/selector, or runtime wiring).
- [x] 3.16 Implement the pure `INTERNAL_AGENT_CONTEXT` Projection Contract Prototype (`D.3-C.13: INTERNAL_AGENT_CONTEXT PROJECTION CONTRACT PROTOTYPE IMPLEMENTED / OFFLINE ONLY / NOT CAPABILITY AUTHORIZED`; source/test contract only, with no holdout, runtime, capability, or selector wiring).
- [x] 3.17 Freeze the independent `INTERNAL_AGENT_CONTEXT` holdout (`D.3-C.14: INDEPENDENT INTERNAL_AGENT_CONTEXT HOLDOUT FROZEN / NOT YET EVALUATED`; fresh synthetic fixture, pure validator, freeze tests/record only, no evaluator or runtime wiring).
- [x] 3.18 Implement the pure independent `INTERNAL_AGENT_CONTEXT` evaluator (`D.3-C.15: PURE INDEPENDENT INTERNAL_AGENT_CONTEXT EVALUATOR IMPLEMENTED / FROZEN HOLDOUT NOT YET EXECUTED`; caller-supplied in-memory rows only, handcrafted tests, no C.14 execution or runtime wiring).

## 4. Phase D.3-D production integration

- [ ] 4.1 Require a separate Planner/Owner product decision after D.3-C evidence.
- [ ] 4.2 Migrate production capability/admissibility/selector/card paths only under separately authorized source work.
- [ ] 4.3 Treat deployment, Gateway operations, AutoRecall enablement, configuration, DB/data mutation, and runtime qualification as separately authorized operations.
- [ ] 4.4 Keep `RAW_DISCLOSABLE` / raw-reference enablement out of scope unless explicitly reopened as its own product decision.

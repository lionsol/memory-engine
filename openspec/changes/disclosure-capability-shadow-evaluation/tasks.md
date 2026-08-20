## 1. Disclosure Capability Shadow Evaluation — contract only

- [x] 1.1 Define the current and capability-constrained shadow flows.
- [x] 1.2 Reference the bounded Disclosure Capability v1 states and no-upgrade rule.
- [x] 1.3 Define bounded candidate-level shadow result fields.
- [x] 1.4 Define safety, capability, preservation, and utility metrics.
- [x] 1.5 Freeze the offline evidence and fixture boundaries.
- [x] 1.6 Validate the documentation-only OpenSpec change.

## 2. Phase D.2-C.6 offline evaluator implementation

- [x] 2.1 Implement pure deterministic shadow capability calculation.
- [x] 2.2 Compare current selector disclosure with capability-constrained disclosure.
- [x] 2.3 Add synthetic tests for capability states, no-upgrade behavior, and metrics.
- [x] 2.4 Confirm no production caller and keep the frozen v2 fixture unevaluated.

## 3. Future stages — not started

- [ ] 3.1 Execute shadow evaluation without mutating the frozen fixture.
- [ ] 3.2 Review evidence before any runtime integration decision.
- [ ] 3.3 Obtain explicit authorization before implementing runtime capability calculation.

This change implements an offline evaluator only. It does not modify
selector/admissibility behavior, enable runtime policy, or mutate
configuration, databases, or data.

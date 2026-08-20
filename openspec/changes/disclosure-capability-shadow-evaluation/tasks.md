## 1. Disclosure Capability Shadow Evaluation — contract only

- [x] 1.1 Define the current and capability-constrained shadow flows.
- [x] 1.2 Reference the bounded Disclosure Capability v1 states and no-upgrade rule.
- [x] 1.3 Define bounded candidate-level shadow result fields.
- [x] 1.4 Define safety, capability, preservation, and utility metrics.
- [x] 1.5 Freeze the offline evidence and fixture boundaries.
- [x] 1.6 Validate the documentation-only OpenSpec change.

## 2. Future stages — not started

- [ ] 2.1 Implement a separately authorized offline shadow evaluator.
- [ ] 2.2 Execute shadow evaluation without mutating the frozen fixture.
- [ ] 2.3 Review evidence before any runtime integration decision.
- [ ] 2.4 Obtain explicit authorization before implementing runtime capability calculation.

This change defines architecture only. It does not implement or execute a
shadow evaluator, modify selector/admissibility behavior, generate metrics,
enable runtime policy, or mutate configuration, databases, or data.

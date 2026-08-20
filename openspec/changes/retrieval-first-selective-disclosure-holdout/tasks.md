## 1. Phase C frozen holdout contract

- [x] 1.1 Define Candidate Disclosure Holdout Row v1.
- [x] 1.2 Implement pure schema, identity, label, and family-balance validation.
- [x] 1.3 Create the 48-row, twelve-family synthetic fixture.
- [x] 1.4 Add freeze/immutability tests without selector or evaluator execution.
- [x] 1.5 Validate the OpenSpec and static repository checks.
- [x] 1.6 Confirm no production caller or runtime flow is introduced.

This phase freezes data only. A future offline evaluation requires a separate
stage and does not receive runtime authorization from this change.

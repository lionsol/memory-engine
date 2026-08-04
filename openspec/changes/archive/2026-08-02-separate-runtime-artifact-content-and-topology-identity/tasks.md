## 1. Contract implementation

- [x] 1.1 Preserve the v1 library, v1 identity field, and existing v1 tests.
- [x] 1.2 Add the isolated v2 builder, validator, semantic/topology/exact identities, and fail-closed validity gates.
- [x] 1.3 Add the closed topology classifier, explicit policy matrix, and controlled split transformation record.
- [x] 1.4 Add the minimal v2 build and compare CLI surfaces.

## 2. Regression tests

- [x] 2.1 Cover exact, complete split, partial split, selected multi-group split, merge, cross-group relink, mixed transformation, and default/explicit policy decisions.
- [x] 2.2 Cover semantic content/mode/path/symlink changes and unsafe root, symlink, hardlink, special-file, and malformed-manifest gates.
- [x] 2.3 Cover the synthetic three-group better-sqlite3 hardlink expansion without using the runtime/evidence tree.
- [x] 2.4 Cover v2 build/compare CLI exit and report behavior.

## 3. Documentation and validation

- [x] 3.1 Create the bounded OpenSpec requirements and update current-state documentation with the stopped/rolled-back Post-H6 status and v1/v2 installation boundary.
- [x] 3.2 Run v1/v2 tests, CLI tests, OpenSpec validation, static check, full suite, `git diff --check`, and final status.
- [x] 3.3 Confirm no runtime/config/database/service mutation and no commit, release, installation, or Git history rewrite.

## 4. Review-blocker correction

- [x] 4.1 Make builder and validator share the relative-path contract and add the backslash filename regression across library, validator, CLI, and both policies.
- [x] 4.2 Add trusted/null-gated identity and gate-count evidence, deterministic stop reasons, semantic difference summaries, and bounded topology difference summaries.
- [x] 4.3 Add report-content tests for exact, accepted/rejected split, merge, cross-group relink, mixed/unknown, semantic mismatch, invalid manifest, and external hardlink reference.
- [x] 4.4 Re-run focused tests, full artifact tests, CLI tests, OpenSpec validation, static check, full suite, diff check, and status before marking this correction complete.

## 5. Hardlink self-consistency correction

- [x] 5.1 Validate identical mode, size, and SHA-256 for every member of each hardlink group using a deterministic reference path.
- [x] 5.2 Add forged-manifest tests with recomputed semantic/topology/exact identities for individual and simultaneous mismatches.
- [x] 5.3 Verify invalid classification, rejection, and deterministic stop reason under both policies while preserving valid complete/partial split behavior.
- [x] 5.4 Re-run focused self-consistency tests, complete artifact/CLI tests, OpenSpec validation, static check, full suite, diff check, and status before marking this correction complete.

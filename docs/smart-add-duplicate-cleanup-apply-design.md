# Smart-Add Duplicate Cleanup Apply Design

## Scope

This design applies only to smart-add duplicate cleanup candidates already surfaced by the preview CLI.

The first apply implementation must only target indexed duplicate records confirmed by manifest validation.

The first apply implementation must not rewrite real memory markdown files.

The first apply implementation must not touch non-smart-add memory families.

The first apply implementation must not touch retrieved or injected chunks.

The first apply implementation must not touch repeated-confirmation or mixed/unclear duplicate groups.

The first apply implementation must not run LLM or network access.

## Preconditions

Any future apply implementation is allowed only after the current safety chain passes.

Required preconditions:

- `npm run smoke:smart-add-duplicates` passes.
- `npm run preview:smart-add-duplicate-cleanup -- --json` shows the expected candidate set.
- A human-reviewed manifest exists.
- `node bin/validate-smart-add-duplicate-cleanup-manifest.js --manifest <path> --json` passes.
- Validator output `status` is `pass`.
- `would_delete_count > 0`.
- `errors.length === 0`.

## Required Command Shape

The future apply command must be explicitly opt-in and must be forbidden by default.

Suggested future command name:

- `bin/apply-smart-add-duplicate-cleanup.js`

The future apply command must require all of:

- `--apply`
- `--manifest <path>`
- `--confirm-smart-add-duplicate-cleanup`

Apply by default is explicitly forbidden.

## Guardrails

The future apply implementation must reject execution if any of the following is true:

- `--apply` is absent.
- `--manifest` is absent.
- `--confirm-smart-add-duplicate-cleanup` is absent.
- Manifest validator fails.
- Any `would_delete` item is missing `chunk_id`, `path`, or `group_hash`.
- The current preview no longer matches the manifest.
- Any candidate has retrieval or injection usage.
- Any candidate is outside lifecycle-owned smart_add.
- Duplicate candidates changed after validation.
- Backup creation fails.
- DB transaction cannot start.
- Post-apply smoke fails.

## Backup And Rollback

The future apply implementation must create a timestamped backup before mutation.

Backup must include the engine DB at minimum.

If core DB rows are ever mutated by a future implementation, backup must include the core DB too.

No deletion may occur before backup succeeds.

Mutations must run inside a transaction.

Transaction must rollback on any error.

The apply report must include backup paths and transaction status.

## Mutation Boundary

The first implementation may only delete indexed duplicate rows that correspond exactly to validator `would_delete` items.

The first implementation must not:

- edit markdown memory files
- delete unconfirmed chunks
- delete keep candidates
- delete groups not approved in manifest
- delete non-smart-add records
- delete retrieved or injected records
- archive
- quarantine
- reinforce
- backfill confidence
- call LLM
- access network

## Post-Apply Verification

After any future apply mutation, the implementation must require all of:

- Re-run manifest validator.
- Re-run `npm run smoke:smart-add-duplicates`.
- Re-run preview.
- Re-run relevant focused tests.
- Re-run `npm test`.
- Apply report must show before and after counts.
- Expected cleanup eligible count must be explicitly checked against planned manifest scope and must not be assumed globally.

## Failure Modes

The future apply implementation must explicitly handle and fail closed on:

- stale manifest
- changed preview
- partial deletion attempt
- backup failure
- transaction failure
- post-apply smoke failure
- unexpected retrieved or injected usage
- duplicate ids in manifest
- missing DB rows
- unknown chunk ids
- mismatch between manifest and current preview

## Non-Goals

This phase does not implement:

- apply CLI
- DB deletion
- markdown memory file rewrite
- automatic manifest generation
- automatic approval
- quarantine
- archive
- reinforce
- backfill confidence
- broader quality cleanup

## Future Implementation Checklist

1. Re-run `npm run smoke:smart-add-duplicates` and confirm it passes.
2. Re-run `npm run preview:smart-add-duplicate-cleanup -- --json` and confirm the expected candidate set.
3. Require a human-reviewed manifest file.
4. Run `node bin/validate-smart-add-duplicate-cleanup-manifest.js --manifest <path> --json` and require `status === "pass"`, `would_delete_count > 0`, and `errors.length === 0`.
5. Require `--apply`, `--manifest <path>`, and `--confirm-smart-add-duplicate-cleanup` together.
6. Create a timestamped backup before any mutation.
7. Start a transaction and verify the candidate set still matches the validated manifest.
8. Delete only validator `would_delete` items and never delete keep candidates.
9. Roll back the transaction on any error.
10. Emit an apply report with backup paths, transaction status, and before/after counts.
11. Re-run manifest validator, preview, `npm run smoke:smart-add-duplicates`, relevant focused tests, and `npm test`.
12. Abort and fail closed if any post-apply verification step fails.

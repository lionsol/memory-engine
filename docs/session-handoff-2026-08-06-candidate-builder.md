# memory-engine Session Handoff — Candidate-Builder Harness

> Status: Current session handoff for source work; not a runtime authority.
>
> Business timezone: Asia/Shanghai.
>
> Handoff date: 2026-08-06.

## Purpose

This document transfers the Candidate-Builder Harness work into a new session
without relying on browser transcript recall. It distinguishes current source
facts, accepted but not yet executed design, and historical records.

## Roles and authorization boundary

- Sol is the owner and explicit authorizer.
- GPT plans, reviews, defines gates, compares evidence, and issues stage decisions.
- Codex CLI is the default implementation actor when separately authorized.
- Edi is a runtime verifier only after runtime work is separately authorized.
- DevSpace is an inspection and bounded source-edit surface; it is not the live
  OpenClaw runtime operation surface.
- A completed stage never authorizes the next stage automatically.
- No tag or push is authorized by this handoff.

## Source authority

### Current facts

- Candidate-Builder implementation commit:
  `c4e74ba3f7014675fe198cb9af13c0a45b2cf117`.
- Commit subject: `feat(runtime): add deterministic authority builder`.
- Package version remains `0.8.22`.
- The implementation adds 50 source/documentation/test files and 5,287 lines.
- The repository entry point is `bin/prepare-runtime-authority.cjs`.
- The library implementation is under `lib/runtime-authority/`.
- The source implementation is committed locally on `main`.
- `origin/main` remained at `4c7ef07a52d5f8c86a522bd00f7f9d2a942fdca7`
  when the implementation was frozen; the implementation was not pushed.

### Fresh implementation evidence before commit

~~~text
harness tests:       71/71 passed
contract/docs tests: 14/14 passed
static check:        612 files passed
full suite:          1832 total / 1824 passed / 0 failed / 8 skipped
git diff check:      passed
runtime mutation:    none
config mutation:     none
service operation:   none
real data access:    none
Edi invocation:      none
~~~

The eight skips are pre-existing OpenClaw-runtime-unavailable integration skips.

## Development plan comparison

### Planned and completed

| Planned contract | Implemented result | Status |
| --- | --- | --- |
| Single CLI entry point | `dry-run --plan`, `prepare --plan`, and `verify --authority` only | Complete |
| Exact plan schema | Strict key set, path normalization, mode/owner/time/hash checks, exact runtime/tool bindings | Complete |
| One-shot transaction | `O_CREAT|O_EXCL` claim, no resume/retry, consumed run identity | Complete |
| Path broker | Exact roots, longest-match authority, ancestor/root symlink rejection, TOCTOU recheck | Complete |
| Closed command registry | Fixed operation IDs, executable/argv/cwd/env/timeout/output bounds, no shell | Complete |
| Dependency sandbox | Real `unshare` mount namespace, chroot, hidden operator/source/runtime/config roots | Complete |
| Source isolation | Exact Git archive into staging; source repository is never npm cwd/prefix | Complete |
| Dependency construction | Staged `npm pack --ignore-scripts`, candidate `npm ci`, lifecycle scripts inside sandbox | Complete |
| Deterministic archives | Uncompressed POSIX pax/GNU tar contract with fixed metadata and parity checks | Complete |
| Manifest/sentinel | Reuses artifact-manifest-v2; canonical sentinel identity is separate from evidence-file hash | Complete |
| Candidate and R0 | Synthetic candidate/R0 construction, native smoke, archive/re-extraction parity | Complete synthetically |
| Read-only dry-run | Full preflight, sandbox probe, `mutation_count=0`, fail-closed rejection | Complete synthetically |
| Self-binding verify | Exact authority roles, checksums, inventory, claim, tools, manifests, sentinels, archives, runtime parity | Complete synthetically |
| Failure injection | Stage failures, drift, link, identity, claim, publication and rollback failures | Complete |
| Implementation freeze | Local commit created with clean worktree | Complete |

### Planned work intentionally not executed

These are not omissions from the completed implementation stage:

- no real OpenClaw plan was created or executed;
- no real-plan `dry-run` was run;
- no real candidate or R0 authority was constructed;
- no runtime install, sourcePath change, Gateway/Console mutation, configuration
  mutation, database access, session access, or memory access occurred;
- no Edi runtime verification occurred;
- no tag or push occurred.

Each item remains a separately authorized future stage.

## Additions beyond the initial implementation outline

Repeated code review found real blockers inside the original safety decision.
The following additions were accepted within scope because they were required to
make the promised fail-closed transaction true:

1. exact semantic roles for candidate/R0 archives, manifests, runtime checkpoints,
   tool identities, and the transaction journal;
2. typed authority inventory covering files, directories, internal symlinks,
   modes, targets, and hardlink topology;
3. strict rejection of external or dangling dependency/build links;
4. Python, C/C++, make, ar, and complete node-gyp closure identities;
5. real Python/node-gyp lifecycle and controlled device/compiler sandbox gates;
6. fail-closed SQLite and LanceDB native smoke contracts;
7. source/candidate and active/R0 runtime identity checkpoints after install,
   freeze, capture, and archive re-extraction;
8. configuration and Gateway/Console before/after stability evidence;
9. claim-backed publication verification and post-rename rollback with
   `RECOVERY_REQUIRED` when rollback cannot be completed;
10. verification of the `.run-claims` directory and claim file type, owner, and
    modes (`0700` directory, `0600` file).

These are implementation hardening, not new product features, database state,
configuration objects, OpenSpec changes, or rollout mechanisms.

## Omissions and documentation drift found during session closeout

The comparison found documentation that lagged behind the committed source:

- `docs/smoke-tests/README.md` still described the harness as design-only and
  unimplemented;
- the design scope still said it did not implement `npm pack`, `npm ci`, or
  candidate/R0 construction;
- `docs/README.md` still said the candidate-builder was unimplemented;
- `docs/current-state.md` did not record the committed source implementation;
- no self-contained handoff existed for the next session.

The session closeout updates those records. This documentation update does not
change runtime behavior.

## Closeout dependency-environment incident

During documentation verification, a shell search pattern containing Markdown
backticks was interpreted by the shell and accidentally started `npm ci` in the
source repository. The command timed out before completion and temporarily left
`node_modules` incomplete. This was a verification-procedure error, not a product
or harness operation.

A controlled recovery then ran the bound Node 24 npm CLI against the unchanged
lockfile. Recovery evidence:

~~~text
package.json SHA-256:            752f46d03f7fe87f744e4441a9f79fccae3d4e09ece129ee60a0ad19abcdf47a
package-lock.json SHA-256:       8ee89a15cc54eb532618cf011a30f5684cedf0aa0c026cb69378bc025ec58718
node_modules/.package-lock SHA:  8a0d4a3ec038517b559b2b9002b2cb21242a3a0485a571758b47b8404a907b5c
npm ls --all --omit=dev:         PASS
better-sqlite3 native smoke:     PASS
LanceDB import smoke:            PASS
tracked package changes:         none
runtime/config/data mutation:    none
~~~

The fresh lockfile install has `2250` files, `315` directories, and `4` internal
npm `.bin` symlinks. A prior historical sentinel had `2252/316/5`; the extra
historical symlink was consistent with a node-gyp build-time external link and
must not be manually recreated. The committed harness excludes source
`node_modules` from authority construction, so this untracked development
installation is not a source or runtime authority. The next session should use
lockfile/tool/native checks, not the old count, if it needs to validate the local
development dependency environment.

## Runtime-state boundary

No active runtime inspection was performed as part of the implementation freeze
or this handoff. Previous deployment observations are historical records and
must not be promoted to current facts in the next session.

Before any real-plan work, revalidate at least:

- repository HEAD, clean status, source tree identity, and remote state;
- active extension and registered release exact paths and identities;
- current configuration SHA-256 without exposing configuration contents;
- actual Gateway and Console unit names, active/running states, PIDs, and restart counts;
- Node/npm/Git/tar/unshare/mount/chroot/systemctl/Python/compiler/node-gyp bindings;
- persistent authority parent existence, owner, mode, and filesystem boundary;
- AutoRecall and any other runtime rollout boundary relevant to the plan.

## Next possible stage

### Accepted design, not authorized

~~~text
stage=Real-Plan Read-Only Dry-Run
authorization=not granted by this handoff
prepare_authorized=false
real_candidate_authorized=false
runtime_install_authorized=false
~~~

The next stage decision should be:

> Can the committed harness validate one exact, freshly reverified real plan in
> read-only dry-run mode with `mutation_count=0` and no claim, staging, final
> authority, npm construction, archive creation, runtime operation, or real data
> access?

The dry-run and `prepare` authorizations must remain separate. Creating the plan
file itself is an owner-only filesystem mutation outside the harness dry-run and
must be explicitly included in the next authorization packet.

## Required new-session startup sequence

1. Read `AGENTS.md`.
2. Read `docs/current-state.md`.
3. Read this handoff.
4. Read the Candidate-Builder design and execution template.
5. Verify Git state and implementation commit without assuming push status.
6. Do not inspect or mutate the live runtime until Sol authorizes the exact next
   stage.
7. Preserve the distinction between `current_fact`, `accepted_design`, and
   `historical_record` in every decision.

## New-session concise state

~~~text
Candidate-Builder Harness design=accepted
Candidate-Builder Harness source implementation=committed at c4e74ba
synthetic production verification=passed
real-plan dry-run=not executed / not authorized
real candidate/R0=not created
runtime verification=not performed
runtime install/config/service/data mutation=none
tag=false
push=false
Edi=false
next possible stage=Real-Plan Read-Only Dry-Run, separately authorized
~~~

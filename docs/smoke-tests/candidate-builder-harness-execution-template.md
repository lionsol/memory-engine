# Candidate-Builder Harness Execution Authorization Template

> Status: Source implementation present; synthetic verification passed; not runtime verified; not used for a real candidate.

This template is a blank, single-run authorization record. It does not authorize
an execution until every placeholder is replaced, independently reviewed, and
the dry-run and prepare approvals are issued separately.

## Frozen bindings

~~~text
PLAN_SCHEMA=memory-engine-runtime-authority-plan-v1
PLAN_PATH=<PLAN_PATH>
PLAN_SHA256=<PLAN_SHA256>
OPERATOR_HOME=<OPERATOR_HOME>
SOURCE_COMMIT=<SOURCE_COMMIT>
SOURCE_TREE_IDENTITY=<SOURCE_TREE_IDENTITY>
ACTIVE_ROOT=<ACTIVE_ROOT>
ACTIVE_RELEASE=<ACTIVE_RELEASE>
ACTIVE_RUNTIME_IDENTITY=<ACTIVE_RUNTIME_IDENTITY>
ACTIVE_ARTIFACT_EXACT_IDENTITY=<ACTIVE_ARTIFACT_EXACT_IDENTITY>
RELEASE_RUNTIME_IDENTITY=<RELEASE_RUNTIME_IDENTITY>
RELEASE_ARTIFACT_EXACT_IDENTITY=<RELEASE_ARTIFACT_EXACT_IDENTITY>
CONFIG_SHA256=<CONFIG_SHA256>
GATEWAY_PID=<GATEWAY_PID>
CONSOLE_PID=<CONSOLE_PID>
PERSISTENT_PARENT=<PERSISTENT_PARENT>
RUN_ID=<RUN_ID>
NODE_EXECUTABLE=<NODE_EXECUTABLE>
NPM_CLI=<NPM_CLI>
GIT_EXECUTABLE=<GIT_EXECUTABLE>
TAR_EXECUTABLE=<TAR_EXECUTABLE>
UNSHARE_EXECUTABLE=<UNSHARE_EXECUTABLE>
MOUNT_EXECUTABLE=<MOUNT_EXECUTABLE>
CHROOT_EXECUTABLE=<CHROOT_EXECUTABLE>
SYSTEMCTL_EXECUTABLE=<SYSTEMCTL_EXECUTABLE>
EXPECTED_NODE_VERSION=<EXPECTED_NODE_VERSION>
EXPECTED_NODE_ABI=<EXPECTED_NODE_ABI>
EXPECTED_NODE_EXECUTABLE_SHA256=<EXPECTED_NODE_EXECUTABLE_SHA256>
EXPECTED_NPM_VERSION=<EXPECTED_NPM_VERSION>
EXPECTED_NPM_CLI_SHA256=<EXPECTED_NPM_CLI_SHA256>
EXPECTED_GIT_VERSION=<EXPECTED_GIT_VERSION>
EXPECTED_TAR_VERSION=<EXPECTED_TAR_VERSION>
EXPECTED_GIT_EXECUTABLE_SHA256=<EXPECTED_GIT_EXECUTABLE_SHA256>
EXPECTED_TAR_EXECUTABLE_SHA256=<EXPECTED_TAR_EXECUTABLE_SHA256>
EXPECTED_UNSHARE_VERSION=<EXPECTED_UNSHARE_VERSION>
EXPECTED_UNSHARE_EXECUTABLE_SHA256=<EXPECTED_UNSHARE_EXECUTABLE_SHA256>
EXPECTED_MOUNT_VERSION=<EXPECTED_MOUNT_VERSION>
EXPECTED_MOUNT_EXECUTABLE_SHA256=<EXPECTED_MOUNT_EXECUTABLE_SHA256>
EXPECTED_CHROOT_VERSION=<EXPECTED_CHROOT_VERSION>
EXPECTED_CHROOT_EXECUTABLE_SHA256=<EXPECTED_CHROOT_EXECUTABLE_SHA256>
EXPECTED_SYSTEMCTL_VERSION=<EXPECTED_SYSTEMCTL_VERSION>
EXPECTED_SYSTEMCTL_EXECUTABLE_SHA256=<EXPECTED_SYSTEMCTL_EXECUTABLE_SHA256>
PYTHON_EXECUTABLE=<PYTHON_EXECUTABLE>
EXPECTED_PYTHON_EXECUTABLE_SHA256=<EXPECTED_PYTHON_EXECUTABLE_SHA256>
EXPECTED_PYTHON_VERSION=<EXPECTED_PYTHON_VERSION>
CC_EXECUTABLE=<CC_EXECUTABLE>
EXPECTED_CC_EXECUTABLE_SHA256=<EXPECTED_CC_EXECUTABLE_SHA256>
EXPECTED_CC_VERSION=<EXPECTED_CC_VERSION>
CXX_EXECUTABLE=<CXX_EXECUTABLE>
EXPECTED_CXX_EXECUTABLE_SHA256=<EXPECTED_CXX_EXECUTABLE_SHA256>
EXPECTED_CXX_VERSION=<EXPECTED_CXX_VERSION>
MAKE_EXECUTABLE=<MAKE_EXECUTABLE>
EXPECTED_MAKE_EXECUTABLE_SHA256=<EXPECTED_MAKE_EXECUTABLE_SHA256>
EXPECTED_MAKE_VERSION=<EXPECTED_MAKE_VERSION>
AR_EXECUTABLE=<AR_EXECUTABLE>
EXPECTED_AR_EXECUTABLE_SHA256=<EXPECTED_AR_EXECUTABLE_SHA256>
EXPECTED_AR_VERSION=<EXPECTED_AR_VERSION>
NODE_GYP_ROOT=<NODE_GYP_ROOT>
EXPECTED_NODE_GYP_TREE_IDENTITY=<EXPECTED_NODE_GYP_TREE_IDENTITY>
~~~

The plan file must be a regular file with mode `0600`, owned by the current
execution UID, with no group or other permissions, and must satisfy
`created_at <= current time < expires_at`. The plan must bind the exact source,
release, active root, configuration, tool executables, service units, package
hashes, runtime identities, artifact identities, restart counts, and targeted
test files required by `memory-engine-runtime-authority-plan-v1`. Tool realpaths,
versions, and hashes are rechecked during dry-run and immediately before any
prepare mutation. No value may be filled by prefix, basename, glob,
latest-directory lookup, timestamp truncation, or fallback.

The plan's `expected_source_runtime_identity`,
`expected_active_runtime_identity`, and `expected_release_runtime_identity`
must each be a lowercase 64-hex value. Candidate and R0 runtime evidence is
checked after dependency installation, freeze, capture, and archive
re-extraction; a missing, invalid, null, or mismatched identity consumes the
run and prevents publication. Verify reuses the authority's bound Node after
rechecking its realpath, SHA-256, version, and ABI.

Python, `cc`, `cxx`, `make`, and `ar` are independently bound regular
non-symlink executables. Their realpaths, hashes, and versions, plus the
complete `node_gyp_root` closure identity, are checked in dry-run and again
before the first prepare mutation. The sandbox forces `PYTHON`, `CC`, `CXX`,
`MAKE`, and `AR`; it never selects these tools from PATH.

## Separate authorizations

### Dry-run authorization

- authorization owner: `<AUTHORIZATION_OWNER>`
- reviewer: `<REVIEWER>`
- plan path: `<PLAN_PATH>`
- plan SHA-256: `<PLAN_SHA256>`
- decision: `PASS` or `REJECT`
- mutation count: `0`
- verified at: `<DRY_RUN_CHECKED_AT>`

Dry-run is read-only. It may validate bindings, inspect Git and safe service
identities, evaluate path policy, probe sandbox capability without exposing
production paths, and render the operation DAG. It must not create staging,
pack a package, install dependencies, create archives, run native smoke, write
configuration, or operate services.

### Prepare authorization

- authorization owner: `<AUTHORIZATION_OWNER>`
- reviewer: `<REVIEWER>`
- dry-run evidence: `<DRY_RUN_EVIDENCE>`
- prepare decision: `PASS` or `REJECT`
- one-shot run ID: `<RUN_ID>`
- expires at: `<EXPIRES_AT>`
- approved at: `<PREPARE_APPROVED_AT>`

Prepare is a one-shot transaction. It may use only the exact bindings above and
only the registered operation IDs. It must use the dependency sandbox, staged
source isolation, explicit candidate cwd and prefix, artifact-manifest-v2, the
mode-preserving R0 archive model, canonical authority archive v1, and atomic
staging-to-final publication.

The final authority uses a typed entry inventory. It records file, directory,
and internal symlink paths with modes; regular files additionally have exact
size/SHA-256 values and symlinks have targets and within-root resolution state.
Internal npm `.bin` symlinks and internal hardlink groups are allowed. External
or dangling symlinks, special entries, unexpected empty directories, and
external hardlink references reject the run. The selected transient-link policy
is strict rejection: immediately after `npm ci`, an audit rejects any external
or dangling root/dependency `node_gyp_bins/python3` link before `npm ls`,
runtime identity, or native smoke. The harness never deletes, repairs, or
allowlists that link and produces no transient-link cleanup evidence.

Before inventory and checksum creation, only owned transient paths are removed:
candidate unpack, npm cache, empty npmrc, harness helpers, sandbox root,
re-extraction scratch, disposable smoke data, and R0 scratch. Frozen candidate
and R0 archives, source artifacts, and required evidence remain. A synthetic
lifecycle package must exercise `npm pack`, lifecycle-enabled `npm ci`, `npm
ls`, controlled devices, and a standard-header compiler inside the namespace.

The run claim is `<PERSISTENT_PARENT>/.run-claims/<RUN_ID>.json`. It is created
with `O_CREAT|O_EXCL`, mode `0600`, before staging, and is never deleted. A
failed claim is consumed and cannot be resumed or retried. The candidate and R0
archive format is `memory-engine-runtime-authority-archive-v1`: GNU tar,
uncompressed POSIX pax, `--format=posix`, fixed metadata, bytewise path order,
preserved modes/bytes/symlink targets, preserved internal hardlink topology, and
no external hardlinks or special files.

Authority roles are fixed: `candidate_archive` and `r0_archive`; manifests
`candidate_frozen`, `active_before`, and `active_after`; checkpoints
`candidate_after_ci`, `candidate_after_freeze`, `candidate_after_reextract`,
`r0_capture`, and `r0_after_reextract`. The candidate archive must reference
the candidate manifest and freeze checkpoint; the R0 archive must reference
active-before and R0-capture. The journal is exact and ordered. An independent
completeness validator runs before `published=true`; failure leaves final absent
and records claim outcome `FAILED`.

The fixed prepare journal is exactly:

~~~text
PLAN_VALIDATED
PREFLIGHT_PASSED
RUN_CLAIMED
SOURCE_ARCHIVED
PACKAGE_PACKED
DEPENDENCIES_INSTALLED
CANDIDATE_VERIFIED
CANDIDATE_ARCHIVED
R0_CAPTURED
R0_VERIFIED
AUTHORITY_ASSEMBLED
PUBLISHED
~~~

Host stability evidence uses schema
`memory-engine-runtime-authority-host-stability-v1` at
`evidence/host-stability.json`. Before and after snapshots must match the
plan's expected configuration SHA, Gateway/Console active/running state, PID,
and restart count, and must be byte-equivalent. Verify derives the sibling
`.run-claims/<RUN_ID>.json` and requires `.run-claims` to be an owner-matching,
mode-0700 non-symlink directory. The claim must be an owner-matching mode-0600
regular non-symlink file with matching run ID, plan SHA-256, and
`outcome=PUBLISHED`; an absent, failed, null, symlink, wrong-mode, wrong-owner,
or mismatched claim or claim directory rejects the authority. The authority's tool
identity roles are exactly `node`, `npm`, `git`, `tar`, `unshare`, `mount`,
`chroot`, `systemctl`, `python`, `cc`, `cxx`, `make`, `ar`, and `node_gyp`.
If the final rename succeeds but the claim update or owned rollback fails, the
result is `RECOVERY_REQUIRED`, never `PASS` or `PUBLISHED`.

The namespace must also pass the real Python/node-gyp lifecycle gate: Python
must import `encodings`, expose existing stdlib and include paths, and invoke
node-gyp configure/build against a minimal synthetic source. Only the explicit
Python paths and individually tested compiler/toolchain roots are read-only
exposed. Native smoke is fail-closed and requires both `ok=true` and
`available=true` for SQLite and LanceDB; local synthetic packages named
`better-sqlite3` and `@lancedb/lancedb` are installed through the real npm
lifecycle so an unavailable smoke result can never publish an authority.

### Verify authorization

`verify --authority <final-root>` accepts no other root, path, tool, policy, or
identity override. The root must be a regular non-symlink directory containing
self-binding `authority.json` and `checksums.sha256`. Verify must check the
authority schema, `published=true`, root binding, checksums, archive hashes,
manifest and sentinel identities, archive re-extraction parity, and unexpected
files. A different supplied path must not alter the frozen bindings. Candidate
and R0 extraction is performed in an owner-only verification namespace with
the authority root read-only, bound tar identity revalidated by realpath/hash/
version, and verification scratch always cleaned.

## Mandatory prohibitions

This authorization never permits:

- automatic retry or reuse of a failed run ID;
- live installation or installed-plugin `sourcePath` repair;
- Gateway or Console stop, start, reload, or restart;
- configuration mutation;
- AutoRecall or H6 activation;
- database, LanceDB, memory, or session access;
- source repository `node_modules` reads by dependency tooling;
- arbitrary shell, free-form executable, free-form cwd, or free-form path;
- tag, push, release generation, or commit.

If any preflight binding, sentinel, service identity, path policy, sandbox
capability, cleanup, or publication gate fails, the run stops. The final root
must remain absent, and a new attempt requires a new plan and run ID.

## Required evidence checklist

Before prepare is approved, record:

- exact plan SHA-256 and schema validation;
- source Git status, commit, tree identity, and package hashes;
- exact active and release runtime/artifact identities;
- configuration identity projection and service status/restart observations;
- sandbox capability result with no production paths mounted;
- deterministic dry-run DAG and `mutation_count=0`;
- synthetic failure-injection results;
- owner-only staging and parent policy;
- planned cleanup and atomic publication policy.

After a successful future prepare, record candidate and R0 manifests, archive
hashes, re-extraction parity, native smokes, source/candidate parity, service
and configuration before/after identities, authority manifest, checksums, and
the final publication result. Do not store provider credentials, configuration
contents, memory text, session text, or raw prompts.

## Final decision

`PASS` means only that the separately authorized offline transaction completed
its specified evidence gates. It does not authorize live runtime installation,
sourcePath mutation, service operation, AutoRecall, H6, tag, push, or release.

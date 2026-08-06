# Candidate-Builder Harness Design

> Status: Accepted design; source implementation present; synthetic verification passed; not runtime verified; not used for a real candidate.

## Decision

The offline authority builder is implemented as a deterministic, single-entry,
fail-closed source tool. It must make the three previously observed procedural failures
mechanically unrepresentable:

1. authority path truncation or substitution;
2. dependency installation with the wrong current working directory or prefix;
3. prohibited exploratory reads combined with a non-reproducible custom sentinel.

This document is the design and implementation contract. The source
implementation and synthetic verification are present; it does not create an
authority from real OpenClaw bindings, access a runtime, or authorize an
installation.

## Scope and non-goals

The design covers the plan schema, path broker, subprocess boundary, dependency
sandbox, command registry, artifact sentinel envelope, transaction journal,
dry-run behavior, failure injection, and verification.

The committed source implementation includes controlled `npm pack`, `npm ci`,
candidate/R0 construction, service-status inspection, and authority verification.
Those paths have only been exercised with synthetic temporary fixtures. This
document does not authorize using them against real OpenClaw bindings, runtime
installation, configuration or service mutation, database or memory access,
OpenSpec changes, package-script changes, tags, or pushes.

## Governing architecture

The implementation entry point is frozen as:

The future implementation of a real OpenClaw transaction remains separately
authorized; this source implementation is limited to synthetic verification in
the current stage.

| Property | Contract |
| --- | --- |
| CLI | `bin/prepare-runtime-authority.cjs` |
| Implementation status | source implementation present; synthetic verification passed; not runtime verified |
| Execution model | one-shot transaction |
| Resume | unsupported |
| Exploration | free-form exploration is forbidden |

Only these subcommands are part of the CLI contract:

~~~text
node bin/prepare-runtime-authority.cjs dry-run --plan <plan.json>
node bin/prepare-runtime-authority.cjs prepare --plan <plan.json>
node bin/prepare-runtime-authority.cjs verify --authority <final-root>
~~~

The CLI accepts no free path arguments, free command arguments, shell fragments,
implicit working directory, or operator-selected fallback. A plan is the only
source of authority bindings.

## Threat model inputs

The builder treats these historical stop conditions as threat-model inputs,
without importing any private execution record or session content:

| Threat | Required control |
| --- | --- |
| Truncated or similar authority path | exact path binding, `lstat`, realpath containment, and no fallback selection |
| Wrong dependency cwd or prefix | fixed operation, explicit cwd, explicit `--prefix`, and prefix equality gate |
| Prohibited exploratory read or custom sentinel | path broker for every read and artifact-manifest-v2 reuse |

The operator home, session paths, memory paths, databases, and unrelated
worktrees are outside the builder's read authority even when a caller can name
them.

## Plan contract

The only accepted plan schema is:

~~~text
schema=memory-engine-runtime-authority-plan-v1
~~~

The root is a UTF-8 JSON object with exactly these fields:

~~~text
schema
run_id
created_at
expires_at
operator_home
source_repo
source_commit
source_tree_identity
origin_remote
active_root
active_release
config_path
persistent_parent
node_executable
npm_cli
git_executable
tar_executable
unshare_executable
mount_executable
chroot_executable
systemctl_executable
gateway_unit
console_unit
expected_package_json_sha256
expected_package_lock_sha256
expected_source_runtime_identity
expected_active_runtime_identity
expected_active_artifact_semantic_identity
expected_active_artifact_topology_identity
expected_active_artifact_exact_identity
expected_release_runtime_identity
expected_release_artifact_semantic_identity
expected_release_artifact_topology_identity
expected_release_artifact_exact_identity
expected_config_sha256
expected_gateway_pid
expected_gateway_restart_count
expected_console_pid
expected_console_restart_count
expected_node_version
expected_node_abi
expected_node_executable_sha256
expected_npm_version
expected_npm_cli_sha256
expected_git_version
expected_git_executable_sha256
expected_tar_version
expected_tar_executable_sha256
expected_unshare_version
expected_unshare_executable_sha256
expected_mount_version
expected_mount_executable_sha256
expected_chroot_version
expected_chroot_executable_sha256
expected_systemctl_version
expected_systemctl_executable_sha256
python_executable
expected_python_executable_sha256
expected_python_version
cc_executable
expected_cc_executable_sha256
expected_cc_version
cxx_executable
expected_cxx_executable_sha256
expected_cxx_version
make_executable
expected_make_executable_sha256
expected_make_version
ar_executable
expected_ar_executable_sha256
expected_ar_version
node_gyp_root
expected_node_gyp_tree_identity
targeted_test_files
~~~

The published authority has an exact tool identity role set:

~~~text
node npm git tar unshare mount chroot systemctl python cc cxx make ar node_gyp
~~~

Executable roles record exactly `kind`, `path`, `sha256`, and `version`, with
Node additionally recording `abi`. `node_gyp` records exactly `kind`, `path`,
`tree_identity`, `entry_count`, `file_count`, `external_symlink_count`, and
`dangling_symlink_count`. Unknown, missing, duplicate, wrong-kind, or drifted
tool identities reject both verification and preparation; npm version checks
run through the bound Node executable and every role is revalidated by verify.

Validation is structural and binding-aware:

- JSON only, UTF-8, root object only, and no unknown keys; `schema` must equal
  `memory-engine-runtime-authority-plan-v1`;
- no NUL bytes, relative paths, path normalization, or path aliases;
- the plan file must be a regular file with mode `0600`, owned by the current
  execution UID, with no group or other permissions, and must not be a symlink;
- `run_id` has a strict, bounded format and is single-use;
- `created_at <= current time < expires_at`, and an expired or not-yet-valid
  plan is rejected;
- every authority path is compared as an exact bound path, never by prefix,
  basename, glob, timestamp truncation, latest-directory selection, or similar
  release substitution;
- executable realpaths, versions, and hashes are verified during dry-run and
  repeated immediately before any prepare mutation;
- the plan SHA-256 is recorded in the dry-run and authority evidence.

The plan contains identities and expected service observations, not secrets,
configuration contents, memory text, session text, or arbitrary environment
values.

## Two-layer filesystem enforcement

### Layer A: path broker

All harness file access goes through one path broker. Direct filesystem calls
outside the broker are an implementation error.

The broker may read only the exact, validated roots for the source repository,
active extension, active release, configuration file, plan file, and explicitly
listed tool executables. It may write only the owned staging root and, after all
gates pass, the final root through atomic publication.

The broker rejects operator-home subtrees containing agents, sessions, memory,
workspace memory, core or engine SQLite, real LanceDB directories, and arbitrary
operator paths. In particular, source repository `node_modules` is denied for
dependency operations and is never a sentinel input.

Every access performs:

1. `lstat` before resolving;
2. rejection of a root symlink and special file;
3. realpath containment against the exact permitted root;
4. operation-specific read or write permission checks;
5. ancestor-symlink checks;
6. a TOCTOU recheck immediately before mutation.

External and dangling symlinks, external hardlink references, FIFOs, sockets,
devices, and unknown entry types are invalid for authority trees.

### Layer B: dependency subprocess sandbox

The source implementation uses an unprivileged user and mount namespace:

~~~text
unshare --user --map-root-user --mount --pid --fork --mount-proc
~~~

The sandbox hides the entire operator home and re-exposes only the Node 24
runtime read-only and the owned staging root read-write. It does not expose the
source repository, active extension, release, configuration, sessions, memory,
or databases.

The child environment is fixed to:

~~~text
HOME=<staging>/sandbox-home
TMPDIR=<staging>/tmp
NPM_CONFIG_CACHE=<staging>/npm-cache
NPM_CONFIG_USERCONFIG=<staging>/empty-npmrc
XDG_CONFIG_HOME=<staging>/xdg-config
XDG_CACHE_HOME=<staging>/xdg-cache
~~~

The namespace also exposes only controlled `/dev/null`, `/dev/zero`,
`/dev/random`, and `/dev/urandom` device bindings, plus read-only compiler headers
and compiler support roots. It does not bind the host `/dev` or a
general toolchain tree. A synthetic lifecycle package must successfully run
`npm pack`, `npm ci`, `npm ls`, device access, and a tiny standard-header
compile inside this namespace; any device or compiler gate failure rejects the
run.

The Python/node-gyp closure is equally explicit. When present, the namespace
binds only `/usr/lib/python312.zip`, `/usr/lib/python3.12`,
`/usr/lib/python3/dist-packages`, and `/usr/include/python3.12` read-only for
the bound Python runtime. Operator-home site-packages, `/home`, and arbitrary
user-installed Python packages are not exposed. The real capability probe runs
`/usr/bin/python3 -c "import encodings,sysconfig; ..."` and requires both the
reported stdlib and include paths to exist. A synthetic node-gyp-shaped
lifecycle then performs Python discovery, invokes node-gyp configure/build, and
compiles a minimal source in the same namespace. Any additional read-only
toolchain path is listed individually and tested; the implementation never
mounts an entire host filesystem or silently falls back to host execution.

Capability probing is itself fail-closed and uses the same setup path as staged
operations. If namespace creation, user mapping, chroot/mount isolation, or
the required read-only exposure cannot be proven, the builder rejects the plan
and never falls back to an unsandboxed dependency operation. The implementation
is source-implemented and synthetic-verified, but remains not runtime verified
and is not used for a real candidate.

## Command registry and execution classes

Subprocesses are selected by operation ID, never by caller-supplied executable,
argv, cwd, or shell text. Each registry entry fixes the executable, argument
builder, cwd policy, environment policy, read roots, write roots, output limit,
and timeout.

### Host-inspection operations

These operations may run on the host, but still use the fixed environment, path
broker, no-shell rule, bounded output, and timeout:

~~~text
git.status
git.resolve_commit
git.resolve_tree
git.archive
systemd.gateway_status
systemd.console_status
node.artifact_manifest for active/release
node.artifact_compare
tar.create_candidate_authority
tar.extract_candidate_authority
tar.create_r0_authority
tar.extract_r0_authority
~~~

The `tar.*` operations are controlled archive I/O only; they never execute
staged JavaScript. Host-inspection results that contain active or release bytes
must be copied through the broker into read-only evidence or converted to a
read-only evidence view. Production roots are never exposed directly to
candidate or R0 code execution.

### Sandboxed staged-code operations

Every operation below runs inside the operator-home-masked namespace:

~~~text
npm.pack_staged_source
npm.prefix_candidate
npm.ci_candidate
npm.ls_candidate
node.candidate_runtime_identity
node.candidate_sqlite_disposable_smoke
node.candidate_lancedb_disposable_smoke
node.candidate_targeted_tests
node.r0_runtime_identity
node.r0_sqlite_disposable_smoke
node.r0_lancedb_disposable_smoke
node.candidate_manifest
node.r0_manifest
tar.verify_extract_candidate
tar.verify_extract_r0
~~~

The sandbox exposes only the read-only Node/npm runtime, read-only required
harness tools, the read-write owned staging root, and minimum required system
libraries. It hides the operator home, source repository, active extension,
active release, config, sessions, memory, databases, and real LanceDB.

The registry rejects unregistered operations, shell invocation, `shell=true`,
`/bin/sh -c`, `bash -c`, `eval`, `source`, arbitrary `find`/`rg`/`grep`, bare
package-manager commands, inherited environment, and inherited cwd. Output is
bounded and a timeout is mandatory for every child. Sandbox capability failure
is a hard rejection with no host fallback.

## Source and dependency isolation

The source repository is treated as an immutable Git authority, not as a
dependency installation directory. The implemented source-staging flow is:

~~~text
exact Git commit
→ git archive into staging
→ extract reviewed source under staging
→ npm pack from staged reviewed source with --ignore-scripts
→ extract package into candidate/install
→ npm ci against candidate/install with lifecycle scripts enabled
~~~

The source repository's `node_modules` is never read by npm, never included in
any sentinel, and never passed as npm cwd or prefix. Source mutation proof uses
Git status, Git tree identity, and package file hashes. The package step is
script-free; the dependency step is the only step that permits lifecycle
scripts, and it runs inside the dependency sandbox.

Native smoke is fail-closed: missing modules, import failures, native binding
load failures, `available=false`, or `ok!=true` all reject the transaction.
Candidate and R0 verification require `sqlite.ok=true`,
`sqlite.available=true`, `lancedb.ok=true`, and `lancedb.available=true`.
Synthetic production fixtures install local, dependency-free packages named
`better-sqlite3` and `@lancedb/lancedb` through real `npm pack` and `npm ci`;
the smoke helper exercises their complete minimal APIs rather than accepting a
hook or an unavailable result.

Runtime identity is a hard binding. The three expected source, active, and
release runtime identities are lowercase 64-hex SHA-256 values; null, empty,
or placeholder values are invalid. Candidate identity must be valid and equal
to the expected source identity after `npm ci`, after candidate freeze, and
after candidate archive re-extraction. R0 identity must be valid and equal to
the expected active identity during capture and after archive re-extraction.
The same checks are repeated by verify using the bound Node executable recorded in
the authority, after revalidating that executable's realpath, SHA-256, version,
and ABI; verify never substitutes `process.execPath` or a PATH-resolved Node.

Python, `cc`, `cxx`, `make`, and `ar` are also exact plan-bound regular
non-symlink executables with realpath, SHA-256, and version checks. The plan
binds `node_gyp_root` to the complete npm node-gyp package closure and records
its v2 tree identity. These identities are checked during dry-run and again
immediately before the first prepare mutation, recorded in the authority, and
revalidated by verify. The sandbox forces `PYTHON`, `CC`, `CXX`, `MAKE`, and
`AR` to these bindings; PATH is not used to select the toolchain.

The candidate authority uses a typed entry inventory rather than a
regular-file-only list. Every entry records its relative path, type, mode, and,
as applicable, file size/SHA-256 or symlink target and resolution state.
Directories and internal symlinks are self-bound; regular files are covered by
checksums; external or dangling symlinks, special entries, unexpected empty directories,
and external hardlink references reject the run. Internal npm
`.bin` symlinks and internal hardlink groups are retained and verified; internal npm
style links are part of the synthetic coverage.

The transient external-link policy is strict rejection, not generic cleanup.
The synthetic lifecycle fixture proves that a fresh install has no external
build link. Immediately after `npm ci`, before `npm ls`, runtime identity, or
native smoke, the implementation records one candidate link audit. If a root
or dependency path such as `candidate/install/build/node_gyp_bins/python3` or
`candidate/install/node_modules/better-sqlite3/build/node_gyp_bins/python3`
points outside the candidate, the run stops before publication; it is not
deleted, repaired, allowlisted, or represented by cleanup evidence. The
synthetic fixture itself removes only its own known build link before the
harness audit.

Before inventory and checksum generation, the implementation removes only the
owned transient paths `candidate/unpack`, `npm-cache`, `empty-npmrc`, `.harness`,
the sandbox root, re-extraction scratch, disposable smoke data, and any R0
scratch. The frozen candidate install, authority archives, source artifacts,
and required evidence remain. The final typed inventory proves the transient
layout is absent.

Before `npm ci`, the fixed `npm.prefix_candidate` operation must prove:

~~~text
cwd == candidate/install
resolved prefix realpath == candidate/install realpath
resolved prefix realpath != source repository realpath
candidate/install is contained by staging
candidate/install/package.json exists
candidate/install/package-lock.json exists
candidate/install/node_modules is absent
~~~

The actual install operation then uses both explicit cwd and explicit prefix.
There is no implicit `cd`, inherited `process.cwd`, nearest-package discovery,
source prefix, or retry after a nonzero `npm ci` exit.

The production default factory creates the path broker, closed command
registry, real sandbox runner, preflight, and stage handlers. The CLI does not
accept or depend on test hooks; synthetic end-to-end tests invoke this same
default path with temporary Git, package, service, and authority fixtures.

## Sentinel contract

No second full-tree hash algorithm is introduced. The builder reuses the
`memory-engine-runtime-artifact-manifest-v2` primitive for filesystem identity.
That primitive covers relative path, type, mode, size, file SHA-256, symlink
target and resolution, hardlink topology, external references, special or
unknown entries, semantic identity, topology identity, and exact identity.

The lightweight envelope is:

~~~text
schema=memory-engine-runtime-authority-sentinel-v1
~~~

The evidence envelope separates two values:

- `manifest_file_sha256` is evidence-file integrity only. It may include
  `checked_at` and `root_path`, and it never participates in tree or sentinel
  identity;
- `sentinel_identity` is the SHA-256 of the canonical JSON projection below.

The projection contains only:

- sentinel schema;
- artifact manifest schema;
- semantic, topology, and exact identities;
- entry, file, directory, and symlink counts;
- external and dangling reference counts;
- writable counts;
- Git commit/tree identity;
- package.json and package-lock.json SHA-256 values.

Canonical encoding is UTF-8 JSON with lexicographically sorted object keys, the
defined semantic order for arrays, and no insignificant whitespace. It excludes
`checked_at`, `root_path`, absolute paths, mtime, ctime, inode, uid, gid, and
filesystem traversal order. Therefore the same tree under different roots or at
different check times has the same `sentinel_identity`, while its
`manifest_file_sha256` may differ. A sentinel mismatch is a hard stop; it is not
repaired, recomputed with an alternate algorithm, or made equivalent by
operator choice.

## Canonical authority archive

Candidate and R0 archives use:

~~~text
schema=memory-engine-runtime-authority-archive-v1
~~~

The canonical archive contract is semantic, not merely a recommended shell
command:

- archive executable is GNU tar;
- archive container is uncompressed POSIX pax tar with `--format=posix`;
- entry order is bytewise relative-path order;
- one fixed, supported tar format is selected by the implementation;
- mtime is a fixed value;
- uid and gid are `0`, and uname and gname are empty;
- atime and ctime are excluded;
- absolute paths and parent traversal are forbidden;
- original mode is preserved;
- file bytes and symlink targets are preserved;
- internal hardlink topology is preserved;
- external hardlinks and special files are forbidden.

An implementation may use equivalent GNU tar flags such as a fixed format,
`--sort=name`, fixed `--mtime`, numeric owner/group zero, and explicit handling
of PAX metadata, but those flags are not the authority by themselves. The
semantic properties above are the contract and must be checked by the manifest
and re-extraction proof.

Required archive tests use synthetic trees:

- archiving the same tree twice produces the same archive SHA-256;
- mtime, uid, and gid changes do not change the archive SHA-256;
- file byte, mode, path, type, or symlink-target changes produce a different
  archive or an exact-parity failure;
- extraction produces the source v2 exact identity;
- internal hardlink topology is preserved.

## Verify contract

For `dry-run` and `prepare`, the plan is the sole source of operational
bindings. For `verify`, `--authority` is the sole accepted root argument.

The verify root must be a regular, non-symlink directory. `authority.json` and
`checksums.sha256` inside that root are self-binding; no external path, tool,
policy, or identity override is accepted. Verification must check:

- authority schema and `published=true`;
- the authority-root binding;
- checksums;
- candidate and R0 archive hashes;
- manifest validation;
- sentinel identities;
- archive re-extraction parity;
- absence of unexpected files.

Candidate and R0 extraction during verify runs in a dedicated, operator-home-
masked verification namespace. The authority root is read-only evidence; a
separate owner-only scratch receives a copied archive, and only the bound tar,
Node runtime, required libraries, and scratch are exposed. The recorded tar realpath,
SHA-256, and version are revalidated before extraction. Scratch is
always removed and an extraction failure never changes the authority root.

Passing a different path cannot change any frozen binding stored in the
authority. A failure to prove self-binding or exact contents is a rejection.

### Host before/after stability

The first complete preflight records a host snapshot and the final pre-
assembly gate records a second snapshot in:
`evidence/host-stability.json`. The fixed evidence schema is
`memory-engine-runtime-authority-host-stability-v1`; each snapshot contains
only the configuration SHA-256 and exact Gateway/Console active, running, PID,
and restart-count fields. Both snapshots must equal the plan-derived expected
values and each other. Any configuration or service drift consumes the claim,
leaves final absent, and prevents publication. The authority records the
evidence path and all expected host values, so verify can independently check
the same before/after contract.

## Transaction model

`prepare` is a one-shot transaction. The following journal stages are fixed:

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

The journal is evidence, not a resumable state machine. A run ID is usable once.
Staging and final must both be absent before a run. A failed run cannot resume,
change bindings, or publish. A new attempt needs a new plan and run ID.

Only after all gates pass may the implementation atomically rename staging to
final on the same filesystem. Publication then atomically updates the sibling
claim to `PUBLISHED`; only both operations succeeding return `PASS`. If the
claim update fails after rename, the builder first attempts an owned atomic
rename back to staging, marks the claim `FAILED`, and cleans staging. If that
rollback fails, the outcome is `RECOVERY_REQUIRED`, the claim is never
`PUBLISHED`, and no success is reported. Verify derives the sibling
`.run-claims/<run_id>.json` path and first requires `.run-claims` itself to be
an owner-matching, non-symlink directory with mode `0700`. The claim must be an
owner-matching regular non-symlink file with mode `0600`; its run ID, plan
SHA-256, and `PUBLISHED` outcome self-bind to the authority.

### Fixed authority roles and publication completeness

The authority has fixed semantic roles rather than positional arrays. Archives
must be exactly `candidate_archive` and `r0_archive`; manifests must be exactly
`candidate_frozen`, `active_before`, and `active_after`; runtime checkpoints
must be exactly `candidate_after_ci`, `candidate_after_freeze`,
`candidate_after_reextract`, `r0_capture`, and `r0_after_reextract`. Candidate
archive references the candidate manifest and candidate-after-freeze evidence;
R0 archive references active-before and R0-capture evidence. The candidate
manifest has a sentinel, active-before and active-after have equal exact
identity, and candidate/R0 checkpoints bind to source/active expected identity
classes respectively. Unknown, duplicate, missing, or swapped roles reject.

The journal must equal the frozen stage order exactly. Before writing
`published=true`, an independent authority completeness validator checks all
roles, references, expected identities, and journal entries. Any failure keeps
the final root absent and marks the consumed claim `FAILED`.

### One-shot run claim

Prepare creates a minimal claim at:

~~~text
<persistent_parent>/.run-claims/<run_id>.json
~~~

The claim directory is mode `0700`; the claim is created atomically with
`O_CREAT|O_EXCL` and mode `0600` before staging creation. It contains only
`run_id`, `plan_sha256`, `claimed_at`, and the final outcome. Dry-run never
creates a claim. An existing claim rejects the run. The outcome is atomically
updated only to `FAILED` or `PUBLISHED`; claims are never deleted and do not
support resume.

## R0 freeze model

R0 is not a chmod-frozen extracted directory. Its persistent authority consists
of a mode-preserving tar archive, archive SHA-256, active-before and active-after
v2 manifests, a re-extracted v2 manifest, runtime identity, exact parity report,
and native smoke report.

The active tree is copied with independent file bytes and no shared external
hardlinks. The before and after exact identities must match. The re-extracted R0
exact identity must match the stable active exact identity, runtime identity must
match, and external references must be zero. The final authority root does not
retain a writable extracted R0 tree.

## Dry-run contract

`dry-run` is strictly read-only. It creates no staging or final root, runs no
package operation, creates no tar, performs no native smoke, writes no config,
and performs no service operation.

It may validate the plan, inspect Git identity and status, compute active and
release artifact manifests, produce a safe configuration identity projection,
read exact systemd status, evaluate path policy, probe sandbox capability without
mounting production paths, and render the deterministic operation DAG.

Its output schema is:

~~~text
schema=memory-engine-runtime-authority-dry-run-v1
decision=PASS|REJECT
plan_sha256
validated_bindings
allowed_roots
denied_roots
planned_operations
preflight_findings
mutation_count=0
~~~

The output excludes provider credentials, unapproved configuration values, all
memory or session content, the raw environment, and the full process
environment. The same synthetic input must produce byte-identical output apart
from the explicitly non-identity `checked_at` evidence field.

## Failure-injection matrix

Every row is a required fail-closed test or gate:

| Failure | Required result |
| --- | --- |
| truncated release path | reject before filesystem traversal |
| similar release directory exists | no substitution |
| source commit mismatch | reject |
| dirty source worktree | reject |
| source repository supplied as npm prefix | reject before npm |
| candidate prefix resolves outside staging | reject |
| candidate prefix equals source repository | reject |
| source `node_modules` access attempt | policy violation |
| session or memory path read attempt | policy violation |
| free shell operation requested | policy violation |
| sandbox unavailable | reject with no fallback |
| external or dangling symlink | invalid manifest |
| external hardlink reference | invalid manifest |
| special file, FIFO, or socket | invalid manifest |
| nonzero `npm ci` exit | stop with no retry |
| candidate archive re-extraction mismatch | stop |
| active identity changes during R0 window | stop |
| R0 archive re-extraction mismatch | stop |
| configuration SHA drift | stop |
| Gateway PID or restart drift | stop |
| Console PID or restart drift | stop |
| final root already exists | stop |
| atomic rename failure | no published authority |
| incomplete cleanup | failed staging remains unpublished |

## Synthetic test contract

All implementation tests use temporary synthetic fixtures created by the test
process. They never read a real operator home, session files, memory files,
configuration, runtime, database, or user secret.

Required groups are:

- plan: exact valid plan, unknown key, expiry, relative path, symlink plan,
  truncated authority path, and run-ID reuse;
- path policy: allowed roots, denied session and memory paths, denied source
  `node_modules`, ancestor symlink escape, root symlink, external symlink, and
  TOCTOU replacement;
- determinism: same-tree identity, traversal-order independence, mtime/ctime
  independence, and detection of byte/mode/path/type/target changes;
- commands: no shell, explicit cwd, explicit npm prefix, source/candidate
  inequality, unregistered executable rejection, bounded output, and timeout;
- sandbox: a synthetic home with session and memory canaries hidden from every
  npm pack child, npm ci child, candidate native-smoke child, candidate
  targeted-test child, and R0 native-smoke child while a staging canary remains
  visible;
- archive: canonical ordering, fixed metadata, repeat SHA-256 determinism,
  mutation detection, exact re-extraction parity, and hardlink-topology
  preservation;
- verify: sole `--authority` root, regular non-symlink root, self-binding
  authority/checksum files, manifest and archive checks, sentinel checks, and
  unexpected-file rejection;
- transaction: every injected stage failure leaves final absent, forbids retry
  under the same run ID, publishes only after all gates, uses atomic rename, and
  cleans only owned staging.

## Future Edi verification

After implementation, Edi must first run synthetic `dry-run` only. The first
verification must prove hidden canaries, inaccessible source `node_modules`,
zero dry-run mutations, deterministic operation DAG, rejection of wrong npm
prefix and free shell requests, fail-closed sandbox-unavailable behavior, and
absence of real OpenClaw path opens.

Passing this dry-run review does not authorize real candidate preparation,
installation, sourcePath changes, service operations, AutoRecall, H6, tags, or
pushes. Edi is not invoked by this design stage.

## Status and authorization boundary

This is an accepted design with source implementation present and synthetic
verification passed. The implementation is not runtime verified and is not
used for a real candidate. Any implementation execution requires a separate
authorization that names the exact plan, run ID, roots, identities, tool
bindings, and one-shot scope. A failed authorization is consumed and cannot be
retried automatically.

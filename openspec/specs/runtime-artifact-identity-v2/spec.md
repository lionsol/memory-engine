# runtime-artifact-identity-v2 Specification

## Purpose
Define an additive v2 runtime-artifact identity contract that separates semantic tree identity from internal hardlink topology while preserving v1 historical identity semantics.
## Requirements
### Requirement: v1 identity remains stable

The implementation MUST preserve `memory-engine-runtime-artifact-manifest-v1`, its existing `identity` field, and existing v1 tests. v2 MUST use separate fields and MUST NOT redefine the v1 identity.

#### Scenario: Existing v1 artifact is built

- **WHEN** the v1 builder is called on an existing fixture
- **THEN** its schema, identity serialization, hardlink-bearing identity, and tests remain unchanged

### Requirement: Semantic identity is complete and topology-independent

The v2 semantic identity MUST include relative path, entry type, permission mode, regular-file size and SHA-256, symlink target and within-root resolution state, and root entry type and mode. It MUST exclude inode/device numbers, internal hardlink membership, uid/gid, timestamps, and allocation metadata.

#### Scenario: Hardlink membership changes without semantic drift

- **WHEN** a candidate internal hardlink group is expanded into independent files with the same paths, types, modes, sizes, hashes, and symlink state
- **THEN** semantic identities are equal
- **AND** topology identities differ

### Requirement: Both trees pass an independent fail-closed validity gate

The candidate and installed manifests MUST independently reject artifact-root symlinks, external/dangling/unresolvable symlinks, external hardlink references, special files, unknown entry types, stat/read/readlink/realpath failures, incomplete or unclassifiable topology, and invalid schema or fields.

#### Scenario: Unsafe installed tree is compared

- **WHEN** the installed tree contains an external link, dangling symlink, special file, root symlink, or incomplete topology
- **THEN** the comparison is rejected
- **AND** no policy can convert that failure into acceptance

### Requirement: Builder and validator share one relative-path contract

The builder and validator MUST use the same `isValidRelativePath` contract. A collected path rejected by that contract MUST make the builder invalid, clear semantic/topology/exact identities, record a deterministic path error, and mark topology incomplete. The build CLI MUST return status 2, and the comparator MUST classify the report as `INVALID_MANIFEST` under both policies.

#### Scenario: Linux filename contains a backslash

- **WHEN** a regular file has basename `bad\name`
- **THEN** the builder returns `valid=false`, null identities, incomplete topology, and a deterministic path error
- **AND** the validator rejects that builder output
- **AND** the build CLI returns status 2
- **AND** both policies reject comparison with `INVALID_MANIFEST`

### Requirement: Hardlink groups are physically self-consistent

Every member of one regular-file hardlink group MUST resolve to an entry with identical permission mode, size, and SHA-256. The validator MUST select the lexically first group path as reference, reject every mismatch with a deterministic group-member error, return `schema_valid=false` and `artifact_valid=false`, and classify comparison as `INVALID_MANIFEST` under both policies. This condition MUST NOT be classified as `SEMANTIC_MISMATCH`.

#### Scenario: Forged group member differs in content, size, or mode

- **WHEN** a manifest group contains members with different SHA-256, size, mode, or any combination of those fields
- **AND** semantic, topology, and exact identities are recomputed after the forgery
- **THEN** validation still rejects the internally impossible group
- **AND** comparison returns `INVALID_MANIFEST`, `REJECT`, and `accepted=false` under `exact` and `allow_internal_hardlink_split_v1`

#### Scenario: Builder-generated group is self-consistent

- **WHEN** the builder creates a real internal regular-file hardlink group
- **THEN** the validator accepts the group and its identities remain eligible for the normal exact/split transition rules

### Requirement: Topology identity records the complete hardlink relation

The v2 topology identity MUST deterministically record complete regular-file equivalence-class path membership and external reference counts. The exact identity MUST deterministically combine semantic and topology identities.

#### Scenario: Three native dependency groups expand

- **WHEN** a synthetic candidate contains three better-sqlite3-shaped internal hardlink groups
- **AND** the installed tree contains the same files as independent files
- **THEN** the topology transition is classified as `SPLIT_ONLY`

### Requirement: Split-only classification uses the subset relation

The comparator MUST classify a transition as `SPLIT_ONLY` only when installed hardlink sharing is a strict subset of candidate sharing, with equal semantic identities and valid manifests. It MUST reject merges, cross-group relinking, new sharing, semantic differences, and mixed or unknown transformations.

#### Scenario: Partial group splitting

- **WHEN** an installed group contains a proper subgroup of a candidate group
- **THEN** the classification is `SPLIT_ONLY`
- **AND** the result records the controlled split transformation

### Requirement: Policy selection is explicit and closed

The comparator MUST support exactly `exact`, `allow_internal_hardlink_split_v1`, and `allow_install_root_mode_and_internal_hardlink_split_v1`. The default MUST be `exact`, and policy selection MUST NOT be inferred from observed semantic or topology differences.

#### Scenario: Default policy sees a split

- **WHEN** a valid transition is classified as `SPLIT_ONLY` and no policy is supplied
- **THEN** the decision is rejection under `exact`

#### Scenario: Explicit split policy sees a split

- **WHEN** a valid transition is classified as `SPLIT_ONLY` and policy `allow_internal_hardlink_split_v1` is supplied
- **THEN** the decision is acceptance with a controlled transformation record

#### Scenario: Strict install-normalization policy sees a split

- **WHEN** a valid transition is classified as `SPLIT_ONLY` and policy `allow_install_root_mode_and_internal_hardlink_split_v1` is supplied
- **THEN** the decision is acceptance with the existing bounded split evidence

### Requirement: Install normalization is a single explicit semantic exception

The comparator MUST classify a valid candidate/installed pair as `INSTALL_NORMALIZATION` only when the complete semantic difference contains exactly one changed path, exactly one changed field, path `.`, field `mode`, candidate root type/mode is directory/`0500`, and installed root type/mode is directory/`0700`. All non-root paths, types, modes, file sizes, file hashes, symlink targets, and symlink resolution states MUST be equal. Both manifests MUST pass the complete validity gate, including no external or dangling symlink, external hardlink reference, special entry, or unknown entry. A raw semantic identity difference in this case is expected and MUST be reported as `semantic_equal=false`.

#### Scenario: Root mode normalization is isolated

- **WHEN** only the artifact root changes from mode `0500` to `0700`
- **THEN** classification is `INSTALL_NORMALIZATION` independently of policy
- **AND** the report records the single root-mode transformation

#### Scenario: Any other semantic change accompanies root normalization

- **WHEN** root mode changes from `0500` to `0700` and any child mode, directory mode, content, size, hash, path, symlink target, or resolution state also changes
- **THEN** classification is `SEMANTIC_MISMATCH`
- **AND** every policy rejects

#### Scenario: Other root mode transitions are rejected

- **WHEN** the root transition is not exactly `0500` to `0700`
- **THEN** classification is `SEMANTIC_MISMATCH`
- **AND** the strict install-normalization policy rejects

### Requirement: Install normalization composes only with exact or split-only topology

After the exact semantic exception is established, the comparator MUST classify the underlying hardlink transition as `EXACT` or pure `SPLIT_ONLY` before producing `INSTALL_NORMALIZATION`. `SPLIT_ONLY` MUST satisfy the installed-sharing-subset relation, have at least one removed sharing pair, zero new sharing pairs, and no cross-group relink or merge. Merge, new sharing, cross-group relink, mixed/unknown topology, external references, and invalid manifests MUST retain their existing rejection classification and MUST NOT be relabeled `INSTALL_NORMALIZATION`.

#### Scenario: Root normalization plus three native hardlink splits

- **WHEN** the root changes exactly from `0500` to `0700` and three internal candidate groups are independently expanded
- **THEN** classification is `INSTALL_NORMALIZATION`
- **AND** the report records `SPLIT_ONLY`, three removed sharing pairs, and zero new sharing pairs

### Requirement: The strict install-normalization decision matrix preserves old policies

Under `exact`, only `EXACT` passes. Under `allow_internal_hardlink_split_v1`, only `EXACT` and `SPLIT_ONLY` pass. Under `allow_install_root_mode_and_internal_hardlink_split_v1`, `EXACT`, `SPLIT_ONLY`, and `INSTALL_NORMALIZATION` pass. Classification MUST be computed before policy evaluation, so the same manifests have the same classification under all three policies.

#### Scenario: Old policies reject normalization

- **WHEN** valid manifests produce `INSTALL_NORMALIZATION`
- **THEN** `exact` and `allow_internal_hardlink_split_v1` reject with deterministic policy-derived stop reasons

#### Scenario: Strict policy accepts normalization

- **WHEN** valid manifests produce `INSTALL_NORMALIZATION` with exact or pure split-only topology
- **THEN** `allow_install_root_mode_and_internal_hardlink_split_v1` passes
- **AND** exact topology uses `accepted_install_root_mode_normalization_v1`
- **AND** split-only topology uses `accepted_install_root_mode_and_internal_hardlink_split_v1`

### Requirement: Classification and decision matrix are deterministic

The comparator MUST emit only the closed classifications `EXACT`, `SPLIT_ONLY`, `MERGE_DETECTED`, `CROSS_GROUP_RELINK`, `MIXED_OR_UNKNOWN`, `EXTERNAL_REFERENCE`, `INVALID_MANIFEST`, `SEMANTIC_MISMATCH`, and `INSTALL_NORMALIZATION`. Under `exact`, only `EXACT` passes. Under `allow_internal_hardlink_split_v1`, only `EXACT` and `SPLIT_ONLY` pass. Under `allow_install_root_mode_and_internal_hardlink_split_v1`, `INSTALL_NORMALIZATION` also passes only when its exact semantic and topology gates hold.

#### Scenario: Semantic difference accompanies a split

- **WHEN** content, mode, path, or symlink target changes along with a topology split
- **THEN** classification is `SEMANTIC_MISMATCH`
- **AND** the decision rejects under both policies

#### Scenario: Controlled normalization has a raw semantic mismatch

- **WHEN** the only semantic difference is the accepted root mode transition and topology is exact or pure split-only
- **THEN** classification is `INSTALL_NORMALIZATION` and `semantic_equal=false`
- **AND** the decision follows the explicit policy matrix rather than treating the raw identity difference as `EXACT`

### Requirement: Comparison reports expose structured gate evidence

Every comparison report MUST emit candidate and installed semantic, topology, and exact identities; hardlink-group counts; external-hardlink-reference counts; `semantic_equal`; `topology_equal`; classification; policy; decision; accepted; and a deterministic `stop_reason`. Missing or schema-invalid manifests MUST use nulls for untrusted values. `stop_reason` MUST be derived from validation, classification, and policy and MUST NOT be caller-supplied free text.

#### Scenario: Exact pass

- **WHEN** both valid trees are identical under all identity layers
- **THEN** the report exposes all six identities, `semantic_equal=true`, `topology_equal=true`, `classification=EXACT`, `decision=PASS`, `accepted=true`, and `stop_reason=accepted_exact`

#### Scenario: Accepted or rejected split

- **WHEN** a valid transition is `SPLIT_ONLY`
- **THEN** the report retains the controlled transformation and complete affected group membership
- **AND** the explicit split policy reports `PASS` with an acceptance stop reason
- **AND** the default `exact` policy reports `REJECT` with a policy-derived stop reason

#### Scenario: Normalization evidence is structured

- **WHEN** classification is `INSTALL_NORMALIZATION`
- **THEN** the report retains `semantic_equal=false`, the root-mode fields, underlying topology classification, topology identities, and bounded split-group membership
- **AND** rejected old-policy reports retain the same transformation evidence with `accepted=false`

#### Scenario: Invalid or external manifest

- **WHEN** a manifest is schema-invalid or contains an external hardlink reference
- **THEN** the report emits null identities where untrusted, exposes only trusted gate counts, reports `INVALID_MANIFEST` or `EXTERNAL_REFERENCE`, and rejects

### Requirement: Comparison differences are bounded and sufficient

Semantic mismatch evidence MUST include a deterministic difference count and bounded changed-path summary covering path/type/mode/file size/hash/symlink target and resolution-state differences. Merge, cross-group relink, and mixed/unknown results MUST include bounded topology summaries with affected group membership and new/removed-sharing counts. The report MUST NOT emit an unbounded pairwise relation.

#### Scenario: Topology rejection evidence

- **WHEN** a transition is `MERGE_DETECTED`, `CROSS_GROUP_RELINK`, or `MIXED_OR_UNKNOWN`
- **THEN** the report includes bounded candidate/installed affected groups and deterministic sharing-difference counts sufficient to establish the rejection

### Requirement: Source tooling remains offline and bounded

The v2 build and compare CLIs MUST be read-only source tooling over explicitly supplied roots/manifests. The implementation MUST NOT modify installer logic, runtime state, configuration, databases, memory data, services, releases, or Git history.

#### Scenario: Source implementation is validated

- **WHEN** the v2 tests and static checks run
- **THEN** only synthetic temporary fixtures and repository source/test/OpenSpec/documentation files are changed
- **AND** source completion does not authorize installation or runtime acceptance

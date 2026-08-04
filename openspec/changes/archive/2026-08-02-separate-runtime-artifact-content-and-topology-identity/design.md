# Design

## Contract boundaries

The v1 library remains the sole implementation of `memory-engine-runtime-artifact-manifest-v1`. The v2 library is separate and emits `memory-engine-runtime-artifact-manifest-v2` with these independent fields:

- `semantic_identity`: deterministic identity of root entry type/mode and each relative path, entry type, mode, regular-file size/hash, and symlink target/resolution state. It excludes inode/device, hardlink membership, uid/gid, timestamps, and allocation metadata.
- `topology_identity`: deterministic identity of complete regular-file hardlink equivalence classes and each external reference count.
- `exact_identity`: deterministic combination of semantic and topology identities for exact snapshots and rollback-source comparisons.

The manifest records all regular-file equivalence classes, including singleton classes, so the comparator can evaluate the relation `H_installed ⊆ H_candidate` without path-specific exceptions.

## Independent validity gate

Each manifest is independently validated before comparison. The builder and validator fail closed for an artifact-root symlink, non-directory root, external/dangling/unresolvable symlink, external hardlink reference, special or unknown entry type, stat/read/readlink/realpath failure, incomplete or unclassifiable topology, and malformed or inconsistent manifest fields. Invalid reports have null identities and cannot pass a policy.

The builder and validator MUST use the same `isValidRelativePath` contract. Every collected relative path rejected by that contract makes the builder report invalid, clears all three identities, records the deterministic path error, and marks topology incomplete. The validator MUST reject the same path, and the build CLI MUST return status 2. Such a report compares as `INVALID_MANIFEST` under both policies.

Every regular-file hardlink group MUST also be internally self-consistent: all member entries must have identical mode, size, and SHA-256. The validator selects the first lexically sorted group path as the deterministic reference and rejects every differing member with a structured group-member error. This is an internally invalid manifest, not a semantic transition, and no policy may accept it.

## Transition classification

After both manifests are valid and semantic identities are equal, the comparator evaluates hardlink membership as a pairwise equivalence relation:

- `EXACT`: the topology relations are equal.
- `SPLIT_ONLY`: installed sharing is a strict subset of candidate sharing.
- `MERGE_DETECTED`: previously independent files are newly shared.
- `CROSS_GROUP_RELINK`: an installed group joins paths from at least two previously non-singleton candidate groups.
- `MIXED_OR_UNKNOWN`: a split is combined with new sharing without a clear permitted classification.
- `EXTERNAL_REFERENCE`: either manifest records an external hardlink reference.
- `INVALID_MANIFEST`: either manifest fails schema or validity gates.
- `SEMANTIC_MISMATCH`: either semantic identity differs after both manifests pass validity.

Semantic mismatch and every invalidity are unconditional rejection conditions.

## Policy matrix

The comparator receives a policy as input. Omission selects the required safe default `exact`; observed topology never selects a policy.

| Policy | Pass | Reject |
| --- | --- | --- |
| `exact` | `EXACT` | every other classification |
| `allow_internal_hardlink_split_v1` | `EXACT`, `SPLIT_ONLY` | every other classification |

An accepted split result records a controlled `internal_hardlink_split_v1` transformation and the affected candidate/install group memberships.

## Structured comparison evidence

Every comparison report emits the candidate and installed semantic, topology, and exact identities; hardlink-group and external-reference counts; `semantic_equal`; `topology_equal`; classification; policy; decision; accepted; and a deterministic `stop_reason`. Values from schema-invalid manifests are null. Artifact-invalid but schema-valid reports may expose only structurally trusted gate counts, never identities.

Valid comparisons include a semantic difference object with a deterministic changed-path count, changed-field count, and bounded changed-path entries covering path, type, mode, file size/hash, and symlink target/resolution fields. They also include a bounded topology difference object with shared-pair counts, new/removed-sharing counts, and bounded affected group memberships. `SPLIT_ONLY` additionally retains the complete affected candidate and installed subgroup membership in its controlled transformation. No unbounded pairwise relation is emitted.

## CLI and verification boundary

The v2 build CLI creates a read-only JSON evidence file from a supplied root. The compare CLI reads two v2 JSON manifests and applies the supplied policy, defaulting to exact. Both are offline source tools; no installer, runtime directory, service, configuration, database, or memory data is accessed or changed.

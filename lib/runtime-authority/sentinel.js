const { createHash } = require("node:crypto");
const { SENTINEL_SCHEMA } = require("./constants.js");
const { canonicalBytes, canonicalize, sha256Canonical } = require("./canonical-json.js");

function manifestFileSha256(manifest) {
  return createHash("sha256").update(canonicalBytes(manifest)).digest("hex");
}

function sentinelProjection({ manifest, gitCommit, gitTree, packageJsonSha256, packageLockSha256 }) {
  return {
    sentinel_schema: SENTINEL_SCHEMA,
    artifact_manifest_schema: "memory-engine-runtime-artifact-manifest-v2",
    semantic_identity: manifest.semantic_identity,
    topology_identity: manifest.topology_identity,
    exact_identity: manifest.exact_identity,
    counts: {
      entry_count: manifest.entry_count,
      file_count: manifest.file_count,
      directory_count: manifest.directory_count,
      symlink_count: manifest.symlink_count,
      special_entry_count: manifest.special_entry_count,
      unknown_entry_count: manifest.unknown_entry_count,
      external_symlink_count: manifest.external_symlink_count,
      dangling_symlink_count: manifest.dangling_symlink_count,
      external_hardlink_reference_count: manifest.external_hardlink_reference_count,
      writable_file_count: manifest.writable_file_count,
      writable_directory_count: manifest.writable_directory_count,
    },
    git_commit: gitCommit,
    git_tree: gitTree,
    package_json_sha256: packageJsonSha256,
    package_lock_sha256: packageLockSha256,
  };
}

function buildSentinel({ manifest, checkedAt = new Date().toISOString(), rootPath = manifest.root_path, ...inputs }) {
  const projection = sentinelProjection({ manifest, ...inputs });
  return {
    schema: SENTINEL_SCHEMA,
    checked_at: checkedAt,
    root_path: rootPath,
    manifest_file_sha256: manifestFileSha256(manifest),
    sentinel_identity: sha256Canonical(projection),
    projection,
  };
}

function validateSentinel(sentinel, { manifest, ...inputs }) {
  const errors = [];
  if (!sentinel || sentinel.schema !== SENTINEL_SCHEMA) errors.push("schema");
  if (sentinel?.manifest_file_sha256 !== manifestFileSha256(manifest)) errors.push("manifest_file_sha256");
  const expectedProjection = sentinelProjection({ manifest, ...inputs });
  if (canonicalize(sentinel?.projection) !== canonicalize(expectedProjection)) errors.push("projection");
  if (sentinel?.sentinel_identity !== sha256Canonical(expectedProjection)) errors.push("sentinel_identity");
  return { valid: errors.length === 0, errors };
}

module.exports = { manifestFileSha256, sentinelProjection, buildSentinel, validateSentinel };

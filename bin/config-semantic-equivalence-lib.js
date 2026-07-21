const { createHash } = require("node:crypto");
const { lstatSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const CONFIG_EQUIVALENCE_SCHEMA_VERSION = 1;
const CONFIG_EQUIVALENCE_POLICY = "memory-engine-config-semantic-equivalence-v1";
const APPROVED_HOST_METADATA_PATH = "meta.lastTouchedAt";

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function octalMode(stats) {
  return (stats.mode & 0o7777).toString(8).padStart(4, "0");
}

function readConfigFile(pathValue) {
  const path = resolve(pathValue);
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) throw new Error(`config file must not be a symlink: ${path}`);
  if (!stats.isFile()) throw new Error(`config path must be a regular file: ${path}`);
  const bytes = readFileSync(path);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`invalid JSON in ${path}: ${error.message}`);
  }
  return {
    path,
    stats,
    bytes,
    value,
    identity: {
      path,
      sha256: sha256Hex(bytes),
      byte_count: bytes.byteLength,
      mode: octalMode(stats),
      owner_only_mode: (stats.mode & 0o077) === 0,
    },
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectChangedPaths(before, after, path = [], output = []) {
  if (Object.is(before, after)) return output;
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      collectChangedPaths(before[index], after[index], [...path, String(index)], output);
    }
    return output;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort((left, right) => left.localeCompare(right));
    for (const key of keys) collectChangedPaths(before[key], after[key], [...path, key], output);
    return output;
  }
  output.push(path.join("."));
  return output;
}

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map(key => [key, sortedValue(value[key])]),
  );
}

function withoutApprovedHostMetadata(value) {
  const copy = JSON.parse(JSON.stringify(value));
  if (isPlainObject(copy.meta)) delete copy.meta.lastTouchedAt;
  return copy;
}

function canonicalSemanticIdentity(value) {
  return sha256Hex(Buffer.from(JSON.stringify(sortedValue(withoutApprovedHostMetadata(value)))));
}

function canonicalUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function getLastTouchedAt(value) {
  return isPlainObject(value?.meta) ? value.meta.lastTouchedAt : undefined;
}

function buildConfigSemanticEquivalenceReport({
  beforePath,
  afterPath,
  checkedAt = new Date().toISOString(),
} = {}) {
  if (typeof beforePath !== "string" || !beforePath.trim()) throw new TypeError("beforePath is required");
  if (typeof afterPath !== "string" || !afterPath.trim()) throw new TypeError("afterPath is required");
  if (!canonicalUtcTimestamp(checkedAt)) throw new TypeError("checkedAt must be a canonical UTC timestamp");

  const before = readConfigFile(beforePath);
  const after = readConfigFile(afterPath);
  const changedPaths = [...new Set(collectChangedPaths(before.value, after.value))]
    .sort((left, right) => left.localeCompare(right));
  const unexpectedChangedPaths = changedPaths.filter(path => path !== APPROVED_HOST_METADATA_PATH);
  const beforeSemanticIdentity = canonicalSemanticIdentity(before.value);
  const afterSemanticIdentity = canonicalSemanticIdentity(after.value);
  const canonicalSemanticEqual = beforeSemanticIdentity === afterSemanticIdentity;
  const beforeLastTouchedAt = getLastTouchedAt(before.value);
  const afterLastTouchedAt = getLastTouchedAt(after.value);
  const beforeTimestampValid = canonicalUtcTimestamp(beforeLastTouchedAt);
  const afterTimestampValid = canonicalUtcTimestamp(afterLastTouchedAt);
  const timestampMonotonic = beforeTimestampValid
    && afterTimestampValid
    && Date.parse(afterLastTouchedAt) >= Date.parse(beforeLastTouchedAt);
  const exactByteEqual = before.identity.sha256 === after.identity.sha256
    && before.identity.byte_count === after.identity.byte_count;
  const approvedMetadataOnly = changedPaths.length === 1
    && changedPaths[0] === APPROVED_HOST_METADATA_PATH
    && canonicalSemanticEqual
    && timestampMonotonic;

  let status = "semantic_mismatch";
  if (exactByteEqual && changedPaths.length === 0) status = "exact_equal";
  else if (approvedMetadataOnly) status = "approved_host_metadata_change";

  const valid = status === "exact_equal" || status === "approved_host_metadata_change";
  const errors = [];
  if (unexpectedChangedPaths.length > 0) errors.push("unexpected_config_paths_changed");
  if (changedPaths.includes(APPROVED_HOST_METADATA_PATH) && !beforeTimestampValid) {
    errors.push("invalid_before_last_touched_at");
  }
  if (changedPaths.includes(APPROVED_HOST_METADATA_PATH) && !afterTimestampValid) {
    errors.push("invalid_after_last_touched_at");
  }
  if (changedPaths.includes(APPROVED_HOST_METADATA_PATH)
      && beforeTimestampValid
      && afterTimestampValid
      && !timestampMonotonic) {
    errors.push("last_touched_at_not_monotonic");
  }
  if (!canonicalSemanticEqual) errors.push("canonical_semantic_identity_mismatch");

  return {
    schema_version: CONFIG_EQUIVALENCE_SCHEMA_VERSION,
    checked_at: checkedAt,
    policy: CONFIG_EQUIVALENCE_POLICY,
    approved_host_metadata_paths: [APPROVED_HOST_METADATA_PATH],
    status,
    valid,
    exact_byte_equal: exactByteEqual,
    canonical_semantic_equal: canonicalSemanticEqual,
    canonical_semantic_sha256_before: beforeSemanticIdentity,
    canonical_semantic_sha256_after: afterSemanticIdentity,
    changed_path_count: changedPaths.length,
    changed_paths: changedPaths,
    unexpected_changed_paths: unexpectedChangedPaths,
    last_touched_at: {
      before: beforeLastTouchedAt ?? null,
      after: afterLastTouchedAt ?? null,
      before_valid: beforeTimestampValid,
      after_valid: afterTimestampValid,
      monotonic: timestampMonotonic,
    },
    before: before.identity,
    after: after.identity,
    errors: [...new Set(errors)].sort(),
  };
}

module.exports = {
  APPROVED_HOST_METADATA_PATH,
  CONFIG_EQUIVALENCE_POLICY,
  CONFIG_EQUIVALENCE_SCHEMA_VERSION,
  buildConfigSemanticEquivalenceReport,
  canonicalSemanticIdentity,
  collectChangedPaths,
};

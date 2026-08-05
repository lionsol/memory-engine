const { isAbsolute, posix, normalize } = require("node:path");
const { canonicalize } = require("./canonical-json.js");

const JOURNAL = Object.freeze([
  "PLAN_VALIDATED", "PREFLIGHT_PASSED", "RUN_CLAIMED", "SOURCE_ARCHIVED", "PACKAGE_PACKED",
  "DEPENDENCIES_INSTALLED", "CANDIDATE_VERIFIED", "CANDIDATE_ARCHIVED", "R0_CAPTURED", "R0_VERIFIED",
  "AUTHORITY_ASSEMBLED", "PUBLISHED",
]);

const ARCHIVE_ROLES = Object.freeze(["candidate_archive", "r0_archive"]);
const MANIFEST_ROLES = Object.freeze(["candidate_frozen", "active_before", "active_after"]);
const RUNTIME_CHECKPOINT_ROLES = Object.freeze([
  "candidate_after_ci", "candidate_after_freeze", "candidate_after_reextract", "r0_capture", "r0_after_reextract",
]);
const HOST_STABILITY_SCHEMA = "memory-engine-runtime-authority-host-stability-v1";
const TOOL_ROLES = Object.freeze([
  "node", "npm", "git", "tar", "unshare", "mount", "chroot", "systemctl",
  "python", "cc", "cxx", "make", "ar", "node_gyp",
]);
const EXECUTABLE_TOOL_ROLES = Object.freeze(TOOL_ROLES.filter(role => role !== "node_gyp"));
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} key set mismatch`);
}

function validRelative(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0") && !value.includes("\\")
    && !isAbsolute(value) && !value.split("/").includes("") && !value.split("/").includes("..")
    && value !== "." && posix.normalize(value) === value;
}

function requireRelative(value, label) {
  if (!validRelative(value)) throw new Error(`${label} must be a normalized relative path`);
}

function requireSha(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be lowercase SHA-256`);
}

function requireAbsoluteNormalized(value, label) {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0") || value.includes("\\")
    || normalize(value) !== value || (value.length > 1 && value.endsWith("/")) || value.startsWith("//")) {
    throw new Error(`${label} must be an absolute normalized path`);
  }
}

function requireNonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative integer`);
}

function assertToolIdentities(authority) {
  exactKeys(authority.tool_identities, TOOL_ROLES, "tool_identities");
  for (const role of EXECUTABLE_TOOL_ROLES) {
    const binding = authority.tool_identities[role];
    const keys = role === "node" ? ["kind", "path", "sha256", "version", "abi"] : ["kind", "path", "sha256", "version"];
    exactKeys(binding, keys, `tool:${role}`);
    if (binding.kind !== role) throw new Error(`tool:${role} kind mismatch`);
    requireAbsoluteNormalized(binding.path, `tool:${role}:path`);
    requireSha(binding.sha256, `tool:${role}:sha256`);
    if (typeof binding.version !== "string" || binding.version.length === 0) throw new Error(`tool:${role}:version required`);
    if (role === "node") requireNonnegativeInteger(binding.abi, "tool:node:abi");
  }
  const nodeGyp = authority.tool_identities.node_gyp;
  exactKeys(nodeGyp, ["kind", "path", "tree_identity", "entry_count", "file_count", "external_symlink_count", "dangling_symlink_count"], "tool:node_gyp");
  if (nodeGyp.kind !== "node_gyp") throw new Error("tool:node_gyp kind mismatch");
  requireAbsoluteNormalized(nodeGyp.path, "tool:node_gyp:path");
  requireSha(nodeGyp.tree_identity, "tool:node_gyp:tree_identity");
  for (const field of ["entry_count", "file_count", "external_symlink_count", "dangling_symlink_count"]) requireNonnegativeInteger(nodeGyp[field], `tool:node_gyp:${field}`);
  if (nodeGyp.external_symlink_count !== 0 || nodeGyp.dangling_symlink_count !== 0) throw new Error("tool:node_gyp external or dangling references rejected");
}

function hostSnapshotKeys(snapshot, label) {
  exactKeys(snapshot, ["config_sha256", "gateway", "console"], label);
  requireSha(snapshot.config_sha256, `${label}:config_sha256`);
  for (const service of ["gateway", "console"]) {
    exactKeys(snapshot[service], ["active", "running", "pid", "restart_count"], `${label}:${service}`);
    if (typeof snapshot[service].active !== "boolean" || typeof snapshot[service].running !== "boolean") throw new Error(`${label}:${service} state invalid`);
    requireNonnegativeInteger(snapshot[service].pid, `${label}:${service}:pid`);
    requireNonnegativeInteger(snapshot[service].restart_count, `${label}:${service}:restart_count`);
  }
}

function expectedHostSnapshot(authority) {
  return {
    config_sha256: authority.expected_config_sha256,
    gateway: { active: true, running: true, pid: authority.expected_gateway_pid, restart_count: authority.expected_gateway_restart_count },
    console: { active: true, running: true, pid: authority.expected_console_pid, restart_count: authority.expected_console_restart_count },
  };
}

function assertHostStabilityEvidence(evidence, authority) {
  exactKeys(evidence, ["schema", "before", "after"], "host_stability evidence");
  if (evidence.schema !== HOST_STABILITY_SCHEMA) throw new Error("host stability schema mismatch");
  hostSnapshotKeys(evidence.before, "host_stability:before");
  hostSnapshotKeys(evidence.after, "host_stability:after");
  const expected = expectedHostSnapshot(authority);
  if (canonicalize(evidence.before) !== canonicalize(expected) || canonicalize(evidence.after) !== canonicalize(expected)) throw new Error("host stability expected values mismatch");
  if (canonicalize(evidence.before) !== canonicalize(evidence.after)) throw new Error("host stability before/after drift");
  return true;
}

function requireRoleSet(items, roles, label) {
  if (!Array.isArray(items) || items.length !== roles.length) throw new Error(`authority completeness: ${label} must contain exactly ${roles.length} entries`);
  const allowed = new Set(roles);
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item.role !== "string" || !allowed.has(item.role)) throw new Error(`authority completeness: ${label} has unknown role`);
    if (seen.has(item.role)) throw new Error(`authority completeness: ${label} has duplicate role:${item.role}`);
    seen.add(item.role);
  }
  for (const role of roles) if (!seen.has(role)) throw new Error(`authority completeness: ${label} missing role:${role}`);
  return Object.fromEntries(items.map(item => [item.role, item]));
}

function assertAuthorityCompleteness(authority, { requirePublished = true } = {}) {
  if (!authority || typeof authority !== "object" || Array.isArray(authority)) throw new Error("authority completeness: object required");
  if (authority.schema !== "memory-engine-runtime-authority-v1") throw new Error("authority completeness: schema mismatch");
  if (requirePublished && authority.published !== true) throw new Error("authority completeness: published=true required");
  if (!requirePublished && typeof authority.published !== "boolean") throw new Error("authority completeness: published flag required");
  requireSha(authority.expected_source_runtime_identity, "expected_source_runtime_identity");
  requireSha(authority.expected_active_runtime_identity, "expected_active_runtime_identity");
  requireSha(authority.expected_config_sha256, "expected_config_sha256");
  for (const field of ["expected_gateway_pid", "expected_gateway_restart_count", "expected_console_pid", "expected_console_restart_count"]) requireNonnegativeInteger(authority[field], field);
  exactKeys(authority.host_stability, ["schema", "path"], "host_stability");
  if (authority.host_stability.schema !== HOST_STABILITY_SCHEMA) throw new Error("host stability schema mismatch");
  requireRelative(authority.host_stability.path, "host_stability:path");
  assertToolIdentities(authority);

  if (!Array.isArray(authority.journal) || authority.journal.length !== JOURNAL.length || authority.journal.some((stage, index) => stage !== JOURNAL[index])) {
    throw new Error("authority completeness: journal mismatch");
  }

  const archives = requireRoleSet(authority.archives, ARCHIVE_ROLES, "archives");
  for (const archive of Object.values(archives)) {
    exactKeys(archive, ["role", "schema", "path", "sha256", "manifest_path", "runtime_identity_path"], `archive:${archive.role}`);
    if (archive.schema !== "memory-engine-runtime-authority-archive-v1") throw new Error(`archive schema mismatch:${archive.role}`);
    for (const field of ["path", "manifest_path", "runtime_identity_path"]) requireRelative(archive[field], `archive:${archive.role}:${field}`);
    requireSha(archive.sha256, `archive:${archive.role}:sha256`);
  }

  const manifests = requireRoleSet(authority.manifests, MANIFEST_ROLES, "manifests");
  exactKeys(manifests.candidate_frozen, ["role", "manifest_path", "sentinel_path", "exact_identity", "git_commit", "git_tree", "package_json_sha256", "package_lock_sha256"], "manifest:candidate_frozen");
  for (const role of ["active_before", "active_after"]) exactKeys(manifests[role], ["role", "manifest_path", "exact_identity"], `manifest:${role}`);
  for (const manifest of Object.values(manifests)) {
    requireRelative(manifest.manifest_path, `manifest:${manifest.role}:manifest_path`);
    requireSha(manifest.exact_identity, `manifest:${manifest.role}:exact_identity`);
  }
  requireRelative(manifests.candidate_frozen.sentinel_path, "manifest:candidate_frozen:sentinel_path");
  if (!GIT_SHA.test(manifests.candidate_frozen.git_commit)) throw new Error("manifest:candidate_frozen git commit invalid");
  if (typeof manifests.candidate_frozen.git_tree !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(manifests.candidate_frozen.git_tree)) throw new Error("manifest:candidate_frozen git tree invalid");
  requireSha(manifests.candidate_frozen.package_json_sha256, "manifest:candidate_frozen:package_json_sha256");
  requireSha(manifests.candidate_frozen.package_lock_sha256, "manifest:candidate_frozen:package_lock_sha256");
  if (manifests.active_before.exact_identity !== manifests.active_after.exact_identity) throw new Error("active manifest exact identity mismatch");

  const checkpoints = requireRoleSet(authority.runtime_identities, RUNTIME_CHECKPOINT_ROLES, "runtime checkpoints");
  for (const checkpoint of Object.values(checkpoints)) {
    exactKeys(checkpoint, ["role", "path", "identity", "expected_identity_class"], `runtime:${checkpoint.role}`);
    requireRelative(checkpoint.path, `runtime:${checkpoint.role}:path`);
    requireSha(checkpoint.identity, `runtime:${checkpoint.role}:identity`);
    if (!["source", "active"].includes(checkpoint.expected_identity_class)) throw new Error(`runtime:${checkpoint.role} identity class invalid`);
    const expected = checkpoint.expected_identity_class === "source" ? authority.expected_source_runtime_identity : authority.expected_active_runtime_identity;
    if (checkpoint.identity !== expected) throw new Error(`runtime:${checkpoint.role} identity mismatch`);
  }
  for (const role of ["candidate_after_ci", "candidate_after_freeze", "candidate_after_reextract"]) {
    if (checkpoints[role].expected_identity_class !== "source") throw new Error(`runtime:${role} identity class mismatch`);
  }
  for (const role of ["r0_capture", "r0_after_reextract"]) {
    if (checkpoints[role].expected_identity_class !== "active") throw new Error(`runtime:${role} identity class mismatch`);
  }

  if (archives.candidate_archive.manifest_path !== manifests.candidate_frozen.manifest_path) throw new Error("candidate archive manifest role mismatch");
  if (archives.candidate_archive.runtime_identity_path !== checkpoints.candidate_after_freeze.path) throw new Error("candidate archive runtime role mismatch");
  if (archives.r0_archive.manifest_path !== manifests.active_before.manifest_path) throw new Error("R0 archive manifest role mismatch");
  if (archives.r0_archive.runtime_identity_path !== checkpoints.r0_capture.path) throw new Error("R0 archive runtime role mismatch");
  return { archives, manifests, checkpoints };
}

module.exports = {
  JOURNAL, ARCHIVE_ROLES, MANIFEST_ROLES, RUNTIME_CHECKPOINT_ROLES, HOST_STABILITY_SCHEMA,
  TOOL_ROLES, EXECUTABLE_TOOL_ROLES, validRelative, assertAuthorityCompleteness, assertHostStabilityEvidence,
};

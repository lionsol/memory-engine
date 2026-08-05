const { execFileSync } = require("node:child_process");
const {
  copyFileSync, chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, realpathSync,
} = require("node:fs");
const { createHash } = require("node:crypto");
const { isAbsolute, join, posix, relative, resolve, sep } = require("node:path");
const { validateRuntimeArtifactManifestV2, buildRuntimeArtifactManifestV2 } = require("../../bin/runtime-artifact-manifest-v2-lib.cjs");
const { ARCHIVE_SCHEMA } = require("./constants.js");
const { canonicalize } = require("./canonical-json.js");
const { verifyChecksums, hashFile, claimPath } = require("./evidence.js");
const { validateSentinel } = require("./sentinel.js");
const { applyCanonicalModes, inspectCanonicalTar, prepareCanonicalExtraction, archiveSha256 } = require("./archive.js");
const { buildTypedEntryInventory, validateTypedEntryInventory } = require("./inventory.js");
const { SandboxRunner } = require("./sandbox.js");
const { makeRemovable } = require("./owned-root.js");
const { assertAuthorityCompleteness, assertHostStabilityEvidence, TOOL_ROLES } = require("./authority-schema.js");

const AUTHORITY_KEYS = Object.freeze([
  "schema", "published", "run_id", "plan_sha256", "authority_root_binding", "journal", "entry_inventory",
  "tool_identities", "source_commit", "source_tree_identity", "expected_source_runtime_identity", "expected_active_runtime_identity",
  "expected_config_sha256", "expected_gateway_pid", "expected_gateway_restart_count", "expected_console_pid", "expected_console_restart_count",
  "host_stability", "archives", "manifests", "runtime_identities",
]);

function validRelative(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0") && !value.includes("\\") && !isAbsolute(value)
    && !value.split("/").includes("..") && !value.split("/").includes("") && value !== "." && posix.normalize(value) === value;
}

function assertAuthorityRoot(root) {
  if (!isAbsolute(root) || root.includes("\0") || root.includes("\\") || resolve(root) !== root || (root.length > 1 && root.endsWith("/"))) throw new Error("authority root must be absolute and normalized");
  const stats = lstatSync(root);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("authority root must be regular non-symlink directory");
  let current = root;
  while (current !== "/") {
    const ancestor = lstatSync(current);
    if (ancestor.isSymbolicLink()) throw new Error(`authority ancestor symlink:${current}`);
    current = resolve(current, "..");
  }
  return realpathSync(root);
}

function listRegularAuthorityFiles(root, current = root, result = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    const rel = relative(root, absolute).replaceAll("\\", "/");
    if (!validRelative(rel)) throw new Error(`invalid authority path:${rel}`);
    if (entry.isDirectory()) listRegularAuthorityFiles(root, absolute, result);
    else if (entry.isFile()) result.push(rel);
    else if (entry.isSymbolicLink()) continue;
    else throw new Error(`unexpected authority special entry:${rel}`);
  }
  return result.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function assertManifest(manifest, label) {
  const validation = validateRuntimeArtifactManifestV2(manifest);
  if (!validation.artifact_valid) throw new Error(`${label} manifest invalid:${validation.errors.join(",")}`);
  return validation;
}

function assertAuthorityPaths(authority) {
  const paths = [];
  for (const entry of authority.entry_inventory?.entries || []) paths.push(entry.path);
  for (const archive of authority.archives || []) paths.push(archive.path, archive.runtime_identity_path);
  for (const item of authority.manifests || []) paths.push(item.manifest_path, item.sentinel_path);
  for (const item of authority.runtime_identities || []) paths.push(item.path);
  if (authority.host_stability?.path) paths.push(authority.host_stability.path);
  for (const path of paths.filter(Boolean)) if (!validRelative(path)) throw new Error(`invalid authority relative path:${path}`);
}

function authorityInventoryProjection(inventory) {
  return {
    schema: inventory.schema,
    root: inventory.root,
    entries: inventory.entries,
    hardlink_groups: inventory.hardlink_groups,
  };
}

function verifyTypedInventory(root, authority) {
  const actual = buildTypedEntryInventory(root, { rejectEmptyDirectories: true });
  const expected = authority.entry_inventory;
  validateTypedEntryInventory(expected);
  const excluded = new Set(["authority.json", "checksums.sha256"]);
  const actualProjection = authorityInventoryProjection({ ...actual, entries: actual.entries.filter(entry => !excluded.has(entry.path)), hardlink_groups: actual.hardlink_groups.filter(group => group.paths.every(path => !excluded.has(path))) });
  if (canonicalize(actualProjection) !== canonicalize(authorityInventoryProjection(expected))) throw new Error("typed entry inventory mismatch");
  return actual;
}

function toolVersion(path, name, authority) {
  const executable = name === "npm" ? authority.tool_identities?.node?.path : path;
  if (!executable) throw new Error("npm authority requires bound Node identity");
  const args = name === "npm" ? [path, "--version"] : ["--version"];
  return String(execFileSync(executable, args, { env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" }, shell: false, timeout: 10_000, maxBuffer: 64 * 1024, encoding: "utf8" })).trim().split(/\r?\n/, 1)[0];
}

function validateToolBinding(authority, name, { required = true } = {}) {
  const binding = authority.tool_identities?.[name];
  if (!binding) { if (required) throw new Error(`missing authority tool identity:${name}`); return null; }
  if (binding.kind !== name) throw new Error(`authority tool kind mismatch:${name}`);
  if (typeof binding.path !== "string" || !isAbsolute(binding.path) || binding.path.includes("\0") || binding.path.includes("\\")) throw new Error(`invalid authority tool path:${name}`);
  const stats = lstatSync(binding.path);
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o111) === 0) throw new Error(`authority tool is not a non-symlink executable:${name}`);
  if (realpathSync(binding.path) !== binding.path) throw new Error(`authority tool realpath mismatch:${name}`);
  if (hashFile(binding.path) !== binding.sha256) throw new Error(`authority tool SHA mismatch:${name}`);
  if (toolVersion(binding.path, name, authority) !== binding.version) throw new Error(`authority tool version mismatch:${name}`);
  if (name === "node") {
    const abi = Number.parseInt(String(execFileSync(binding.path, ["-p", "process.versions.modules"], { env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" }, shell: false, timeout: 10_000, maxBuffer: 64 * 1024, encoding: "utf8" })).trim(), 10);
    if (!Number.isSafeInteger(binding.abi) || abi !== binding.abi) throw new Error("authority node ABI mismatch");
  }
  return binding.path;
}

function validateNodeGypBinding(authority) {
  const binding = authority.tool_identities?.node_gyp;
  if (!binding || typeof binding.path !== "string" || !isAbsolute(binding.path) || binding.path.includes("\0") || binding.path.includes("\\")) throw new Error("missing authority node-gyp closure identity");
  const stats = lstatSync(binding.path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("authority node-gyp root is not a non-symlink directory");
  if (realpathSync(binding.path) !== binding.path) throw new Error("authority node-gyp root realpath mismatch");
  const manifest = buildRuntimeArtifactManifestV2({ rootDir: binding.path });
  if (!manifest.valid || manifest.exact_identity !== binding.tree_identity) throw new Error("authority node-gyp closure identity mismatch");
  for (const field of ["entry_count", "file_count", "external_symlink_count", "dangling_symlink_count"]) if (manifest[field] !== binding[field]) throw new Error(`authority node-gyp ${field} mismatch`);
  if (binding.external_symlink_count !== 0 || binding.dangling_symlink_count !== 0) throw new Error("authority node-gyp external or dangling references rejected");
  return binding.path;
}

function verificationSandbox(authority, scratch) {
  const node = validateToolBinding(authority, "node");
  const unshare = validateToolBinding(authority, "unshare");
  const mount = validateToolBinding(authority, "mount");
  const chroot = validateToolBinding(authority, "chroot");
  const python = validateToolBinding(authority, "python");
  const cc = validateToolBinding(authority, "cc");
  const cxx = validateToolBinding(authority, "cxx");
  const make = validateToolBinding(authority, "make");
  const ar = validateToolBinding(authority, "ar");
  validateToolBinding(authority, "tar");
  const nodeGypRoot = validateNodeGypBinding(authority);
  return new SandboxRunner({
    stagingRoot: scratch,
    plan: { node_executable: node, unshare_executable: unshare, mount_executable: mount, chroot_executable: chroot, python_executable: python, cc_executable: cc, cxx_executable: cxx, make_executable: make, ar_executable: ar, node_gyp_root: nodeGypRoot },
  });
}

function assertPublishedClaim(root, authority, { uid = typeof process.geteuid === "function" ? process.geteuid() : null } = {}) {
  const parent = resolve(root, "..");
  const directory = join(parent, ".run-claims");
  const directoryStats = lstatSync(directory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) throw new Error("published claim directory must be a non-symlink directory");
  if ((directoryStats.mode & 0o7777) !== 0o700) throw new Error("published claim directory mode must be 0700");
  if (uid !== null && directoryStats.uid !== uid) throw new Error("published claim directory owner mismatch");
  const path = claimPath(parent, authority.run_id);
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("published claim must be a regular non-symlink file");
  if ((stats.mode & 0o7777) !== 0o600) throw new Error("published claim mode must be 0600");
  if (uid !== null && stats.uid !== uid) throw new Error("published claim owner mismatch");
  const claim = JSON.parse(readFileSync(path, "utf8"));
  const keys = Object.keys(claim).sort();
  if (canonicalize(keys) !== canonicalize(["claimed_at", "outcome", "plan_sha256", "run_id"])) throw new Error("published claim key set mismatch");
  if (claim.run_id !== authority.run_id) throw new Error("published claim run_id mismatch");
  if (claim.plan_sha256 !== authority.plan_sha256) throw new Error("published claim plan_sha256 mismatch");
  if (claim.outcome !== "PUBLISHED") throw new Error("published claim outcome mismatch");
  return { path, claim };
}

function extractInVerificationNamespace({ authority, archivePath, destination, scratch, operation }) {
  inspectCanonicalTar(archivePath);
  const input = join(scratch, `${operation.replaceAll(".", "-")}.tar`);
  copyFileSync(archivePath, input);
  chmodSync(input, 0o400);
  prepareCanonicalExtraction({ archivePath, destination });
  const sandbox = verificationSandbox(authority, scratch);
  sandbox.run(operation, {
    executable: authority.tool_identities.tar.path,
    args: ["-xf", input, "-C", destination, "--no-same-owner", "--no-same-permissions", "--no-overwrite-dir", "--mode=ugo+rwX", "--keep-directory-symlink"],
    cwd: scratch,
    env: {},
  });
  applyCanonicalModes({ archivePath, destination });
}

function verifyAuthority({ authorityRoot, extractArchive = null, manifestBuilder = buildRuntimeArtifactManifestV2 } = {}) {
  if (extractArchive) throw new Error("external archive extraction override rejected");
  const root = assertAuthorityRoot(authorityRoot);
  const rootName = root.split(sep).pop();
  const authorityPath = join(root, "authority.json");
  const authority = JSON.parse(readFileSync(authorityPath, "utf8"));
  const actualKeys = Object.keys(authority).sort();
  if (canonicalize(actualKeys) !== canonicalize([...AUTHORITY_KEYS].sort())) throw new Error("authority key set mismatch");
  if (authority.schema !== "memory-engine-runtime-authority-v1") throw new Error("authority schema mismatch");
  if (authority.published !== true) throw new Error("authority is not published");
  if (!authority.authority_root_binding || authority.authority_root_binding.root_name !== rootName || authority.authority_root_binding.run_id !== authority.run_id) throw new Error("authority root binding mismatch");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(authority.run_id)) throw new Error("invalid authority run id");
  assertAuthorityCompleteness(authority);
  assertPublishedClaim(root, authority);
  assertAuthorityPaths(authority);
  if (authority.entry_inventory?.schema !== "memory-engine-runtime-authority-entry-inventory-v1") throw new Error("typed entry inventory required");
  const hostStability = JSON.parse(readFileSync(join(root, authority.host_stability.path), "utf8"));
  assertHostStabilityEvidence(hostStability, authority);
  const actualFiles = listRegularAuthorityFiles(root).filter(path => path !== "checksums.sha256");
  const checksums = require("./evidence.js").verifyChecksums(root, { exactFiles: actualFiles });
  if (checksums.files.length !== actualFiles.length) throw new Error("checksums do not cover authority regular files exactly");
  const actualInventory = verifyTypedInventory(root, authority);
  for (const archive of authority.archives || []) {
    const archivePath = join(root, archive.path);
    if (archive.schema !== ARCHIVE_SCHEMA || archive.sha256 !== archiveSha256(archivePath)) throw new Error(`archive mismatch:${archive.path}`);
  }
  for (const item of authority.runtime_identities || []) {
    if (!validRelative(item.path) || typeof item.identity !== "string" || !/^[0-9a-f]{64}$/.test(item.identity)) throw new Error("invalid runtime identity binding");
    const recorded = JSON.parse(readFileSync(join(root, item.path), "utf8"));
    if (recorded.valid !== true || recorded.identity !== item.identity) throw new Error(`runtime identity evidence mismatch:${item.path}`);
  }
  for (const name of TOOL_ROLES.filter(role => role !== "node_gyp")) validateToolBinding(authority, name);
  validateNodeGypBinding(authority);
  const scratch = require("node:fs").mkdtempSync(join(resolve(root, ".."), `.verify-${authority.run_id}-`), { encoding: "utf8" });
  try {
    for (const item of authority.manifests || []) {
      const manifest = JSON.parse(readFileSync(join(root, item.manifest_path), "utf8"));
      assertManifest(manifest, item.manifest_path);
      if (manifest.exact_identity !== item.exact_identity) throw new Error(`manifest mismatch:${item.manifest_path}`);
      if (item.sentinel_path) {
        const sentinel = JSON.parse(readFileSync(join(root, item.sentinel_path), "utf8"));
        const result = validateSentinel(sentinel, { manifest, gitCommit: item.git_commit, gitTree: item.git_tree, packageJsonSha256: item.package_json_sha256, packageLockSha256: item.package_lock_sha256 });
        if (!result.valid) throw new Error(`sentinel mismatch:${item.sentinel_path}:${result.errors.join(",")}`);
      }
    }
    for (const archive of authority.archives) {
      const destination = join(scratch, archive.role);
      extractInVerificationNamespace({ authority, archivePath: join(root, archive.path), destination, scratch, operation: archive.role === "candidate_archive" ? "tar.verify_extract_candidate" : "tar.verify_extract_r0" });
      const rebuilt = manifestBuilder({ rootDir: destination });
      assertManifest(rebuilt, archive.path);
      const expectedManifest = archive.manifest_path ? JSON.parse(readFileSync(join(root, archive.manifest_path), "utf8")) : null;
      if (!expectedManifest || rebuilt.exact_identity !== expectedManifest.exact_identity) throw new Error(`archive re-extraction mismatch:${archive.path}`);
      if (archive.runtime_identity_path) {
        const runtimeBinding = (authority.runtime_identities || []).find(item => item.path === archive.runtime_identity_path);
        if (!runtimeBinding) throw new Error(`missing runtime identity binding:${archive.path}`);
        const helper = join(__dirname, "runtime-host-helper.mjs");
        const nodePath = authority.tool_identities.node.path;
        const rebuiltRuntime = JSON.parse(execFileSync(nodePath, [helper, "--root", destination], { cwd: destination, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" }, shell: false, timeout: 30_000, maxBuffer: 256 * 1024, encoding: "utf8" }));
        if (rebuiltRuntime.valid !== true || rebuiltRuntime.identity !== runtimeBinding.identity) throw new Error(`runtime archive parity mismatch:${archive.path}`);
      }
      chmodSync(destination, 0o700);
    }
  } finally {
    try { makeRemovable(scratch); } catch { /* cleanup is best effort; the verification failure remains authoritative */ }
    rmSync(scratch, { recursive: true, force: true });
  }
  return { valid: true, authority, checksums, root };
}

function readdirRecursive(root, current = root, result = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const child = join(current, entry.name);
    const rel = relative(root, child).replaceAll("\\", "/");
    result.push(rel);
    if (entry.isDirectory()) readdirRecursive(root, child, result);
  }
  return result.sort();
}

module.exports = { assertAuthorityRoot, assertPublishedClaim, verifyAuthority, readdirRecursive, validRelative, validateToolBinding, AUTHORITY_KEYS };

const { createHash } = require("node:crypto");
const {
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} = require("node:fs");
const { isAbsolute, relative, resolve, sep } = require("node:path");

const ARTIFACT_MANIFEST_V2_SCHEMA_VERSION = 2;
const ARTIFACT_MANIFEST_V2_ALGORITHM = "sha256";
const ARTIFACT_MANIFEST_V2_PREFIX = "memory-engine-runtime-artifact-manifest-v2";
const ARTIFACT_MANIFEST_V2_TOPOLOGY_PREFIX = "memory-engine-runtime-artifact-topology-v2";
const ARTIFACT_MANIFEST_V2_EXACT_PREFIX = "memory-engine-runtime-artifact-exact-v2";
const ARTIFACT_MANIFEST_V2_GROUP_PREFIX = "memory-engine-runtime-artifact-hardlink-group-v2";

const ARTIFACT_MANIFEST_V2_POLICIES = Object.freeze({
  EXACT: "exact",
  ALLOW_INTERNAL_HARDLINK_SPLIT_V1: "allow_internal_hardlink_split_v1",
  ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1: "allow_install_root_mode_and_internal_hardlink_split_v1",
});
const ARTIFACT_MANIFEST_V2_DEFAULT_POLICY = ARTIFACT_MANIFEST_V2_POLICIES.EXACT;

const ARTIFACT_MANIFEST_V2_CLASSIFICATIONS = Object.freeze({
  EXACT: "EXACT",
  SPLIT_ONLY: "SPLIT_ONLY",
  MERGE_DETECTED: "MERGE_DETECTED",
  CROSS_GROUP_RELINK: "CROSS_GROUP_RELINK",
  MIXED_OR_UNKNOWN: "MIXED_OR_UNKNOWN",
  EXTERNAL_REFERENCE: "EXTERNAL_REFERENCE",
  INVALID_MANIFEST: "INVALID_MANIFEST",
  SEMANTIC_MISMATCH: "SEMANTIC_MISMATCH",
  INSTALL_NORMALIZATION: "INSTALL_NORMALIZATION",
});

const VALID_ENTRY_TYPES = new Set(["directory", "file", "symlink", "special", "unknown"]);
const VALID_SYMLINK_STATES = new Set([
  "within_root",
  "external",
  "dangling",
  "unresolvable",
  "readlink_error",
  "root_symlink",
]);
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const OCTAL_MODE = /^[0-7]{4}$/;
const MAX_COMPARISON_EVIDENCE_GROUPS = 16;
const MAX_COMPARISON_EVIDENCE_PATHS_PER_GROUP = 32;
const MAX_COMPARISON_EVIDENCE_CHANGED_PATHS = 32;

function sha256Hex(bytes) {
  return createHash(ARTIFACT_MANIFEST_V2_ALGORITHM).update(bytes).digest("hex");
}

function framedHash(prefix, values) {
  const hash = createHash(ARTIFACT_MANIFEST_V2_ALGORITHM);
  for (const value of [prefix, ...values]) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    hash.update(`${bytes.byteLength}\n`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function octalMode(stats) {
  return (stats.mode & 0o7777).toString(8).padStart(4, "0");
}

function normalizePath(value) {
  return value.replaceAll(sep, "/") || ".";
}

function isWithinRoot(rootRealPath, candidateRealPath) {
  return candidateRealPath === rootRealPath || candidateRealPath.startsWith(`${rootRealPath}${sep}`);
}

function errorCode(error) {
  return error && (error.code || error.message) ? (error.code || error.message) : "unknown";
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => String(left?.path ?? "").localeCompare(String(right?.path ?? "")));
}

function sortGroups(groups) {
  return [...groups].sort((left, right) => left.paths.join("\n").localeCompare(right.paths.join("\n")));
}

function buildGroupId(paths) {
  return framedHash(ARTIFACT_MANIFEST_V2_GROUP_PREFIX, paths);
}

function inspectSymlink(absolutePath, rootRealPath, rel, { rootSymlink = false } = {}) {
  const errors = [];
  let target = null;
  try {
    target = readlinkSync(absolutePath);
  } catch (error) {
    errors.push(`readlink_error:${rel}:${errorCode(error)}`);
    return {
      target,
      resolved_within_root: null,
      symlink_resolution_state: rootSymlink ? "root_symlink" : "readlink_error",
      errors,
    };
  }

  if (rootSymlink) {
    return {
      target,
      resolved_within_root: false,
      symlink_resolution_state: "root_symlink",
      errors: [`root_symlink:${rel}`],
    };
  }

  if (!rootRealPath) {
    return {
      target,
      resolved_within_root: null,
      symlink_resolution_state: "unresolvable",
      errors: [`symlink_resolution_error:${rel}:root_realpath_unavailable`],
    };
  }

  try {
    const targetRealPath = realpathSync(absolutePath);
    const resolvedWithinRoot = isWithinRoot(rootRealPath, targetRealPath);
    return {
      target,
      resolved_within_root: resolvedWithinRoot,
      symlink_resolution_state: resolvedWithinRoot ? "within_root" : "external",
      errors: resolvedWithinRoot ? [] : [`external_symlink:${rel}`],
    };
  } catch (error) {
    const code = errorCode(error);
    const dangling = code === "ENOENT" || code === "ENOTDIR";
    return {
      target,
      resolved_within_root: false,
      symlink_resolution_state: dangling ? "dangling" : "unresolvable",
      errors: [`${dangling ? "dangling_symlink" : "symlink_resolution_error"}:${rel}:${code}`],
    };
  }
}

function collectDirectoryEntries({ rootPath, rootRealPath }) {
  const entries = [];
  const errors = [];
  const topologyErrors = [];
  const inodeGroups = new Map();

  function visit(absolutePath) {
    const rel = absolutePath === rootPath ? "." : normalizePath(relative(rootPath, absolutePath));
    if (!isValidRelativePath(rel)) {
      const message = pathValidityError(rel);
      errors.push(message);
      topologyErrors.push(message);
    }
    let stats;
    try {
      stats = lstatSync(absolutePath);
    } catch (error) {
      const message = `stat_error:${rel}:${errorCode(error)}`;
      errors.push(message);
      topologyErrors.push(message);
      return;
    }

    if (stats.isSymbolicLink()) {
      const symlink = inspectSymlink(absolutePath, rootRealPath, rel);
      errors.push(...symlink.errors);
      entries.push({
        path: rel,
        type: "symlink",
        mode: octalMode(stats),
        target: symlink.target,
        resolved_within_root: symlink.resolved_within_root,
        symlink_resolution_state: symlink.symlink_resolution_state,
      });
      return;
    }

    if (stats.isDirectory()) {
      entries.push({ path: rel, type: "directory", mode: octalMode(stats) });
      let names;
      try {
        names = readdirSync(absolutePath).sort((left, right) => left.localeCompare(right));
      } catch (error) {
        const message = `read_error:${rel}:${errorCode(error)}`;
        errors.push(message);
        topologyErrors.push(message);
        return;
      }
      for (const name of names) visit(resolve(absolutePath, name));
      return;
    }

    if (stats.isFile()) {
      let bytes;
      try {
        bytes = readFileSync(absolutePath);
      } catch (error) {
        const message = `read_error:${rel}:${errorCode(error)}`;
        errors.push(message);
        topologyErrors.push(message);
        return;
      }
      const inodeKey = `${stats.dev}:${stats.ino}`;
      const group = inodeGroups.get(inodeKey) || { nlink: stats.nlink, paths: [] };
      group.paths.push(rel);
      inodeGroups.set(inodeKey, group);
      entries.push({
        path: rel,
        type: "file",
        mode: octalMode(stats),
        size: stats.size,
        sha256: sha256Hex(bytes),
      });
      return;
    }

    const type = stats.isFIFO() || stats.isSocket() || stats.isBlockDevice() || stats.isCharacterDevice()
      ? "special"
      : "unknown";
    const message = `${type === "special" ? "special_entry" : "unknown_entry_type"}:${rel}`;
    entries.push({ path: rel, type, mode: octalMode(stats) });
    errors.push(message);
    topologyErrors.push(message);
  }

  visit(rootPath);

  const hardlinkGroups = [];
  let externalHardlinkReferenceCount = 0;
  for (const group of inodeGroups.values()) {
    const paths = uniqueSorted(group.paths);
    const externalReferenceCount = Math.max(0, Number(group.nlink) - paths.length);
    externalHardlinkReferenceCount += externalReferenceCount;
    hardlinkGroups.push({
      id: buildGroupId(paths),
      paths,
      external_reference_count: externalReferenceCount,
    });
    if (externalReferenceCount > 0) {
      errors.push(`external_hardlink_reference:${paths.join(",")}:${externalReferenceCount}`);
    }
  }

  return {
    entries: sortEntries(entries),
    errors,
    topologyErrors,
    topologyComplete: topologyErrors.length === 0,
    hardlinkGroups: sortGroups(hardlinkGroups),
    externalHardlinkReferenceCount,
  };
}

function buildSemanticIdentity({ rootEntryType, rootMode, entries }) {
  const values = [rootEntryType || "", rootMode || ""];
  for (const entry of sortEntries(entries)) {
    values.push(entry.path, entry.type, entry.mode);
    if (entry.type === "file") {
      values.push(String(entry.size), entry.sha256);
    } else if (entry.type === "symlink") {
      values.push(entry.target === null ? "<null>" : entry.target);
      values.push(entry.resolved_within_root === null ? "<null>" : String(entry.resolved_within_root));
      values.push(entry.symlink_resolution_state || "");
    }
  }
  return framedHash(ARTIFACT_MANIFEST_V2_PREFIX, values);
}

function buildTopologyIdentity({ hardlinkGroups, topologyComplete, externalHardlinkReferenceCount }) {
  const values = [topologyComplete ? "complete" : "incomplete", String(externalHardlinkReferenceCount)];
  for (const group of sortGroups(hardlinkGroups)) {
    values.push(String(group.paths.length));
    values.push(...group.paths);
    values.push(String(group.external_reference_count));
  }
  return framedHash(ARTIFACT_MANIFEST_V2_TOPOLOGY_PREFIX, values);
}

function buildExactIdentity({ semanticIdentity, topologyIdentity }) {
  return framedHash(ARTIFACT_MANIFEST_V2_EXACT_PREFIX, [semanticIdentity, topologyIdentity]);
}

function emptyManifest({ rootPath, checkedAt, rootEntryType = null, rootMode = null, entries = [], errors = [] }) {
  return {
    schema_version: ARTIFACT_MANIFEST_V2_SCHEMA_VERSION,
    checked_at: checkedAt,
    algorithm: ARTIFACT_MANIFEST_V2_ALGORITHM,
    serialization: ARTIFACT_MANIFEST_V2_PREFIX,
    root_path: rootPath,
    root_entry_type: rootEntryType,
    root_mode: rootMode,
    valid: false,
    semantic_identity: null,
    topology_identity: null,
    exact_identity: null,
    topology_complete: false,
    entry_count: entries.length,
    file_count: entries.filter(entry => entry.type === "file").length,
    directory_count: entries.filter(entry => entry.type === "directory").length,
    symlink_count: entries.filter(entry => entry.type === "symlink").length,
    special_entry_count: entries.filter(entry => entry.type === "special").length,
    unknown_entry_count: entries.filter(entry => entry.type === "unknown").length,
    total_file_bytes: entries.filter(entry => entry.type === "file").reduce((sum, entry) => sum + entry.size, 0),
    writable_file_count: entries.filter(entry => entry.type === "file" && (Number.parseInt(entry.mode, 8) & 0o222) !== 0).length,
    writable_directory_count: entries.filter(entry => entry.type === "directory" && (Number.parseInt(entry.mode, 8) & 0o222) !== 0).length,
    external_symlink_count: entries.filter(entry => entry.type === "symlink" && entry.symlink_resolution_state === "external").length,
    dangling_symlink_count: entries.filter(entry => entry.type === "symlink" && entry.symlink_resolution_state === "dangling").length,
    external_hardlink_reference_count: 0,
    topology_group_count: 0,
    hardlink_group_count: 0,
    hardlink_groups: [],
    errors: uniqueSorted(errors),
    entries: sortEntries(entries),
  };
}

function buildRuntimeArtifactManifestV2({ rootDir, checkedAt = new Date().toISOString() } = {}) {
  if (typeof rootDir !== "string" || !rootDir.trim()) throw new TypeError("rootDir is required");
  const rootPath = resolve(rootDir);
  let rootStats;
  try {
    rootStats = lstatSync(rootPath);
  } catch (error) {
    return emptyManifest({
      rootPath,
      checkedAt,
      errors: [`root_stat_error:${errorCode(error)}`],
    });
  }

  const rootMode = octalMode(rootStats);
  if (rootStats.isSymbolicLink()) {
    const symlink = inspectSymlink(rootPath, null, ".", { rootSymlink: true });
    return emptyManifest({
      rootPath,
      checkedAt,
      rootEntryType: "symlink",
      rootMode,
      entries: [{
        path: ".",
        type: "symlink",
        mode: rootMode,
        target: symlink.target,
        resolved_within_root: symlink.resolved_within_root,
        symlink_resolution_state: symlink.symlink_resolution_state,
      }],
      errors: symlink.errors,
    });
  }

  if (!rootStats.isDirectory()) {
    const rootType = rootStats.isFile()
      ? "file"
      : (rootStats.isFIFO() || rootStats.isSocket() || rootStats.isBlockDevice() || rootStats.isCharacterDevice()
        ? "special"
        : "unknown");
    const entries = rootType === "file"
      ? [{ path: ".", type: "file", mode: rootMode, size: rootStats.size, sha256: null }]
      : [{ path: ".", type: rootType, mode: rootMode }];
    return emptyManifest({
      rootPath,
      checkedAt,
      rootEntryType: rootType,
      rootMode,
      entries,
      errors: [`artifact_root_not_directory:${rootType}`],
    });
  }

  let rootRealPath;
  try {
    rootRealPath = realpathSync(rootPath);
  } catch (error) {
    return emptyManifest({
      rootPath,
      checkedAt,
      rootEntryType: "directory",
      rootMode,
      entries: [{ path: ".", type: "directory", mode: rootMode }],
      errors: [`root_realpath_error:${errorCode(error)}`],
    });
  }

  const collected = collectDirectoryEntries({ rootPath, rootRealPath });
  const entries = collected.entries;
  const fileEntries = entries.filter(entry => entry.type === "file");
  const directoryEntries = entries.filter(entry => entry.type === "directory");
  const symlinkEntries = entries.filter(entry => entry.type === "symlink");
  const specialEntries = entries.filter(entry => entry.type === "special");
  const unknownEntries = entries.filter(entry => entry.type === "unknown");
  const externalSymlinkCount = symlinkEntries.filter(entry => entry.symlink_resolution_state === "external").length;
  const danglingSymlinkCount = symlinkEntries.filter(entry => entry.symlink_resolution_state === "dangling").length;
  const valid = collected.errors.length === 0
    && collected.topologyComplete
    && entries.every(entry => isValidRelativePath(entry.path))
    && entries[0]?.path === "."
    && entries[0]?.type === "directory"
    && specialEntries.length === 0
    && unknownEntries.length === 0
    && externalSymlinkCount === 0
    && danglingSymlinkCount === 0
    && symlinkEntries.every(entry => entry.symlink_resolution_state === "within_root")
    && collected.externalHardlinkReferenceCount === 0;
  const topologyIdentity = valid
    ? buildTopologyIdentity({
      hardlinkGroups: collected.hardlinkGroups,
      topologyComplete: collected.topologyComplete,
      externalHardlinkReferenceCount: collected.externalHardlinkReferenceCount,
    })
    : null;
  const semanticIdentity = valid ? buildSemanticIdentity({ rootEntryType: "directory", rootMode, entries }) : null;
  const exactIdentity = valid ? buildExactIdentity({ semanticIdentity, topologyIdentity }) : null;
  const hardlinkGroupCount = collected.hardlinkGroups.filter(group => group.paths.length > 1 || group.external_reference_count > 0).length;

  return {
    schema_version: ARTIFACT_MANIFEST_V2_SCHEMA_VERSION,
    checked_at: checkedAt,
    algorithm: ARTIFACT_MANIFEST_V2_ALGORITHM,
    serialization: ARTIFACT_MANIFEST_V2_PREFIX,
    root_path: rootPath,
    root_entry_type: "directory",
    root_mode: rootMode,
    valid,
    semantic_identity: semanticIdentity,
    topology_identity: topologyIdentity,
    exact_identity: exactIdentity,
    topology_complete: collected.topologyComplete,
    entry_count: entries.length,
    file_count: fileEntries.length,
    directory_count: directoryEntries.length,
    symlink_count: symlinkEntries.length,
    special_entry_count: specialEntries.length,
    unknown_entry_count: unknownEntries.length,
    total_file_bytes: fileEntries.reduce((sum, entry) => sum + entry.size, 0),
    writable_file_count: fileEntries.filter(entry => (Number.parseInt(entry.mode, 8) & 0o222) !== 0).length,
    writable_directory_count: directoryEntries.filter(entry => (Number.parseInt(entry.mode, 8) & 0o222) !== 0).length,
    external_symlink_count: externalSymlinkCount,
    dangling_symlink_count: danglingSymlinkCount,
    external_hardlink_reference_count: collected.externalHardlinkReferenceCount,
    topology_group_count: collected.hardlinkGroups.length,
    hardlink_group_count: hardlinkGroupCount,
    hardlink_groups: collected.hardlinkGroups,
    errors: uniqueSorted(collected.errors),
    entries,
  };
}

function isValidMode(value) {
  return typeof value === "string" && OCTAL_MODE.test(value);
}

function isValidRelativePath(value) {
  if (typeof value !== "string" || value === "" || value.includes("\\") || value.includes("\0")) return false;
  if (value === ".") return true;
  if (value.startsWith("/") || value.endsWith("/") || value.includes("//")) return false;
  return value.split("/").every(part => part && part !== "." && part !== "..");
}

function pathValidityError(value) {
  return `entries:path_invalid:${value}`;
}

function exactKeys(value, expected, label, errors) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((entry, index) => entry !== required[index])) {
    errors.push(`${label}:invalid_fields`);
  }
}

function validateRuntimeArtifactManifestV2(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { schema_valid: false, artifact_valid: false, errors: ["manifest:not_an_object"] };
  }

  const requiredKeys = [
    "schema_version", "checked_at", "algorithm", "serialization", "root_path", "root_entry_type", "root_mode",
    "valid", "semantic_identity", "topology_identity", "exact_identity", "topology_complete", "entry_count",
    "file_count", "directory_count", "symlink_count", "special_entry_count", "unknown_entry_count", "total_file_bytes",
    "writable_file_count", "writable_directory_count", "external_symlink_count", "dangling_symlink_count",
    "external_hardlink_reference_count", "topology_group_count", "hardlink_group_count", "hardlink_groups", "errors", "entries",
  ];
  exactKeys(manifest, requiredKeys, "manifest", errors);
  if (manifest.schema_version !== ARTIFACT_MANIFEST_V2_SCHEMA_VERSION) errors.push("schema_version:invalid");
  if (typeof manifest.checked_at !== "string" || !manifest.checked_at) errors.push("checked_at:invalid");
  if (manifest.algorithm !== ARTIFACT_MANIFEST_V2_ALGORITHM) errors.push("algorithm:invalid");
  if (manifest.serialization !== ARTIFACT_MANIFEST_V2_PREFIX) errors.push("serialization:invalid");
  if (typeof manifest.root_path !== "string" || !isAbsolute(manifest.root_path)) errors.push("root_path:invalid");
  if (manifest.root_entry_type !== null && !VALID_ENTRY_TYPES.has(manifest.root_entry_type)) errors.push("root_entry_type:invalid");
  if (manifest.root_mode !== null && !isValidMode(manifest.root_mode)) errors.push("root_mode:invalid");
  if (typeof manifest.valid !== "boolean") errors.push("valid:invalid");
  if (typeof manifest.topology_complete !== "boolean") errors.push("topology_complete:invalid");
  if (!Array.isArray(manifest.errors) || manifest.errors.some(value => typeof value !== "string")) errors.push("errors:invalid");
  if (!Array.isArray(manifest.hardlink_groups)) errors.push("hardlink_groups:invalid");
  if (!Array.isArray(manifest.entries)) errors.push("entries:invalid");

  const countFields = [
    "entry_count", "file_count", "directory_count", "symlink_count", "special_entry_count", "unknown_entry_count",
    "writable_file_count", "writable_directory_count", "external_symlink_count", "dangling_symlink_count",
    "external_hardlink_reference_count", "topology_group_count", "hardlink_group_count",
  ];
  for (const field of countFields) {
    if (!Number.isSafeInteger(manifest[field]) || manifest[field] < 0) errors.push(`${field}:invalid`);
  }
  if (!Number.isSafeInteger(manifest.total_file_bytes) || manifest.total_file_bytes < 0) errors.push("total_file_bytes:invalid");

  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const filePaths = new Set();
  const fileEntriesByPath = new Map();
  let computedTotalBytes = 0;
  let computedWritableFiles = 0;
  let computedWritableDirectories = 0;
  let computedSymlinks = 0;
  let computedExternalSymlinks = 0;
  let computedDanglingSymlinks = 0;
  let computedSpecial = 0;
  let computedUnknown = 0;
  const previousPaths = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push("entries:entry_not_object");
      continue;
    }
    if (!isValidRelativePath(entry.path)) errors.push(pathValidityError(entry.path));
    if (previousPaths.has(entry.path)) errors.push(`entries:duplicate_path:${entry.path}`);
    previousPaths.add(entry.path);
    if (!VALID_ENTRY_TYPES.has(entry.type)) {
      errors.push(`entries:type_invalid:${entry.path}`);
      continue;
    }
    if (!isValidMode(entry.mode)) errors.push(`entries:mode_invalid:${entry.path}`);
    if (entry.type === "directory") {
      exactKeys(entry, ["path", "type", "mode"], `entry:${entry.path}`, errors);
      if ((Number.parseInt(entry.mode, 8) & 0o222) !== 0) computedWritableDirectories += 1;
    } else if (entry.type === "file") {
      exactKeys(entry, ["path", "type", "mode", "size", "sha256"], `entry:${entry.path}`, errors);
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) errors.push(`entry:${entry.path}:size_invalid`);
      if (typeof entry.sha256 !== "string" || !HEX_SHA256.test(entry.sha256)) errors.push(`entry:${entry.path}:sha256_invalid`);
      filePaths.add(entry.path);
      fileEntriesByPath.set(entry.path, entry);
      if (Number.isSafeInteger(entry.size) && entry.size >= 0) computedTotalBytes += entry.size;
      if (isValidMode(entry.mode) && (Number.parseInt(entry.mode, 8) & 0o222) !== 0) computedWritableFiles += 1;
    } else if (entry.type === "symlink") {
      exactKeys(entry, ["path", "type", "mode", "target", "resolved_within_root", "symlink_resolution_state"], `entry:${entry.path}`, errors);
      if (entry.target !== null && typeof entry.target !== "string") errors.push(`entry:${entry.path}:target_invalid`);
      if (entry.resolved_within_root !== null && typeof entry.resolved_within_root !== "boolean") errors.push(`entry:${entry.path}:resolution_invalid`);
      if (!VALID_SYMLINK_STATES.has(entry.symlink_resolution_state)) errors.push(`entry:${entry.path}:resolution_state_invalid`);
      computedSymlinks += 1;
      if (entry.symlink_resolution_state === "external") computedExternalSymlinks += 1;
      if (entry.symlink_resolution_state === "dangling") computedDanglingSymlinks += 1;
    } else if (entry.type === "special") {
      exactKeys(entry, ["path", "type", "mode"], `entry:${entry.path}`, errors);
      computedSpecial += 1;
    } else {
      exactKeys(entry, ["path", "type", "mode"], `entry:${entry.path}`, errors);
      computedUnknown += 1;
    }
  }
  const sortedEntries = sortEntries(entries);
  if (entries.some((entry, index) => entry?.path !== sortedEntries[index]?.path)) errors.push("entries:unsorted");
  const rootEntry = entries.find(entry => entry && entry.path === ".");
  if (!rootEntry) errors.push("entries:root_missing");
  if (rootEntry && (rootEntry.type !== manifest.root_entry_type || rootEntry.mode !== manifest.root_mode)) errors.push("root_entry:inconsistent");

  const groups = Array.isArray(manifest.hardlink_groups) ? manifest.hardlink_groups : [];
  const groupedPaths = new Set();
  let computedExternalReferences = 0;
  for (const group of groups) {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      errors.push("hardlink_groups:group_not_object");
      continue;
    }
    exactKeys(group, ["id", "paths", "external_reference_count"], "hardlink_group", errors);
    if (!Array.isArray(group.paths) || group.paths.length === 0) {
      errors.push("hardlink_group:paths_invalid");
      continue;
    }
    const sortedPaths = uniqueSorted(group.paths);
    if (sortedPaths.length !== group.paths.length || sortedPaths.some((path, index) => path !== group.paths[index])) errors.push("hardlink_group:paths_unsorted");
    if (typeof group.id !== "string" || group.id !== buildGroupId(group.paths)) errors.push("hardlink_group:id_invalid");
    if (!Number.isSafeInteger(group.external_reference_count) || group.external_reference_count < 0) errors.push("hardlink_group:external_reference_count_invalid");
    for (const path of group.paths) {
      if (!filePaths.has(path)) errors.push(`hardlink_group:path_not_file:${path}`);
      if (groupedPaths.has(path)) errors.push(`hardlink_group:path_duplicate:${path}`);
      groupedPaths.add(path);
    }
    const referencePath = sortedPaths[0];
    const referenceEntry = fileEntriesByPath.get(referencePath);
    if (referenceEntry) {
      for (const path of sortedPaths.slice(1)) {
        const memberEntry = fileEntriesByPath.get(path);
        if (!memberEntry) continue;
        if (memberEntry.mode !== referenceEntry.mode) errors.push(`hardlink_group:member_mode_mismatch:${group.id}:${path}`);
        if (memberEntry.size !== referenceEntry.size) errors.push(`hardlink_group:member_size_mismatch:${group.id}:${path}`);
        if (memberEntry.sha256 !== referenceEntry.sha256) errors.push(`hardlink_group:member_sha256_mismatch:${group.id}:${path}`);
      }
    }
    if (Number.isSafeInteger(group.external_reference_count) && group.external_reference_count >= 0) computedExternalReferences += group.external_reference_count;
  }
  if (manifest.topology_complete && groupedPaths.size !== filePaths.size) errors.push("hardlink_groups:incomplete_membership");
  if (manifest.topology_complete && [...filePaths].some(path => !groupedPaths.has(path))) errors.push("hardlink_groups:unclassified_file");

  const computedCounts = {
    entry_count: entries.length,
    file_count: filePaths.size,
    directory_count: entries.filter(entry => entry?.type === "directory").length,
    symlink_count: computedSymlinks,
    special_entry_count: computedSpecial,
    unknown_entry_count: computedUnknown,
    total_file_bytes: computedTotalBytes,
    writable_file_count: computedWritableFiles,
    writable_directory_count: computedWritableDirectories,
    external_symlink_count: computedExternalSymlinks,
    dangling_symlink_count: computedDanglingSymlinks,
    external_hardlink_reference_count: computedExternalReferences,
    topology_group_count: groups.length,
    hardlink_group_count: groups.filter(group => Array.isArray(group?.paths) && (group.paths.length > 1 || group.external_reference_count > 0)).length,
  };
  for (const [field, expected] of Object.entries(computedCounts)) {
    if (manifest[field] !== expected) errors.push(`${field}:inconsistent`);
  }

  const schemaValidBeforeIdentity = errors.length === 0;
  if (manifest.valid === true) {
    if (manifest.root_entry_type !== "directory" || manifest.root_mode === null) errors.push("valid_manifest:root_invalid");
    if (!manifest.topology_complete || !Array.isArray(manifest.errors) || manifest.errors.length !== 0) errors.push("valid_manifest:errors_present");
    if (manifest.special_entry_count !== 0 || manifest.unknown_entry_count !== 0) errors.push("valid_manifest:unsupported_entry");
    if (manifest.external_symlink_count !== 0 || manifest.dangling_symlink_count !== 0 || manifest.external_hardlink_reference_count !== 0) errors.push("valid_manifest:external_reference");
    if (entries.some(entry => entry.type === "symlink" && entry.symlink_resolution_state !== "within_root")) errors.push("valid_manifest:symlink_state");
    if (schemaValidBeforeIdentity) {
      const semanticIdentity = buildSemanticIdentity({ rootEntryType: manifest.root_entry_type, rootMode: manifest.root_mode, entries });
      const topologyIdentity = buildTopologyIdentity({ hardlinkGroups: groups, topologyComplete: manifest.topology_complete, externalHardlinkReferenceCount: manifest.external_hardlink_reference_count });
      const exactIdentity = buildExactIdentity({ semanticIdentity, topologyIdentity });
      if (manifest.semantic_identity !== semanticIdentity) errors.push("semantic_identity:inconsistent");
      if (manifest.topology_identity !== topologyIdentity) errors.push("topology_identity:inconsistent");
      if (manifest.exact_identity !== exactIdentity) errors.push("exact_identity:inconsistent");
    }
  } else if (manifest.semantic_identity !== null || manifest.topology_identity !== null || manifest.exact_identity !== null) {
    errors.push("invalid_manifest:identities_must_be_null");
  }

  return {
    schema_valid: errors.length === 0,
    artifact_valid: errors.length === 0 && manifest.valid === true,
    errors: uniqueSorted(errors),
  };
}

function normalizePolicy(policy) {
  const selected = policy === undefined ? ARTIFACT_MANIFEST_V2_DEFAULT_POLICY : policy;
  if (!Object.values(ARTIFACT_MANIFEST_V2_POLICIES).includes(selected)) {
    throw new RangeError(`unsupported artifact identity policy: ${selected}`);
  }
  return selected;
}

function groupKey(paths) {
  return paths.join("\u0000");
}

function topologyMaps(manifest) {
  const groups = sortGroups(manifest.hardlink_groups).map(group => ({ ...group, key: groupKey(group.paths) }));
  const pathToGroup = new Map();
  for (const group of groups) for (const path of group.paths) pathToGroup.set(path, group);
  return { groups, pathToGroup };
}

function sharedPairCount(groups) {
  return groups.reduce((sum, group) => sum + (group.paths.length * (group.paths.length - 1)) / 2, 0);
}

function sameGroup(pathToGroup, left, right) {
  return pathToGroup.get(left)?.key === pathToGroup.get(right)?.key;
}

function installedSharingIsSubset(candidatePathToGroup, installedGroups) {
  for (const group of installedGroups) {
    for (let left = 0; left < group.paths.length; left += 1) {
      for (let right = left + 1; right < group.paths.length; right += 1) {
        if (!sameGroup(candidatePathToGroup, group.paths[left], group.paths[right])) return false;
      }
    }
  }
  return true;
}

function countRemovedSharing(candidateGroups, installedPathToGroup) {
  let count = 0;
  for (const group of candidateGroups) {
    for (let left = 0; left < group.paths.length; left += 1) {
      for (let right = left + 1; right < group.paths.length; right += 1) {
        if (!sameGroup(installedPathToGroup, group.paths[left], group.paths[right])) count += 1;
      }
    }
  }
  return count;
}

function countNewSharing(installedGroups, candidatePathToGroup) {
  let count = 0;
  for (const group of installedGroups) {
    for (let left = 0; left < group.paths.length; left += 1) {
      for (let right = left + 1; right < group.paths.length; right += 1) {
        if (!sameGroup(candidatePathToGroup, group.paths[left], group.paths[right])) count += 1;
      }
    }
  }
  return count;
}

function splitGroups(candidateGroups, installedPathToGroup) {
  return candidateGroups
    .filter(group => group.paths.length > 1)
    .map(candidateGroup => {
      const installedGroups = new Map();
      for (const path of candidateGroup.paths) {
        const installedGroup = installedPathToGroup.get(path);
        if (installedGroup) installedGroups.set(installedGroup.key, installedGroup.paths);
      }
      return {
        candidate_paths: candidateGroup.paths,
        installed_subgroups: [...installedGroups.values()].sort((left, right) => left.join("\n").localeCompare(right.join("\n"))),
      };
    })
    .filter(group => group.installed_subgroups.length > 1);
}

function classifyTopologyTransition(candidateManifest, installedManifest) {
  const candidate = topologyMaps(candidateManifest);
  const installed = topologyMaps(installedManifest);
  const candidatePairCount = sharedPairCount(candidate.groups);
  const installedPairCount = sharedPairCount(installed.groups);
  const installedIsSubset = installedSharingIsSubset(candidate.pathToGroup, installed.groups);
  if (installedIsSubset) {
    return {
      classification: installedPairCount === candidatePairCount
        ? ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.EXACT
        : ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.SPLIT_ONLY,
      split_groups: splitGroups(candidate.groups, installed.pathToGroup),
    };
  }

  const crossGroupRelink = installed.groups.some(installedGroup => {
    const candidateGroups = new Map();
    for (const path of installedGroup.paths) {
      const candidateGroup = candidate.pathToGroup.get(path);
      if (candidateGroup && candidateGroup.paths.length > 1) candidateGroups.set(candidateGroup.key, candidateGroup);
    }
    return candidateGroups.size >= 2;
  });
  if (crossGroupRelink) {
    return { classification: ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.CROSS_GROUP_RELINK, split_groups: [] };
  }

  const splitObserved = countRemovedSharing(candidate.groups, installed.pathToGroup) > 0;
  return {
    classification: splitObserved
      ? ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.MIXED_OR_UNKNOWN
      : ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.MERGE_DETECTED,
    split_groups: [],
  };
}

function policyAccepts(policy, classification) {
  if (classification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.EXACT) return true;
  if (policy === ARTIFACT_MANIFEST_V2_POLICIES.ALLOW_INTERNAL_HARDLINK_SPLIT_V1
    && classification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.SPLIT_ONLY) return true;
  if (policy === ARTIFACT_MANIFEST_V2_POLICIES.ALLOW_INSTALL_ROOT_MODE_AND_INTERNAL_HARDLINK_SPLIT_V1
    && [
      ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.SPLIT_ONLY,
      ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.INSTALL_NORMALIZATION,
    ].includes(classification)) return true;
  return false;
}

function invalidClassification(candidate, installed, candidateValidation, installedValidation) {
  if (!candidateValidation.schema_valid || !installedValidation.schema_valid) return ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.INVALID_MANIFEST;
  if (candidate.external_hardlink_reference_count > 0 || installed.external_hardlink_reference_count > 0) {
    return ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.EXTERNAL_REFERENCE;
  }
  return ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.INVALID_MANIFEST;
}

function trustedIdentity(manifest, validation, field) {
  return validation.artifact_valid ? (manifest?.[field] ?? null) : null;
}

function trustedCount(manifest, validation, field) {
  return validation.schema_valid ? (manifest?.[field] ?? null) : null;
}

function identityEqual(left, right) {
  return left === null || right === null ? null : left === right;
}

function semanticEntryValues(entry) {
  return {
    type: entry?.type ?? null,
    mode: entry?.mode ?? null,
    size: entry?.type === "file" ? entry.size : null,
    sha256: entry?.type === "file" ? entry.sha256 : null,
    symlink_target: entry?.type === "symlink" ? entry.target : null,
    symlink_resolved_within_root: entry?.type === "symlink" ? entry.resolved_within_root : null,
    symlink_resolution_state: entry?.type === "symlink" ? entry.symlink_resolution_state : null,
  };
}

const SEMANTIC_EVIDENCE_FIELDS = Object.freeze([
  "type",
  "mode",
  "size",
  "sha256",
  "symlink_target",
  "symlink_resolved_within_root",
  "symlink_resolution_state",
]);

function semanticDifference(candidateManifest, installedManifest) {
  const candidateEntries = new Map(candidateManifest.entries.map(entry => [entry.path, entry]));
  const installedEntries = new Map(installedManifest.entries.map(entry => [entry.path, entry]));
  const paths = [...new Set([...candidateEntries.keys(), ...installedEntries.keys()])].sort((left, right) => left.localeCompare(right));
  const changedPaths = [];
  let differenceCount = 0;
  let changedFieldCount = 0;
  for (const path of paths) {
    const candidateEntry = candidateEntries.get(path);
    const installedEntry = installedEntries.get(path);
    let changedFields;
    let changeType;
    if (!candidateEntry || !installedEntry) {
      changeType = candidateEntry ? "deleted_path" : "added_path";
      changedFields = ["path", ...SEMANTIC_EVIDENCE_FIELDS];
    } else {
      changeType = "changed";
      const candidateValues = semanticEntryValues(candidateEntry);
      const installedValues = semanticEntryValues(installedEntry);
      changedFields = SEMANTIC_EVIDENCE_FIELDS.filter(field => candidateValues[field] !== installedValues[field]);
    }
    if (changedFields.length === 0) continue;
    differenceCount += 1;
    changedFieldCount += changedFields.length;
    if (changedPaths.length < MAX_COMPARISON_EVIDENCE_CHANGED_PATHS) {
      changedPaths.push({
        path,
        change_type: changeType,
        changed_fields: changedFields,
        candidate: semanticEntryValues(candidateEntry),
        installed: semanticEntryValues(installedEntry),
      });
    }
  }
  return {
    difference_count: differenceCount,
    changed_field_count: changedFieldCount,
    compared_path_count: paths.length,
    changed_path_count: differenceCount,
    changed_paths: changedPaths,
    changed_paths_truncated: differenceCount > MAX_COMPARISON_EVIDENCE_CHANGED_PATHS,
  };
}

function isInstallRootModeNormalization(candidateManifest, installedManifest, difference) {
  if (!difference
    || difference.difference_count !== 1
    || difference.changed_field_count !== 1
    || difference.changed_path_count !== 1
    || difference.changed_paths_truncated
    || difference.changed_paths.length !== 1) return false;

  const [change] = difference.changed_paths;
  return change.path === "."
    && change.change_type === "changed"
    && change.changed_fields.length === 1
    && change.changed_fields[0] === "mode"
    && change.candidate?.type === "directory"
    && change.installed?.type === "directory"
    && change.candidate?.mode === "0500"
    && change.installed?.mode === "0700"
    && candidateManifest.root_entry_type === "directory"
    && installedManifest.root_entry_type === "directory"
    && candidateManifest.root_mode === "0500"
    && installedManifest.root_mode === "0700";
}

function groupHasRemovedSharing(group, installedPathToGroup) {
  for (let left = 0; left < group.paths.length; left += 1) {
    for (let right = left + 1; right < group.paths.length; right += 1) {
      if (!sameGroup(installedPathToGroup, group.paths[left], group.paths[right])) return true;
    }
  }
  return false;
}

function groupHasNewSharing(group, candidatePathToGroup) {
  for (let left = 0; left < group.paths.length; left += 1) {
    for (let right = left + 1; right < group.paths.length; right += 1) {
      if (!sameGroup(candidatePathToGroup, group.paths[left], group.paths[right])) return true;
    }
  }
  return false;
}

function groupHasChangedMembership(group, candidatePathToGroup) {
  const candidateGroups = new Set(group.paths.map(path => candidatePathToGroup.get(path)?.key));
  if (candidateGroups.size !== 1) return true;
  const candidateGroup = candidatePathToGroup.get(group.paths[0]);
  return !candidateGroup || candidateGroup.paths.length !== group.paths.length;
}

function boundedGroupEvidence(groups) {
  const sorted = sortGroups(groups);
  return {
    total_group_count: sorted.length,
    groups: sorted.slice(0, MAX_COMPARISON_EVIDENCE_GROUPS).map(group => ({
      id: group.id,
      paths: group.paths.slice(0, MAX_COMPARISON_EVIDENCE_PATHS_PER_GROUP),
      path_count: group.paths.length,
      paths_truncated: group.paths.length > MAX_COMPARISON_EVIDENCE_PATHS_PER_GROUP,
      external_reference_count: group.external_reference_count,
    })),
    groups_truncated: sorted.length > MAX_COMPARISON_EVIDENCE_GROUPS,
  };
}

function topologyDifference(candidateManifest, installedManifest) {
  const candidate = topologyMaps(candidateManifest);
  const installed = topologyMaps(installedManifest);
  const candidateAffectedBySplit = candidate.groups.filter(group => groupHasRemovedSharing(group, installed.pathToGroup));
  const candidateAffectedByNewSharing = new Map();
  const installedAffected = installed.groups.filter(group => {
    const hasNewSharing = groupHasNewSharing(group, candidate.pathToGroup);
    if (hasNewSharing) {
      for (const path of group.paths) {
        const candidateGroup = candidate.pathToGroup.get(path);
        if (candidateGroup) candidateAffectedByNewSharing.set(candidateGroup.key, candidateGroup);
      }
    }
    return hasNewSharing || groupHasChangedMembership(group, candidate.pathToGroup);
  });
  const candidateAffected = candidate.groups.filter(group => (
    candidateAffectedBySplit.some(affected => affected.key === group.key)
    || candidateAffectedByNewSharing.has(group.key)
  ));
  return {
    candidate_shared_pair_count: sharedPairCount(candidate.groups),
    installed_shared_pair_count: sharedPairCount(installed.groups),
    removed_sharing_pair_count: countRemovedSharing(candidate.groups, installed.pathToGroup),
    new_sharing_pair_count: countNewSharing(installed.groups, candidate.pathToGroup),
    candidate_affected_groups: boundedGroupEvidence(candidateAffected),
    installed_affected_groups: boundedGroupEvidence(installedAffected),
  };
}

function deriveStopReason({ classification, accepted, policy, candidateValidation, installedValidation, topologyClassification }) {
  if (classification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.INVALID_MANIFEST) {
    return !candidateValidation.schema_valid || !installedValidation.schema_valid
      ? "invalid_manifest_schema"
      : "invalid_manifest_validity_gate";
  }
  if (classification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.EXTERNAL_REFERENCE) return "external_hardlink_reference";
  if (classification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.SEMANTIC_MISMATCH) return "semantic_mismatch";
  if (classification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.MERGE_DETECTED) return "merge_detected";
  if (classification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.CROSS_GROUP_RELINK) return "cross_group_relink";
  if (classification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.MIXED_OR_UNKNOWN) return "mixed_or_unknown_topology";
  if (classification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.SPLIT_ONLY) {
    return accepted ? "accepted_controlled_internal_hardlink_split_v1" : `policy_rejected_split_only:${policy}`;
  }
  if (classification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.INSTALL_NORMALIZATION) {
    if (!accepted) return `policy_rejected_install_normalization:${policy}`;
    return topologyClassification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.SPLIT_ONLY
      ? "accepted_install_root_mode_and_internal_hardlink_split_v1"
      : "accepted_install_root_mode_normalization_v1";
  }
  if (classification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.EXACT) return "accepted_exact";
  return "invalid_manifest_classification";
}

function compareRuntimeArtifactManifests({ candidateManifest, installedManifest, policy } = {}) {
  const selectedPolicy = normalizePolicy(policy);
  const candidateValidation = validateRuntimeArtifactManifestV2(candidateManifest);
  const installedValidation = validateRuntimeArtifactManifestV2(installedManifest);
  let classification;
  let splitGroups = [];
  let topologyClassification = null;
  const semanticDifferenceReport = candidateValidation.artifact_valid && installedValidation.artifact_valid
    ? semanticDifference(candidateManifest, installedManifest)
    : null;

  if (!candidateValidation.artifact_valid || !installedValidation.artifact_valid) {
    classification = invalidClassification(candidateManifest || {}, installedManifest || {}, candidateValidation, installedValidation);
  } else if (candidateManifest.semantic_identity !== installedManifest.semantic_identity) {
    if (isInstallRootModeNormalization(candidateManifest, installedManifest, semanticDifferenceReport)) {
      const transition = candidateManifest.topology_identity === installedManifest.topology_identity
        ? { classification: ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.EXACT, split_groups: [] }
        : classifyTopologyTransition(candidateManifest, installedManifest);
      topologyClassification = transition.classification;
      splitGroups = transition.split_groups;
      classification = [
        ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.EXACT,
        ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.SPLIT_ONLY,
      ].includes(topologyClassification)
        ? ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.INSTALL_NORMALIZATION
        : topologyClassification;
    } else {
      classification = ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.SEMANTIC_MISMATCH;
    }
  } else if (candidateManifest.topology_identity === installedManifest.topology_identity) {
    classification = ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.EXACT;
    topologyClassification = ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.EXACT;
  } else {
    const transition = classifyTopologyTransition(candidateManifest, installedManifest);
    classification = transition.classification;
    topologyClassification = transition.classification;
    splitGroups = transition.split_groups;
  }

  const accepted = policyAccepts(selectedPolicy, classification);
  const candidateSemanticIdentity = trustedIdentity(candidateManifest, candidateValidation, "semantic_identity");
  const installedSemanticIdentity = trustedIdentity(installedManifest, installedValidation, "semantic_identity");
  const candidateTopologyIdentity = trustedIdentity(candidateManifest, candidateValidation, "topology_identity");
  const installedTopologyIdentity = trustedIdentity(installedManifest, installedValidation, "topology_identity");
  const candidateExactIdentity = trustedIdentity(candidateManifest, candidateValidation, "exact_identity");
  const installedExactIdentity = trustedIdentity(installedManifest, installedValidation, "exact_identity");
  return {
    schema_version: ARTIFACT_MANIFEST_V2_SCHEMA_VERSION,
    candidate_semantic_identity: candidateSemanticIdentity,
    installed_semantic_identity: installedSemanticIdentity,
    candidate_topology_identity: candidateTopologyIdentity,
    installed_topology_identity: installedTopologyIdentity,
    candidate_exact_identity: candidateExactIdentity,
    installed_exact_identity: installedExactIdentity,
    candidate_hardlink_group_count: trustedCount(candidateManifest, candidateValidation, "hardlink_group_count"),
    installed_hardlink_group_count: trustedCount(installedManifest, installedValidation, "hardlink_group_count"),
    candidate_external_hardlink_reference_count: trustedCount(candidateManifest, candidateValidation, "external_hardlink_reference_count"),
    installed_external_hardlink_reference_count: trustedCount(installedManifest, installedValidation, "external_hardlink_reference_count"),
    semantic_equal: identityEqual(candidateSemanticIdentity, installedSemanticIdentity),
    topology_equal: identityEqual(candidateTopologyIdentity, installedTopologyIdentity),
    policy: selectedPolicy,
    classification,
    decision: accepted ? "PASS" : "REJECT",
    accepted,
    stop_reason: deriveStopReason({
      classification,
      accepted,
      policy: selectedPolicy,
      candidateValidation,
      installedValidation,
      topologyClassification,
    }),
    candidate_validation_errors: candidateValidation.errors,
    installed_validation_errors: installedValidation.errors,
    semantic_difference: semanticDifferenceReport,
    topology_difference: candidateValidation.artifact_valid && installedValidation.artifact_valid
      ? topologyDifference(candidateManifest, installedManifest)
      : null,
    controlled_transformation: classification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.INSTALL_NORMALIZATION
      ? {
        type: "install_root_mode_and_internal_hardlink_split_v1",
        accepted,
        semantic_transformation: {
          path: ".",
          changed_fields: ["mode"],
          candidate_root_mode: candidateManifest.root_mode,
          installed_root_mode: installedManifest.root_mode,
        },
        topology_classification: topologyClassification,
        candidate_topology_identity: candidateTopologyIdentity,
        installed_topology_identity: installedTopologyIdentity,
        split_groups: topologyClassification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.SPLIT_ONLY ? splitGroups : [],
      }
      : classification === ARTIFACT_MANIFEST_V2_CLASSIFICATIONS.SPLIT_ONLY
      ? {
        type: "internal_hardlink_split_v1",
        accepted,
        candidate_topology_identity: candidateTopologyIdentity,
        installed_topology_identity: installedTopologyIdentity,
        split_groups: splitGroups,
      }
      : null,
  };
}

module.exports = {
  ARTIFACT_MANIFEST_V2_ALGORITHM,
  ARTIFACT_MANIFEST_V2_CLASSIFICATIONS,
  ARTIFACT_MANIFEST_V2_DEFAULT_POLICY,
  ARTIFACT_MANIFEST_V2_POLICIES,
  ARTIFACT_MANIFEST_V2_PREFIX,
  ARTIFACT_MANIFEST_V2_SCHEMA_VERSION,
  buildExactIdentity,
  buildSemanticIdentity,
  buildTopologyIdentity,
  buildRuntimeArtifactManifestV2,
  compareRuntimeArtifactManifests,
  validateRuntimeArtifactManifestV2,
};

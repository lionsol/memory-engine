const { createHash } = require("node:crypto");
const {
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} = require("node:fs");
const { relative, resolve, sep } = require("node:path");

const ARTIFACT_MANIFEST_SCHEMA_VERSION = 1;
const ARTIFACT_MANIFEST_ALGORITHM = "sha256";
const ARTIFACT_MANIFEST_PREFIX = "memory-engine-runtime-artifact-manifest-v1";

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function updateFramed(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  hash.update(`${bytes.byteLength}\n`);
  hash.update(bytes);
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

function sortByPath(entries) {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
}

function collectEntries({ rootPath, rootRealPath }) {
  const entries = [];
  const errors = [];
  const inodeGroups = new Map();

  function visit(absolutePath) {
    const rel = absolutePath === rootPath ? "." : normalizePath(relative(rootPath, absolutePath));
    let stats;
    try {
      stats = lstatSync(absolutePath);
    } catch (error) {
      errors.push(`stat_error:${rel}:${error.code || error.message}`);
      return;
    }

    if (stats.isSymbolicLink()) {
      let target = null;
      let resolvedWithinRoot = false;
      try {
        target = readlinkSync(absolutePath);
      } catch (error) {
        errors.push(`readlink_error:${rel}:${error.code || error.message}`);
      }
      try {
        resolvedWithinRoot = isWithinRoot(rootRealPath, realpathSync(absolutePath));
      } catch (error) {
        errors.push(`symlink_resolution_error:${rel}:${error.code || error.message}`);
      }
      entries.push({
        path: rel,
        type: "symlink",
        mode: octalMode(stats),
        target,
        resolved_within_root: resolvedWithinRoot,
      });
      return;
    }

    if (stats.isDirectory()) {
      entries.push({ path: rel, type: "directory", mode: octalMode(stats) });
      let names;
      try {
        names = readdirSync(absolutePath).sort((left, right) => left.localeCompare(right));
      } catch (error) {
        errors.push(`read_error:${rel}:${error.code || error.message}`);
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
        errors.push(`read_error:${rel}:${error.code || error.message}`);
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
        inode_key: inodeKey,
        nlink: stats.nlink,
      });
      return;
    }

    entries.push({ path: rel, type: "special", mode: octalMode(stats) });
    errors.push(`unsupported_entry_type:${rel}`);
  }

  visit(rootPath);

  const hardlinkByPath = new Map();
  const hardlinkGroups = [];
  let externalHardlinkReferenceCount = 0;
  for (const group of inodeGroups.values()) {
    const paths = [...group.paths].sort((left, right) => left.localeCompare(right));
    if (group.nlink <= 1 && paths.length <= 1) continue;
    const identity = sha256Hex(Buffer.from(paths.join("\n")));
    const externalReferenceCount = Math.max(0, Number(group.nlink) - paths.length);
    externalHardlinkReferenceCount += externalReferenceCount;
    hardlinkGroups.push({
      id: identity,
      paths,
      observed_link_count: Number(group.nlink),
      external_reference_count: externalReferenceCount,
    });
    for (const path of paths) hardlinkByPath.set(path, identity);
  }

  const normalizedEntries = sortByPath(entries).map(entry => {
    if (entry.type !== "file") return entry;
    const { inode_key: _inodeKey, nlink: _nlink, ...rest } = entry;
    return {
      ...rest,
      hardlink_group: hardlinkByPath.get(entry.path) || null,
    };
  });

  return {
    entries: normalizedEntries,
    errors: [...new Set(errors)].sort(),
    hardlinkGroups: [...hardlinkGroups].sort((left, right) => left.id.localeCompare(right.id)),
    externalHardlinkReferenceCount,
  };
}

function buildIdentity(entries) {
  const hash = createHash(ARTIFACT_MANIFEST_ALGORITHM);
  updateFramed(hash, ARTIFACT_MANIFEST_PREFIX);
  for (const entry of entries) {
    updateFramed(hash, entry.path);
    updateFramed(hash, entry.type);
    updateFramed(hash, entry.mode);
    if (entry.type === "file") {
      updateFramed(hash, String(entry.size));
      updateFramed(hash, entry.sha256);
      updateFramed(hash, entry.hardlink_group || "");
    } else if (entry.type === "symlink") {
      updateFramed(hash, entry.target || "");
      updateFramed(hash, entry.resolved_within_root ? "true" : "false");
    }
  }
  return hash.digest("hex");
}

function buildRuntimeArtifactManifest({ rootDir, checkedAt = new Date().toISOString() } = {}) {
  if (typeof rootDir !== "string" || !rootDir.trim()) throw new TypeError("rootDir is required");
  const rootPath = resolve(rootDir);
  let rootStats;
  try {
    rootStats = lstatSync(rootPath);
  } catch (error) {
    throw new Error(`artifact root unavailable: ${error.code || error.message}`);
  }
  if (rootStats.isSymbolicLink()) throw new Error("artifact root must not be a symlink");
  if (!rootStats.isDirectory()) throw new Error("artifact root must be a directory");
  const rootRealPath = realpathSync(rootPath);
  const collected = collectEntries({ rootPath, rootRealPath });
  const fileEntries = collected.entries.filter(entry => entry.type === "file");
  const directoryEntries = collected.entries.filter(entry => entry.type === "directory");
  const symlinkEntries = collected.entries.filter(entry => entry.type === "symlink");
  const specialEntries = collected.entries.filter(entry => entry.type === "special");
  const writableFiles = fileEntries.filter(entry => (Number.parseInt(entry.mode, 8) & 0o222) !== 0);
  const writableDirectories = directoryEntries.filter(entry => (Number.parseInt(entry.mode, 8) & 0o222) !== 0);
  const externalSymlinks = symlinkEntries.filter(entry => entry.resolved_within_root !== true);
  const valid = collected.errors.length === 0
    && specialEntries.length === 0
    && externalSymlinks.length === 0
    && collected.externalHardlinkReferenceCount === 0;

  return {
    schema_version: ARTIFACT_MANIFEST_SCHEMA_VERSION,
    checked_at: checkedAt,
    algorithm: ARTIFACT_MANIFEST_ALGORITHM,
    serialization: ARTIFACT_MANIFEST_PREFIX,
    root_path: rootPath,
    root_mode: octalMode(rootStats),
    valid,
    identity: valid ? buildIdentity(collected.entries) : null,
    entry_count: collected.entries.length,
    file_count: fileEntries.length,
    directory_count: directoryEntries.length,
    symlink_count: symlinkEntries.length,
    special_entry_count: specialEntries.length,
    total_file_bytes: fileEntries.reduce((sum, entry) => sum + entry.size, 0),
    writable_file_count: writableFiles.length,
    writable_directory_count: writableDirectories.length,
    external_symlink_count: externalSymlinks.length,
    hardlink_group_count: collected.hardlinkGroups.length,
    external_hardlink_reference_count: collected.externalHardlinkReferenceCount,
    hardlink_groups: collected.hardlinkGroups,
    errors: collected.errors,
    entries: collected.entries,
  };
}

module.exports = {
  ARTIFACT_MANIFEST_ALGORITHM,
  ARTIFACT_MANIFEST_PREFIX,
  ARTIFACT_MANIFEST_SCHEMA_VERSION,
  buildRuntimeArtifactManifest,
};

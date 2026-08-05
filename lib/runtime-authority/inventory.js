const { buildRuntimeArtifactManifestV2, validateRuntimeArtifactManifestV2 } = require("../../bin/runtime-artifact-manifest-v2-lib.cjs");
const { canonicalize } = require("./canonical-json.js");

const ENTRY_INVENTORY_SCHEMA = "memory-engine-runtime-authority-entry-inventory-v1";

function directChild(parent, path) {
  if (parent === ".") return path.split("/").length === 1;
  return path.startsWith(`${parent}/`) && path.slice(parent.length + 1).split("/").length === 1;
}

function typedEntry(entry) {
  const result = { path: entry.path, type: entry.type, mode: entry.mode };
  if (entry.type === "file") {
    result.size = entry.size;
    result.sha256 = entry.sha256;
  } else if (entry.type === "symlink") {
    result.target = entry.target;
    result.resolved_within_root = entry.resolved_within_root;
    result.symlink_resolution_state = entry.symlink_resolution_state;
  }
  return result;
}

function buildTypedEntryInventory(root, { rejectEmptyDirectories = true, checkedAt } = {}) {
  const manifest = buildRuntimeArtifactManifestV2({ rootDir: root, checkedAt });
  const validation = validateRuntimeArtifactManifestV2(manifest);
  if (!validation.artifact_valid) throw new Error(`invalid typed inventory:${manifest.errors.join(",")}`);
  const entries = manifest.entries.filter(entry => entry.path !== ".").map(typedEntry).sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  if (rejectEmptyDirectories) {
    for (const entry of entries.filter(candidate => candidate.type === "directory")) {
      if (!entries.some(candidate => directChild(entry.path, candidate.path))) throw new Error(`unexpected empty directory:${entry.path}`);
    }
  }
  return {
    schema: ENTRY_INVENTORY_SCHEMA,
    root: { type: "directory", mode: manifest.root_mode },
    entries,
    hardlink_groups: manifest.hardlink_groups,
    exact_identity: manifest.exact_identity,
  };
}

function validateTypedEntryInventory(inventory) {
  if (!inventory || inventory.schema !== ENTRY_INVENTORY_SCHEMA || !inventory.root || !Array.isArray(inventory.entries)) throw new Error("typed inventory schema mismatch");
  const sortedPaths = [...inventory.entries].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path))).map(entry => entry.path);
  if (canonicalize(inventory.entries.map(entry => entry.path)) !== canonicalize(sortedPaths)) throw new Error("typed inventory ordering mismatch");
  const seen = new Set();
  for (const entry of inventory.entries) {
    if (seen.has(entry.path) || typeof entry.path !== "string" || !entry.path || entry.path.includes("\0") || entry.path.includes("\\") || entry.path.startsWith("/") || entry.path.split("/").includes("..") || entry.path.split("/").includes("")) throw new Error(`invalid typed inventory path:${entry.path}`);
    seen.add(entry.path);
    if (!["file", "directory", "symlink"].includes(entry.type)) throw new Error(`invalid typed inventory type:${entry.path}`);
    if (typeof entry.mode !== "string" || !/^\d{4}$/.test(entry.mode)) throw new Error(`invalid typed inventory mode:${entry.path}`);
    if (entry.type === "file" && (!Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[0-9a-f]{64}$/.test(entry.sha256))) throw new Error(`invalid typed inventory file:${entry.path}`);
    if (entry.type === "symlink" && (typeof entry.target !== "string" || entry.resolved_within_root !== true || entry.symlink_resolution_state !== "within_root")) throw new Error(`invalid typed inventory symlink:${entry.path}`);
  }
  for (const entry of inventory.entries.filter(candidate => candidate.type === "directory")) {
    if (!inventory.entries.some(candidate => directChild(entry.path, candidate.path))) throw new Error(`unexpected empty directory:${entry.path}`);
  }
  return true;
}

function compareTypedEntryInventories(actual, expected) {
  validateTypedEntryInventory(actual);
  validateTypedEntryInventory(expected);
  return canonicalize(actual) === canonicalize(expected);
}

module.exports = { ENTRY_INVENTORY_SCHEMA, buildTypedEntryInventory, validateTypedEntryInventory, compareTypedEntryInventories, typedEntry };

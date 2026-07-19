import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_IDENTITY_SCHEMA_VERSION = 1;
const RUNTIME_IDENTITY_ALGORITHM = "sha256";
const RUNTIME_IDENTITY_PREFIX = "memory-engine-runtime-build-v1";
const RUNTIME_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".json", ".sql"]);
const DEFAULT_RUNTIME_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function isWithinRoot(rootDir, candidate) {
  const root = resolve(rootDir);
  const target = resolve(candidate);
  return target === root || target.startsWith(`${root}${sep}`);
}

function byteLength(value) {
  return Buffer.byteLength(value);
}

function updateFramed(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  hash.update(`${bytes.byteLength}\n`);
  hash.update(bytes);
}

function normalizeEntry(entry, rootDir) {
  if (!entry || typeof entry !== "object" || typeof entry.path !== "string") return null;
  const relativePath = entry.path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!relativePath || relativePath.startsWith("/") || relativePath.split("/").includes("..")) return null;
  const bytes = Buffer.isBuffer(entry.bytes)
    ? Buffer.from(entry.bytes)
    : Buffer.from(typeof entry.content === "string" ? entry.content : "");
  return {
    path: relativePath,
    bytes,
    absolutePath: resolve(rootDir, relativePath),
  };
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
}

function collectDirectory(rootDir, directory, entries, errors) {
  let names;
  try {
    names = readdirSync(directory).sort((left, right) => left.localeCompare(right));
  } catch (error) {
    errors.push(`read_error:${relative(rootDir, directory).replaceAll(sep, "/")}:${error.code || error.message}`);
    return;
  }

  for (const name of names) {
    const absolutePath = resolve(directory, name);
    const relativePath = relative(rootDir, absolutePath).replaceAll(sep, "/");
    let stats;
    try {
      stats = lstatSync(absolutePath);
    } catch (error) {
      errors.push(`stat_error:${relativePath}:${error.code || error.message}`);
      continue;
    }
    if (stats.isSymbolicLink()) {
      let target;
      try {
        target = realpathSync(absolutePath);
      } catch {
        target = null;
      }
      if (!target || !isWithinRoot(rootDir, target)) {
        errors.push(`symlink_escapes_root:${relativePath}`);
      } else if (RUNTIME_EXTENSIONS.has(extname(name).toLowerCase())) {
        try {
          entries.push({ path: relativePath, bytes: readFileSync(absolutePath), absolutePath });
        } catch (error) {
          errors.push(`read_error:${relativePath}:${error.code || error.message}`);
        }
      }
      continue;
    }
    if (stats.isDirectory()) {
      collectDirectory(rootDir, absolutePath, entries, errors);
      continue;
    }
    if (!stats.isFile() || !RUNTIME_EXTENSIONS.has(extname(name).toLowerCase())) continue;
    try {
      entries.push({ path: relativePath, bytes: readFileSync(absolutePath), absolutePath });
    } catch (error) {
      errors.push(`read_error:${relativePath}:${error.code || error.message}`);
    }
  }
}

export function collectRuntimeBuildFiles({ rootDir = DEFAULT_RUNTIME_ROOT } = {}) {
  const resolvedRoot = resolve(rootDir);
  const entries = [];
  const errors = [];
  for (const required of ["index.js", "openclaw.plugin.json"]) {
    const absolutePath = resolve(resolvedRoot, required);
    try {
      const stats = lstatSync(absolutePath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        errors.push(`missing_required_file:${required}`);
      } else {
        entries.push({ path: required, bytes: readFileSync(absolutePath), absolutePath });
      }
    } catch (error) {
      errors.push(`missing_required_file:${required}:${error.code || error.message}`);
    }
  }
  const packagePath = resolve(resolvedRoot, "package.json");
  try {
    const stats = lstatSync(packagePath);
    if (stats.isFile() && !stats.isSymbolicLink()) {
      entries.push({ path: "package.json", bytes: readFileSync(packagePath), absolutePath: packagePath });
    }
  } catch {
    // package.json is included when present but is not a required entry point.
  }
  const libPath = resolve(resolvedRoot, "lib");
  try {
    if (lstatSync(libPath).isDirectory()) collectDirectory(resolvedRoot, libPath, entries, errors);
  } catch (error) {
    errors.push(`missing_runtime_directory:lib:${error.code || error.message}`);
  }
  return { rootDir: resolvedRoot, entries: sortEntries(entries), errors: [...new Set(errors)].sort() };
}

export function buildRuntimeBuildIdentity({ rootDir = DEFAULT_RUNTIME_ROOT, fileEntries } = {}) {
  const resolvedRoot = resolve(rootDir);
  const collected = Array.isArray(fileEntries)
    ? { rootDir: resolvedRoot, entries: fileEntries.map(entry => normalizeEntry(entry, resolvedRoot)).filter(Boolean), errors: [] }
    : collectRuntimeBuildFiles({ rootDir: resolvedRoot });
  const entries = sortEntries(collected.entries);
  const errors = [...new Set(collected.errors)].sort();
  const requiredPaths = new Set(entries.map(entry => entry.path));
  for (const required of ["index.js", "openclaw.plugin.json"]) {
    if (!requiredPaths.has(required)) errors.push(`missing_required_file:${required}`);
  }

  const hash = createHash(RUNTIME_IDENTITY_ALGORITHM);
  updateFramed(hash, RUNTIME_IDENTITY_PREFIX);
  for (const entry of entries) {
    updateFramed(hash, entry.path);
    updateFramed(hash, String(entry.bytes.byteLength));
    updateFramed(hash, entry.bytes);
  }

  return {
    schema_version: RUNTIME_IDENTITY_SCHEMA_VERSION,
    algorithm: RUNTIME_IDENTITY_ALGORITHM,
    identity: errors.length === 0 ? hash.digest("hex") : null,
    file_count: entries.length,
    valid: errors.length === 0,
    errors,
  };
}

export { DEFAULT_RUNTIME_ROOT, RUNTIME_IDENTITY_SCHEMA_VERSION };

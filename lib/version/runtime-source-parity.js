import { createHash } from "node:crypto";
import {
  buildRuntimeBuildIdentity,
  collectRuntimeBuildFiles,
} from "./runtime-build-identity.js";

function canonicalIsoTimestamp(value) {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const canonical = new Date(parsed).toISOString();
  return canonical === value ? canonical : null;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function entryMap(entries = []) {
  return new Map(entries.map(entry => [entry.path, {
    size: entry.bytes.byteLength,
    digest: digest(entry.bytes),
  }]));
}

function compareRuntimeFiles(sourceEntries, runtimeEntries) {
  const source = entryMap(sourceEntries);
  const runtime = entryMap(runtimeEntries);
  const paths = [...new Set([...source.keys(), ...runtime.keys()])]
    .sort((left, right) => left.localeCompare(right));
  const differences = [];
  for (const path of paths) {
    const sourceEntry = source.get(path);
    const runtimeEntry = runtime.get(path);
    if (!sourceEntry) differences.push({ path, status: "missing_from_source" });
    else if (!runtimeEntry) differences.push({ path, status: "missing_from_runtime" });
    else if (sourceEntry.size !== runtimeEntry.size || sourceEntry.digest !== runtimeEntry.digest) {
      differences.push({ path, status: "content_mismatch" });
    }
  }
  return differences;
}

export function buildRuntimeSourceParityReport({
  sourceRoot,
  runtimeRoot,
  checkedAt = new Date().toISOString(),
} = {}) {
  const canonicalCheckedAt = canonicalIsoTimestamp(checkedAt);
  if (!canonicalCheckedAt) throw new TypeError("checkedAt must be a canonical UTC ISO timestamp");
  if (typeof sourceRoot !== "string" || !sourceRoot.trim()) throw new TypeError("sourceRoot is required");
  if (typeof runtimeRoot !== "string" || !runtimeRoot.trim()) throw new TypeError("runtimeRoot is required");

  const sourceFiles = collectRuntimeBuildFiles({ rootDir: sourceRoot });
  const runtimeFiles = collectRuntimeBuildFiles({ rootDir: runtimeRoot });
  const sourceIdentity = buildRuntimeBuildIdentity({ rootDir: sourceRoot });
  const runtimeIdentity = buildRuntimeBuildIdentity({ rootDir: runtimeRoot });
  const differences = compareRuntimeFiles(sourceFiles.entries, runtimeFiles.entries);
  const sourceRuntimeEqual = sourceIdentity.valid
    && runtimeIdentity.valid
    && differences.length === 0
    && sourceIdentity.identity === runtimeIdentity.identity;

  return {
    schema_version: 1,
    checked_at: canonicalCheckedAt,
    source_runtime_equal: sourceRuntimeEqual,
    difference_count: differences.length,
    runtime_build_identity: runtimeIdentity.identity,
    source_build_identity: sourceIdentity.identity,
    source_root: sourceFiles.rootDir,
    runtime_root: runtimeFiles.rootDir,
    source_file_count: sourceFiles.entries.length,
    runtime_file_count: runtimeFiles.entries.length,
    source_identity_valid: sourceIdentity.valid,
    runtime_identity_valid: runtimeIdentity.valid,
    source_errors: sourceIdentity.errors,
    runtime_errors: runtimeIdentity.errors,
    differences,
  };
}

export { canonicalIsoTimestamp, compareRuntimeFiles };

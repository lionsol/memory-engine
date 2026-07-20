import { createHash } from "node:crypto";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { buildEffectiveRuntimeConfigReport } from "./effective-runtime-config-report.js";
import { canonicalIsoTimestamp } from "./hybrid-observation-provenance.js";
import { fingerprintRolloutConfig } from "./production-evidence-identity.js";
import { buildSustainedRuntimeBoundaryReport } from "./sustained-runtime-boundary.js";

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildSustainedRuntimeConfigBackupManifest({
  configPath,
  liveConfigPath,
  createdAt = new Date().toISOString(),
} = {}) {
  const createdAtIso = canonicalIsoTimestamp(createdAt);
  if (!createdAtIso) throw new TypeError("createdAt must be a canonical UTC ISO timestamp");
  if (typeof configPath !== "string" || !configPath.trim()) throw new TypeError("configPath is required");
  if (typeof liveConfigPath !== "string" || !liveConfigPath.trim()) throw new TypeError("liveConfigPath is required");
  const absolutePath = resolve(configPath);
  const absoluteLivePath = resolve(liveConfigPath);
  const blockers = [];
  let bytes = null;
  let liveBytes = null;
  let backupStats = null;
  let liveStats = null;
  let config = null;
  try {
    const linkStats = lstatSync(absolutePath);
    backupStats = statSync(absolutePath);
    if (linkStats.isSymbolicLink()) blockers.push("config_backup_symlink_not_allowed");
    if (!backupStats.isFile()) blockers.push("config_backup_not_regular_file");
    else {
      if ((backupStats.mode & 0o077) !== 0) blockers.push("config_backup_permissions_too_open");
      bytes = readFileSync(absolutePath);
    }
  } catch (error) {
    blockers.push(`config_backup_read_failed:${error.code || error.message}`);
  }
  try {
    liveStats = statSync(absoluteLivePath);
    if (!liveStats.isFile()) blockers.push("live_config_not_regular_file");
    else liveBytes = readFileSync(absoluteLivePath);
  } catch (error) {
    blockers.push(`live_config_read_failed:${error.code || error.message}`);
  }
  if (absolutePath === absoluteLivePath
    || (backupStats && liveStats && backupStats.dev === liveStats.dev && backupStats.ino === liveStats.ino)) {
    blockers.push("config_backup_not_independent_copy");
  }
  const backupHash = bytes ? sha256(bytes) : null;
  const liveHash = liveBytes ? sha256(liveBytes) : null;
  const backupMatchesLive = Boolean(bytes && liveBytes
    && bytes.byteLength === liveBytes.byteLength
    && backupHash === liveHash);
  if (!backupMatchesLive) blockers.push("config_backup_live_bytes_mismatch");
  if (bytes) {
    try {
      const parsed = JSON.parse(bytes.toString("utf8"));
      if (!isPlainObject(parsed)) blockers.push("config_backup_json_not_object");
      else config = parsed;
    } catch (error) {
      blockers.push(`config_backup_json_invalid:${error.message}`);
    }
  }

  const effective = config
    ? buildEffectiveRuntimeConfigReport({ openclawConfig: config, checkedAt: createdAtIso })
    : null;
  const boundary = config
    ? buildSustainedRuntimeBoundaryReport({ openclawConfig: config, checkedAt: createdAtIso })
    : null;
  const openclawConfigIdentity = config ? fingerprintRolloutConfig(config) : null;
  if (effective && effective.valid !== true) blockers.push("config_backup_effective_config_invalid");
  if (openclawConfigIdentity && openclawConfigIdentity.valid !== true) blockers.push("config_backup_openclaw_config_fingerprint_invalid");
  if (boundary && boundary.status !== "clean") blockers.push(`config_backup_runtime_boundary_${boundary.status}`);
  blockers.push(...(effective?.errors || []));
  blockers.push(...(boundary?.blockers || []));
  const uniqueBlockers = [...new Set(blockers)];
  const current = effective?.effective_config;
  return {
    schema_version: 1,
    created_at: createdAtIso,
    status: uniqueBlockers.length === 0 ? "ready" : "blocked",
    valid: uniqueBlockers.length === 0,
    backup_path: absolutePath,
    live_config_path: absoluteLivePath,
    config_sha256: backupHash,
    live_config_sha256: liveHash,
    byte_count: bytes?.byteLength ?? null,
    live_byte_count: liveBytes?.byteLength ?? null,
    backup_matches_live_config: backupMatchesLive,
    openclaw_config_fingerprint: openclawConfigIdentity?.fingerprint ?? null,
    effective_config_fingerprint: effective?.rollout_config_fingerprint ?? null,
    active_memory_enabled: boundary?.active_memory_enabled ?? null,
    kg_mode: current?.kgFailClosedMode ?? null,
    recent_mode: current?.recentFailClosedMode ?? null,
    auto_recall_enabled: current?.autoRecall?.enabled ?? null,
    production_evidence_enabled: current?.productionEvidenceWindow?.enabled ?? null,
    blockers: uniqueBlockers,
  };
}

export { isPlainObject, sha256 };

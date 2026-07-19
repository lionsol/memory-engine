import { createHash } from "node:crypto";
import { buildRuntimeBuildIdentity } from "../../version/runtime-build-identity.js";
import {
  PRODUCTION_HYBRID_OBSERVATION_SURFACES,
  parseHybridObservationMetadata,
  validateProductionHybridObservationProvenance,
} from "./hybrid-observation-provenance.js";

const CONFIG_IDENTITY_SCHEMA_VERSION = 1;
const CONFIG_IDENTITY_ALGORITHM = "sha256";
const CONFIG_UNDEFINED_MARKER = "__memory_engine_undefined__";
const SHA256_HEX = /^[a-f0-9]{64}$/;

function canonicalize(value) {
  if (value === undefined) return { [CONFIG_UNDEFINED_MARKER]: true };
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("config contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map(item => canonicalize(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map(key => [key, canonicalize(value[key])]),
    );
  }
  throw new TypeError(`config contains unsupported value type: ${typeof value}`);
}

export function canonicalizeRolloutConfig(config) {
  return canonicalize(config ?? {});
}

export function fingerprintRolloutConfig(config) {
  try {
    const canonical = canonicalizeRolloutConfig(config);
    const serialized = JSON.stringify(canonical);
    return {
      schema_version: CONFIG_IDENTITY_SCHEMA_VERSION,
      algorithm: CONFIG_IDENTITY_ALGORITHM,
      fingerprint: createHash(CONFIG_IDENTITY_ALGORITHM).update(serialized).digest("hex"),
      valid: true,
      errors: [],
    };
  } catch (error) {
    return {
      schema_version: CONFIG_IDENTITY_SCHEMA_VERSION,
      algorithm: CONFIG_IDENTITY_ALGORITHM,
      fingerprint: null,
      valid: false,
      errors: [error.message],
    };
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function createProductionEvidenceIdentityContext({
  rootDir,
  config = {},
  configErrors = [],
} = {}) {
  const productionEvidenceWindow = config?.productionEvidenceWindow;
  const enabled = productionEvidenceWindow?.enabled === true;
  const runtime = buildRuntimeBuildIdentity({ rootDir });
  const rolloutConfig = configErrors.length > 0
    ? {
      schema_version: CONFIG_IDENTITY_SCHEMA_VERSION,
      algorithm: CONFIG_IDENTITY_ALGORITHM,
      fingerprint: null,
      valid: false,
      errors: [...configErrors],
    }
    : fingerprintRolloutConfig(config);
  const epochId = enabled ? nonEmptyString(productionEvidenceWindow?.epochId) : null;
  return {
    evidenceEpochId: epochId,
    runtimeBuildIdentity: runtime.valid ? runtime.identity : null,
    rolloutConfigFingerprint: rolloutConfig.valid ? rolloutConfig.fingerprint : null,
    productionEvidenceEnabled: enabled,
    runtimeBuildIdentityReport: runtime,
    rolloutConfigFingerprintReport: rolloutConfig,
  };
}

export function isSha256Identity(value) {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function issue(code, actual, expected = undefined) {
  const value = { code };
  if (actual !== undefined) value.actual = actual;
  if (expected !== undefined) value.expected = expected;
  return value;
}

function sortedStrings(values) {
  return [...new Set(values.filter(value => typeof value === "string" && value.trim()))]
    .sort((left, right) => left.localeCompare(right));
}

export function evaluateProductionEvidenceIdentity({ observations = [] } = {}) {
  const productionSurfaces = new Set(PRODUCTION_HYBRID_OBSERVATION_SURFACES);
  const rows = [];
  let excludedNonProductionCount = 0;
  let unknownSurfaceCount = 0;
  for (const row of Array.isArray(observations) ? observations : []) {
    if (row?.event_type !== "hybrid_search_observation") continue;
    const metadata = parseHybridObservationMetadata(row);
    const surface = typeof metadata?.surface === "string" ? metadata.surface.trim() : "unknown";
    if (!productionSurfaces.has(surface)) {
      excludedNonProductionCount += 1;
      if (surface !== "cli_search") unknownSurfaceCount += 1;
      continue;
    }
    rows.push(row);
  }

  const blockers = [];
  const evidenceGaps = [];
  const validRows = [];
  const identityRows = [];
  let missingIdentityObservationCount = 0;
  let productionEvidenceDisabledCount = 0;
  const missingIdentityCounts = {};

  for (const row of rows) {
    const provenance = validateProductionHybridObservationProvenance(row);
    if (!provenance.valid) {
      blockers.push(issue("invalid_observation_provenance", provenance.reasons));
      continue;
    }
    validRows.push({ row, metadata: provenance.metadata });
    const metadata = provenance.metadata;
    const missing = [];
    for (const key of ["evidence_epoch_id", "runtime_build_identity", "rollout_config_fingerprint"]) {
      if (typeof metadata[key] !== "string" || !metadata[key].trim()) missing.push(key);
    }
    if (missing.length > 0) {
      missingIdentityObservationCount += 1;
      for (const key of missing) missingIdentityCounts[key] = (missingIdentityCounts[key] || 0) + 1;
    }
    if (metadata.production_evidence_enabled !== true) {
      productionEvidenceDisabledCount += 1;
      continue;
    }
    if (missing.length > 0) continue;
    let invalidIdentity = false;
    for (const key of ["runtime_build_identity", "rollout_config_fingerprint"]) {
      if (!isSha256Identity(metadata[key])) {
        blockers.push(issue("invalid_identity_format", key));
        invalidIdentity = true;
      }
    }
    if (!invalidIdentity) identityRows.push(metadata);
  }

  const epochIds = sortedStrings(identityRows.map(metadata => metadata.evidence_epoch_id));
  const runtimeBuildIdentities = sortedStrings(identityRows.map(metadata => metadata.runtime_build_identity));
  const rolloutConfigFingerprints = sortedStrings(identityRows.map(metadata => metadata.rollout_config_fingerprint));
  const mixedEpoch = epochIds.length > 1;
  const mixedRuntimeBuild = runtimeBuildIdentities.length > 1;
  const mixedRolloutConfig = rolloutConfigFingerprints.length > 1;
  if (mixedEpoch) blockers.push(issue("mixed_evidence_epochs", epochIds));
  if (mixedRuntimeBuild) blockers.push(issue("mixed_runtime_build_identities", runtimeBuildIdentities));
  if (mixedRolloutConfig) blockers.push(issue("mixed_rollout_config_fingerprints", rolloutConfigFingerprints));
  for (const key of ["evidence_epoch_id", "runtime_build_identity", "rollout_config_fingerprint"]) {
    if (missingIdentityCounts[key]) blockers.push(issue(`missing_${key}`, missingIdentityCounts[key]));
  }
  if (productionEvidenceDisabledCount > 0) {
    blockers.push(issue("production_evidence_not_enabled", productionEvidenceDisabledCount));
  }
  if (unknownSurfaceCount > 0) {
    blockers.push(issue("unknown_production_surface", unknownSurfaceCount));
  }
  if (rows.length === 0) evidenceGaps.push(issue("no_production_observations", 0));
  if (validRows.length > 0 && identityRows.length === 0 && blockers.length === 0) {
    evidenceGaps.push(issue("no_qualifying_identity_observations", validRows.length));
  }

  const hasMixedIdentity = mixedEpoch || mixedRuntimeBuild || mixedRolloutConfig;
  let status = "identity_ready";
  const onlyMixedBlockers = blockers.length > 0 && blockers.every(item => item.code.startsWith("mixed_"));
  if (hasMixedIdentity && onlyMixedBlockers) status = "identity_mixed";
  else if (blockers.length > 0) status = "blocked";
  else if (hasMixedIdentity) status = "identity_mixed";
  else if (evidenceGaps.length > 0) status = "identity_incomplete";

  return {
    schema_version: 1,
    status,
    observation_count: rows.length,
    qualifying_observation_count: identityRows.length,
    evidence_epoch_ids: epochIds,
    runtime_build_identities: runtimeBuildIdentities,
    rollout_config_fingerprints: rolloutConfigFingerprints,
    missing_identity_observation_count: missingIdentityObservationCount,
    mixed_epoch: mixedEpoch,
    mixed_runtime_build: mixedRuntimeBuild,
    mixed_rollout_config: mixedRolloutConfig,
    excluded_non_production_observation_count: excludedNonProductionCount,
    unknown_surface_observation_count: unknownSurfaceCount,
    blockers: [...new Map(blockers.map(item => [JSON.stringify(item), item])).values()],
    evidence_gaps: evidenceGaps,
  };
}

export { CONFIG_IDENTITY_SCHEMA_VERSION };

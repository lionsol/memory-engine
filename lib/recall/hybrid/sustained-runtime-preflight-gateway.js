import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sanitizeEffectiveConfigForAuthorization } from "./effective-runtime-config-report.js";
import { buildSustainedRuntimeBoundaryReport } from "./sustained-runtime-boundary.js";
import {
  fingerprintRolloutConfig,
  isSha256Identity,
} from "./production-evidence-identity.js";

export const SUSTAINED_RUNTIME_PREFLIGHT_METHOD = "memoryEngine.sustainedRuntimePreflight";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function configFileIdentity({ path, bytes } = {}) {
  const normalizedPath = nonEmptyString(path);
  const buffer = Buffer.isBuffer(bytes)
    ? bytes
    : bytes instanceof Uint8Array
      ? Buffer.from(bytes)
      : null;
  if (!normalizedPath || !buffer) {
    return { valid: false, path: normalizedPath, sha256: null, byte_count: null };
  }
  return {
    valid: true,
    path: resolve(normalizedPath),
    sha256: createHash("sha256").update(buffer).digest("hex"),
    byte_count: buffer.byteLength,
  };
}

export function buildSustainedRuntimePreflightReport({
  openclawConfig,
  openclawRuntimeVersion,
  openclawConfigFilePath,
  openclawConfigFileBytes,
  effectiveRuntimeConfig,
  effectiveRuntimeConfigValid,
  effectiveRuntimeConfigErrors = [],
  productionEvidenceIdentityContext,
  checkedAt = new Date().toISOString(),
} = {}) {
  const runtimeVersion = nonEmptyString(openclawRuntimeVersion);
  const runtimeBuildIdentity = productionEvidenceIdentityContext?.runtimeBuildIdentity ?? null;
  const rolloutConfigFingerprint = productionEvidenceIdentityContext?.rolloutConfigFingerprint ?? null;
  const boundary = buildSustainedRuntimeBoundaryReport({ openclawConfig, checkedAt });
  const openclawConfigIdentity = fingerprintRolloutConfig(openclawConfig);
  const fileIdentity = configFileIdentity({
    path: openclawConfigFilePath,
    bytes: openclawConfigFileBytes,
  });
  const configErrors = Array.isArray(effectiveRuntimeConfigErrors) ? effectiveRuntimeConfigErrors : [];
  const configValid = effectiveRuntimeConfigValid === true
    && configErrors.length === 0
    && isSha256Identity(rolloutConfigFingerprint);
  const runtimeBuildValid = isSha256Identity(runtimeBuildIdentity)
    && productionEvidenceIdentityContext?.runtimeBuildIdentityReport?.valid === true;
  const blockers = [];
  if (!runtimeVersion) blockers.push("openclaw_runtime_version_missing");
  if (!fileIdentity.valid) blockers.push("openclaw_config_file_identity_invalid");
  if (!openclawConfigIdentity.valid) blockers.push("openclaw_config_fingerprint_invalid");
  if (!configValid) blockers.push("effective_runtime_config_invalid");
  if (!runtimeBuildValid) blockers.push("runtime_build_identity_invalid");
  if (boundary.status !== "clean") blockers.push(`runtime_boundary_${boundary.status}`);
  blockers.push(...configErrors);
  blockers.push(...(boundary.blockers || []));
  const uniqueBlockers = [...new Set(blockers)];
  return {
    schema_version: 1,
    checked_at: checkedAt,
    status: uniqueBlockers.length === 0 ? "clean" : "blocked",
    openclaw_runtime_version: runtimeVersion,
    openclaw_config_file_path: fileIdentity.path,
    openclaw_config_file_sha256: fileIdentity.sha256,
    openclaw_config_file_byte_count: fileIdentity.byte_count,
    openclaw_config_fingerprint: openclawConfigIdentity.fingerprint,
    runtime_build_identity: runtimeBuildIdentity,
    rollout_config_fingerprint: rolloutConfigFingerprint,
    effective_config_report: {
      schema_version: 1,
      checked_at: checkedAt,
      valid: configValid,
      errors: configErrors,
      effective_config: sanitizeEffectiveConfigForAuthorization(effectiveRuntimeConfig),
      rollout_config_fingerprint: rolloutConfigFingerprint,
    },
    runtime_boundary: boundary,
    blockers: uniqueBlockers,
  };
}

export function registerSustainedRuntimePreflightGateway({
  api,
  effectiveRuntimeConfig,
  effectiveRuntimeConfigValid,
  effectiveRuntimeConfigErrors,
  productionEvidenceIdentityContext,
  openclawConfigPath,
} = {}) {
  if (!api || typeof api.registerGatewayMethod !== "function") return false;
  api.registerGatewayMethod(SUSTAINED_RUNTIME_PREFLIGHT_METHOD, async ({ respond }) => {
    try {
      const openclawConfig = typeof api.runtime?.config?.current === "function"
        ? api.runtime.config.current()
        : api.config;
      const configPath = nonEmptyString(openclawConfigPath);
      const configBytes = configPath ? readFileSync(configPath) : null;
      const report = buildSustainedRuntimePreflightReport({
        openclawConfig,
        openclawRuntimeVersion: api.runtime?.version,
        openclawConfigFilePath: configPath,
        openclawConfigFileBytes: configBytes,
        effectiveRuntimeConfig,
        effectiveRuntimeConfigValid,
        effectiveRuntimeConfigErrors,
        productionEvidenceIdentityContext,
        checkedAt: new Date().toISOString(),
      });
      respond(true, report);
    } catch (error) {
      respond(false, undefined, {
        code: "SUSTAINED_RUNTIME_PREFLIGHT_FAILED",
        message: String(error?.message || error || "sustained runtime preflight failed"),
      });
    }
  }, { scope: "operator.read" });
  return true;
}

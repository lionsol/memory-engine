import { createHash } from "node:crypto";

import {
  explainProjectionArtifactValidation,
  PROJECTION_ARTIFACT_SCHEMA_VERSION,
  PROJECTION_KINDS,
} from "../../canonical/projection-artifact.js";
import { computeDisclosureCardBaselineProjectionHash } from "./redaction-evidence-contract.js";

export const DISCLOSURE_ATTESTATION_SCHEMA_VERSION = 1;
export const DISCLOSURE_ATTESTATION_AUTHORITY_KIND = "OWNER_EXPLICIT_ATTESTATION";
export const DISCLOSURE_ATTESTATION_AUDIENCE_SCOPE = "OWNER_SELF";
export const DISCLOSURE_ATTESTATION_SURFACE = "DISCLOSURE_CARD";
export const DISCLOSURE_ATTESTATION_PROJECTION_SCHEMA_VERSION = PROJECTION_ARTIFACT_SCHEMA_VERSION;
export const DISCLOSURE_ATTESTATION_PROJECTION_KIND = PROJECTION_KINDS.DISCLOSURE_CARD;
export const DISCLOSURE_ATTESTATION_PROJECTION_ADAPTER_VERSION = "owner_attestable_canonical_card_v1";
export const DISCLOSURE_ATTESTATION_POLICY_VERSION = "direct_card_owner_attestation_v1";
export const DISCLOSURE_ATTESTATION_STATUS_LIMIT = 8;

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const ATTESTATION_ID = /^datt_[0-9a-f]{64}$/u;
const ATTESTATION_BINDING_FIELDS = Object.freeze([
  "memory_id",
  "canonical_id",
  "source_content_hash",
  "surface",
  "projection_schema_version",
  "projection_kind",
  "projection_hash",
  "projection_adapter_version",
  "authority_kind",
  "audience_scope",
  "attestation_schema_version",
  "policy_version",
]);
const ATTESTATION_ROW_FIELDS = new Set([
  "attestation_id",
  ...ATTESTATION_BINDING_FIELDS,
  "state",
  "asserted_at",
  "revoked_at",
  "created_at",
  "updated_at",
]);

const ATTESTATION_SELECT_FIELDS = [
  "attestation_id",
  "memory_id",
  "canonical_id",
  "source_content_hash",
  "surface",
  "projection_schema_version",
  "projection_kind",
  "projection_hash",
  "projection_adapter_version",
  "authority_kind",
  "audience_scope",
  "attestation_schema_version",
  "policy_version",
  "state",
  "asserted_at",
  "revoked_at",
  "created_at",
  "updated_at",
].join(", ");

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactFields(value, fields) {
  return isRecord(value) &&
    Object.keys(value).length === fields.size &&
    Object.keys(value).every(field => fields.has(field));
}

function hasRequiredFields(value, fields) {
  return isRecord(value) && fields.every(field => Object.hasOwn(value, field));
}

function nonEmptyBoundedString(value, max = 256) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value &&
    !/\s/u.test(value);
}

function validTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function invalid(reason) {
  return { valid: false, reason };
}

function valid() {
  return { valid: true, reason: "valid" };
}

function validationError(reason) {
  const error = new TypeError(`invalid disclosure attestation: ${reason}`);
  error.reason = reason;
  return error;
}

function bindingMaterial(binding) {
  return Object.fromEntries(ATTESTATION_BINDING_FIELDS.map(field => [field, binding[field]]));
}

export function computeDisclosureAttestationId(binding) {
  if (!hasRequiredFields(binding, ATTESTATION_BINDING_FIELDS)) {
    throw validationError("invalid_attestation_binding");
  }
  return `datt_${createHash("sha256")
    .update(JSON.stringify(bindingMaterial(binding)), "utf8")
    .digest("hex")}`;
}

export function deriveDisclosureAttestationBinding(canonicalMemory, projectionArtifact) {
  const projectionValidation = explainProjectionArtifactValidation(
    projectionArtifact,
    canonicalMemory,
  );
  if (!projectionValidation.valid) return invalid(projectionValidation.reason);
  if (projectionArtifact.surface !== DISCLOSURE_ATTESTATION_SURFACE) {
    return invalid("surface_mismatch");
  }
  if (!isRecord(projectionArtifact.provenance) ||
      projectionArtifact.provenance.adapter !== DISCLOSURE_ATTESTATION_PROJECTION_ADAPTER_VERSION) {
    return invalid("projection_adapter_mismatch");
  }

  let projectionHash;
  try {
    projectionHash = computeDisclosureCardBaselineProjectionHash(
      projectionArtifact,
      canonicalMemory,
    );
  } catch (error) {
    return invalid(error?.reason || "projection_hash_unavailable");
  }

  const binding = {
    memory_id: canonicalMemory.memory_id,
    canonical_id: canonicalMemory.canonical_id,
    source_content_hash: canonicalMemory.content_ref?.content_hash,
    surface: projectionArtifact.surface,
    projection_schema_version: projectionArtifact.projection_schema_version,
    projection_kind: projectionArtifact.projection_kind,
    projection_hash: projectionHash,
    projection_adapter_version: projectionArtifact.provenance.adapter,
    authority_kind: DISCLOSURE_ATTESTATION_AUTHORITY_KIND,
    audience_scope: DISCLOSURE_ATTESTATION_AUDIENCE_SCOPE,
    attestation_schema_version: DISCLOSURE_ATTESTATION_SCHEMA_VERSION,
    policy_version: DISCLOSURE_ATTESTATION_POLICY_VERSION,
  };

  try {
    return {
      valid: true,
      reason: "valid",
      binding: {
        ...binding,
        attestation_id: computeDisclosureAttestationId(binding),
      },
    };
  } catch (error) {
    return invalid(error?.reason || "invalid_attestation_binding");
  }
}

function validateBindingFields(record) {
  if (!nonEmptyBoundedString(record.memory_id)) return invalid("invalid_memory_id");
  if (!nonEmptyBoundedString(record.canonical_id)) return invalid("invalid_canonical_id");
  if (!nonEmptyBoundedString(record.source_content_hash, 128)) return invalid("invalid_source_content_hash");
  if (record.surface !== DISCLOSURE_ATTESTATION_SURFACE) return invalid("surface_mismatch");
  if (record.projection_schema_version !== DISCLOSURE_ATTESTATION_PROJECTION_SCHEMA_VERSION) {
    return invalid("projection_schema_mismatch");
  }
  if (record.projection_kind !== DISCLOSURE_ATTESTATION_PROJECTION_KIND) {
    return invalid("projection_kind_mismatch");
  }
  if (!SHA256_HEX.test(record.projection_hash)) return invalid("projection_hash_mismatch");
  if (record.projection_adapter_version !== DISCLOSURE_ATTESTATION_PROJECTION_ADAPTER_VERSION) {
    return invalid("projection_adapter_mismatch");
  }
  if (record.authority_kind !== DISCLOSURE_ATTESTATION_AUTHORITY_KIND) {
    return invalid("authority_kind_mismatch");
  }
  if (record.audience_scope !== DISCLOSURE_ATTESTATION_AUDIENCE_SCOPE) {
    return invalid("audience_scope_mismatch");
  }
  if (record.attestation_schema_version !== DISCLOSURE_ATTESTATION_SCHEMA_VERSION) {
    return invalid("attestation_schema_mismatch");
  }
  if (!nonEmptyBoundedString(record.policy_version, 128) ||
      record.policy_version !== DISCLOSURE_ATTESTATION_POLICY_VERSION) {
    return invalid("policy_version_mismatch");
  }
  return valid();
}

export function validateDisclosureAttestationRecord(
  record,
  expectedBinding = null,
  { activeOnly = false } = {},
) {
  if (!hasExactFields(record, ATTESTATION_ROW_FIELDS)) {
    return invalid("malformed_attestation");
  }
  if (!ATTESTATION_ID.test(record.attestation_id)) return invalid("malformed_attestation_id");

  const bindingValidation = validateBindingFields(record);
  if (!bindingValidation.valid) return bindingValidation;

  if (record.state !== "active" && record.state !== "revoked") {
    return invalid("invalid_attestation_state");
  }
  if (!validTimestamp(record.asserted_at) ||
      !validTimestamp(record.created_at) ||
      !validTimestamp(record.updated_at)) {
    return invalid("invalid_attestation_timestamp");
  }
  if (record.state === "active" && record.revoked_at !== null) {
    return invalid("invalid_active_attestation_state");
  }
  if (record.state === "revoked" && !validTimestamp(record.revoked_at)) {
    return invalid("invalid_revoked_attestation_state");
  }
  if (record.updated_at < record.created_at) return invalid("invalid_attestation_timestamp");

  let expectedId;
  try {
    expectedId = computeDisclosureAttestationId(record);
  } catch {
    return invalid("malformed_attestation");
  }
  if (record.attestation_id !== expectedId) return invalid("attestation_id_mismatch");

  if (expectedBinding) {
    for (const field of ATTESTATION_BINDING_FIELDS) {
      if (record[field] !== expectedBinding[field]) return invalid(`${field}_mismatch`);
    }
    if (record.attestation_id !== expectedBinding.attestation_id) {
      return invalid("attestation_id_mismatch");
    }
  }
  if (activeOnly && record.state !== "active") return invalid("attestation_not_active");
  return valid();
}

export function assertValidDisclosureAttestationRecord(record, expectedBinding = null, options = {}) {
  const validation = validateDisclosureAttestationRecord(record, expectedBinding, options);
  if (!validation.valid) throw validationError(validation.reason);
  return record;
}

function assertDb(db) {
  if (!db || typeof db.prepare !== "function") throw validationError("attestation_store_unavailable");
  return db;
}

function validAttestationId(attestationId) {
  return typeof attestationId === "string" && ATTESTATION_ID.test(attestationId);
}

export function getDisclosureAttestationById(db, attestationId) {
  if (!validAttestationId(attestationId)) return null;
  assertDb(db);
  return db.prepare(`SELECT ${ATTESTATION_SELECT_FIELDS} FROM disclosure_attestations WHERE attestation_id = ?`).get(attestationId) || null;
}

export function getDisclosureAttestationsByMemoryId(db, memoryId, limit = DISCLOSURE_ATTESTATION_STATUS_LIMIT) {
  if (!nonEmptyBoundedString(memoryId)) return { rows: [], truncated: false };
  assertDb(db);
  const boundedLimit = Number.isSafeInteger(limit) && limit > 0 && limit <= 32 ? limit : DISCLOSURE_ATTESTATION_STATUS_LIMIT;
  const rows = db.prepare(`
    SELECT ${ATTESTATION_SELECT_FIELDS}
    FROM disclosure_attestations
    WHERE memory_id = ?
    ORDER BY updated_at DESC, attestation_id ASC
    LIMIT ?
  `).all(memoryId, boundedLimit + 1);
  return {
    rows: rows.slice(0, boundedLimit),
    truncated: rows.length > boundedLimit,
  };
}

function validNow(now) {
  if (!validTimestamp(now)) throw validationError("invalid_attestation_timestamp");
  return now;
}

export function assertDisclosureAttestation(db, binding, { now = Date.now() } = {}) {
  assertDb(db);
  const assertedAt = validNow(now);
  const candidate = {
    ...binding,
    state: "active",
    asserted_at: assertedAt,
    revoked_at: null,
    created_at: assertedAt,
    updated_at: assertedAt,
  };
  assertValidDisclosureAttestationRecord(candidate, binding);

  const existing = getDisclosureAttestationById(db, binding.attestation_id);
  if (existing) {
    assertValidDisclosureAttestationRecord(existing, binding);
    if (existing.state === "active") return { ok: true, changed: false, attestation: existing };
    db.prepare(`
      UPDATE disclosure_attestations
      SET state = 'active', asserted_at = ?, revoked_at = NULL, updated_at = ?
      WHERE attestation_id = ?
    `).run(assertedAt, assertedAt, binding.attestation_id);
    return {
      ok: true,
      changed: true,
      attestation: getDisclosureAttestationById(db, binding.attestation_id),
    };
  }

  db.prepare(`
    INSERT INTO disclosure_attestations (
      attestation_id,
      memory_id,
      canonical_id,
      source_content_hash,
      surface,
      projection_schema_version,
      projection_kind,
      projection_hash,
      projection_adapter_version,
      authority_kind,
      audience_scope,
      attestation_schema_version,
      policy_version,
      state,
      asserted_at,
      revoked_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    candidate.attestation_id,
    candidate.memory_id,
    candidate.canonical_id,
    candidate.source_content_hash,
    candidate.surface,
    candidate.projection_schema_version,
    candidate.projection_kind,
    candidate.projection_hash,
    candidate.projection_adapter_version,
    candidate.authority_kind,
    candidate.audience_scope,
    candidate.attestation_schema_version,
    candidate.policy_version,
    candidate.state,
    candidate.asserted_at,
    candidate.revoked_at,
    candidate.created_at,
    candidate.updated_at,
  );
  return {
    ok: true,
    changed: true,
    attestation: getDisclosureAttestationById(db, binding.attestation_id),
  };
}

export function revokeDisclosureAttestation(db, attestationId, { now = Date.now() } = {}) {
  assertDb(db);
  if (!validAttestationId(attestationId)) return { ok: false, changed: false, reason: "invalid_attestation_id" };
  const revokedAt = validNow(now);
  const existing = getDisclosureAttestationById(db, attestationId);
  if (!existing) return { ok: false, changed: false, reason: "attestation_not_found" };
  assertValidDisclosureAttestationRecord(existing);
  if (existing.state === "revoked") return { ok: true, changed: false, attestation: existing };

  db.prepare(`
    UPDATE disclosure_attestations
    SET state = 'revoked', revoked_at = ?, updated_at = ?
    WHERE attestation_id = ?
  `).run(revokedAt, revokedAt, attestationId);
  return {
    ok: true,
    changed: true,
    attestation: getDisclosureAttestationById(db, attestationId),
  };
}

function authorityEvidence(binding) {
  return {
    memory_id: binding.memory_id,
    canonical_id: binding.canonical_id,
    source_content_hash: binding.source_content_hash,
    surface: binding.surface,
    projection_schema_version: binding.projection_schema_version,
    projection_kind: binding.projection_kind,
    projection_hash: binding.projection_hash,
    projection_adapter_version: binding.projection_adapter_version,
    authority_kind: binding.authority_kind,
    audience_scope: binding.audience_scope,
    attestation_schema_version: binding.attestation_schema_version,
    policy_version: binding.policy_version,
    attestation_id: binding.attestation_id,
  };
}

function failedAuthority(reason) {
  return {
    safe_to_disclose: false,
    reason,
  };
}

export function createDisclosureAttestationAuthorityProvider({ withEngineDbReadonly } = {}) {
  return {
    getSafeToDiscloseEvidence({ canonicalMemory, projectionArtifact } = {}) {
      let expected;
      try {
        expected = deriveDisclosureAttestationBinding(canonicalMemory, projectionArtifact);
      } catch {
        return failedAuthority("invalid_projection_artifact");
      }
      if (!expected.valid) return failedAuthority(expected.reason);
      if (typeof withEngineDbReadonly !== "function") return failedAuthority("attestation_store_unavailable");

      let stored;
      try {
        stored = withEngineDbReadonly(db => getDisclosureAttestationById(
          db,
          expected.binding.attestation_id,
        ));
      } catch {
        return failedAuthority("attestation_store_unavailable");
      }
      if (!stored) return failedAuthority("attestation_missing");

      const validation = validateDisclosureAttestationRecord(
        stored,
        expected.binding,
        { activeOnly: true },
      );
      if (!validation.valid) return failedAuthority(validation.reason);
      return {
        safe_to_disclose: true,
        authority: authorityEvidence(expected.binding),
      };
    },
  };
}

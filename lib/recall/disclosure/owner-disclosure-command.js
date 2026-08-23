import { getCanonicalMemoryById } from "../../canonical/read-adapter.js";
import {
  assertDisclosureAttestation,
  getDisclosureAttestationsByMemoryId,
  revokeDisclosureAttestation,
  validateDisclosureAttestationRecord,
} from "./owner-attestation.js";
import { buildOwnerDisclosurePreview } from "./owner-attestable-projection.js";

const HASH = /^[0-9a-f]{64}$/u;
const ATTESTATION_ID = /^datt_[0-9a-f]{64}$/u;
const MAX_MEMORY_ID_LENGTH = 256;

function reply(value) {
  return { text: JSON.stringify(value) };
}

function failure(reason) {
  return reply({ ok: false, reason });
}

function validExactMemoryId(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_MEMORY_ID_LENGTH &&
    value.trim() === value &&
    !/\s/u.test(value) &&
    !/[?*]/u.test(value) &&
    value.toLowerCase() !== "all";
}

function parseArgs(args) {
  const tokens = String(args || "").trim().split(/\s+/u).filter(Boolean);
  const operation = tokens[0] || "";
  if (!["preview", "assert", "status", "revoke"].includes(operation)) {
    return { ok: false, reason: "invalid_operation" };
  }

  const expectedCount = operation === "assert" ? 3 : 2;
  if (tokens.length !== expectedCount) return { ok: false, reason: "invalid_arguments" };
  if (operation === "revoke") {
    if (!ATTESTATION_ID.test(tokens[1])) return { ok: false, reason: "invalid_attestation_id" };
    return { ok: true, operation, attestation_id: tokens[1] };
  }
  if (!validExactMemoryId(tokens[1])) return { ok: false, reason: "invalid_memory_id" };
  if (operation === "assert" && !HASH.test(tokens[2])) {
    return { ok: false, reason: "invalid_projection_hash" };
  }
  return {
    ok: true,
    operation,
    memory_id: tokens[1],
    ...(operation === "assert" ? { projection_hash: tokens[2] } : {}),
  };
}

function boundedBinding(preview) {
  return {
    memory_id: preview.binding.memory_id,
    canonical_id: preview.binding.canonical_id,
    source_content_hash: preview.binding.source_content_hash,
    surface: preview.binding.surface,
    projection_schema_version: preview.binding.projection_schema_version,
    projection_kind: preview.binding.projection_kind,
    projection_hash: preview.binding.projection_hash,
    projection_adapter_version: preview.binding.projection_adapter_version,
    authority_kind: preview.binding.authority_kind,
    audience_scope: preview.binding.audience_scope,
    attestation_schema_version: preview.binding.attestation_schema_version,
    policy_version: preview.binding.policy_version,
    attestation_id: preview.binding.attestation_id,
  };
}

function boundedPreview(preview) {
  return {
    ...boundedBinding(preview),
    payload: preview.artifact.payload,
  };
}

function boundedStatus(row) {
  return {
    attestation_id: row.attestation_id,
    memory_id: row.memory_id,
    canonical_id: row.canonical_id,
    source_content_hash: row.source_content_hash,
    surface: row.surface,
    projection_schema_version: row.projection_schema_version,
    projection_kind: row.projection_kind,
    projection_hash: row.projection_hash,
    projection_adapter_version: row.projection_adapter_version,
    authority_kind: row.authority_kind,
    audience_scope: row.audience_scope,
    attestation_schema_version: row.attestation_schema_version,
    policy_version: row.policy_version,
    state: row.state,
    asserted_at: row.asserted_at,
    revoked_at: row.revoked_at,
  };
}

export function createOwnerDisclosureCommandHandler({
  getCanonicalMemoryById: getCanonical = getCanonicalMemoryById,
  withCoreDb,
  withEngineDbReadonly,
  withEngineDbWritable,
  now = () => Date.now(),
} = {}) {
  function readCanonical(memoryId) {
    try {
      const result = getCanonical(memoryId, {
        withCoreDb,
        withEngineDb: withEngineDbReadonly,
      });
      if (!result?.ok || !result.memory) return { ok: false, reason: "canonical_not_available" };
      return result;
    } catch {
      return { ok: false, reason: "canonical_not_available" };
    }
  }

  function currentPreview(memoryId) {
    const canonical = readCanonical(memoryId);
    if (!canonical.ok) return canonical;
    try {
      return { ok: true, preview: buildOwnerDisclosurePreview(canonical.memory) };
    } catch {
      return { ok: false, reason: "projection_invalid" };
    }
  }

  return async function handleOwnerDisclosureCommand(ctx = {}) {
    if (ctx.isAuthorizedSender !== true || ctx.senderIsOwner !== true) {
      return failure("owner_authorization_required");
    }

    const parsed = parseArgs(ctx.args);
    if (!parsed.ok) return failure(parsed.reason);

    if (parsed.operation === "preview") {
      const current = currentPreview(parsed.memory_id);
      if (!current.ok) return failure(current.reason);
      return reply({ ok: true, operation: "preview", preview: boundedPreview(current.preview) });
    }

    if (parsed.operation === "assert") {
      const current = currentPreview(parsed.memory_id);
      if (!current.ok) return failure(current.reason);
      if (current.preview.projection_hash !== parsed.projection_hash) {
        return failure("projection_hash_mismatch");
      }
      if (typeof withEngineDbWritable !== "function") return failure("attestation_store_unavailable");
      try {
        const result = withEngineDbWritable(db => assertDisclosureAttestation(
          db,
          current.preview.binding,
          { now: now() },
        ));
        if (!result?.ok || !result.attestation) return failure("attestation_store_unavailable");
        return reply({
          ok: true,
          operation: "assert",
          changed: result.changed === true,
          attestation: boundedStatus(result.attestation),
        });
      } catch {
        return failure("attestation_store_unavailable");
      }
    }

    if (parsed.operation === "status") {
      if (typeof withEngineDbReadonly !== "function") return failure("attestation_store_unavailable");
      try {
        const result = withEngineDbReadonly(db => getDisclosureAttestationsByMemoryId(db, parsed.memory_id));
        for (const row of result.rows) {
          const validation = validateDisclosureAttestationRecord(row);
          if (!validation.valid) return failure(validation.reason);
        }
        return reply({
          ok: true,
          operation: "status",
          memory_id: parsed.memory_id,
          truncated: result.truncated,
          attestations: result.rows.map(boundedStatus),
        });
      } catch {
        return failure("attestation_store_unavailable");
      }
    }

    if (typeof withEngineDbWritable !== "function") return failure("attestation_store_unavailable");
    try {
      const result = withEngineDbWritable(db => revokeDisclosureAttestation(
        db,
        parsed.attestation_id,
        { now: now() },
      ));
      if (!result?.ok) return failure(result?.reason || "attestation_store_unavailable");
      return reply({
        ok: true,
        operation: "revoke",
        changed: result.changed === true,
        attestation: boundedStatus(result.attestation),
      });
    } catch {
      return failure("attestation_store_unavailable");
    }
  };
}

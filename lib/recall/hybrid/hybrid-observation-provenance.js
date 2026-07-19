export const PRODUCTION_HYBRID_OBSERVATION_SURFACES = Object.freeze([
  "auto_recall",
  "memory_engine_action_search",
  "memory_engine_search",
]);

const PRODUCTION_SURFACE_SET = new Set(PRODUCTION_HYBRID_OBSERVATION_SURFACES);
const AUTO_RECALL_SURFACE = "auto_recall";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function canonicalIsoTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;
  try {
    return new Date(timestamp).toISOString() === raw ? raw : null;
  } catch {
    return null;
  }
}

export function parseHybridObservationMetadata(row) {
  if (!isObject(row)) return null;
  if (isObject(row.metadata_json)) return row.metadata_json;
  if (typeof row.metadata_json !== "string") return null;
  try {
    const parsed = JSON.parse(row.metadata_json);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function validateProductionHybridObservationProvenance(row) {
  const reasons = [];
  const metadata = parseHybridObservationMetadata(row);
  const surface = nonEmptyString(metadata?.surface) || "unknown";
  const rowId = row?.id ?? null;

  if (!isObject(row)) reasons.push("invalid_row");
  if (row?.event_type !== "hybrid_search_observation") reasons.push("invalid_event_type");
  if (!metadata) reasons.push("invalid_metadata_json");
  if (!PRODUCTION_SURFACE_SET.has(surface)) reasons.push("unknown_production_surface");

  if (metadata) {
    const expectedSource = PRODUCTION_SURFACE_SET.has(surface) ? `hybrid.${surface}` : null;
    if (!expectedSource || row?.source !== expectedSource) reasons.push("source_mismatch");
    if (metadata.schema_version === undefined || metadata.schema_version === null) {
      reasons.push("missing_schema_version");
    } else if (metadata.schema_version !== 1) {
      reasons.push("unsupported_schema_version");
    }
    if (metadata.search_executed !== true) reasons.push("search_not_executed");
    if (!canonicalIsoTimestamp(metadata.completed_at)) reasons.push("invalid_completed_at");
    if (!nonEmptyString(row?.trace_id)) reasons.push("missing_trace_id");
    if (surface === AUTO_RECALL_SURFACE && !nonEmptyString(row?.session_id)) {
      reasons.push("missing_auto_recall_session_id");
    }
  }

  return {
    valid: reasons.length === 0,
    row_id: rowId,
    surface,
    metadata,
    expected_source: PRODUCTION_SURFACE_SET.has(surface) ? `hybrid.${surface}` : null,
    reasons: [...new Set(reasons)],
  };
}

function sortedCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => (right[1] - left[1]) || left[0].localeCompare(right[0])),
  );
}

export function summarizeProductionHybridObservationProvenance(rows = []) {
  const valid = [];
  const invalid = [];
  const invalidReasonCounts = {};

  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.event_type !== "hybrid_search_observation") continue;
    const result = validateProductionHybridObservationProvenance(row);
    if (result.valid) {
      valid.push({ row, metadata: result.metadata, provenance: result });
      continue;
    }
    invalid.push({ row, metadata: result.metadata, provenance: result });
    for (const reason of result.reasons) {
      invalidReasonCounts[reason] = (invalidReasonCounts[reason] || 0) + 1;
    }
  }

  return {
    valid,
    invalid,
    valid_count: valid.length,
    invalid_count: invalid.length,
    invalid_observation_ids: invalid
      .map(item => item.provenance.row_id)
      .filter(id => id !== null && id !== undefined),
    invalid_reason_distribution: sortedCounts(invalidReasonCounts),
  };
}

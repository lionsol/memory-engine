import {
  PRODUCTION_HYBRID_OBSERVATION_SURFACES,
  canonicalIsoTimestamp,
  parseHybridObservationMetadata,
  validateProductionHybridObservationProvenance,
} from "./hybrid-observation-provenance.js";
import {
  baselineEvidenceStart,
  validateBaseline,
} from "./production-evidence-health-monitor.js";

function rowIdentity(row) {
  return {
    id: row?.id ?? null,
    trace_id: typeof row?.trace_id === "string" ? row.trace_id : null,
  };
}

function addReason(distribution, reason) {
  distribution[reason] = (distribution[reason] || 0) + 1;
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

export function projectProductionEvidenceEpoch({
  observations = [],
  baseline,
  asOf = new Date().toISOString(),
} = {}) {
  const baselineValidation = validateBaseline(baseline);
  const asOfIso = canonicalIsoTimestamp(asOf);
  if (!baselineValidation.valid) {
    return {
      selectedRows: [],
      report: {
        schema_version: 1,
        status: "blocked",
        as_of: asOfIso,
        evidence_epoch_id: null,
        raw_observation_count: Array.isArray(observations) ? observations.length : 0,
        selected_observation_count: 0,
        blocking_rejection_count: 1,
        excluded_non_production_count: 0,
        rejection_reason_distribution: { invalid_baseline: 1 },
        rejections: [{ id: null, trace_id: null, reasons: baselineValidation.errors.map(error => error.code) }],
      },
    };
  }
  if (!asOfIso) throw new TypeError("asOf must be a canonical UTC ISO timestamp");
  const evidenceStartedAt = baselineEvidenceStart(baseline);
  const evidenceStartedAtMs = Date.parse(evidenceStartedAt);
  const asOfMs = Date.parse(asOfIso);
  if (evidenceStartedAtMs > asOfMs) throw new TypeError("baseline evidence start must not be after asOf");

  const selectedRows = [];
  const rejections = [];
  const reasonDistribution = {};
  let excludedNonProductionCount = 0;
  for (const row of Array.isArray(observations) ? observations : []) {
    if (row?.event_type !== "hybrid_search_observation") {
      excludedNonProductionCount += 1;
      continue;
    }
    const metadata = parseHybridObservationMetadata(row);
    const surface = typeof metadata?.surface === "string" ? metadata.surface.trim() : "unknown";
    if (surface === "cli_search") {
      excludedNonProductionCount += 1;
      continue;
    }
    const reasons = [];
    const provenance = validateProductionHybridObservationProvenance(row);
    if (!provenance.valid) reasons.push(...provenance.reasons.map(reason => `invalid_provenance:${reason}`));
    if (!PRODUCTION_HYBRID_OBSERVATION_SURFACES.includes(surface)) reasons.push(`unknown_surface:${surface}`);
    if (metadata?.production_evidence_enabled !== true) reasons.push("production_evidence_not_enabled");
    if (metadata?.evidence_epoch_id !== baseline.evidence_epoch_id) reasons.push("evidence_epoch_mismatch");
    if (metadata?.runtime_build_identity !== baseline.runtime_build_identity) reasons.push("runtime_build_identity_mismatch");
    if (metadata?.rollout_config_fingerprint !== baseline.rollout_config_fingerprint) reasons.push("rollout_config_fingerprint_mismatch");
    const completedAt = canonicalIsoTimestamp(metadata?.completed_at);
    if (!completedAt) reasons.push("invalid_completed_at");
    else {
      const timestamp = Date.parse(completedAt);
      if (timestamp < evidenceStartedAtMs) reasons.push("observation_before_evidence_start");
      if (timestamp > asOfMs) reasons.push("observation_after_as_of");
    }

    const uniqueReasons = [...new Set(reasons)];
    if (uniqueReasons.length === 0) selectedRows.push(row);
    else {
      for (const reason of uniqueReasons) addReason(reasonDistribution, reason);
      rejections.push({ ...rowIdentity(row), reasons: uniqueReasons });
    }
  }

  const blockingRejectionCount = rejections.length;
  const status = blockingRejectionCount > 0
    ? "blocked"
    : selectedRows.length > 0
      ? "ready"
      : "insufficient_evidence";
  return {
    selectedRows,
    report: {
      schema_version: 1,
      status,
      as_of: asOfIso,
      authorized_at: baseline.authorized_at,
      activated_at: baseline.activated_at ?? null,
      evidence_started_at: evidenceStartedAt,
      evidence_epoch_id: baseline.evidence_epoch_id,
      runtime_build_identity: baseline.runtime_build_identity,
      rollout_config_fingerprint: baseline.rollout_config_fingerprint,
      raw_observation_count: Array.isArray(observations) ? observations.length : 0,
      selected_observation_count: selectedRows.length,
      blocking_rejection_count: blockingRejectionCount,
      excluded_non_production_count: excludedNonProductionCount,
      rejection_reason_distribution: sortedObject(reasonDistribution),
      rejections,
    },
  };
}

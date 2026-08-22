import {
  explainProjectionArtifactValidation,
  projectCanonicalMemoryToDisclosureCardArtifact,
} from "../../canonical/projection-artifact.js";
import { explainShadowCapability } from "./disclosure-capability-shadow-evaluator.js";
import {
  PROJECTION_AWARE_HOLDOUT_FAMILIES,
  validateProjectionAwareHoldoutFixture,
  validateProjectionAwareHoldoutRow,
  normalizeProjectionLiteral,
} from "./projection-aware-holdout.js";

const DISCLOSURE_CARD_SURFACE = "DISCLOSURE_CARD";
const CURRENT_CAPABILITY_STATES = new Set([
  "RETRIEVAL_ONLY",
  "INTERNAL_CONTEXT",
  "CARD_DISCLOSABLE",
]);
const SIDE_EFFECTS = Object.freeze({
  retrieval: false,
  db_writes: false,
  data_mutation: false,
  selector: false,
  network: false,
  llm: false,
  runtime: false,
});
const CARD_PAYLOAD_FIELDS = [
  "schema_version",
  "card_id",
  "title",
  "summary",
  "salience_reason",
  "source_hint",
  "category",
  "kind",
  "confidence_score",
  "risk_flags",
];

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function ratio(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(4));
}

function sideEffects() {
  return { ...SIDE_EFFECTS };
}

function boundedReason(value, fallback) {
  if (typeof value === "string" && /^[a-z0-9_:-]+$/u.test(value)) return value;
  return fallback;
}

function invalidHoldoutError(diagnostics = []) {
  const error = new TypeError("projection-aware case must pass the frozen holdout row contract");
  error.code = "invalid_projection_aware_holdout_row";
  error.diagnostics = diagnostics.slice(0, 32).map(item => ({
    code: boundedReason(item?.code, "invalid_row"),
    path: typeof item?.path === "string" ? item.path.slice(0, 240) : "row",
  }));
  return error;
}

function assertValidHoldoutRow(row) {
  let validation;
  try {
    validation = validateProjectionAwareHoldoutRow(row);
  } catch {
    throw invalidHoldoutError();
  }
  if (!validation.valid) throw invalidHoldoutError(validation.diagnostics);
  return row;
}

function collectPayloadStrings(value, strings = []) {
  if (typeof value === "string") {
    strings.push(value);
    return strings;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectPayloadStrings(item, strings));
    return strings;
  }
  if (isRecord(value)) {
    Object.keys(value).sort().forEach(key => collectPayloadStrings(value[key], strings));
  }
  return strings;
}

function normalizedPayloadText(payload) {
  return normalizeProjectionLiteral(collectPayloadStrings(payload).join("\n"));
}

function literalsPresent(payload, literals) {
  const normalizedPayload = normalizedPayloadText(payload);
  return literals.filter(literal => normalizedPayload.includes(normalizeProjectionLiteral(literal)));
}

function boundedCardPayload(payload) {
  return Object.fromEntries(CARD_PAYLOAD_FIELDS.map(field => [
    field,
    field === "risk_flags" ? [...payload[field]] : payload[field],
  ]));
}

function projectionResult(row) {
  try {
    const artifact = projectCanonicalMemoryToDisclosureCardArtifact(
      row.canonical_memory,
      row.runtime_candidate,
    );
    const validation = explainProjectionArtifactValidation(artifact, row.canonical_memory);
    if (!validation.valid) {
      return {
        valid: false,
        reason: boundedReason(validation.reason, "invalid_projection_artifact"),
        payload: null,
      };
    }
    if (artifact.surface !== DISCLOSURE_CARD_SURFACE || row.projection_surface !== DISCLOSURE_CARD_SURFACE) {
      return {
        valid: false,
        reason: "projection_surface_mismatch",
        payload: null,
      };
    }
    return {
      valid: true,
      reason: "valid",
      payload: boundedCardPayload(artifact.payload),
    };
  } catch (error) {
    return {
      valid: false,
      reason: boundedReason(error?.reason, "projection_failed"),
      payload: null,
    };
  }
}

function capabilityContext(policyContext, projectionValid) {
  const lifecycleState = policyContext.lifecycle_state;
  return {
    lifecycle: {
      state: lifecycleState,
      archived: lifecycleState === "archived",
      quarantined: lifecycleState === "quarantined",
      deleted_shadow: lifecycleState === "deleted_shadow",
      stale_index_candidate: lifecycleState === "stale_index_candidate",
    },
    scope: {
      scope: policyContext.scope,
      agent_scope: policyContext.agent_scope,
    },
    risk_flags: [...policyContext.risk_flags],
    artifact_state: policyContext.artifact_state,
    projection_valid: projectionValid === true,
    safe_to_disclose: policyContext.current_safe_to_disclose,
  };
}

function capabilityResult(policyContext, projectionValid) {
  const explained = explainShadowCapability(capabilityContext(policyContext, projectionValid));
  const actualCapability = CURRENT_CAPABILITY_STATES.has(explained.capability)
    ? explained.capability
    : "RETRIEVAL_ONLY";
  const actualCapabilityReason = CURRENT_CAPABILITY_STATES.has(explained.capability)
    ? boundedReason(explained.reason, "invalid_capability_reason")
    : "invalid_capability_result";
  return {
    actualCapability,
    actualCapabilityReason,
    actualDisclosureAuthority: actualCapability === "CARD_DISCLOSABLE" ? "CARD" : "NONE",
  };
}

function caseResult(row, projection, capability) {
  const surfaceSafety = projection.valid
    ? literalsPresent(projection.payload, row.label.surface_safety.forbidden_literals)
    : null;
  const actualSurfaceSafe = projection.valid ? surfaceSafety.length === 0 : null;
  const semanticMissing = projection.valid && row.label.semantic_preservation.required === true
    ? row.label.semantic_preservation.required_literals.filter(literal => !literalsPresent(projection.payload, [literal]).includes(literal))
    : null;
  const actualSemanticPreserved = projection.valid && row.label.semantic_preservation.required === true
    ? semanticMissing.length === 0
    : null;
  const usefulProjection = row.label.answer_bearing === true &&
    projection.valid === true &&
    actualSurfaceSafe === true &&
    actualSemanticPreserved === true;
  const projectionFeasibleButCapabilityBlocked = usefulProjection && capability.actualCapability !== "CARD_DISCLOSABLE";

  return {
    case_id: row.case_id,
    family: row.family,
    projection_surface: row.projection_surface,
    answer_bearing: row.label.answer_bearing,
    expected_projection_valid: row.label.expected_projection_valid,
    projection_valid: projection.valid,
    projection_valid_matches_expected: projection.valid === row.label.expected_projection_valid,
    projection_validation_reason: projection.reason,
    projected_payload: projection.payload,
    forbidden_literals_present: surfaceSafety,
    actual_surface_safe: actualSurfaceSafe,
    required_literals_missing: semanticMissing,
    actual_semantic_preserved: actualSemanticPreserved,
    actual_capability: capability.actualCapability,
    actual_capability_reason: capability.actualCapabilityReason,
    actual_disclosure_authority: capability.actualDisclosureAuthority,
    capability_matches_expected: capability.actualCapability === row.label.current_v1_1.expected_capability,
    disclosure_authority_matches_expected: capability.actualDisclosureAuthority === row.label.current_v1_1.expected_disclosure_authority,
    useful_projection: usefulProjection,
    projection_feasible_but_capability_blocked: projectionFeasibleButCapabilityBlocked,
    side_effects: sideEffects(),
  };
}

function emptyFamilyBreakdown() {
  return Object.fromEntries(PROJECTION_AWARE_HOLDOUT_FAMILIES.map(family => [family, {
    cases: 0,
    answer_bearing: 0,
    projection_valid: 0,
    projection_valid_match: 0,
    surface_safe: 0,
    semantic_preserved: 0,
    useful_projection: 0,
    capability_blocked_useful: 0,
  }]));
}

function aggregateMetrics(results) {
  const metrics = {
    case_count: results.length,
    projection_valid_count: results.filter(result => result.projection_valid === true).length,
    projection_invalid_count: results.filter(result => result.projection_valid === false).length,
    projection_valid_match_count: results.filter(result => result.projection_valid_matches_expected === true).length,
    projection_valid_match_rate: ratio(
      results.filter(result => result.projection_valid_matches_expected === true).length,
      results.length,
    ),
    surface_safe_count: results.filter(result => result.actual_surface_safe === true).length,
    surface_unsafe_count: results.filter(result => result.actual_surface_safe === false).length,
    answer_bearing_total: results.filter(result => result.answer_bearing === true).length,
    answer_bearing_semantic_preserved: results.filter(result => result.actual_semantic_preserved === true).length,
    semantic_preservation_rate: null,
    useful_projection_count: results.filter(result => result.useful_projection === true).length,
    useful_projection_rate: null,
    card_authorized_useful_projection_count: results.filter(result => result.useful_projection === true && result.actual_capability === "CARD_DISCLOSABLE").length,
    projection_feasible_but_capability_blocked_count: results.filter(result => result.projection_feasible_but_capability_blocked === true).length,
    capability_match_count: results.filter(result => result.capability_matches_expected === true).length,
    capability_match_rate: ratio(results.filter(result => result.capability_matches_expected === true).length, results.length),
    disclosure_authority_match_count: results.filter(result => result.disclosure_authority_matches_expected === true).length,
    disclosure_authority_match_rate: ratio(results.filter(result => result.disclosure_authority_matches_expected === true).length, results.length),
    family_breakdown: emptyFamilyBreakdown(),
  };

  const answerBearingTotal = results.filter(result => result.answer_bearing === true).length;
  metrics.answer_bearing_total = answerBearingTotal;
  metrics.semantic_preservation_rate = ratio(metrics.answer_bearing_semantic_preserved, answerBearingTotal);
  metrics.useful_projection_rate = ratio(metrics.useful_projection_count, answerBearingTotal);

  results.forEach(result => {
    const family = metrics.family_breakdown[result.family];
    if (!family) return;
    family.cases += 1;
    if (result.answer_bearing === true) family.answer_bearing += 1;
    if (result.projection_valid === true) family.projection_valid += 1;
    if (result.projection_valid_matches_expected === true) family.projection_valid_match += 1;
    if (result.actual_surface_safe === true) family.surface_safe += 1;
    if (result.actual_semantic_preserved === true) family.semantic_preserved += 1;
    if (result.useful_projection === true) family.useful_projection += 1;
    if (result.projection_feasible_but_capability_blocked === true) family.capability_blocked_useful += 1;
  });
  return metrics;
}

function aggregateResult(results) {
  const metrics = aggregateMetrics(results);
  return {
    mode: "offline_projection_aware_evaluation_v1",
    runtime_authorized: false,
    results,
    ...metrics,
    metrics,
    side_effects: sideEffects(),
  };
}

/**
 * Evaluates one already-contract-valid synthetic projection case. The
 * projector is representation-only; capability is calculated afterward from
 * bounded policy context and actual projection validation.
 */
export function evaluateProjectionAwareCase(row) {
  const validRow = assertValidHoldoutRow(row);
  const projection = projectionResult(validRow);
  const capability = capabilityResult(validRow.policy_context, projection.valid);
  return caseResult(validRow, projection, capability);
}

/**
 * Evaluates caller-supplied in-memory cases without opening a fixture or
 * running retrieval. This is the unit/evidence composition API.
 */
export function evaluateProjectionAwareCases(rows = []) {
  if (!Array.isArray(rows)) throw new TypeError("projection-aware cases must be an array");
  return aggregateResult(rows.map(evaluateProjectionAwareCase));
}

/**
 * Evaluates only a caller-supplied row collection that passes the complete
 * frozen C.1 contract. This function never opens the frozen fixture itself.
 */
export function evaluateProjectionAwareFixture(rows = []) {
  let validation;
  try {
    validation = validateProjectionAwareHoldoutFixture(rows);
  } catch {
    throw invalidHoldoutError();
  }
  if (!validation.valid) throw invalidHoldoutError(validation.diagnostics);
  return evaluateProjectionAwareCases(rows);
}

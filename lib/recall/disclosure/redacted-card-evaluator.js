import {
  explainProjectionArtifactValidation,
  projectCanonicalMemoryToDisclosureCardArtifact,
} from "../../canonical/projection-artifact.js";
import { projectRedactedCardCandidate } from "./redacted-card-prototype.js";
import {
  REDACTED_CARD_HOLDOUT_FAMILIES,
  validateRedactedCardHoldoutFixture,
  validateRedactedCardHoldoutRow,
} from "./redacted-card-holdout.js";

const DISCLOSURE_CARD_SURFACE = "DISCLOSURE_CARD";
const PRESENTATION_FIELDS = Object.freeze([
  "title",
  "summary",
  "salience_reason",
  "source_hint",
]);
const PROTECTED_FIELDS = Object.freeze([
  "card_id",
  "category",
  "kind",
  "confidence_score",
  "risk_flags",
]);
const SIDE_EFFECTS = Object.freeze({
  retrieval: false,
  db_writes: false,
  data_mutation: false,
  selector: false,
  capability: false,
  network: false,
  llm: false,
  runtime: false,
});

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sideEffects() {
  return { ...SIDE_EFFECTS };
}

function ratio(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(4));
}

function boundedReason(value, fallback) {
  if (typeof value === "string" && /^[a-z0-9_:-]+$/u.test(value)) return value.slice(0, 96);
  return fallback;
}

function boundedDiagnostics(diagnostics = []) {
  return diagnostics.slice(0, 32).map(item => ({
    code: boundedReason(item?.code, "invalid_row"),
    path: typeof item?.path === "string" ? item.path.slice(0, 240) : "row",
  }));
}

function invalidRowError(diagnostics = []) {
  const error = new TypeError("redacted-card case must pass the frozen holdout row contract");
  error.code = "invalid_redacted_card_holdout_row";
  error.diagnostics = boundedDiagnostics(diagnostics);
  return error;
}

function invalidFixtureError(diagnostics = []) {
  const error = new TypeError("redacted-card fixture must pass the frozen holdout contract");
  error.code = "invalid_redacted_card_holdout_fixture";
  error.diagnostics = boundedDiagnostics(diagnostics);
  return error;
}

function assertValidRow(row) {
  let validation;
  try {
    validation = validateRedactedCardHoldoutRow(row);
  } catch {
    throw invalidRowError();
  }
  if (!validation.valid) throw invalidRowError(validation.diagnostics);
  return row;
}

function assertValidFixture(rows) {
  let validation;
  try {
    validation = validateRedactedCardHoldoutFixture(rows);
  } catch {
    throw invalidFixtureError();
  }
  if (!validation.valid) throw invalidFixtureError(validation.diagnostics);
  return rows;
}

function baselineProjection(row) {
  try {
    const artifact = projectCanonicalMemoryToDisclosureCardArtifact(
      row.canonical_memory,
      row.runtime_candidate,
    );
    const validation = explainProjectionArtifactValidation(artifact, row.canonical_memory);
    if (!validation.valid ||
        artifact.surface !== DISCLOSURE_CARD_SURFACE ||
        row.projection_surface !== DISCLOSURE_CARD_SURFACE) {
      return { valid: false, reason: "baseline_projection_failed", payload: null };
    }
    return { valid: true, reason: "valid", payload: artifact.payload };
  } catch {
    return { valid: false, reason: "baseline_projection_failed", payload: null };
  }
}

function runPrototype(row) {
  try {
    return projectRedactedCardCandidate(
      row.canonical_memory,
      row.runtime_candidate,
      row.redaction_plan,
    );
  } catch {
    return null;
  }
}

function boundedRedactionEvidence(prototypeResult, directiveCount) {
  const evidence = isRecord(prototypeResult?.redaction_evidence)
    ? prototypeResult.redaction_evidence
    : {};
  const fieldsChanged = Array.isArray(evidence.fields_changed)
    ? evidence.fields_changed.filter(field => PRESENTATION_FIELDS.includes(field))
    : [];
  const boundedCount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return {
    directive_count: boundedCount(evidence.directive_count) || directiveCount,
    applied_directive_count: boundedCount(evidence.applied_directive_count),
    occurrence_count: boundedCount(evidence.occurrence_count),
    fields_changed: [...new Set(fieldsChanged)],
  };
}

function presentationValues(payload) {
  return PRESENTATION_FIELDS.map(field => typeof payload?.[field] === "string" ? payload[field] : "");
}

function presentationContains(payload, literal) {
  return presentationValues(payload).some(value => value.includes(literal));
}

function literalsPresent(payload, literals) {
  return literals.filter(literal => presentationContains(payload, literal));
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
  }
  return false;
}

function protectedFieldMismatches(baselinePayload, candidatePayload) {
  return PROTECTED_FIELDS.filter(field => !deepEqual(baselinePayload[field], candidatePayload[field]));
}

function unplannedDriftFields(row, baselinePayload, candidatePayload) {
  const targetedFields = new Set(row.redaction_plan.directives.map(directive => directive.field));
  return PRESENTATION_FIELDS.filter(field => (
    !targetedFields.has(field) && baselinePayload[field] !== candidatePayload[field]
  ));
}

function transformReason(baseline, prototypeResult, transformSuccess) {
  if (transformSuccess) return "valid";
  if (!baseline.valid) return "baseline_projection_failed";
  return boundedReason(
    prototypeResult?.structural_compatibility?.reason,
    "candidate_projection_invalid",
  );
}

function evaluateCase(row) {
  const baseline = baselineProjection(row);
  const prototypeResult = runPrototype(row);
  const candidatePayload = prototypeResult?.candidate_payload;
  const prototypeStructuralValid = prototypeResult?.structural_compatibility?.valid === true;
  const transformSuccess = baseline.valid &&
    prototypeStructuralValid &&
    candidatePayload != null &&
    isRecord(candidatePayload);
  const structuralCompatibilityValid = transformSuccess;
  const transformFailureReason = transformReason(baseline, prototypeResult, transformSuccess);
  const actualSurfaceSafe = transformSuccess
    ? literalsPresent(candidatePayload, row.label.surface_safety.forbidden_literals).length === 0
    : null;
  const forbiddenLiteralsPresent = transformSuccess
    ? literalsPresent(candidatePayload, row.label.surface_safety.forbidden_literals)
    : null;
  const requiredLiteralsMissing = transformSuccess && row.label.answer_bearing === true
    ? row.label.semantic_preservation.required_literals.filter(literal => !presentationContains(candidatePayload, literal))
    : null;
  const actualSemanticPreserved = transformSuccess && row.label.answer_bearing === true
    ? requiredLiteralsMissing.length === 0
    : null;
  const protectedFieldMismatches = transformSuccess
    ? protectedFieldMismatchesForCase(baseline.payload, candidatePayload)
    : null;
  const protectedFieldsPreserved = transformSuccess
    ? protectedFieldMismatches.length === 0
    : null;
  const unplannedDrift = transformSuccess
    ? unplannedDriftFields(row, baseline.payload, candidatePayload)
    : null;
  const noUnplannedFieldDrift = transformSuccess
    ? unplannedDrift.length === 0
    : null;
  const usefulRedactedProjection = row.label.answer_bearing === true &&
    transformSuccess === true &&
    actualSurfaceSafe === true &&
    actualSemanticPreserved === true &&
    protectedFieldsPreserved === true &&
    noUnplannedFieldDrift === true;

  return {
    case_id: row.case_id,
    family: row.family,
    answer_bearing: row.label.answer_bearing,
    transform_success: transformSuccess,
    transform_reason: transformFailureReason,
    structural_compatibility_matches_expected: structuralCompatibilityValid === row.label.expected_structural_compatibility,
    forbidden_literals_present: forbiddenLiteralsPresent,
    actual_surface_safe: actualSurfaceSafe,
    required_literals_missing: requiredLiteralsMissing,
    actual_semantic_preserved: actualSemanticPreserved,
    protected_field_mismatches: protectedFieldMismatches,
    protected_fields_preserved: protectedFieldsPreserved,
    unplanned_drift_fields: unplannedDrift,
    no_unplanned_field_drift: noUnplannedFieldDrift,
    useful_redacted_projection: usefulRedactedProjection,
    redaction_evidence: boundedRedactionEvidence(
      prototypeResult,
      row.redaction_plan.directives.length,
    ),
    side_effects: sideEffects(),
  };
}

function protectedFieldMismatchesForCase(baselinePayload, candidatePayload) {
  return protectedFieldMismatches(baselinePayload, candidatePayload);
}

function emptyFamilyBreakdown() {
  return Object.fromEntries(REDACTED_CARD_HOLDOUT_FAMILIES.map(family => [family, {
    cases: 0,
    answer_bearing: 0,
    transform_success: 0,
    surface_safe: 0,
    semantic_preserved: 0,
    protected_fields_preserved: 0,
    no_unplanned_field_drift: 0,
    useful_redacted_projection: 0,
  }]));
}

function aggregateMetrics(results) {
  const answerBearingTotal = results.filter(result => result.answer_bearing === true).length;
  const semanticPreserved = results.filter(result => result.actual_semantic_preserved === true).length;
  const useful = results.filter(result => result.useful_redacted_projection === true).length;
  const structuralMatches = results.filter(result => result.structural_compatibility_matches_expected === true).length;
  const metrics = {
    case_count: results.length,
    transform_success_count: results.filter(result => result.transform_success === true).length,
    transform_failure_count: results.filter(result => result.transform_success === false).length,
    structural_compatibility_match_count: structuralMatches,
    structural_compatibility_match_rate: ratio(structuralMatches, results.length),
    surface_safe_count: results.filter(result => result.actual_surface_safe === true).length,
    surface_unsafe_count: results.filter(result => result.actual_surface_safe === false).length,
    answer_bearing_total: answerBearingTotal,
    answer_bearing_semantic_preserved: semanticPreserved,
    semantic_preservation_rate: ratio(semanticPreserved, answerBearingTotal),
    protected_fields_preserved_count: results.filter(result => result.protected_fields_preserved === true).length,
    no_unplanned_field_drift_count: results.filter(result => result.no_unplanned_field_drift === true).length,
    useful_redacted_projection_count: useful,
    useful_redacted_projection_rate: ratio(useful, answerBearingTotal),
    family_breakdown: emptyFamilyBreakdown(),
  };

  results.forEach(result => {
    const family = metrics.family_breakdown[result.family];
    if (!family) return;
    family.cases += 1;
    if (result.answer_bearing === true) family.answer_bearing += 1;
    if (result.transform_success === true) family.transform_success += 1;
    if (result.actual_surface_safe === true) family.surface_safe += 1;
    if (result.actual_semantic_preserved === true) family.semantic_preserved += 1;
    if (result.protected_fields_preserved === true) family.protected_fields_preserved += 1;
    if (result.no_unplanned_field_drift === true) family.no_unplanned_field_drift += 1;
    if (result.useful_redacted_projection === true) family.useful_redacted_projection += 1;
  });

  return metrics;
}

function aggregateResult(results) {
  const metrics = aggregateMetrics(results);
  return {
    mode: "offline_redacted_card_evaluation_v1",
    runtime_authorized: false,
    results,
    ...metrics,
    metrics,
    side_effects: sideEffects(),
  };
}

/**
 * Evaluates one caller-supplied row after validating the synthetic holdout
 * contract. The result contains representation evidence only.
 */
export function evaluateRedactedCardCase(row) {
  return evaluateCase(assertValidRow(row));
}

/**
 * Evaluates caller-supplied in-memory rows. It never opens a fixture and does
 * not require the complete 12-row family balance.
 */
export function evaluateRedactedCardCases(rows = []) {
  if (!Array.isArray(rows)) throw invalidFixtureError();
  return aggregateResult(rows.map(row => evaluateRedactedCardCase(row)));
}

/**
 * Evaluates only a caller-supplied collection that passes the complete frozen
 * C.6 contract. This API does not read the frozen fixture itself.
 */
export function evaluateRedactedCardFixture(rows = []) {
  assertValidFixture(rows);
  return evaluateRedactedCardCases(rows);
}

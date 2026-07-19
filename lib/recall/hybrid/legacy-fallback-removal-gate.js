const DEFAULT_LEGACY_FALLBACK_REMOVAL_THRESHOLDS = Object.freeze({
  minimum_full_fail_closed_window_days: 30,
  minimum_production_observations: 500,
  minimum_surface_observations: 100,
  require_zero_fallback_events: true,
  require_full_surface_coverage: true,
  require_zero_unknown_surfaces: true,
  require_supported_schema_only: true,
  require_rollback_drill: true,
  require_complete_code_inventory: true,
  require_replacement_rollback_strategy: true,
});

const PRODUCTION_SURFACES = Object.freeze([
  "auto_recall",
  "memory_engine_action_search",
  "memory_engine_search",
]);
const VALID_KG_ROLLOUT_STATUSES = new Set([
  "full_fail_closed",
  "expanded_canary",
  "scoped_canary",
  "legacy_fallback",
  "unknown",
]);
const VALID_ROLLBACK_STRATEGIES = new Set([
  "release_revert",
  "feature_branch_restore",
  "replacement_fallback",
  "legacy_runtime_switch",
  "none",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asObject(value) {
  return isObject(value) ? value : {};
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value) {
  const normalized = number(value);
  return normalized !== null && normalized >= 0 && Number.isInteger(normalized) ? normalized : null;
}

function addIssue(list, code, actual, threshold) {
  const issue = { code };
  if (actual !== undefined) issue.actual = actual;
  if (threshold !== undefined) issue.threshold = threshold;
  if (!list.some(item => item.code === code)) list.push(issue);
}

function normalizeThresholds(input = {}) {
  const values = { ...DEFAULT_LEGACY_FALLBACK_REMOVAL_THRESHOLDS, ...asObject(input) };
  const thresholds = {};
  const invalid = [];
  for (const [key, value] of Object.entries(values)) {
    const validBoolean = key.startsWith("require_") && typeof value === "boolean";
    const validNumber = !key.startsWith("require_")
      && typeof value === "number"
      && Number.isFinite(value)
      && value >= 0;
    if (!validBoolean && !validNumber) invalid.push(key);
    thresholds[key] = value;
  }
  return { thresholds, invalid };
}

function readNumber(report, key) {
  const value = asObject(report)[key];
  return { value: nonNegativeInteger(value), present: value !== undefined };
}

function normalizeProductionRollout(input) {
  const report = asObject(input);
  const surfaceReport = report.production_observed_by_surface || report.observed_by_surface;
  const result = {
    target_mode: typeof report.target_mode === "string" ? report.target_mode : null,
    kg_mode: typeof report.kg_mode === "string" ? report.kg_mode : null,
    recent_mode: typeof report.recent_mode === "string" ? report.recent_mode : null,
    observation_count: null,
    window_days: null,
    kg_fallback_events: null,
    recent_fallback_events: null,
    unknown_surface_events: null,
    missing_schema_version_events: null,
    unsupported_schema_version_events: null,
    invalid_provenance_observation_count: null,
    production_observed_by_surface: isObject(surfaceReport) ? surfaceReport : {},
  };
  const supplied = {};
  let invalid = input !== undefined && input !== null && !isObject(input);
  for (const key of [
    "observation_count",
    "window_days",
    "kg_fallback_events",
    "recent_fallback_events",
    "unknown_surface_events",
    "missing_schema_version_events",
    "unsupported_schema_version_events",
    "invalid_provenance_observation_count",
  ]) {
    const normalized = readNumber(report, key);
    result[key] = normalized.value;
    supplied[key] = normalized.present;
    invalid ||= normalized.present && normalized.value === null;
  }
  invalid ||= report.production_observed_by_surface !== undefined
    && !isObject(report.production_observed_by_surface);
  invalid ||= report.target_mode !== undefined && typeof report.target_mode !== "string";
  invalid ||= report.kg_mode !== undefined && typeof report.kg_mode !== "string";
  invalid ||= report.recent_mode !== undefined && typeof report.recent_mode !== "string";
  return { ...result, supplied, invalid };
}

function normalizeCodeReachability(input) {
  const report = asObject(input);
  const result = {};
  let invalid = input !== undefined && input !== null && !isObject(input);
  for (const key of [
    "legacy_query_definitions",
    "legacy_query_call_sites",
    "legacy_db_entrypoints",
    "config_modes_referencing_legacy_fallback",
    "tests_requiring_legacy_fallback",
    "docs_requiring_legacy_fallback",
    "known_dynamic_references",
  ]) {
    const normalized = readNumber(report, key);
    result[key] = normalized.value;
    invalid ||= normalized.present && normalized.value === null;
  }
  result.inventory_complete = report.inventory_complete === true;
  result.supplied = Object.fromEntries(Object.keys(result).map(key => [key, Object.hasOwn(report, key)]));
  return { ...result, invalid };
}

function normalizeRollbackStrategy(input) {
  const report = asObject(input);
  const strategy = report.strategy;
  return {
    strategy: typeof strategy === "string" ? strategy : null,
    tested: report.tested === true,
    documented: report.documented === true,
    owner_assigned: report.owner_assigned === true,
    supplied: strategy !== undefined,
    invalid: strategy !== undefined && !VALID_ROLLBACK_STRATEGIES.has(strategy),
  };
}

function buildEvidence({ closureReadiness, evidenceWindow, kgRollout, recentReview, recentExpansion,
  recentRollback, productionRollout, codeReachability, rollbackStrategy }) {
  return {
    closure_readiness: {
      decision: asObject(asObject(closureReadiness).decision).class || null,
    },
    evidence_window: {
      decision: asObject(evidenceWindow).decision || null,
      status: asObject(evidenceWindow).status || null,
      window_days: number(asObject(evidenceWindow).window_days
        ?? asObject(evidenceWindow).duration_days
        ?? asObject(evidenceWindow).window?.duration_days),
    },
    kg_rollout: kgRollout,
    recent_review: { status: asObject(recentReview).status || null },
    recent_expansion: { decision: asObject(recentExpansion).decision || null },
    recent_rollback: { status: asObject(recentRollback).status || null },
    production_rollout: productionRollout,
    code_reachability: codeReachability,
    rollback_strategy: rollbackStrategy,
  };
}

export function evaluateLegacyFallbackRemovalGate({
  closureReadiness = {},
  evidenceWindow = {},
  kgRollout = {},
  recentReview = {},
  recentExpansion = {},
  recentRollback = {},
  productionRollout = {},
  codeReachability = {},
  rollbackStrategy = {},
  thresholds: thresholdInput = {},
} = {}) {
  const { thresholds, invalid: invalidThresholds } = normalizeThresholds(thresholdInput);
  const production = normalizeProductionRollout(productionRollout);
  const reachability = normalizeCodeReachability(codeReachability);
  const rollback = normalizeRollbackStrategy(rollbackStrategy);
  const blockers = [];
  const evidenceGaps = [];
  const warnings = [];
  const closureClass = asObject(asObject(closureReadiness).decision).class || null;
  const evidenceDecision = asObject(evidenceWindow).decision;
  const kgStatus = asObject(kgRollout).status || null;
  const reviewStatus = asObject(recentReview).status || null;
  const expansionDecision = asObject(recentExpansion).decision || null;
  const rollbackStatus = asObject(recentRollback).status || null;

  if (invalidThresholds.length > 0) addIssue(blockers, "invalid_thresholds", invalidThresholds);
  if (production.invalid) addIssue(blockers, "invalid_production_rollout_report");
  if (reachability.invalid) addIssue(blockers, "invalid_code_reachability_report");
  if (rollback.invalid) addIssue(blockers, "post_removal_rollback_strategy_invalid");

  if (closureClass === "blocked") addIssue(blockers, "closure_readiness_blocked");
  if (reviewStatus === "rollback_required") addIssue(blockers, "recent_canary_review_requires_rollback");
  if (expansionDecision === "rollback") addIssue(blockers, "recent_expansion_decision_requires_rollback");
  if (rollbackStatus === "rollback_failed") addIssue(blockers, "recent_rollback_drill_failed");
  if (thresholds.require_zero_fallback_events
    && ((production.kg_fallback_events ?? 0) > 0 || (production.recent_fallback_events ?? 0) > 0)) {
    addIssue(blockers, "production_fallback_events_present");
  }
  if (thresholds.require_zero_unknown_surfaces && (production.unknown_surface_events ?? 0) > 0) {
    addIssue(blockers, "unknown_production_surfaces_present", production.unknown_surface_events, 0);
  }
  if (thresholds.require_supported_schema_only
    && ((production.missing_schema_version_events ?? 0) > 0
      || (production.unsupported_schema_version_events ?? 0) > 0)) {
    addIssue(blockers, "invalid_observation_schema_present");
  }
  if ((production.invalid_provenance_observation_count ?? 0) > 0) {
    addIssue(
      blockers,
      "invalid_observation_provenance_present",
      production.invalid_provenance_observation_count,
      0,
    );
  }
  if ((reachability.known_dynamic_references ?? 0) > 0) {
    addIssue(blockers, "unresolved_dynamic_legacy_references", reachability.known_dynamic_references, 0);
  }
  if (rollback.strategy === "legacy_runtime_switch" || rollback.strategy === "none") {
    addIssue(blockers, "post_removal_rollback_strategy_invalid", rollback.strategy);
  }

  if (closureClass !== "ready_for_removal") addIssue(evidenceGaps, "closure_not_ready_for_removal");
  if (!VALID_KG_ROLLOUT_STATUSES.has(kgStatus)) addIssue(evidenceGaps, "kg_rollout_evidence_missing_or_invalid");
  else if (kgStatus !== "full_fail_closed") addIssue(evidenceGaps, "kg_full_fail_closed_not_confirmed");
  if (reviewStatus !== "healthy") {
    addIssue(evidenceGaps, "recent_review_evidence_insufficient");
  }
  if (production.recent_mode !== "full_fail_closed") {
    addIssue(evidenceGaps, "recent_full_fail_closed_rollout_not_completed");
  }
  if (rollbackStatus === "insufficient_evidence" || rollbackStatus === null) {
    addIssue(evidenceGaps, "recent_rollback_drill_evidence_insufficient");
  }
  if (thresholds.require_rollback_drill && rollbackStatus !== "rollback_confirmed") {
    addIssue(evidenceGaps, "recent_rollback_drill_evidence_insufficient");
  }
  if (production.target_mode !== "full_fail_closed") addIssue(evidenceGaps, "full_fail_closed_target_not_confirmed");
  if (production.kg_mode !== "full_fail_closed" || production.recent_mode !== "full_fail_closed") {
    addIssue(evidenceGaps, "full_fail_closed_production_modes_not_confirmed");
  }
  for (const key of [
    "kg_fallback_events",
    "recent_fallback_events",
    "unknown_surface_events",
    "missing_schema_version_events",
    "unsupported_schema_version_events",
    "invalid_provenance_observation_count",
  ]) {
    if (!production.supplied[key]) addIssue(evidenceGaps, "production_rollout_metrics_incomplete");
  }
  if (!production.supplied.window_days || production.window_days < thresholds.minimum_full_fail_closed_window_days) {
    addIssue(evidenceGaps, "full_fail_closed_window_below_threshold", production.window_days, thresholds.minimum_full_fail_closed_window_days);
  }
  if (!production.supplied.observation_count || production.observation_count < thresholds.minimum_production_observations) {
    addIssue(evidenceGaps, "production_observations_below_threshold", production.observation_count, thresholds.minimum_production_observations);
  }
  if (thresholds.require_full_surface_coverage) {
    for (const surface of PRODUCTION_SURFACES) {
      const count = production.production_observed_by_surface[surface];
      if (typeof count !== "number" || count < thresholds.minimum_surface_observations) {
        addIssue(evidenceGaps, `surface_observations_below_threshold:${surface}`, count ?? null, thresholds.minimum_surface_observations);
      }
    }
  }
  if (thresholds.require_complete_code_inventory && reachability.inventory_complete !== true) {
    addIssue(evidenceGaps, "legacy_code_inventory_incomplete");
  }
  if (thresholds.require_complete_code_inventory && !reachability.supplied.known_dynamic_references) {
    addIssue(evidenceGaps, "legacy_code_inventory_incomplete");
  }
  if (!rollback.supplied) addIssue(evidenceGaps, "post_removal_rollback_strategy_missing");
  else if (thresholds.require_replacement_rollback_strategy) {
    if (!rollback.tested) addIssue(evidenceGaps, "post_removal_rollback_strategy_untested");
    if (!rollback.documented) addIssue(evidenceGaps, "post_removal_rollback_strategy_undocumented");
    if (!rollback.owner_assigned) addIssue(evidenceGaps, "post_removal_rollback_owner_missing");
  }
  if (evidenceDecision === "blocked") addIssue(blockers, "evidence_window_blocked");
  else if (evidenceDecision !== "ready" && evidenceDecision !== "sufficient") {
    addIssue(evidenceGaps, "evidence_window_not_sufficient");
  }

  let decision = "ready_for_code_removal";
  let recommendation = "begin_code_removal";
  if (blockers.length > 0) {
    decision = "blocked";
    recommendation = "do_not_remove";
  } else if (evidenceGaps.length > 0) {
    decision = "insufficient_evidence";
    recommendation = "continue_rollout_and_collect_evidence";
  }

  return {
    schema_version: 1,
    decision,
    recommendation,
    blockers,
    evidence_gaps: evidenceGaps,
    warnings,
    evidence: buildEvidence({
      closureReadiness,
      evidenceWindow,
      kgRollout,
      recentReview,
      recentExpansion,
      recentRollback,
      productionRollout: production,
      codeReachability: reachability,
      rollbackStrategy: rollback,
    }),
    thresholds,
  };
}

export { DEFAULT_LEGACY_FALLBACK_REMOVAL_THRESHOLDS, PRODUCTION_SURFACES };

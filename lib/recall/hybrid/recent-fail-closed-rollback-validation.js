const DEFAULT_RECENT_ROLLBACK_VALIDATION_THRESHOLDS = Object.freeze({
  minimum_before_applied_events: 1,
  minimum_after_observations: 20,
  minimum_after_guard_failure_events: 1,
  max_after_applied_events: 0,
  max_after_suppressed_fallback_events: 0,
  minimum_after_legacy_fallback_events: 1,
});

const VALID_RUNTIME_MODES = new Set([
  "legacy_fallback",
  "shadow_fail_closed",
  "fail_closed_canary",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asObject(value) {
  return isObject(value) ? value : {};
}

function readField(report, key) {
  const root = asObject(report);
  const sections = [root, root.runtime, root.metrics, root.recent_fail_closed_canary_runtime];
  for (const section of sections) {
    if (isObject(section) && Object.hasOwn(section, key)) return { value: section[key], present: true };
  }
  return { value: undefined, present: false };
}

function normalizeCount(field) {
  if (!field.present) return { value: null, valid: true, present: false };
  const value = field.value;
  const valid = typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isInteger(value);
  return { value: valid ? value : null, valid, present: true };
}

function addIssue(list, code, actual, threshold) {
  const issue = { code };
  if (actual !== undefined) issue.actual = actual;
  if (threshold !== undefined) issue.threshold = threshold;
  if (!list.some(item => item.code === code)) list.push(issue);
}

function normalizeThresholds(input = {}) {
  const values = { ...DEFAULT_RECENT_ROLLBACK_VALIDATION_THRESHOLDS, ...asObject(input) };
  const thresholds = {};
  const invalid = [];
  for (const [key, value] of Object.entries(values)) {
    const valid = typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isInteger(value);
    if (!valid) invalid.push(key);
    thresholds[key] = value;
  }
  return { thresholds, invalid };
}

function normalizeReport(input) {
  const report = asObject(input);
  const invalidSource = input !== undefined && input !== null && !isObject(input);
  const modeField = readField(input, "runtime_mode");
  const runtimeMode = modeField.present ? modeField.value : null;
  const counts = {};
  let invalid = invalidSource || (modeField.present && (
    typeof runtimeMode !== "string" || !VALID_RUNTIME_MODES.has(runtimeMode)
  ));
  const fields = [
    "observation_count",
    "applied_events",
    "suppressed_fallback_events",
    "legacy_fallback_events",
    "scope_match_events",
    "empty_candidate_events",
    "guard_failure_events",
  ];
  const supplied = {};
  for (const key of fields) {
    const normalized = normalizeCount(readField(input, key));
    counts[key] = normalized.value;
    supplied[key] = normalized.present;
    invalid ||= !normalized.valid;
  }
  if (counts.suppressed_fallback_events !== null
    && counts.observation_count !== null
    && counts.suppressed_fallback_events > counts.observation_count) invalid = true;
  if (counts.applied_events !== null
    && counts.observation_count !== null
    && counts.applied_events > counts.observation_count) invalid = true;
  if (counts.legacy_fallback_events !== null
    && counts.guard_failure_events !== null
    && counts.legacy_fallback_events > counts.guard_failure_events) invalid = true;
  return {
    runtime_mode: runtimeMode,
    ...counts,
    supplied,
    invalid,
    present: Object.keys(supplied).some(key => supplied[key]) || modeField.present,
    raw: report,
  };
}

function delta(after, before) {
  return after === null || before === null ? null : after - before;
}

function buildEvidence(before, after) {
  return {
    before: {
      runtime_mode: before.runtime_mode,
      observation_count: before.observation_count,
      applied_events: before.applied_events,
      suppressed_fallback_events: before.suppressed_fallback_events,
      legacy_fallback_events: before.legacy_fallback_events,
      scope_match_events: before.scope_match_events,
      empty_candidate_events: before.empty_candidate_events,
      guard_failure_events: before.guard_failure_events,
    },
    after: {
      runtime_mode: after.runtime_mode,
      observation_count: after.observation_count,
      applied_events: after.applied_events,
      suppressed_fallback_events: after.suppressed_fallback_events,
      legacy_fallback_events: after.legacy_fallback_events,
      scope_match_events: after.scope_match_events,
      empty_candidate_events: after.empty_candidate_events,
      guard_failure_events: after.guard_failure_events,
    },
    deltas: {
      window_comparison: "independent_observation_windows",
      applied_events: delta(after.applied_events, before.applied_events),
      suppressed_fallback_events: delta(after.suppressed_fallback_events, before.suppressed_fallback_events),
      legacy_fallback_events: delta(after.legacy_fallback_events, before.legacy_fallback_events),
    },
  };
}

export function evaluateRecentFailClosedRollbackValidation({
  beforeRollback = {},
  afterRollback = {},
  thresholds: thresholdInput = {},
} = {}) {
  const { thresholds, invalid: invalidThresholds } = normalizeThresholds(thresholdInput);
  const before = normalizeReport(beforeRollback);
  const after = normalizeReport(afterRollback);
  const blockers = [];
  const evidenceGaps = [];
  const warnings = [];

  if (invalidThresholds.length > 0) addIssue(blockers, "invalid_thresholds", invalidThresholds);
  if (before.invalid) addIssue(blockers, "invalid_before_report");
  if (after.invalid) addIssue(blockers, "invalid_after_report");

  if (after.runtime_mode !== null && after.runtime_mode !== "legacy_fallback") {
    addIssue(blockers, "rollback_mode_not_applied", after.runtime_mode, "legacy_fallback");
  }
  if (after.applied_events !== null && after.applied_events > thresholds.max_after_applied_events) {
    addIssue(blockers, "fail_closed_applied_after_rollback", after.applied_events, thresholds.max_after_applied_events);
  }
  if (after.suppressed_fallback_events !== null
    && after.suppressed_fallback_events > thresholds.max_after_suppressed_fallback_events) {
    addIssue(blockers, "fallback_suppression_after_rollback", after.suppressed_fallback_events, thresholds.max_after_suppressed_fallback_events);
  }

  if (after.applied_events !== null && after.suppressed_fallback_events !== null) {
    if ((after.suppressed_fallback_events > 0 && after.applied_events === 0)
      || (after.applied_events > 0 && after.suppressed_fallback_events === 0)) {
      addIssue(blockers, "rollback_telemetry_inconsistent");
    }
  }
  if (after.legacy_fallback_events !== null && after.suppressed_fallback_events !== null
    && after.legacy_fallback_events > 0 && after.suppressed_fallback_events > 0) {
    addIssue(blockers, "rollback_telemetry_inconsistent");
  }

  if (!before.supplied.applied_events || before.applied_events < thresholds.minimum_before_applied_events) {
    addIssue(evidenceGaps, "missing_pre_rollback_canary_evidence", before.applied_events, thresholds.minimum_before_applied_events);
  }
  if (!after.supplied.observation_count || after.observation_count < thresholds.minimum_after_observations) {
    addIssue(evidenceGaps, "insufficient_post_rollback_observations", after.observation_count, thresholds.minimum_after_observations);
  }
  if (!after.supplied.guard_failure_events || after.guard_failure_events < thresholds.minimum_after_guard_failure_events) {
    addIssue(evidenceGaps, "missing_post_rollback_guard_failure_evidence", after.guard_failure_events, thresholds.minimum_after_guard_failure_events);
  }
  if (!after.supplied.legacy_fallback_events) {
    addIssue(evidenceGaps, "missing_post_rollback_legacy_fallback_evidence");
  }

  if (after.guard_failure_events !== null
    && after.guard_failure_events >= thresholds.minimum_after_guard_failure_events
    && (after.legacy_fallback_events === null || after.legacy_fallback_events === 0)) {
    addIssue(blockers, "legacy_fallback_not_restored", after.legacy_fallback_events, thresholds.minimum_after_legacy_fallback_events);
  } else if (after.legacy_fallback_events !== null
    && after.legacy_fallback_events < thresholds.minimum_after_legacy_fallback_events) {
    addIssue(evidenceGaps, "missing_post_rollback_legacy_fallback_evidence", after.legacy_fallback_events, thresholds.minimum_after_legacy_fallback_events);
  }

  if (after.runtime_mode === "legacy_fallback" && after.applied_events === 0 && after.suppressed_fallback_events === 0) {
    warnings.push("post_rollback_fail_closed_activity_absent");
  }

  let status = "rollback_confirmed";
  let recommendation = "close_canary";
  if (blockers.length > 0) {
    status = "rollback_failed";
    recommendation = "investigate_and_retry";
  } else if (evidenceGaps.length > 0) {
    status = "insufficient_evidence";
    recommendation = "collect_more_evidence";
  }

  return {
    schema_version: 1,
    status,
    recommendation,
    blockers,
    evidence_gaps: evidenceGaps,
    warnings,
    evidence: buildEvidence(before, after),
    thresholds,
  };
}

export { DEFAULT_RECENT_ROLLBACK_VALIDATION_THRESHOLDS };

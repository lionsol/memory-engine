function toLowerStringArray(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => String(value || "").trim().toLowerCase())
    .filter(Boolean);
}

function hasSignal(values, signal) {
  return toLowerStringArray(values).includes(String(signal || "").trim().toLowerCase());
}

export function evaluateAutoRecallEligibility(candidate = {}) {
  const denyReasons = [];
  const riskReasons = [];

  const primaryBucket = String(candidate?.primary_bucket || "").trim().toLowerCase();
  const sampleBuckets = toLowerStringArray(candidate?.sample_buckets);
  const qualityFlags = toLowerStringArray(candidate?.quality_flags);

  const suspectedToolOutput =
    primaryBucket === "suspected_tool_output" ||
    hasSignal(sampleBuckets, "suspected_tool_output") ||
    hasSignal(qualityFlags, "suspected_tool_output");

  const dreamingArtifact =
    primaryBucket === "dreaming_maintenance_log" ||
    primaryBucket === "dreaming_candidate_staging" ||
    hasSignal(sampleBuckets, "dreaming_maintenance_log") ||
    hasSignal(sampleBuckets, "dreaming_candidate_staging") ||
    hasSignal(qualityFlags, "dreaming_maintenance_log") ||
    hasSignal(qualityFlags, "dreaming_candidate_staging");

  const hasRawLogLeakSignal =
    primaryBucket === "raw_log_leak" ||
    hasSignal(sampleBuckets, "raw_log_leak") ||
    hasSignal(qualityFlags, "raw_log_leak");

  const rawLogLeakOnly =
    hasRawLogLeakSignal &&
    !hasSignal(sampleBuckets, "suspected_tool_output") &&
    !hasSignal(qualityFlags, "suspected_tool_output");

  if (suspectedToolOutput) {
    denyReasons.push("denied_by_suspected_tool_output");
  } else if (dreamingArtifact) {
    denyReasons.push("denied_by_dreaming_artifact");
  } else if (rawLogLeakOnly) {
    riskReasons.push("risk_raw_log_leak_review_required");
  }

  return {
    allowed: denyReasons.length === 0,
    deny_reasons: denyReasons,
    risk_reasons: riskReasons,
    reinforcement_allowed: denyReasons.length === 0,
  };
}

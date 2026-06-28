import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ALLOWED_SAMPLE_TYPES = new Set(["memory"]);
const ALLOWED_AUTO_RECALL_ELIGIBLE = new Set(["yes", "no", "unsure"]);
const ALLOWED_PREFERRED_ACTION = new Set(["keep", "demote", "quarantine", "archive", "delete"]);

function timestampForFile(now = new Date()) {
  const iso = new Date(now).toISOString();
  return iso.slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

function defaultOutPath({ cwd = process.cwd(), format = "md", now = new Date() } = {}) {
  return resolve(cwd, "reports", `annotation-eligibility-preview-${timestampForFile(now)}.${format}`);
}

function normalizeFormat(value) {
  const format = String(value || "md").trim().toLowerCase();
  if (format !== "json" && format !== "md") {
    throw new Error(`--format must be one of: json, md`);
  }
  return format;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeAnnotation(annotation) {
  if (!annotation || typeof annotation !== "object") return {};
  const reason = isNonEmptyString(annotation.reason)
    ? annotation.reason
    : (isNonEmptyString(annotation.notes) ? annotation.notes : annotation.reason);
  return {
    ...annotation,
    reason,
  };
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return { row: JSON.parse(line), line_number: index + 1, raw: line };
      } catch (error) {
        return {
          row: null,
          line_number: index + 1,
          raw: line,
          parse_error: String(error?.message || error),
        };
      }
    });
}

function validateLabelRow(rowWrapper) {
  const errors = [];
  if (rowWrapper.parse_error) {
    return { valid: false, errors: [`parse_error:${rowWrapper.parse_error}`] };
  }

  const row = rowWrapper.row || {};
  const annotation = normalizeAnnotation(row.annotation);
  if (Number(row.schema_version) !== 1) errors.push("schema_version");
  if (!isNonEmptyString(row.sample_id)) errors.push("sample_id");
  if (!ALLOWED_SAMPLE_TYPES.has(String(row.sample_type || ""))) errors.push("sample_type");
  if (!isNonEmptyString(row.memory_id)) errors.push("memory_id");
  if (!isNonEmptyString(row.chunk_id)) errors.push("chunk_id");
  if (!isNonEmptyString(row.primary_bucket)) errors.push("primary_bucket");
  if (!isNonEmptyString(row.source_path)) errors.push("source_path");
  if (!ALLOWED_AUTO_RECALL_ELIGIBLE.has(String(annotation.auto_recall_eligible || ""))) errors.push("annotation.auto_recall_eligible");
  if (!ALLOWED_PREFERRED_ACTION.has(String(annotation.preferred_action || ""))) errors.push("annotation.preferred_action");

  return { valid: errors.length === 0, errors };
}

function buildCandidateIndexes(candidateWrappers) {
  const bySampleId = new Map();
  const byChunkMemory = new Map();

  for (const wrapper of candidateWrappers) {
    if (wrapper.parse_error || !wrapper.row || typeof wrapper.row !== "object") continue;
    const row = wrapper.row;
    if (isNonEmptyString(row.sample_id) && !bySampleId.has(row.sample_id)) {
      bySampleId.set(row.sample_id, row);
    }
    const key = `${String(row.chunk_id || "")}::${String(row.memory_id || "")}`;
    if (key !== "::" && !byChunkMemory.has(key)) {
      byChunkMemory.set(key, row);
    }
  }

  return { bySampleId, byChunkMemory };
}

function matchCandidate(labelRow, indexes) {
  if (!indexes) return null;
  if (isNonEmptyString(labelRow.sample_id) && indexes.bySampleId.has(labelRow.sample_id)) {
    return indexes.bySampleId.get(labelRow.sample_id);
  }
  const key = `${String(labelRow.chunk_id || "")}::${String(labelRow.memory_id || "")}`;
  return indexes.byChunkMemory.get(key) || null;
}

function buildRecommendation(labelRow, candidateRow = null) {
  const annotation = labelRow.annotation || {};
  const sampleBuckets = uniqueStrings(candidateRow?.sample_buckets?.length ? candidateRow.sample_buckets : [labelRow.primary_bucket]);
  const recommendationReasons = [];

  const recommendation = {
    schema_version: 1,
    sample_id: labelRow.sample_id,
    sample_type: labelRow.sample_type,
    memory_id: labelRow.memory_id,
    chunk_id: labelRow.chunk_id,
    primary_bucket: labelRow.primary_bucket,
    sample_buckets: sampleBuckets,
    source_path: labelRow.source_path,
    recommend_auto_recall_eligible: null,
    recommend_reinforcement_eligible: null,
    suggested_action: null,
    requires_manual_confirm: false,
    reasons: recommendationReasons,
  };

  if (labelRow.primary_bucket === "suspected_tool_output") {
    recommendation.recommend_auto_recall_eligible = false;
    recommendation.recommend_reinforcement_eligible = false;
    recommendation.suggested_action = "quarantine_candidate";
    recommendationReasons.push("bucket_policy:suspected_tool_output");
  }

  if (annotation.auto_recall_eligible === "no") {
    recommendation.recommend_auto_recall_eligible = false;
    recommendationReasons.push("annotation:auto_recall_eligible=no");
  }

  if (annotation.preferred_action === "delete") {
    recommendation.suggested_action = "delete_candidate";
    recommendation.requires_manual_confirm = true;
    recommendationReasons.push("annotation:preferred_action=delete");
  } else if (annotation.preferred_action === "quarantine") {
    recommendation.suggested_action = "quarantine_candidate";
    recommendationReasons.push("annotation:preferred_action=quarantine");
  } else if (annotation.preferred_action === "demote") {
    recommendation.suggested_action = "demote_only";
    recommendationReasons.push("annotation:preferred_action=demote");
  } else if (annotation.preferred_action === "archive") {
    recommendation.suggested_action = "archive_candidate";
    recommendationReasons.push("annotation:preferred_action=archive");
  }

  const hasEffect = Boolean(
    recommendation.recommend_auto_recall_eligible !== null
    || recommendation.recommend_reinforcement_eligible !== null
    || recommendation.suggested_action
  );

  const rawLogLeakOnly = labelRow.primary_bucket === "raw_log_leak" && sampleBuckets.length === 1;
  return {
    recommendation,
    hasEffect,
    rawLogLeakOnly,
  };
}

function incrementCount(map, key, by = 1) {
  const normalized = String(key ?? "unknown");
  map[normalized] = (map[normalized] || 0) + by;
}

function renderMarkdown(report) {
  const summary = report.summary;
  const renderMap = map => Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n") || "- none";

  return [
    "# Annotation Eligibility Preview",
    "",
    `- generated_at: ${report.generated_at}`,
    `- labels_input_path: ${report.labels_input_path}`,
    `- candidates_input_path: ${report.candidates_input_path || "none"}`,
    `- affected_sample_count: ${summary.affected_sample_count}`,
    `- manual_confirm_required_count: ${summary.manual_confirm_required_count}`,
    `- write_db: false`,
    `- validation_only_covers_raw_log_leak: ${summary.validation_only_covers_raw_log_leak}`,
    "",
    "## Bucket Coverage",
    "",
    "### Labeled Bucket Distribution",
    "",
    renderMap(summary.labeled_bucket_distribution),
    "",
    "### Candidate Bucket Distribution",
    "",
    renderMap(summary.candidate_bucket_distribution || {}),
    "",
    `- validation_scope_note: ${summary.validation_scope_note || "none"}`,
    "",
    "## Recommendations by Action",
    "",
    renderMap(summary.recommendations_by_action),
    "",
    "## Recommendations by Primary Bucket",
    "",
    renderMap(summary.recommendations_by_primary_bucket),
    "",
    "## Raw Log Leak Warning",
    "",
    `- ${summary.raw_log_leak_false_positive_warning}`,
    `- raw_log_leak_only_samples_seen: ${summary.raw_log_leak_only_samples_seen}`,
    `- raw_log_leak_only_bucket_noop_count: ${summary.raw_log_leak_only_bucket_noop_count}`,
    "",
  ].join("\n");
}

function writeOutput(content, outPath) {
  const targetPath = resolve(process.cwd(), outPath);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, "utf8");
  return targetPath;
}

export function previewAnnotationEligibility(options = {}) {
  const labelsInputPath = options.labelsInputPath || options.labels || options.in;
  if (!labelsInputPath) {
    throw new Error("input labels file is required");
  }

  const candidatesInputPath = options.candidatesInputPath || options.candidates || null;
  const now = options.now || new Date();
  const format = normalizeFormat(options.format || "md");
  const outPath = options.out || defaultOutPath({ format, now });

  const labelWrappers = readJsonl(labelsInputPath);
  const candidateWrappers = candidatesInputPath ? readJsonl(candidatesInputPath) : [];
  const candidateIndexes = candidatesInputPath ? buildCandidateIndexes(candidateWrappers) : null;

  const validationErrors = [];
  const recommendations = [];
  const recommendationsByAction = {};
  const recommendationsByPrimaryBucket = {};
  const labeledBucketDistribution = {};
  const candidateBucketDistribution = {};
  const labeledBucketsSeen = new Set();
  let matchedCandidateCount = 0;

  let manualConfirmRequiredCount = 0;
  let rawLogLeakOnlySamplesSeen = 0;
  let rawLogLeakOnlyBucketNoopCount = 0;

  for (const rowWrapper of labelWrappers) {
    const validation = validateLabelRow(rowWrapper);
    if (!validation.valid) {
      validationErrors.push({
        line_number: rowWrapper.line_number,
        sample_id: rowWrapper.row?.sample_id || null,
        errors: validation.errors,
      });
      continue;
    }

    const labelRow = rowWrapper.row;
    const annotation = normalizeAnnotation(labelRow.annotation);
    labelRow.annotation = annotation;
    incrementCount(labeledBucketDistribution, labelRow.primary_bucket);
    labeledBucketsSeen.add(String(labelRow.primary_bucket));
    const candidateRow = matchCandidate(labelRow, candidateIndexes);
    if (candidateRow) {
      matchedCandidateCount += 1;
      for (const bucket of uniqueStrings(
        candidateRow.sample_buckets?.length ? candidateRow.sample_buckets : [candidateRow.primary_bucket || labelRow.primary_bucket]
      )) {
        incrementCount(candidateBucketDistribution, bucket);
      }
    }
    const { recommendation, hasEffect, rawLogLeakOnly } = buildRecommendation(labelRow, candidateRow);

    if (rawLogLeakOnly) {
      rawLogLeakOnlySamplesSeen += 1;
      if (!recommendation.reasons.some(reason => reason.startsWith("annotation:preferred_action="))) {
        rawLogLeakOnlyBucketNoopCount += 1;
      }
    }

    if (!hasEffect) continue;
    recommendations.push(recommendation);
    incrementCount(recommendationsByAction, recommendation.suggested_action || "eligibility_only");
    incrementCount(recommendationsByPrimaryBucket, recommendation.primary_bucket);
    if (recommendation.requires_manual_confirm) {
      manualConfirmRequiredCount += 1;
    }
  }

  const summary = {
    total_labels: labelWrappers.length,
    invalid_label_count: validationErrors.length,
    affected_sample_count: recommendations.length,
    labeled_bucket_distribution: labeledBucketDistribution,
    candidate_bucket_distribution: candidatesInputPath ? candidateBucketDistribution : null,
    matched_candidate_count: matchedCandidateCount,
    recommendations_by_action: recommendationsByAction,
    recommendations_by_primary_bucket: recommendationsByPrimaryBucket,
    manual_confirm_required_count: manualConfirmRequiredCount,
    raw_log_leak_only_samples_seen: rawLogLeakOnlySamplesSeen,
    raw_log_leak_only_bucket_noop_count: rawLogLeakOnlyBucketNoopCount,
    raw_log_leak_false_positive_warning: "raw_log_leak is noisy and must not trigger quarantine/delete from bucket membership alone",
    validation_only_covers_raw_log_leak: labeledBucketsSeen.size === 1 && labeledBucketsSeen.has("raw_log_leak"),
    validation_scope_note: labeledBucketsSeen.size === 1 && labeledBucketsSeen.has("raw_log_leak")
      ? "This validation only covers raw_log_leak."
      : null,
  };

  const report = {
    mode: "dry_run",
    schema_version: 1,
    generated_at: new Date(now).toISOString(),
    labels_input_path: resolve(process.cwd(), labelsInputPath),
    candidates_input_path: candidatesInputPath ? resolve(process.cwd(), candidatesInputPath) : null,
    output_path: null,
    format,
    write_db: false,
    memory_side_effects: false,
    reinforcement_side_effects: false,
    summary,
    validation_errors: validationErrors,
    recommendations,
  };

  const content = format === "json"
    ? JSON.stringify(report, null, 2)
    : renderMarkdown(report);
  report.output_path = writeOutput(content, outPath);
  return report;
}

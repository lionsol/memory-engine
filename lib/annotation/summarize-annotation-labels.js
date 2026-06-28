import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ALLOWED_SAMPLE_TYPES = new Set(["memory"]);
const ALLOWED_QUALITY = new Set(["good", "usable", "low_quality", "polluted"]);
const ALLOWED_CURRENCY = new Set(["current", "superseded", "unknown"]);
const ALLOWED_AUTO_RECALL_ELIGIBLE = new Set(["yes", "no", "unsure"]);
const ALLOWED_PREFERRED_ACTION = new Set(["keep", "demote", "quarantine", "archive", "delete"]);

function timestampForFile(now = new Date()) {
  const iso = new Date(now).toISOString();
  return iso.slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

function defaultOutPath({ cwd = process.cwd(), format = "md", now = new Date() } = {}) {
  return resolve(cwd, "reports", `annotation-summary-${timestampForFile(now)}.${format}`);
}

function normalizeFormat(value) {
  const format = String(value || "md").trim().toLowerCase();
  if (format !== "json" && format !== "md") {
    throw new Error(`--format must be one of: json, md`);
  }
  return format;
}

function incrementCount(map, key, by = 1) {
  const name = String(key ?? "unknown");
  map[name] = (map[name] || 0) + by;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasFilledAnnotation(annotation) {
  if (!annotation || typeof annotation !== "object") return false;
  const reason = annotation.reason ?? annotation.notes;
  return Boolean(
    annotation.quality
    || annotation.currency
    || annotation.auto_recall_eligible
    || annotation.preferred_action
    || reason
  );
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

function validateRow(rowWrapper) {
  const errors = [];
  if (rowWrapper.parse_error) {
    errors.push(`parse_error:${rowWrapper.parse_error}`);
    return { valid: false, errors };
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

  if (!ALLOWED_QUALITY.has(String(annotation.quality || ""))) errors.push("annotation.quality");
  if (!ALLOWED_CURRENCY.has(String(annotation.currency || ""))) errors.push("annotation.currency");
  if (!ALLOWED_AUTO_RECALL_ELIGIBLE.has(String(annotation.auto_recall_eligible || ""))) errors.push("annotation.auto_recall_eligible");
  if (!ALLOWED_PREFERRED_ACTION.has(String(annotation.preferred_action || ""))) errors.push("annotation.preferred_action");
  if (!isNonEmptyString(annotation.reason)) errors.push("annotation.reason");

  return {
    valid: errors.length === 0,
    errors,
  };
}

function summarizeValidatedRows(validatedRows) {
  const countsByPrimaryBucket = {};
  const countsByQuality = {};
  const countsByAutoRecallEligible = {};
  const countsByPreferredAction = {};
  const perBucket = new Map();
  const labeledBucketsSeen = new Set();

  let labeledCount = 0;
  let missingRequiredFieldCount = 0;

  for (const item of validatedRows) {
    if (!item.valid) {
      missingRequiredFieldCount += item.errors.length;
      continue;
    }

    const row = item.rowWrapper.row;
    const annotation = normalizeAnnotation(row.annotation);
    if (hasFilledAnnotation(annotation)) labeledCount += 1;

    incrementCount(countsByPrimaryBucket, row.primary_bucket);
    labeledBucketsSeen.add(String(row.primary_bucket));
    incrementCount(countsByQuality, annotation.quality);
    incrementCount(countsByAutoRecallEligible, annotation.auto_recall_eligible);
    incrementCount(countsByPreferredAction, annotation.preferred_action);

    const bucketEntry = perBucket.get(row.primary_bucket) || {
      total: 0,
      polluted: 0,
      auto_recall_no: 0,
      auto_recall_unsure: 0,
    };
    bucketEntry.total += 1;
    if (annotation.quality === "polluted") bucketEntry.polluted += 1;
    if (annotation.auto_recall_eligible === "no") bucketEntry.auto_recall_no += 1;
    if (annotation.auto_recall_eligible === "unsure") bucketEntry.auto_recall_unsure += 1;
    perBucket.set(row.primary_bucket, bucketEntry);
  }

  const pollutedRateByPrimaryBucket = {};
  const autoRecallEligibleNoRateByPrimaryBucket = {};
  const unsureRateByPrimaryBucket = {};
  for (const [bucket, entry] of perBucket.entries()) {
    const denom = entry.total || 1;
    pollutedRateByPrimaryBucket[bucket] = Number((entry.polluted / denom).toFixed(4));
    autoRecallEligibleNoRateByPrimaryBucket[bucket] = Number((entry.auto_recall_no / denom).toFixed(4));
    unsureRateByPrimaryBucket[bucket] = Number((entry.auto_recall_unsure / denom).toFixed(4));
  }

  return {
    labeled_count: labeledCount,
    missing_required_field_count: missingRequiredFieldCount,
    counts_by_primary_bucket: countsByPrimaryBucket,
    labeled_bucket_distribution: countsByPrimaryBucket,
    counts_by_quality: countsByQuality,
    counts_by_auto_recall_eligible: countsByAutoRecallEligible,
    counts_by_preferred_action: countsByPreferredAction,
    polluted_rate_by_primary_bucket: pollutedRateByPrimaryBucket,
    auto_recall_eligible_no_rate_by_primary_bucket: autoRecallEligibleNoRateByPrimaryBucket,
    unsure_rate_by_primary_bucket: unsureRateByPrimaryBucket,
    validation_only_covers_raw_log_leak: labeledBucketsSeen.size === 1 && labeledBucketsSeen.has("raw_log_leak"),
    validation_scope_note: labeledBucketsSeen.size === 1 && labeledBucketsSeen.has("raw_log_leak")
      ? "This validation only covers raw_log_leak."
      : null,
  };
}

function renderMarkdown(summary, report) {
  const renderMap = map => Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n") || "- none";

  return [
    "# Annotation Labels Summary",
    "",
    `- generated_at: ${report.generated_at}`,
    `- input_path: ${report.input_path}`,
    `- total_labels: ${summary.total_labels}`,
    `- labeled_count: ${summary.labeled_count}`,
    `- missing_required_field_count: ${summary.missing_required_field_count}`,
    `- invalid_enum_count: ${summary.invalid_enum_count}`,
    `- write_db: false`,
    `- validation_only_covers_raw_log_leak: ${summary.validation_only_covers_raw_log_leak}`,
    "",
    "## Bucket Coverage",
    "",
    "### Labeled Bucket Distribution",
    "",
    renderMap(summary.labeled_bucket_distribution),
    "",
    `- validation_scope_note: ${summary.validation_scope_note || "none"}`,
    "",
    "## Counts by Primary Bucket",
    "",
    renderMap(summary.counts_by_primary_bucket),
    "",
    "## Counts by Quality",
    "",
    renderMap(summary.counts_by_quality),
    "",
    "## Counts by Auto Recall Eligible",
    "",
    renderMap(summary.counts_by_auto_recall_eligible),
    "",
    "## Counts by Preferred Action",
    "",
    renderMap(summary.counts_by_preferred_action),
    "",
    "## Polluted Rate by Primary Bucket",
    "",
    renderMap(summary.polluted_rate_by_primary_bucket),
    "",
    "## Auto Recall Eligible No Rate by Primary Bucket",
    "",
    renderMap(summary.auto_recall_eligible_no_rate_by_primary_bucket),
    "",
    "## Unsure Rate by Primary Bucket",
    "",
    renderMap(summary.unsure_rate_by_primary_bucket),
    "",
  ].join("\n");
}

function writeOutput(content, outPath) {
  const targetPath = resolve(process.cwd(), outPath);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, "utf8");
  return targetPath;
}

export function summarizeAnnotationLabels(options = {}) {
  const inputPath = options.inputPath || options.labels || options.in;
  if (!inputPath) {
    throw new Error("input labels file is required");
  }

  const now = options.now || new Date();
  const format = normalizeFormat(options.format || "md");
  const outPath = options.out || defaultOutPath({ format, now });
  const rows = readJsonl(inputPath);
  const normalizedRows = rows.map(rowWrapper => (
    rowWrapper?.row && typeof rowWrapper.row === "object"
      ? {
          ...rowWrapper,
          row: {
            ...rowWrapper.row,
            annotation: normalizeAnnotation(rowWrapper.row.annotation),
          },
        }
      : rowWrapper
  ));
  const validatedRows = normalizedRows.map(rowWrapper => ({
    rowWrapper,
    ...validateRow(rowWrapper),
  }));

  const invalidEnumCount = validatedRows.reduce((sum, item) => (
    sum + item.errors.filter(error => error.startsWith("annotation.")).length
  ), 0);
  const aggregation = summarizeValidatedRows(validatedRows);
  const summary = {
    total_labels: rows.length,
    invalid_row_count: validatedRows.filter(item => !item.valid).length,
    invalid_enum_count: invalidEnumCount,
    validation_errors: validatedRows
      .filter(item => !item.valid)
      .map(item => ({
        line_number: item.rowWrapper.line_number,
        sample_id: item.rowWrapper.row?.sample_id || null,
        errors: item.errors,
      })),
    ...aggregation,
  };

  const report = {
    mode: "dry_run",
    generated_at: new Date(now).toISOString(),
    input_path: resolve(process.cwd(), inputPath),
    output_path: null,
    format,
    write_db: false,
    memory_side_effects: false,
    reinforcement_side_effects: false,
    summary,
  };

  const content = format === "json"
    ? JSON.stringify(report, null, 2)
    : renderMarkdown(summary, report);
  report.output_path = writeOutput(content, outPath);
  return report;
}

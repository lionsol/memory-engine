import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAutoRecallDecisionTrace, isAutoRecallIntentAnalysis } from "../../lib/recall/auto-recall-decision-trace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const ANNOTATION_BUCKET_SLUG = "[a-z0-9_]+(?:-[a-z0-9_]+)*";
const ANNOTATION_BUCKET_SEGMENTS = `(?:-${ANNOTATION_BUCKET_SLUG})+`;

const REPORT_PATTERNS = [
  {
    kind: "annotation_candidates",
    regex: new RegExp(`^annotation-candidates(?:${ANNOTATION_BUCKET_SEGMENTS})?-(?:\\d{8}-\\d{6}|\\d{8})\\.(jsonl|md)$`),
  },
  { kind: "annotation_labels", regex: /^annotation-labels-.*\.jsonl$/ },
  { kind: "annotation_summary", regex: /^annotation-summary-\d{8}-\d{6}\.(json|md)$/ },
  { kind: "annotation_eligibility_preview", regex: /^annotation-eligibility-preview-\d{8}-\d{6}\.(json|md)$/ },
  { kind: "annotation_local_qc_report", regex: /^annotation-local-qc-report-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d{3})?Z\.json$/ },
  { kind: "archived_raw_log_rescue_combined_report", regex: /^archived-raw-log-rescue-combined-report-p\d+(?:-p\d+)*-\d{8}\.(json|md)$/ },
  { kind: "archived_raw_log_rescue_review_queue", regex: /^archived-raw-log-rescue-manual-review-queue-p\d+-\d{8}\.(jsonl|md)$/ },
  { kind: "archived_raw_log_rescue_review_queue_label_report", regex: /^archived-raw-log-rescue-review-queue-label-report-p\d+(?:-[a-z0-9_]+)*-\d{8}\.(json|md)$/ },
  { kind: "auto_recall_safety_smoke", regex: /^auto-recall-safety-smoke-\d{8}-\d{6}\.md$/ },
  { kind: "auto_recall_long_input_smoke", regex: /^auto-recall-long-input-smoke-\d{8}-\d{6}\.(json|md)$/ },
  { kind: "auto_recall_turn_gold_set_replay", regex: /^auto-recall-turn-gold-set-replay-\d{8}-\d{6}\.json$/ },
];

const LATEST_KIND_KEYS = [
  "annotation_summary",
  "annotation_eligibility_preview",
  "annotation_local_qc_report",
  "archived_raw_log_rescue_combined_report",
  "archived_raw_log_rescue_review_queue",
  "archived_raw_log_rescue_review_queue_label_report",
  "auto_recall_safety_smoke",
  "auto_recall_long_input_smoke",
  "auto_recall_turn_gold_set_replay",
];

function isoFromMs(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function getReportsDir() {
  const override = process.env.MEMORY_ENGINE_REPORTS_DIR;
  return override ? path.resolve(override) : path.join(repoRoot, "reports");
}

export function getAllowedReportKind(name) {
  const value = String(name || "");
  const match = REPORT_PATTERNS.find(entry => entry.regex.test(value));
  return match?.kind || null;
}

export function isAllowedReportName(name) {
  return Boolean(getAllowedReportKind(name));
}

export function validateReportName(name) {
  const value = String(name || "");
  if (!value) throw new Error("report name is required");
  if (path.isAbsolute(value)) throw new Error("absolute paths are not allowed");
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new Error("path traversal is not allowed");
  }
  if (path.basename(value) !== value) throw new Error("nested paths are not allowed");
  if (!isAllowedReportName(value)) throw new Error("report file is not allowed");
  return value;
}

function toReportEntry(dir, name) {
  const file = path.join(dir, name);
  const stat = fs.statSync(file);
  return {
    name,
    kind: getAllowedReportKind(name),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    updated_at: isoFromMs(stat.mtimeMs),
  };
}

function sortReports(a, b) {
  return (Number(b.mtimeMs) || 0) - (Number(a.mtimeMs) || 0) || String(b.name).localeCompare(String(a.name));
}

function parseJsonContent(content) {
  try {
    return JSON.parse(String(content || ""));
  } catch {
    return null;
  }
}

function decisionTraceScore(intent) {
  let score = 0;
  if (intent?.long_input_detected) score += 10;
  if (intent?.explicit_history_context) score += 20;
  if (intent?.should_recall) score += 5;
  if (typeof intent?.focused_query === "string" && intent.focused_query.length > 0) score += 10;
  return score;
}

function selectDecisionTraceCandidate(payload) {
  if (isAutoRecallIntentAnalysis(payload)) return payload;
  const checks = Array.isArray(payload?.checks) ? payload.checks : [];
  const candidates = checks
    .map(check => check?.details)
    .filter(isAutoRecallIntentAnalysis)
    .sort((a, b) => decisionTraceScore(b) - decisionTraceScore(a));
  return candidates[0] || null;
}

function extractAutoRecallDecisionTrace(entry, content, format) {
  if (!String(entry?.kind || "").startsWith("auto_recall_")) return null;
  if (format !== "json") return null;
  const payload = parseJsonContent(content);
  const candidate = selectDecisionTraceCandidate(payload);
  return buildAutoRecallDecisionTrace(candidate);
}

function normalizeMemoryCardPreview(card, result = {}) {
  if (!card || typeof card !== "object") return null;
  return {
    turn_id: result?.turn_id || null,
    line_number: result?.line_number ?? null,
    card_id: card.card_id || null,
    memory_id: card.memory_id || null,
    title: card.title || "",
    summary: card.summary || "",
    salience_reason: card.salience_reason || "",
    source_hint: card.source_hint || "",
    category: card.category || "unknown",
    kind: card.kind || "fact",
    confidence_score: card.confidence_score ?? null,
    risk_flags: Array.isArray(card.risk_flags) ? card.risk_flags : [],
    disclosure_level: card.disclosure_level || "none",
    get_token: card.get_token || null,
  };
}

function extractMemoryCardsFromResults(results) {
  return (Array.isArray(results) ? results : [])
    .map(result => normalizeMemoryCardPreview(result?.card_projection?.memory_card, result))
    .filter(Boolean);
}

function selectMemoryCardPreviewPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const replay = payload.replay && typeof payload.replay === "object" ? payload.replay : payload;
  const cards = extractMemoryCardsFromResults(replay.results);
  if (cards.length === 0) return null;
  return {
    summary: {
      mode: "read_only_memory_card_preview",
      total_count: Number(replay?.summary?.total_count || 0),
      card_expected_count: Number(replay?.summary?.card_expected_count || cards.length),
      card_projection_count: Number(replay?.summary?.card_projection_count || cards.length),
      preview_count: Math.min(cards.length, 8),
      truncated: cards.length > 8,
    },
    cards: cards.slice(0, 8),
    side_effects: {
      db_writes: false,
      memory_file_mutation: false,
      dataset_file_mutation: false,
      retrieval: false,
      injection: false,
      cleanup_apply: false,
      archive: false,
      quarantine: false,
      reinforce: false,
      llm: false,
      network: false,
      runtime_report_files: false,
    },
  };
}

function extractMemoryCardPreview(entry, content, format) {
  if (entry?.kind !== "auto_recall_turn_gold_set_replay") return null;
  if (format !== "json") return null;
  return selectMemoryCardPreviewPayload(parseJsonContent(content));
}

function topDistributionEntries(distribution, limit = 8) {
  return Object.entries(distribution || {})
    .map(([label, count]) => ({ label, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)))
    .slice(0, Math.max(1, Number(limit) || 1));
}

function incrementDistribution(distribution, key) {
  const label = key == null || key === "" ? "(empty)" : String(key);
  distribution[label] = (distribution[label] || 0) + 1;
}

function countDistribution(rows, getter) {
  const distribution = {};
  for (const row of rows) incrementDistribution(distribution, getter(row));
  return distribution;
}

function parseJsonlContent(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(row => row && typeof row === "object");
}

function extractReviewQueuePreview(entry, content, format) {
  if (entry?.kind !== "archived_raw_log_rescue_review_queue") return null;
  if (format !== "jsonl") return null;
  const rows = parseJsonlContent(content)
    .filter(row => row.queue_type === "archived_raw_log_rescue_manual_review");
  if (!rows.length) return null;
  const sampleIds = rows.map(row => String(row.sample_id || "")).filter(Boolean);
  const uniqueSampleIds = new Set(sampleIds);
  const duplicateSampleIds = sampleIds.filter((id, index) => sampleIds.indexOf(id) !== index);
  return {
    summary: {
      mode: "read_only_review_queue_preview",
      total_rows: rows.length,
      unique_sample_ids: uniqueSampleIds.size,
      duplicate_sample_ids: duplicateSampleIds.length,
      min_queue_priority: Math.min(...rows.map(row => Number(row.queue_priority) || 0)),
      max_queue_priority: Math.max(...rows.map(row => Number(row.queue_priority) || 0)),
      archived_count: rows.filter(row => row.is_archived === true).length,
      content_missing_count: rows.filter(row => row.content_missing_reason).length,
    },
    distributions: {
      review_reason_distribution: topDistributionEntries(countDistribution(rows, row => Array.isArray(row.review_reasons) ? row.review_reasons[0] : "(empty)")),
      primary_bucket_distribution: topDistributionEntries(countDistribution(rows, row => row.primary_bucket || "unknown")),
      raw_predicted_keep_active_distribution: topDistributionEntries(countDistribution(rows, row => row.raw_predicted_keep_active || "(empty)")),
      predicted_keep_active_distribution: topDistributionEntries(countDistribution(rows, row => row.predicted_keep_active || "(empty)")),
      manual_review_flag_distribution: topDistributionEntries(countDistribution(rows.flatMap(row => Array.isArray(row.manual_review_flags) && row.manual_review_flags.length ? row.manual_review_flags : ["(empty)"]), flag => flag)),
      risk_signal_distribution: topDistributionEntries(countDistribution(rows.flatMap(row => Array.isArray(row.risk_signals) && row.risk_signals.length ? row.risk_signals : ["(empty)"]), signal => signal)),
    },
    queue_samples: rows.slice(0, 10).map(row => ({
      queue_priority: row.queue_priority ?? null,
      sample_id: row.sample_id || null,
      memory_id: row.memory_id || null,
      chunk_id: row.chunk_id || null,
      primary_bucket: row.primary_bucket || null,
      review_reasons: Array.isArray(row.review_reasons) ? row.review_reasons : [],
      raw_predicted_keep_active: row.raw_predicted_keep_active || null,
      predicted_keep_active: row.predicted_keep_active || null,
      score: row.score ?? null,
      boundary_distance: row.boundary_distance ?? null,
      content_preview: row.content_preview || "",
    })),
    duplicate_sample_ids: Array.from(new Set(duplicateSampleIds)).slice(0, 10),
    safety: {
      db_writes: false,
      memory_file_mutation: false,
      unarchive: false,
      category_update: false,
      delete: false,
      quarantine: false,
      reinforce: false,
      llm: false,
      network: false,
    },
  };
}

function compactMetricSummary(metrics = {}) {
  return {
    total: Number(metrics.total || 0),
    exact_match: Number(metrics.exact_match || 0),
    exact_accuracy: metrics.exact_accuracy ?? null,
    yes_true_positive: Number(metrics.yes_true_positive || 0),
    yes_false_positive: Number(metrics.yes_false_positive || 0),
    yes_false_negative: Number(metrics.yes_false_negative || 0),
    yes_true_negative: Number(metrics.yes_true_negative || 0),
    yes_precision: metrics.yes_precision ?? null,
    yes_recall: metrics.yes_recall ?? null,
    yes_f1: metrics.yes_f1 ?? null,
  };
}

function topMetricBreakdowns(groups = {}, limit = 8) {
  return Object.entries(groups || {})
    .map(([label, metrics]) => ({ label, ...compactMetricSummary(metrics) }))
    .sort((a, b) => b.total - a.total || String(a.label).localeCompare(String(b.label)))
    .slice(0, Math.max(1, Number(limit) || 1));
}

function extractRescueCombinedPreview(entry, content, format) {
  if (entry?.kind !== "archived_raw_log_rescue_combined_report") return null;
  if (format !== "json") return null;
  const payload = parseJsonContent(content);
  if (!payload || payload.mode !== "archived_raw_log_rescue_combined_label_report") return null;
  const scoring = payload.scoring || {};
  const manualReview = payload.manual_review || {};
  const nonManual = payload.non_manual || {};
  return {
    summary: {
      mode: "read_only_rescue_combined_preview",
      threshold: payload.threshold ?? null,
      unsure_threshold: payload.unsure_threshold ?? null,
      labels_valid: Number(payload.summary?.labels_valid || 0),
      labels_invalid: Number(payload.summary?.labels_invalid || 0),
      ...compactMetricSummary(scoring),
      manual_review_total: Number(manualReview.total || 0),
      non_manual_total: Number(nonManual.total || 0),
    },
    distributions: {
      predicted_distribution: topDistributionEntries(scoring.predicted_distribution),
      actual_distribution: topDistributionEntries(scoring.actual_distribution),
      manual_review_predicted_distribution: topDistributionEntries(manualReview.predicted_distribution),
      manual_review_raw_predicted_distribution: topDistributionEntries(manualReview.raw_predicted_distribution),
      manual_review_flag_distribution: topDistributionEntries(manualReview.flag_distribution),
      manual_review_selection_reason_distribution: topDistributionEntries(manualReview.selection_reason_distribution),
      manual_review_target_category_distribution: topDistributionEntries(manualReview.target_category_distribution),
      manual_review_rescue_confidence_distribution: topDistributionEntries(manualReview.rescue_confidence_distribution),
      non_manual_predicted_distribution: topDistributionEntries(nonManual.predicted_distribution),
      non_manual_selection_reason_distribution: topDistributionEntries(nonManual.selection_reason_distribution),
    },
    breakdowns: {
      by_round: topMetricBreakdowns(payload.by_round),
      by_bucket: topMetricBreakdowns(payload.by_bucket),
      by_selection_reason: topMetricBreakdowns(payload.by_selection_reason),
      manual_review_metrics: compactMetricSummary(manualReview.metrics || {}),
      non_manual_metrics: compactMetricSummary(nonManual.metrics || {}),
    },
    false_positives: Array.isArray(scoring.false_positives) ? scoring.false_positives.slice(0, 10) : [],
    false_negatives: Array.isArray(scoring.false_negatives) ? scoring.false_negatives.slice(0, 10) : [],
    invalid_labels: Array.isArray(payload.invalid_labels) ? payload.invalid_labels.slice(0, 10) : [],
    safety: {
      db_writes: false,
      memory_file_mutation: false,
      unarchive: false,
      category_update: false,
      delete: false,
      quarantine: false,
      reinforce: false,
      llm: false,
      network: false,
    },
  };
}

function extractAnnotationLocalQcPreview(entry, content, format) {
  if (entry?.kind !== "annotation_local_qc_report") return null;
  if (format !== "json") return null;
  const payload = parseJsonContent(content);
  if (!payload || payload.mode !== "annotation_local_qc_report") return null;
  const summary = payload.summary || {};
  return {
    summary: {
      mode: "read_only_annotation_local_qc_preview",
      generated_at: payload.generated_at || null,
      total_candidates: Number(summary.total_candidates || 0),
      unique_candidate_sample_ids: Number(summary.unique_candidate_sample_ids || 0),
      duplicate_candidate_sample_ids: Number(summary.duplicate_candidate_sample_ids || 0),
      labeled_count: Number(summary.labeled_count || 0),
      unlabeled_count: Number(summary.unlabeled_count || 0),
      coverage_rate: Number(summary.coverage_rate || 0),
      last_label_import: summary.last_label_import || null,
    },
    distributions: {
      candidate_bucket_distribution: topDistributionEntries(summary.candidate_bucket_distribution),
      queue_reason_distribution: topDistributionEntries(summary.queue_reason_distribution),
      quality_distribution: topDistributionEntries(summary.quality_distribution),
      keep_active_distribution: topDistributionEntries(summary.keep_active_distribution),
      preferred_action_distribution: topDistributionEntries(summary.preferred_action_distribution),
      target_category_distribution: topDistributionEntries(summary.target_category_distribution),
      rescue_confidence_distribution: topDistributionEntries(summary.rescue_confidence_distribution),
    },
    unlabeled_samples: Array.isArray(payload.unlabeled_samples) ? payload.unlabeled_samples.slice(0, 10) : [],
    duplicate_candidate_sample_ids: Array.isArray(payload.duplicate_candidate_sample_ids) ? payload.duplicate_candidate_sample_ids.slice(0, 10) : [],
    safety: {
      db_writes: false,
      memory_file_mutation: false,
      upload: false,
      apply: false,
      archive: false,
      delete: false,
      quarantine: false,
      reinforce: false,
      llm: false,
      network: false,
    },
  };
}

function extractReviewQueueLabelPreview(entry, content, format) {
  if (entry?.kind !== "archived_raw_log_rescue_review_queue_label_report") return null;
  if (format !== "json") return null;
  const payload = parseJsonContent(content);
  if (!payload || payload.mode !== "archived_raw_log_rescue_review_queue_label_report") return null;
  const summary = payload.summary || {};
  return {
    summary: {
      mode: "read_only_review_queue_label_preview",
      queue_total: Number(summary.queue_total || 0),
      queue_valid: Number(summary.queue_valid || 0),
      queue_unique_sample_ids: Number(summary.queue_unique_sample_ids || 0),
      queue_invalid: Number(summary.queue_invalid || 0),
      queue_duplicate_sample_ids: Number(summary.queue_duplicate_sample_ids || 0),
      labels_total: Number(summary.labels_total || 0),
      labels_valid_aligned: Number(summary.labels_valid_aligned || 0),
      labels_invalid: Number(summary.labels_invalid || 0),
      labels_not_in_queue: Number(summary.labels_not_in_queue || 0),
      labels_identity_mismatch: Number(summary.labels_identity_mismatch || 0),
      labels_duplicate_sample_ids: Number(summary.labels_duplicate_sample_ids || 0),
      queue_unlabeled: Number(summary.queue_unlabeled || 0),
      coverage_rate: Number(summary.coverage_rate || 0),
    },
    distributions: {
      queue_reason_distribution: topDistributionEntries(summary.queue_reason_distribution),
      queue_bucket_distribution: topDistributionEntries(summary.queue_bucket_distribution),
      quality_distribution: topDistributionEntries(summary.quality_distribution),
      keep_active_distribution: topDistributionEntries(summary.keep_active_distribution),
      preferred_action_distribution: topDistributionEntries(summary.preferred_action_distribution),
      target_category_distribution: topDistributionEntries(summary.target_category_distribution),
      rescue_confidence_distribution: topDistributionEntries(summary.rescue_confidence_distribution),
    },
    blockers: {
      queue_errors: Array.isArray(payload.queue_errors) ? payload.queue_errors.slice(0, 10) : [],
      invalid_labels: Array.isArray(payload.invalid_labels) ? payload.invalid_labels.slice(0, 10) : [],
      labels_not_in_queue: Array.isArray(payload.labels_not_in_queue) ? payload.labels_not_in_queue.slice(0, 10) : [],
      identity_mismatch_labels: Array.isArray(payload.identity_mismatch_labels) ? payload.identity_mismatch_labels.slice(0, 10) : [],
      duplicate_queue_sample_ids: Array.isArray(payload.duplicate_queue_sample_ids) ? payload.duplicate_queue_sample_ids.slice(0, 10) : [],
      duplicate_label_sample_ids: Array.isArray(payload.duplicate_label_sample_ids) ? payload.duplicate_label_sample_ids.slice(0, 10) : [],
    },
    unlabeled_queue_samples: Array.isArray(payload.unlabeled_queue_samples) ? payload.unlabeled_queue_samples.slice(0, 10) : [],
    valid_labels: Array.isArray(payload.valid_labels) ? payload.valid_labels.slice(0, 10) : [],
    safety: {
      db_writes: false,
      memory_file_mutation: false,
      unarchive: false,
      category_update: false,
      delete: false,
      quarantine: false,
      reinforce: false,
      llm: false,
      network: false,
    },
  };
}

export function listReports() {
  const dir = getReportsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => isAllowedReportName(name))
    .filter(name => {
      try {
        return fs.statSync(path.join(dir, name)).isFile();
      } catch {
        return false;
      }
    })
    .map(name => toReportEntry(dir, name))
    .sort(sortReports);
}

function isLatestStructuredPreviewCandidate(file) {
  if (file.kind === "archived_raw_log_rescue_combined_report") return file.name.endsWith(".json");
  if (file.kind === "archived_raw_log_rescue_review_queue") return file.name.endsWith(".jsonl");
  if (file.kind === "archived_raw_log_rescue_review_queue_label_report") return file.name.endsWith(".json");
  return true;
}

export function latestReports() {
  const files = listReports();
  const latest = Object.fromEntries(LATEST_KIND_KEYS.map(kind => [kind, null]));
  for (const file of files) {
    if (LATEST_KIND_KEYS.includes(file.kind) && !latest[file.kind] && isLatestStructuredPreviewCandidate(file)) latest[file.kind] = file;
  }
  return latest;
}

export function readReportFile(name) {
  const validName = validateReportName(name);
  const dir = getReportsDir();
  const file = path.join(dir, validName);
  const resolved = path.resolve(file);
  const resolvedDir = path.resolve(dir) + path.sep;
  if (!resolved.startsWith(resolvedDir) && resolved !== path.resolve(dir, validName)) {
    throw new Error("report file is outside reports directory");
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("report file not found");
  }
  const entry = toReportEntry(dir, validName);
  const content = fs.readFileSync(resolved, "utf8");
  return {
    ...entry,
    content,
    format: path.extname(validName).replace(/^\./, ""),
    decision_trace: extractAutoRecallDecisionTrace(entry, content, path.extname(validName).replace(/^\./, "")),
    memory_card_preview: extractMemoryCardPreview(entry, content, path.extname(validName).replace(/^\./, "")),
    rescue_combined_preview: extractRescueCombinedPreview(entry, content, path.extname(validName).replace(/^\./, "")),
    review_queue_preview: extractReviewQueuePreview(entry, content, path.extname(validName).replace(/^\./, "")),
    annotation_local_qc_preview: extractAnnotationLocalQcPreview(entry, content, path.extname(validName).replace(/^\./, "")),
    review_queue_label_preview: extractReviewQueueLabelPreview(entry, content, path.extname(validName).replace(/^\./, "")),
  };
}

export function reportsPageSnapshot() {
  return {
    files: listReports(),
    latest: latestReports(),
    safety_status: {
      suspected_tool_output_hard_deny: {
        enabled: true,
        summary: "suspected_tool_output 会被 autoRecall hard deny，并禁止自动强化。",
      },
      raw_log_leak_risk_only: {
        enabled: true,
        summary: "raw_log_leak 仅作为风险信号，不会单桶自动 quarantine 或 delete。",
      },
      reinforcement_default_deny: {
        enabled: true,
        summary: "before_agent_finalize 采用 default-deny；只允许 autoRecall allowlist 与本 turn memory_engine_get 命中的 id。",
      },
      long_input_intent_gate: {
        enabled: true,
        summary: "长输入默认跳过 autoRecall；只有显式历史/项目依赖时才使用 focused_query。",
      },
    },
  };
}

export function annotationReportsSnapshot() {
  const files = listReports();
  return {
    available_candidates: files.filter(file => (
      file.kind === "annotation_candidates"
      || (file.kind === "archived_raw_log_rescue_review_queue" && file.name.endsWith(".jsonl"))
    )),
    available_labels: files.filter(file => file.kind === "annotation_labels"),
  };
}

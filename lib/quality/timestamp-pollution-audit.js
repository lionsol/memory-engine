import { collectQualityCandidates } from "./collect-quality-candidates.js";
import { evaluateQualityFlags } from "./quality-rules.js";
import { detectTimestampPollution } from "./timestamp-pollution.js";
import {
  openAuditDb,
  resolveAuditDbPaths,
  writeAuditReport,
} from "./chunks-without-confidence-audit.js";

const HISTORICAL_BUCKET_CUTOFF = "2026-06-15T00:00:00.000Z";
const AMBIGUOUS_FIX_WINDOW_END = "2026-06-20T00:00:00.000Z";

function compareStrings(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function toShare(count, total) {
  const n = Number(count) || 0;
  const d = Number(total) || 0;
  if (d <= 0) return 0;
  return Math.round((n / d) * 10000) / 10000;
}

function toIsoDateTime(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const millis = raw > 1e12 ? raw : raw * 1000;
  return new Date(millis).toISOString();
}

function safePreview(text, maxLength = 160) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

function normalizePath(path) {
  return String(path ?? "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function inferPathPrefix(path) {
  const normalized = normalizePath(path);
  if (!normalized) return "unknown";
  if (normalized === "MEMORY.md") return "MEMORY.md";
  if (
    normalized.startsWith("memory/smart-add/")
    || normalized.startsWith("memory/episodes/")
    || normalized.startsWith("memory/dreaming/")
    || normalized.startsWith("memory/projects/")
    || normalized.startsWith("memory/raw_log/")
  ) {
    return normalized.split("/").slice(0, 2).join("/");
  }
  return normalized;
}

function buildBreakdown(items, keyField, selector) {
  const counts = new Map();
  for (const item of items) {
    const key = String(selector(item) ?? "unknown");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({
      [keyField]: key,
      count,
      share: toShare(count, items.length),
    }))
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || compareStrings(a[keyField], b[keyField]));
}

function readPathMetadata(db) {
  const rows = db.prepare(`
    SELECT path, source, mtime
    FROM core.files
    ORDER BY path ASC
  `).all();
  const byPath = new Map();
  for (const row of rows) {
    byPath.set(String(row.path || ""), {
      file_source: row.source ?? null,
      file_mtime: row.mtime ?? null,
    });
  }
  return byPath;
}

function determineCreatedBucket(createdAt) {
  if (!createdAt) return "unknown_fix_window";
  if (String(createdAt) < HISTORICAL_BUCKET_CUTOFF) return "created_before_raw_log_fix";
  if (String(createdAt) >= AMBIGUOUS_FIX_WINDOW_END) return "created_after_raw_log_fix";
  return "unknown_fix_window";
}

function inferSourceType(candidate, fileMeta) {
  return String(candidate?.source ?? fileMeta?.file_source ?? "unknown") || "unknown";
}

function inferLikelySource(candidate, detection) {
  const text = String(candidate?.text ?? "");
  const family = String(candidate?.quality_scope_family || "unknown");
  const owner = String(candidate?.quality_scope_owner || "unknown");

  if (
    /memory_candidate_retrieved|memory_injected|vector_score|fts_score|final_score|candidate_count|post_rerank_count|lexical_confidence|debug\.sync/i.test(text)
  ) {
    return "autoRecall_trace";
  }
  if (
    /llm\s*[—-]?\s*ok|embedding\s*[—-]?\s*ok|vision\s*[—-]?\s*ok|healthcheck|硅基流动健康检查/i.test(text)
  ) {
    return "healthcheck_note";
  }
  if (owner === "memory_engine_generated_or_diagnostic" || family === "dreaming" || family === "stats_history") {
    return "generated_artifact";
  }
  const emphasizedTurns = (
    text.match(/\*\*(user|assistant|system|tool)\*\s*:/gi)
    || text.match(/\*\*(user|assistant|system|tool):\*\*/gi)
    || []
  ).length;
  if (emphasizedTurns >= 2) {
    return "checkpoint_input";
  }
  if (emphasizedTurns >= 1) {
    return "session_event_formatter";
  }
  if (
    /^(user|assistant|system|tool):/im.test(text)
    || /\brole\s*:\s*(user|assistant|system|tool)\b/i.test(text)
    || /"type"\s*:\s*"message"/i.test(text)
    || /"role"\s*:\s*"(user|assistant|system|tool)"/i.test(text)
  ) {
    return "raw_log_parser";
  }
  if (family === "smart_add" && detection.detected) {
    return "smart_add_writer";
  }
  return "unknown";
}

function inferRiskLevel(candidate, createdBucket, detection, likelySource) {
  const retrieved = Number(candidate?.retrieved_count || 0);
  const injected = Number(candidate?.injected_count || 0);
  if (retrieved > 0 || injected > 0) return "high";
  if (createdBucket === "created_after_raw_log_fix") return "high";
  if (candidate?.default_quality_score_scope) return "medium";
  if (likelySource === "generated_artifact" || likelySource === "healthcheck_note") return "low";
  if (detection.detected_pattern === "bracketed_time_prefix") return "medium";
  return "low";
}

function inferRecommendedAction(candidate, createdBucket, likelySource, detection) {
  const text = String(candidate?.text ?? "");
  const meaningfulDateHeading = /^#{1,6}\s+\d{4}-\d{2}-\d{2}\b/m.test(text)
    && !detection.detected;
  if (meaningfulDateHeading) return "false_positive_rule_review";
  if (createdBucket === "created_after_raw_log_fix") return "source_fix";
  if (
    candidate?.quality_scope_family === "daily_memory"
    || candidate?.quality_scope_family === "curated_memory"
    || likelySource === "healthcheck_note"
  ) {
    return "false_positive_rule_review";
  }
  if (createdBucket === "created_before_raw_log_fix") return "historical_cleanup_candidate";
  return "none";
}

function buildHypotheses(items, report) {
  const sourceBreakdown = report.breakdowns.by_likely_source;
  const familyBreakdown = report.breakdowns.by_family;
  const topSource = sourceBreakdown[0];
  const topFamily = familyBreakdown[0];
  const hypotheses = [];

  if (topSource) {
    hypotheses.push({
      id: "dominant_source_family",
      confidence: "medium",
      summary: `timestamp pollution is currently dominated by ${topSource.likely_source} within ${topFamily?.family || "unknown"} paths`,
      evidence: [
        `top likely_source=${topSource.likely_source} count=${topSource.count}`,
        `top family=${topFamily?.family || "unknown"} count=${topFamily?.count || 0}`,
      ],
    });
  }

  if (report.summary.created_after_raw_log_fix > 0) {
    hypotheses.push({
      id: "still_active_after_fix_window",
      confidence: "medium",
      summary: "some timestamp-polluted entries were created after the ambiguous raw-log fix window, so active generation cannot be ruled out",
      evidence: [
        `created_after_raw_log_fix=${report.summary.created_after_raw_log_fix}`,
      ],
    });
  } else {
    hypotheses.push({
      id: "mostly_historical_residue",
      confidence: "medium",
      summary: "no entries fall after the post-fix bucket boundary, suggesting timestamp pollution is mostly historical residue in the current snapshot",
      evidence: [
        `created_before_raw_log_fix=${report.summary.created_before_raw_log_fix}`,
        `unknown_fix_window=${report.summary.unknown_fix_window}`,
        `created_after_raw_log_fix=${report.summary.created_after_raw_log_fix}`,
      ],
    });
  }

  if (report.summary.entries_ever_retrieved > 0 || report.summary.entries_ever_injected > 0) {
    hypotheses.push({
      id: "retrieval_impact_present",
      confidence: "medium",
      summary: "timestamp-polluted memories are not purely dormant historical residue because some have retrieval/injection usage",
      evidence: [
        `entries_ever_retrieved=${report.summary.entries_ever_retrieved}`,
        `entries_ever_injected=${report.summary.entries_ever_injected}`,
      ],
    });
  }

  return hypotheses;
}

function buildSampleRow(candidate) {
  return {
    chunk_id: candidate.id,
    path: candidate.path,
    family: candidate.quality_scope_family,
    owner: candidate.quality_scope_owner,
    category: candidate.category ?? null,
    source_type: candidate.source_type,
    created_at: candidate.created_at,
    updated_at: candidate.updated_at_iso,
    detected_pattern: candidate.detected_pattern,
    matched_text: candidate.matched_text,
    content_preview: candidate.content_preview,
    retrieved_count: Number(candidate.retrieved_count || 0),
    injected_count: Number(candidate.injected_count || 0),
    likely_source: candidate.likely_source,
    is_recent_after_fix: candidate.is_recent_after_fix,
    risk_level: candidate.risk_level,
    recommended_action: candidate.recommended_action,
  };
}

export function buildTimestampPollutionAudit({
  generatedAt = new Date().toISOString(),
  candidateSource = null,
  pathMetadata = null,
} = {}) {
  const candidateResult = candidateSource || collectQualityCandidates({ scope: "all" });
  const candidates = Array.isArray(candidateResult?.candidates) ? candidateResult.candidates : [];
  const metadataMap = pathMetadata instanceof Map ? pathMetadata : new Map();
  const nowSec = Math.floor(Date.now() / 1000);

  const polluted = candidates.map(candidate => {
    const evaluated = evaluateQualityFlags(candidate, { nowSec });
    if (!(evaluated.p0_flags || []).includes("timestamp_pollution")) return null;
    const detection = detectTimestampPollution(candidate.text);
    const fileMeta = metadataMap.get(String(candidate.path || "")) || null;
    const createdAt = toIsoDateTime(fileMeta?.file_mtime ?? candidate.updated_at);
    const createdBucket = determineCreatedBucket(createdAt);
    const likelySource = inferLikelySource(candidate, detection);
    return {
      ...candidate,
      source_type: inferSourceType(candidate, fileMeta),
      created_at: createdAt,
      updated_at_iso: toIsoDateTime(candidate.updated_at),
      detected_pattern: detection.detected_pattern,
      matched_text: detection.matched_text,
      content_preview: safePreview(candidate.text),
      path_prefix: inferPathPrefix(candidate.path),
      created_day: createdAt ? createdAt.slice(0, 10) : "unknown",
      likely_source: likelySource,
      created_bucket: createdBucket,
      is_recent_after_fix: createdBucket === "created_after_raw_log_fix",
      risk_level: inferRiskLevel(candidate, createdBucket, detection, likelySource),
      recommended_action: inferRecommendedAction(candidate, createdBucket, likelySource, detection),
    };
  }).filter(Boolean).sort((a, b) => (
    compareStrings(a.path, b.path)
    || compareStrings(a.id, b.id)
  ));

  const summary = {
    timestamp_pollution_total: polluted.length,
    default_scope_count: polluted.filter(item => item.default_quality_score_scope).length,
    all_scope_count: polluted.length,
    lifecycle_owned_count: polluted.filter(item => item.quality_scope_owner === "memory_engine_lifecycle").length,
    core_owned_count: polluted.filter(item => item.quality_scope_owner === "openclaw_core").length,
    generated_or_diagnostic_count: polluted.filter(item => item.quality_scope_owner === "memory_engine_generated_or_diagnostic").length,
    legacy_or_manual_count: polluted.filter(item => item.quality_scope_owner === "memory_engine_legacy_or_manual" || item.quality_scope_owner === "raw_or_legacy").length,
    unknown_count: polluted.filter(item => item.quality_scope_owner === "unknown").length,
    retrieved_count_total: polluted.reduce((sum, item) => sum + Number(item.retrieved_count || 0), 0),
    injected_count_total: polluted.reduce((sum, item) => sum + Number(item.injected_count || 0), 0),
    entries_ever_retrieved: polluted.filter(item => Number(item.retrieved_count || 0) > 0).length,
    entries_ever_injected: polluted.filter(item => Number(item.injected_count || 0) > 0).length,
    created_before_raw_log_fix: polluted.filter(item => item.created_bucket === "created_before_raw_log_fix").length,
    created_after_raw_log_fix: polluted.filter(item => item.created_bucket === "created_after_raw_log_fix").length,
    unknown_fix_window: polluted.filter(item => item.created_bucket === "unknown_fix_window").length,
  };

  const breakdowns = {
    by_owner: buildBreakdown(polluted, "owner", item => item.quality_scope_owner),
    by_family: buildBreakdown(polluted, "family", item => item.quality_scope_family),
    by_category: buildBreakdown(polluted, "category", item => String(item.category ?? "null")),
    by_path_prefix: buildBreakdown(polluted, "path_prefix", item => item.path_prefix),
    by_created_day: buildBreakdown(polluted, "created_day", item => item.created_day),
    by_detected_pattern: buildBreakdown(polluted, "detected_pattern", item => item.detected_pattern),
    by_likely_source: buildBreakdown(polluted, "likely_source", item => item.likely_source),
  };

  const samples = {
    default_scope_examples: polluted
      .filter(item => item.default_quality_score_scope)
      .slice(0, 10)
      .map(buildSampleRow),
    recent_examples: polluted
      .filter(item => item.is_recent_after_fix)
      .sort((a, b) => compareStrings(b.created_at, a.created_at) || compareStrings(a.path, b.path) || compareStrings(a.id, b.id))
      .slice(0, 10)
      .map(buildSampleRow),
    retrieved_examples: polluted
      .filter(item => Number(item.retrieved_count || 0) > 0)
      .sort((a, b) => Number(b.retrieved_count || 0) - Number(a.retrieved_count || 0) || Number(b.injected_count || 0) - Number(a.injected_count || 0) || compareStrings(a.path, b.path) || compareStrings(a.id, b.id))
      .slice(0, 10)
      .map(buildSampleRow),
    injected_examples: polluted
      .filter(item => Number(item.injected_count || 0) > 0)
      .sort((a, b) => Number(b.injected_count || 0) - Number(a.injected_count || 0) || Number(b.retrieved_count || 0) - Number(a.retrieved_count || 0) || compareStrings(a.path, b.path) || compareStrings(a.id, b.id))
      .slice(0, 10)
      .map(buildSampleRow),
    top_path_examples: polluted
      .slice()
      .sort((a, b) => compareStrings(a.path_prefix, b.path_prefix) || compareStrings(a.path, b.path) || compareStrings(a.id, b.id))
      .slice(0, 10)
      .map(buildSampleRow),
  };

  const report = {
    generated_at: generatedAt,
    mode: "read_only",
    summary,
    breakdowns,
    samples,
    hypotheses: [],
  };
  report.hypotheses = buildHypotheses(polluted, report);
  return report;
}

export function renderTimestampPollutionMarkdown(report) {
  const topOwners = (report.breakdowns.by_owner || []).map(row => `- ${row.owner}: ${row.count} (${row.share})`).join("\n") || "- none";
  const topFamilies = (report.breakdowns.by_family || []).map(row => `- ${row.family}: ${row.count} (${row.share})`).join("\n") || "- none";
  const topSources = (report.breakdowns.by_likely_source || []).map(row => `- ${row.likely_source}: ${row.count} (${row.share})`).join("\n") || "- none";
  const hypotheses = (report.hypotheses || []).map(item => `- [${item.confidence}] ${item.id}: ${item.summary}`).join("\n") || "- none";

  return `# Timestamp Pollution Audit

## Summary

- generated_at: ${report.generated_at}
- mode: ${report.mode}
- timestamp_pollution_total: ${report.summary.timestamp_pollution_total}
- default_scope_count: ${report.summary.default_scope_count}
- all_scope_count: ${report.summary.all_scope_count}
- lifecycle_owned_count: ${report.summary.lifecycle_owned_count}
- core_owned_count: ${report.summary.core_owned_count}
- generated_or_diagnostic_count: ${report.summary.generated_or_diagnostic_count}
- legacy_or_manual_count: ${report.summary.legacy_or_manual_count}
- unknown_count: ${report.summary.unknown_count}
- retrieved_count_total: ${report.summary.retrieved_count_total}
- injected_count_total: ${report.summary.injected_count_total}
- entries_ever_retrieved: ${report.summary.entries_ever_retrieved}
- entries_ever_injected: ${report.summary.entries_ever_injected}
- created_before_raw_log_fix: ${report.summary.created_before_raw_log_fix}
- created_after_raw_log_fix: ${report.summary.created_after_raw_log_fix}
- unknown_fix_window: ${report.summary.unknown_fix_window}

## Owners

${topOwners}

## Families

${topFamilies}

## Likely Sources

${topSources}

## Hypotheses

${hypotheses}
`;
}

export function runTimestampPollutionAudit(options = {}) {
  const dbPaths = options.dbPaths || resolveAuditDbPaths();
  const db = openAuditDb(dbPaths);
  try {
    const pathMetadata = readPathMetadata(db);
    return buildTimestampPollutionAudit({
      generatedAt: options.generatedAt || new Date().toISOString(),
      candidateSource: options.candidateSource || null,
      pathMetadata,
    });
  } finally {
    db.close();
  }
}

export {
  HISTORICAL_BUCKET_CUTOFF,
  AMBIGUOUS_FIX_WINDOW_END,
  inferLikelySource,
  inferRecommendedAction,
  determineCreatedBucket,
  buildSampleRow,
  writeAuditReport,
};

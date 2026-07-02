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
  { kind: "auto_recall_safety_smoke", regex: /^auto-recall-safety-smoke-\d{8}-\d{6}\.md$/ },
  { kind: "auto_recall_long_input_smoke", regex: /^auto-recall-long-input-smoke-\d{8}-\d{6}\.(json|md)$/ },
  { kind: "auto_recall_turn_gold_set_replay", regex: /^auto-recall-turn-gold-set-replay-\d{8}-\d{6}\.json$/ },
];

const LATEST_KIND_KEYS = [
  "annotation_summary",
  "annotation_eligibility_preview",
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

export function latestReports() {
  const files = listReports();
  const latest = Object.fromEntries(LATEST_KIND_KEYS.map(kind => [kind, null]));
  for (const file of files) {
    if (LATEST_KIND_KEYS.includes(file.kind) && !latest[file.kind]) latest[file.kind] = file;
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
    available_candidates: files.filter(file => file.kind === "annotation_candidates"),
    available_labels: files.filter(file => file.kind === "annotation_labels"),
  };
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const REPORT_PATTERNS = [
  { kind: "annotation_candidates", regex: /^annotation-candidates-\d{8}-\d{6}\.(jsonl|md)$/ },
  { kind: "annotation_labels", regex: /^annotation-labels-.*\.jsonl$/ },
  { kind: "annotation_summary", regex: /^annotation-summary-\d{8}-\d{6}\.(json|md)$/ },
  { kind: "annotation_eligibility_preview", regex: /^annotation-eligibility-preview-\d{8}-\d{6}\.(json|md)$/ },
  { kind: "auto_recall_safety_smoke", regex: /^auto-recall-safety-smoke-\d{8}-\d{6}\.md$/ },
];

const LATEST_KIND_KEYS = [
  "annotation_summary",
  "annotation_eligibility_preview",
  "auto_recall_safety_smoke",
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

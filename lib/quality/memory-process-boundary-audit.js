import { loadOpenClawConfig } from "../../memory-manager-runtime.js";
import { collectQualityCandidates } from "./collect-quality-candidates.js";
import {
  openAuditDb,
  resolveAuditDbPaths,
  writeAuditReport,
} from "./chunks-without-confidence-audit.js";

const DEFAULT_BOUNDARY_HOUR = 3;

function compareStrings(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return value;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^-?\d+$/.test(raw)) return toMillis(Number(raw));
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoDateTime(value) {
  const millis = toMillis(value);
  if (!Number.isFinite(millis) || millis <= 0) return null;
  return new Date(millis).toISOString();
}

function schemaHasTable(db, schema, tableName) {
  try {
    const row = db.prepare(
      `SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`,
    ).get(String(tableName || ""));
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

function getDeepValue(object, path) {
  let current = object;
  for (const segment of path) {
    if (!current || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

function detectBoolean(paths, cfg) {
  for (const path of paths) {
    const value = getDeepValue(cfg, path);
    if (typeof value === "boolean") {
      return {
        detectable: true,
        value,
        source_path: path.join("."),
      };
    }
  }
  return {
    detectable: false,
    value: null,
    source_path: null,
  };
}

function normalizeObservation({ key, expected, detected, detectable, sourcePath = null, detail = null }) {
  let status = "not_detectable";
  if (detectable) {
    status = detected === expected ? "match" : "mismatch";
  }
  return {
    key,
    expected,
    detected,
    detectable,
    status,
    source_path: sourcePath,
    detail,
  };
}

export function resolveLatestLocalBoundary({ now = new Date(), boundaryHour = DEFAULT_BOUNDARY_HOUR } = {}) {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new Error("invalid now value");
  }
  const boundary = new Date(date.getTime());
  boundary.setHours(Number(boundaryHour) || DEFAULT_BOUNDARY_HOUR, 0, 0, 0);
  if (date.getTime() < boundary.getTime()) {
    boundary.setDate(boundary.getDate() - 1);
  }
  return {
    boundary,
    iso: boundary.toISOString(),
    epoch_ms: boundary.getTime(),
    boundary_hour_local: Number(boundaryHour) || DEFAULT_BOUNDARY_HOUR,
  };
}

export function resolveAuditSince(input, { now = new Date() } = {}) {
  if (input === undefined || input === null || input === "") {
    const boundary = resolveLatestLocalBoundary({ now });
    return {
      source: "default_latest_local_03_00_boundary",
      input: null,
      iso: boundary.iso,
      epoch_ms: boundary.epoch_ms,
      boundary_hour_local: boundary.boundary_hour_local,
    };
  }

  const millis = toMillis(input);
  if (!Number.isFinite(millis)) {
    throw new Error(`invalid --since value: ${input}`);
  }
  return {
    source: "cli",
    input: String(input),
    iso: new Date(millis).toISOString(),
    epoch_ms: millis,
    boundary_hour_local: DEFAULT_BOUNDARY_HOUR,
  };
}

function detectMemoryCoreSearch(cfg) {
  const deny = Array.isArray(cfg?.tools?.deny) ? cfg.tools.deny.map(item => String(item)) : [];
  const slot = cfg?.plugins?.slots?.memory;
  if (typeof slot === "string") {
    if (slot === "none") {
      return normalizeObservation({
        key: "memory_core_search",
        expected: true,
        detected: false,
        detectable: true,
        sourcePath: "plugins.slots.memory",
        detail: "memory slot is explicitly disabled",
      });
    }
    if (slot !== "memory-core") {
      return normalizeObservation({
        key: "memory_core_search",
        expected: true,
        detected: false,
        detectable: true,
        sourcePath: "plugins.slots.memory",
        detail: `memory slot points to ${slot}`,
      });
    }
  }

  const denied = deny.includes("memory_search") || deny.includes("memory_get");
  return normalizeObservation({
    key: "memory_core_search",
    expected: true,
    detected: !denied,
    detectable: true,
    sourcePath: "tools.deny",
    detail: denied ? "memory_search or memory_get is denied" : "memory-core search/get remain callable",
  });
}

function detectConfigObservations(configResult, dreamingSummary) {
  const cfg = configResult?.cfg || null;
  const observations = [];

  if (!cfg) {
    observations.push(normalizeObservation({
      key: "active_memory",
      expected: false,
      detected: null,
      detectable: false,
      detail: configResult?.error || "openclaw config unavailable",
    }));
    observations.push(normalizeObservation({
      key: "memory_engine_autoRecall",
      expected: false,
      detected: null,
      detectable: false,
      detail: configResult?.error || "openclaw config unavailable",
    }));
    observations.push(normalizeObservation({
      key: "memory_core_search",
      expected: true,
      detected: null,
      detectable: false,
      detail: configResult?.error || "openclaw config unavailable",
    }));
  } else {
    const activeMemory = detectBoolean([
      ["plugins", "entries", "active-memory", "enabled"],
      ["plugins", "entries", "active-memory", "config", "enabled"],
    ], cfg);
    observations.push(normalizeObservation({
      key: "active_memory",
      expected: false,
      detected: activeMemory.value,
      detectable: activeMemory.detectable,
      sourcePath: activeMemory.source_path,
      detail: activeMemory.detectable ? null : "active-memory flag not present in config",
    }));

    const autoRecall = detectBoolean([
      ["plugins", "entries", "memory-engine", "config", "autoRecall", "enabled"],
      ["memoryEngine", "autoRecall", "enabled"],
      ["autoRecall", "enabled"],
    ], cfg);
    observations.push(normalizeObservation({
      key: "memory_engine_autoRecall",
      expected: false,
      detected: autoRecall.detected ?? autoRecall.value,
      detectable: autoRecall.detectable,
      sourcePath: autoRecall.source_path,
      detail: autoRecall.detectable ? null : "memory-engine autoRecall flag not present; plugin default remains false",
    }));

    observations.push(detectMemoryCoreSearch(cfg));
  }

  observations.push(normalizeObservation({
    key: "dreaming",
    expected: false,
    detected: Number(dreamingSummary?.count || 0) > 0,
    detectable: true,
    sourcePath: "core.files.mtime",
    detail: dreamingSummary?.detectable === false
      ? dreamingSummary?.detail
      : `${Number(dreamingSummary?.count || 0)} dreaming file(s) observed since boundary`,
  }));

  return observations;
}

function readDreamingFilesSince(db, sinceMs) {
  if (!schemaHasTable(db, "core", "files")) {
    return {
      detectable: false,
      detail: "core.files table unavailable",
      count: 0,
      files: [],
    };
  }

  const rows = db.prepare(`
    SELECT path, source, mtime
    FROM core.files
    WHERE path LIKE 'memory/dreaming/%'
    ORDER BY mtime DESC, path ASC
  `).all();

  const files = rows
    .map(row => ({
      path: String(row.path || ""),
      source: row.source ?? null,
      mtime_ms: toMillis(row.mtime),
      mtime: toIsoDateTime(row.mtime),
    }))
    .filter(row => Number.isFinite(row.mtime_ms) && row.mtime_ms >= sinceMs)
    .sort((a, b) => (
      Number(b.mtime_ms || 0) - Number(a.mtime_ms || 0)
      || compareStrings(a.path, b.path)
    ));

  return {
    detectable: true,
    detail: "core.files mtime >= boundary",
    count: files.length,
    files,
  };
}

function summarizeNonLifecycleWarnings(diagnostics) {
  const warnings = diagnostics?.non_lifecycle_recall_warnings || {};
  const injected = Number(warnings.non_lifecycle_injected_count || 0);
  const retrieved = Number(warnings.non_lifecycle_retrieved_count || 0);
  return {
    status: injected > 0 ? "warning" : "clear",
    historical_non_lifecycle_injected_count: injected,
    historical_non_lifecycle_retrieved_count: retrieved,
    examples: Array.isArray(warnings.examples) ? warnings.examples.slice(0, 10) : [],
  };
}

function computeBoundaryVerdict(observations = []) {
  const failures = [];
  const warnings = [];

  for (const observation of observations) {
    if (observation?.status !== "mismatch") continue;
    const key = String(observation.key || "unknown");
    if (["active_memory", "memory_engine_autoRecall", "dreaming"].includes(key)) {
      failures.push(`${key}_mismatch`);
      continue;
    }
    if (key === "memory_core_search") {
      warnings.push("memory_core_search_mismatch");
      continue;
    }
    warnings.push(`${key}_mismatch`);
  }

  return {
    status: failures.length > 0 ? "fail" : "pass",
    failures,
    warnings,
  };
}

async function withAuditDbEnv(dbPaths, fn) {
  const previousCore = process.env.MEMORY_ENGINE_CORE_DB;
  const previousEngine = process.env.MEMORY_ENGINE_DB;
  const previousEnginePath = process.env.MEMORY_ENGINE_DB_PATH;
  process.env.MEMORY_ENGINE_CORE_DB = dbPaths.coreDbPath;
  process.env.MEMORY_ENGINE_DB = dbPaths.engineDbPath;
  process.env.MEMORY_ENGINE_DB_PATH = dbPaths.engineDbPath;
  try {
    return await fn();
  } finally {
    if (previousCore === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = previousCore;
    if (previousEngine === undefined) delete process.env.MEMORY_ENGINE_DB;
    else process.env.MEMORY_ENGINE_DB = previousEngine;
    if (previousEnginePath === undefined) delete process.env.MEMORY_ENGINE_DB_PATH;
    else process.env.MEMORY_ENGINE_DB_PATH = previousEnginePath;
  }
}

export function buildMemoryProcessBoundaryAudit({
  generatedAt = new Date().toISOString(),
  since,
  dbPaths = resolveAuditDbPaths(),
  configResult = null,
  dreamingSummary = null,
  qualityResult = null,
} = {}) {
  const warnings = summarizeNonLifecycleWarnings(qualityResult?.diagnostics || {});
  const baseline = {
    active_memory: "off",
    dreaming: "off",
    memory_engine_autoRecall: "off",
    memory_core_search: "on",
  };
  const configObservations = detectConfigObservations(
    configResult || { cfg: null, error: "openclaw config unavailable", configPath: null },
    dreamingSummary || { detectable: false, detail: "dreaming audit unavailable", count: 0, files: [] },
  );
  const verdict = computeBoundaryVerdict(configObservations);

  return {
    generated_at: generatedAt,
    mode: "read_only",
    status: verdict.status,
    boundary_failures: verdict.failures,
    boundary_warnings: verdict.warnings,
    since,
    db_paths: {
      engine: dbPaths.engineDbPath,
      core: dbPaths.coreDbPath,
    },
    expected_baseline: baseline,
    config: {
      config_path: configResult?.configPath || null,
      read_error: configResult?.error || null,
      observations: configObservations,
    },
    dreaming_files_since_boundary: {
      detectable: Boolean(dreamingSummary?.detectable),
      detail: dreamingSummary?.detail || null,
      count: Number(dreamingSummary?.count || 0),
      files: Array.isArray(dreamingSummary?.files) ? dreamingSummary.files : [],
    },
    non_lifecycle_recall_warning_summary: warnings,
    side_effects: {
      db_writes: false,
      memory_file_mutation: false,
      config_mutation: false,
      archive: false,
      quarantine: false,
      reinforce: false,
    },
  };
}

export function renderMemoryProcessBoundaryMarkdown(report) {
  const configLines = (report?.config?.observations || [])
    .map(item => {
      const detected = item.detectable ? String(item.detected) : "not_detectable";
      const source = item.source_path ? ` source=${item.source_path}` : "";
      const detail = item.detail ? ` detail=${item.detail}` : "";
      return `- ${item.key}: expected=${item.expected} detected=${detected} status=${item.status}${source}${detail}`;
    })
    .join("\n") || "- none";
  const dreamingFiles = (report?.dreaming_files_since_boundary?.files || [])
    .map(row => `- ${row.path} (${row.mtime || "unknown"})`)
    .join("\n") || "- none";
  const recallExamples = (report?.non_lifecycle_recall_warning_summary?.examples || [])
    .map(row => `- ${row.path} owner=${row.owner} retrieved=${row.retrieved_count} injected=${row.injected_count}`)
    .join("\n") || "- none";

  return `# Memory Process Boundary Audit

## Status

- status: ${report.status}
- boundary_failures: ${report.boundary_failures?.length ? report.boundary_failures.join(", ") : "none"}
- boundary_warnings: ${report.boundary_warnings?.length ? report.boundary_warnings.join(", ") : "none"}
- mode: ${report.mode}
- generated_at: ${report.generated_at}
- since_source: ${report.since.source}
- since: ${report.since.iso}
- engine_db: ${report.db_paths.engine}
- core_db: ${report.db_paths.core}

## Expected Baseline

- active-memory: ${report.expected_baseline.active_memory}
- dreaming: ${report.expected_baseline.dreaming}
- memory-engine autoRecall: ${report.expected_baseline.memory_engine_autoRecall}
- memory-core search: ${report.expected_baseline.memory_core_search}

## Config Observations

${configLines}

## Dreaming Files Since Boundary

- detectable: ${report.dreaming_files_since_boundary.detectable}
- count: ${report.dreaming_files_since_boundary.count}
- detail: ${report.dreaming_files_since_boundary.detail || "none"}

${dreamingFiles}

## Non-Lifecycle Recall Warnings

- status: ${report.non_lifecycle_recall_warning_summary.status}
- historical_non_lifecycle_injected_count: ${report.non_lifecycle_recall_warning_summary.historical_non_lifecycle_injected_count}
- historical_non_lifecycle_retrieved_count: ${report.non_lifecycle_recall_warning_summary.historical_non_lifecycle_retrieved_count}

${recallExamples}

## Side Effects

- db_writes: ${report.side_effects.db_writes}
- memory_file_mutation: ${report.side_effects.memory_file_mutation}
- config_mutation: ${report.side_effects.config_mutation}
- archive: ${report.side_effects.archive}
- quarantine: ${report.side_effects.quarantine}
- reinforce: ${report.side_effects.reinforce}
`;
}

export async function runMemoryProcessBoundaryAudit(options = {}) {
  const dbPaths = options.dbPaths || resolveAuditDbPaths();
  const since = resolveAuditSince(options.since, { now: options.now || new Date() });
  const configPath = options.configPath || process.env.OPENCLAW_CONFIG_PATH;
  const configResult = options.configResult || loadOpenClawConfig(configPath);
  const qualityResult = options.qualityResult || await withAuditDbEnv(dbPaths, async () => (
    collectQualityCandidates({ scope: "all" })
  ));

  const db = options.db || openAuditDb(dbPaths);
  try {
    const dreamingSummary = options.dreamingSummary || readDreamingFilesSince(db, since.epoch_ms);
    return buildMemoryProcessBoundaryAudit({
      generatedAt: options.generatedAt || new Date().toISOString(),
      since,
      dbPaths,
      configResult,
      dreamingSummary,
      qualityResult,
    });
  } finally {
    if (!options.db) db.close();
  }
}

export {
  readDreamingFilesSince,
  writeAuditReport,
};

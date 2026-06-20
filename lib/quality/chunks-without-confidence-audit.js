import Database from "better-sqlite3";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { attachEventStatsByPrefix } from "./event-prefix-join.js";
import { isWriteSql, patchWriteGuards } from "../db/core-write-guard.js";
import { readUnifiedMemoryEvents } from "../../console/services/metrics-service.js";
import { classifyQualityScope } from "./quality-scope.js";

function escapeSqliteString(value) {
  return String(value || "").replace(/'/g, "''");
}

function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function toIsoDateTime(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const millis = raw > 1e12 ? raw : raw * 1000;
  return new Date(millis).toISOString();
}

function toMonthKey(value) {
  const iso = toIsoDateTime(value);
  return iso ? iso.slice(0, 7) : "unknown";
}

function toShare(count, total) {
  const n = Number(count) || 0;
  const d = Number(total) || 0;
  if (d <= 0) return 0;
  return Math.round((n / d) * 10000) / 10000;
}

function safePreview(text, maxLength = 140) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

function compareStrings(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function sortBreakdownRows(rows, keyField) {
  return rows.sort((a, b) => (
    Number(b.count || 0) - Number(a.count || 0)
    || compareStrings(a[keyField], b[keyField])
  ));
}

function buildBreakdown(items, keyField, valueSelector) {
  const counts = new Map();
  for (const item of items) {
    const key = valueSelector(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return sortBreakdownRows(
    Array.from(counts.entries()).map(([key, count]) => ({
      [keyField]: key,
      count,
      share: toShare(count, items.length),
    })),
    keyField,
  );
}

function aggregateEventRows(rows) {
  const byMemoryId = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const memoryId = String(row?.memory_id ?? "").trim();
    if (!memoryId) continue;
    const existing = byMemoryId.get(memoryId) || {
      memory_id: memoryId,
      retrieved_count: 0,
      injected_count: 0,
      last_retrieved_at: null,
      last_injected_at: null,
    };
    if (row?.event_type === "memory_candidate_retrieved") {
      existing.retrieved_count += 1;
      existing.last_retrieved_at = maxDateTime(existing.last_retrieved_at, row?.created_at ?? null);
    } else if (row?.event_type === "memory_injected") {
      existing.injected_count += 1;
      existing.last_injected_at = maxDateTime(existing.last_injected_at, row?.created_at ?? null);
    }
    byMemoryId.set(memoryId, existing);
  }
  return Array.from(byMemoryId.values()).sort((a, b) => compareStrings(a.memory_id, b.memory_id));
}

function maxDateTime(a, b) {
  if (!a) return b ?? null;
  if (!b) return a ?? null;
  return String(a) >= String(b) ? a : b;
}

function installReadOnlySqlGuard(db) {
  if (!db || typeof db.prepare !== "function" || db.__chunksAuditReadOnlyGuardInstalled) {
    return db;
  }
  const originalPrepare = db.prepare.bind(db);
  const originalExec = db.exec.bind(db);
  db.prepare = (sql, ...args) => {
    if (isWriteSql(sql)) {
      throw new Error(`read-only audit refused write SQL via prepare(): ${String(sql).slice(0, 120)}`);
    }
    return originalPrepare(sql, ...args);
  };
  db.exec = (sql, ...args) => {
    if (isWriteSql(sql)) {
      throw new Error(`read-only audit refused write SQL via exec(): ${String(sql).slice(0, 120)}`);
    }
    return originalExec(sql, ...args);
  };
  Object.defineProperty(db, "__chunksAuditReadOnlyGuardInstalled", {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return db;
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

function inferSourceType(row = {}) {
  return String(row.source ?? row.file_source ?? "unknown") || "unknown";
}

export function inferAuditFamily(path) {
  return classifyQualityScope(path).family;
}

export function inferAuditPathPrefix(path) {
  const normalized = normalizePath(path);
  if (!normalized) return "unknown";
  if (normalized === "MEMORY.md") return "MEMORY.md";
  if (normalized.startsWith("memory/dreaming/")) {
    const parts = normalized.split("/");
    return parts.slice(0, Math.min(3, parts.length)).join("/");
  }
  if (
    normalized.startsWith("memory/smart-add/")
    || normalized.startsWith("memory/episodes/")
    || normalized.startsWith("memory/projects/")
    || normalized.startsWith("memory/raw_log/")
  ) {
    return normalized.split("/").slice(0, 2).join("/");
  }
  return normalized;
}

export function inferManagedStatus(path) {
  const owner = classifyQualityScope(path).owner;
  if (owner === "memory_engine_lifecycle") return "confidence_lifecycle_managed";
  if (owner === "memory_engine_generated_or_diagnostic") return "generated_artifact_outside_lifecycle";
  if (
    owner === "openclaw_core"
    || owner === "memory_engine_legacy_or_manual"
    || owner === "raw_or_legacy"
  ) {
    return "memory_file_outside_lifecycle";
  }
  return "unknown_outside_lifecycle";
}

function likelyRootCauseForFamily(path) {
  const family = inferAuditFamily(path);
  if (family === "dreaming") {
    return "core indexed dreaming markdown, but confidence lifecycle backfill only covers smart-add and episodes";
  }
  if (family === "smart_add" || family === "episode") {
    return "unexpected lifecycle gap inside a family that should normally receive confidence rows";
  }
  return "core indexed memory markdown outside the current smart-add/episodes confidence lifecycle";
}

function buildSampleRow(row) {
  const qualityScope = classifyQualityScope(row.path);
  const family = inferAuditFamily(row.path);
  const managedStatus = inferManagedStatus(row.path);
  return {
    chunk_id: row.id,
    path: row.path,
    source_type: inferSourceType(row),
    category: row.category ?? null,
    family,
    owner: qualityScope.owner,
    expected_confidence: qualityScope.expected_confidence,
    default_quality_score_scope: qualityScope.default_quality_score_scope,
    diagnostic_scope: qualityScope.diagnostic_scope,
    retrieval_visible: qualityScope.retrieval_visible,
    reason: qualityScope.reason,
    memory_engine_managed: managedStatus === "confidence_lifecycle_managed",
    memory_engine_managed_status: managedStatus,
    has_confidence: Boolean(row.has_confidence),
    has_category: row.category !== null && row.category !== undefined,
    created_at: toIsoDateTime(row.file_mtime ?? row.updated_at),
    updated_at: toIsoDateTime(row.updated_at),
    content_hash: row.hash ?? null,
    content_preview: safePreview(row.text),
    retrieved_count: Number(row.retrieved_count || 0),
    injected_count: Number(row.injected_count || 0),
    likely_root_cause: likelyRootCauseForFamily(row.path),
  };
}

function selectRows(db, sql, params = {}) {
  return db.prepare(sql).all(params);
}

function readCandidateRows(db) {
  const hasFiles = schemaHasTable(db, "core", "files");
  const fileMtimeSelect = hasFiles ? "f.mtime AS file_mtime," : "NULL AS file_mtime,";
  const fileSourceSelect = hasFiles ? "f.source AS file_source" : "NULL AS file_source";
  return selectRows(db, `
    SELECT
      c.id AS id,
      c.path AS path,
      c.source AS source,
      c.hash AS hash,
      c.text AS text,
      c.updated_at AS updated_at,
      mc.chunk_id AS confidence_chunk_id,
      mc.category AS category,
      ${fileMtimeSelect}
      ${fileSourceSelect}
    FROM core.chunks c
    LEFT JOIN memory_confidence mc ON mc.chunk_id = c.id
    ${hasFiles ? "LEFT JOIN core.files f ON f.path = c.path" : ""}
    WHERE (c.path LIKE 'memory/%' OR c.path = 'MEMORY.md')
      AND c.path <> 'memory/stats-history.md'
    ORDER BY c.updated_at DESC, c.id ASC
  `).map(row => ({
    ...row,
    has_confidence: Boolean(row.confidence_chunk_id),
  }));
}

function readEventAggRows(db) {
  const unifiedEvents = readUnifiedMemoryEvents(db);
  return aggregateEventRows(unifiedEvents);
}

export function compareFlagSets(rows) {
  const missingConfidenceIds = rows
    .filter(row => !row.has_confidence)
    .map(row => row.id)
    .sort(compareStrings);
  const missingCategoryIds = rows
    .filter(row => row.category === null || row.category === undefined)
    .map(row => row.id)
    .sort(compareStrings);

  const missingConfidenceSet = new Set(missingConfidenceIds);
  const missingCategorySet = new Set(missingCategoryIds);
  const intersection = missingConfidenceIds.filter(id => missingCategorySet.has(id));
  const onlyWithoutConfidence = missingConfidenceIds.filter(id => !missingCategorySet.has(id));
  const onlyMissingCategory = missingCategoryIds.filter(id => !missingConfidenceSet.has(id));

  return {
    missingConfidenceIds,
    missingCategoryIds,
    intersection,
    onlyWithoutConfidence,
    onlyMissingCategory,
  };
}

function buildDreamingSummary(rows) {
  const dreamingRows = rows.filter(row => inferAuditFamily(row.path) === "dreaming");
  const retrievedRows = dreamingRows.filter(row => Number(row.retrieved_count || 0) > 0);
  const injectedRows = dreamingRows.filter(row => Number(row.injected_count || 0) > 0);
  return {
    count: dreamingRows.length,
    share: toShare(dreamingRows.length, rows.length),
    path_examples: Array.from(new Set(dreamingRows.map(row => row.path))).sort(compareStrings).slice(0, 10),
    source_type_breakdown: buildBreakdown(dreamingRows, "source_type", row => inferSourceType(row)),
    retrieval_usage: {
      retrieved_count_total: dreamingRows.reduce((sum, row) => sum + Number(row.retrieved_count || 0), 0),
      injected_count_total: dreamingRows.reduce((sum, row) => sum + Number(row.injected_count || 0), 0),
      chunks_ever_retrieved: retrievedRows.length,
      chunks_ever_injected: injectedRows.length,
    },
  };
}

function buildHypotheses(rows, counts) {
  const familyBreakdown = buildBreakdown(rows, "family", row => inferAuditFamily(row.path));
  const dreaming = familyBreakdown.find(row => row.family === "dreaming");
  const lifecycleManaged = familyBreakdown.find(row => row.family === "smart_add" || row.family === "episode");
  const hypotheses = [
    {
      id: "index_sync_backfill_scope_gap",
      confidence: "high",
      summary: "The missing rows align with paths that are indexed by core but excluded from the current confidence backfill scope.",
      evidence: [
        `intersection_count=${counts.intersection_count} with only_without_confidence=${counts.only_without_confidence} and only_missing_category=${counts.only_missing_category}`,
        `default missing set is dominated by dreaming (${dreaming?.count || 0} rows, share=${dreaming?.share || 0})`,
        "lib/index-sync-runtime.js backfills only memory/smart-add/% and memory/episodes/%",
        "memory-manager-runtime.js only watches memory/smart-add and memory/episodes for sync backfill",
      ],
    },
    {
      id: "not_orphan_confidence_or_historical_leftover",
      confidence: "high",
      summary: "These are live indexed chunks with matching core file records, not orphan confidence leftovers.",
      evidence: [
        "all sampled rows exist in core.chunks and core.files with source=memory",
        "missing rows have has_confidence=false rather than stale confidence rows",
        "quality diagnostics already show orphan confidence count at zero in the current DB",
      ],
    },
  ];
  if (!lifecycleManaged) {
    hypotheses.push({
      id: "dreaming_and_other_memory_files_never_entered_lifecycle",
      confidence: "medium",
      summary: "The current missing set suggests dreaming, daily-memory, curated-memory, project, and raw-log paths were never wired into confidence creation.",
      evidence: familyBreakdown.map(row => `${row.family}=${row.count}`),
    });
  }
  return hypotheses;
}

export function resolveAuditDbPaths() {
  const home = homedir();
  return {
    coreDbPath: process.env.MEMORY_ENGINE_CORE_DB || resolve(home, ".openclaw/memory/main.sqlite"),
    engineDbPath: process.env.MEMORY_ENGINE_DB_PATH
      || process.env.MEMORY_ENGINE_DB
      || resolve(home, ".openclaw/memory/memory-engine/memory-engine.sqlite"),
  };
}

export function openAuditDb(dbPaths = resolveAuditDbPaths()) {
  if (!existsSync(dbPaths.engineDbPath)) {
    throw new Error(`memory-engine DB not found: ${dbPaths.engineDbPath}`);
  }
  if (!existsSync(dbPaths.coreDbPath)) {
    throw new Error(`OpenClaw core DB not found: ${dbPaths.coreDbPath}`);
  }
  const db = new Database(dbPaths.engineDbPath, {
    readonly: true,
    fileMustExist: true,
  });
  db.pragma("busy_timeout = 5000");
  installReadOnlySqlGuard(db);
  db.exec(`ATTACH DATABASE '${escapeSqliteString(dbPaths.coreDbPath)}' AS core`);
  patchWriteGuards(db, { message: "writes to OpenClaw core DB are blocked in read-only chunks audit" });
  return db;
}

export function buildChunksWithoutConfidenceAudit({ db, dbPaths = resolveAuditDbPaths(), generatedAt = new Date().toISOString() } = {}) {
  if (!db) {
    throw new Error("buildChunksWithoutConfidenceAudit requires an open db");
  }
  const candidateRows = readCandidateRows(db);
  const eventAggRows = readEventAggRows(db);
  const joined = attachEventStatsByPrefix(candidateRows, eventAggRows);
  const missingRows = joined.candidates
    .filter(row => !row.has_confidence)
    .map(row => ({
      ...row,
      family: inferAuditFamily(row.path),
      owner: classifyQualityScope(row.path).owner,
      source_type: inferSourceType(row),
      memory_engine_managed_status: inferManagedStatus(row.path),
      path_prefix: inferAuditPathPrefix(row.path),
      created_month: toMonthKey(row.file_mtime ?? row.updated_at),
    }));

  const sets = compareFlagSets(joined.candidates);
  const samples = missingRows
    .slice()
    .sort((a, b) => (
      compareStrings(a.path, b.path)
      || compareStrings(a.id, b.id)
    ));

  const report = {
    generated_at: generatedAt,
    mode: "read_only",
    db_paths: {
      engine: dbPaths.engineDbPath,
      core: dbPaths.coreDbPath,
    },
    counts: {
      chunks_without_confidence: sets.missingConfidenceIds.length,
      missing_category: sets.missingCategoryIds.length,
      intersection_count: sets.intersection.length,
      only_without_confidence: sets.onlyWithoutConfidence.length,
      only_missing_category: sets.onlyMissingCategory.length,
    },
    breakdowns: {
      by_path_prefix: buildBreakdown(missingRows, "path_prefix", row => row.path_prefix),
      by_family: buildBreakdown(missingRows, "family", row => row.family),
      by_quality_scope_owner: buildBreakdown(missingRows, "owner", row => row.owner),
      by_source_type: buildBreakdown(missingRows, "source_type", row => row.source_type),
      by_category: buildBreakdown(missingRows, "category", row => String(row.category ?? "null")),
      by_memory_engine_managed_status: buildBreakdown(
        missingRows,
        "status",
        row => row.memory_engine_managed_status,
      ),
      by_created_month: buildBreakdown(missingRows, "created_month", row => row.created_month),
    },
    dreaming: buildDreamingSummary(missingRows),
    samples: {
      top_path_prefixes: buildBreakdown(missingRows, "path_prefix", row => row.path_prefix).slice(0, 10),
      dreaming_examples: samples
        .filter(row => row.family === "dreaming")
        .slice(0, 10)
        .map(buildSampleRow),
      non_dreaming_examples: samples
        .filter(row => row.family !== "dreaming")
        .slice(0, 10)
        .map(buildSampleRow),
      retrieved_examples: samples
        .filter(row => Number(row.retrieved_count || 0) > 0)
        .sort((a, b) => (
          Number(b.injected_count || 0) - Number(a.injected_count || 0)
          || Number(b.retrieved_count || 0) - Number(a.retrieved_count || 0)
          || compareStrings(a.path, b.path)
          || compareStrings(a.id, b.id)
        ))
        .slice(0, 10)
        .map(buildSampleRow),
      injected_examples: samples
        .filter(row => Number(row.injected_count || 0) > 0)
        .sort((a, b) => (
          Number(b.injected_count || 0) - Number(a.injected_count || 0)
          || Number(b.retrieved_count || 0) - Number(a.retrieved_count || 0)
          || compareStrings(a.path, b.path)
          || compareStrings(a.id, b.id)
        ))
        .slice(0, 10)
        .map(buildSampleRow),
    },
    root_cause_hypotheses: buildHypotheses(missingRows, {
      intersection_count: sets.intersection.length,
      only_without_confidence: sets.onlyWithoutConfidence.length,
      only_missing_category: sets.onlyMissingCategory.length,
    }),
  };

  return report;
}

export function renderChunksWithoutConfidenceMarkdown(report) {
  const topPrefixes = (report?.breakdowns?.by_path_prefix || [])
    .slice(0, 10)
    .map(row => `- ${row.path_prefix}: ${row.count} (${row.share})`)
    .join("\n") || "- none";
  const families = (report?.breakdowns?.by_family || [])
    .map(row => `- ${row.family}: ${row.count} (${row.share})`)
    .join("\n") || "- none";
  const sources = (report?.breakdowns?.by_source_type || [])
    .map(row => `- ${row.source_type}: ${row.count} (${row.share})`)
    .join("\n") || "- none";
  const hypotheses = (report?.root_cause_hypotheses || [])
    .map(item => `- [${item.confidence}] ${item.id}: ${item.summary}`)
    .join("\n") || "- none";

  return `# Chunks Without Confidence Audit

## Summary

- generated_at: ${report.generated_at}
- mode: ${report.mode}
- engine_db: ${report.db_paths.engine}
- core_db: ${report.db_paths.core}
- chunks_without_confidence: ${report.counts.chunks_without_confidence}
- missing_category: ${report.counts.missing_category}
- intersection_count: ${report.counts.intersection_count}
- only_without_confidence: ${report.counts.only_without_confidence}
- only_missing_category: ${report.counts.only_missing_category}

## Dreaming

- count: ${report.dreaming.count}
- share: ${report.dreaming.share}
- retrieved_count_total: ${report.dreaming.retrieval_usage.retrieved_count_total}
- injected_count_total: ${report.dreaming.retrieval_usage.injected_count_total}
- chunks_ever_retrieved: ${report.dreaming.retrieval_usage.chunks_ever_retrieved}
- chunks_ever_injected: ${report.dreaming.retrieval_usage.chunks_ever_injected}

## Top Path Prefixes

${topPrefixes}

## Families

${families}

## Source Types

${sources}

## Hypotheses

${hypotheses}
`;
}

export function writeAuditReport(content, outPath) {
  const targetPath = resolve(outPath);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content);
  return targetPath;
}

export function runChunksWithoutConfidenceAudit(options = {}) {
  const dbPaths = options.dbPaths || resolveAuditDbPaths();
  const db = openAuditDb(dbPaths);
  try {
    return buildChunksWithoutConfidenceAudit({
      db,
      dbPaths,
      generatedAt: options.generatedAt || new Date().toISOString(),
    });
  } finally {
    db.close();
  }
}

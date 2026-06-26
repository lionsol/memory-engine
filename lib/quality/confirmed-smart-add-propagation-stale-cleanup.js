import Database from "better-sqlite3";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import {
  CORE_DB_PATH,
  ENGINE_DB_PATH,
} from "../../memory-manager-runtime.js";

export const CONFIRMED_SMART_ADD_PROPAGATION_STALE_CLEANUP_CONFIRM_TOKEN = "cleanup-confirmed-smart-add-propagation-stale-chunks";

const DEFAULT_CONFIRMED_PATHS = ["memory/smart-add/2026-06-24.md"];
const DEFAULT_STALE_MARKERS = ["2026-06-23_", "87c081ed", "3f503661"];

function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function compareStrings(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function timestampForFilename(now = new Date()) {
  return new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function listNormalized(values = []) {
  return Array.from(new Set((values || []).map(normalizePath).filter(Boolean))).sort(compareStrings);
}

function listStrings(values = []) {
  return Array.from(new Set((values || []).map(value => String(value ?? "").trim()).filter(Boolean))).sort(compareStrings);
}

function resolveDbPaths(options = {}) {
  const home = homedir();
  const rootDir = options.rootDir || process.env.MEMORY_ENGINE_WORKSPACE_DIR || resolve(home, ".openclaw/workspace");
  const memoryDir = options.memoryDir || resolve(rootDir, "memory");
  return {
    rootDir,
    memoryDir,
    coreDbPath: options.coreDbPath
      || process.env.CORE_DB_PATH
      || process.env.MEMORY_ENGINE_CORE_DB
      || process.env.MEMORY_ENGINE_CORE_DB_PATH
      || CORE_DB_PATH,
    engineDbPath: options.engineDbPath
      || process.env.ENGINE_DB_PATH
      || process.env.MEMORY_ENGINE_DB
      || process.env.MEMORY_ENGINE_DB_PATH
      || ENGINE_DB_PATH,
  };
}

function openCoreDb(coreDbPath, { readonly = true } = {}) {
  const db = new Database(coreDbPath, { readonly, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  if (!readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }
  return db;
}

function attachEngine(db, engineDbPath) {
  if (!engineDbPath || !existsSync(engineDbPath)) return false;
  db.exec(`ATTACH DATABASE '${String(engineDbPath).replace(/'/g, "''")}' AS engine`);
  return true;
}

function tableColumns(db, schemaName, tableName) {
  try {
    return db.prepare(`PRAGMA ${schemaName}.table_info(${tableName})`).all().map(row => String(row.name || ""));
  } catch {
    return [];
  }
}

function tableExists(db, schemaName, tableName) {
  try {
    const row = db.prepare(
      `SELECT name FROM ${schemaName}.sqlite_master WHERE type = 'table' AND name = ?`,
    ).get(String(tableName || ""));
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

function readQuarantineEvidence(memoryDir, confirmedPath, markers) {
  const logPath = resolve(memoryDir, "quarantined-smart-add-propagation", "quarantine-log.jsonl");
  const normalizedPath = normalizePath(confirmedPath);
  const lines = existsSync(logPath)
    ? readFileSync(logPath, "utf8").split("\n").map(line => line.trim()).filter(Boolean)
    : [];
  const markerSet = new Set(markers);
  const evidenceByMarker = new Map();

  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (normalizePath(parsed?.source_path) !== normalizedPath) continue;
    const reviewStatus = String(parsed?.review_status || "");
    if (reviewStatus !== "manual_confirmed" && reviewStatus !== "confirmed") continue;
    const blockId = String(parsed?.block_id || "");
    const fingerprint = String(parsed?.fingerprint || "").toLowerCase();
    for (const marker of markerSet) {
      const fingerprintMatched = marker !== "2026-06-23_" && fingerprint.startsWith(marker.toLowerCase());
      const blockMatched = marker === "2026-06-23_" && blockId.startsWith(marker);
      if (!fingerprintMatched && !blockMatched) continue;
      const list = evidenceByMarker.get(marker) || [];
      list.push({
        block_id: blockId || null,
        fingerprint: fingerprint || null,
        block_hash: parsed?.block_hash || null,
        reason: parsed?.reason || null,
        review_status: reviewStatus,
      });
      evidenceByMarker.set(marker, list);
    }
  }

  return {
    logPath,
    evidenceByMarker,
  };
}

function buildMarkerStatus(fileContent, markers, evidenceByMarker) {
  const statuses = [];
  for (const marker of markers) {
    statuses.push({
      marker,
      present_in_disk_file: String(fileContent || "").includes(marker),
      has_quarantine_evidence: (evidenceByMarker.get(marker) || []).length > 0,
      evidence_count: (evidenceByMarker.get(marker) || []).length,
    });
  }
  return statuses;
}

function collectPathChunkRows(db, path) {
  return db.prepare(`
    SELECT id, path, text
    FROM chunks
    WHERE path = ?
    ORDER BY id ASC
  `).all(path).map(row => ({
    id: String(row.id || ""),
    path: normalizePath(row.path),
    text: String(row.text || ""),
  }));
}

function collectFtsRowsByChunkId(db, ids, hasFtsIdColumn) {
  if (ids.length === 0) return [];
  if (!hasFtsIdColumn) return [];
  const placeholders = ids.map(() => "?").join(", ");
  return db.prepare(`
    SELECT rowid, id, path, text
    FROM chunks_fts
    WHERE id IN (${placeholders})
    ORDER BY id ASC, rowid ASC
  `).all(...ids).map(row => ({
    rowid: row.rowid,
    id: String(row.id || ""),
    path: normalizePath(row.path),
    text: String(row.text || ""),
  }));
}

function findMatchedMarkers(text, markers) {
  return markers.filter(marker => String(text || "").includes(marker));
}

function findResidualKeywords(text) {
  const matched = [];
  if (/(OpenCode|opencode)/.test(String(text || ""))) matched.push("OpenCode");
  if (/OPENCODE_API_KEY/.test(String(text || ""))) matched.push("OPENCODE_API_KEY");
  return matched;
}

function resolveConfirmedPaths(options = {}) {
  const requested = options.confirmedPaths?.length
    ? listNormalized(options.confirmedPaths)
    : DEFAULT_CONFIRMED_PATHS.slice();
  const allowed = new Set(DEFAULT_CONFIRMED_PATHS);
  for (const path of requested) {
    if (!allowed.has(path)) {
      throw new Error(`confirmed stale cleanup only allows: ${DEFAULT_CONFIRMED_PATHS.join(", ")}`);
    }
  }
  return requested;
}

function collectConfirmedStaleCandidates(options = {}) {
  const resolved = resolveDbPaths(options);
  const confirmedPaths = resolveConfirmedPaths(options);
  const markers = listStrings(options.markers?.length ? options.markers : DEFAULT_STALE_MARKERS);
  const db = openCoreDb(resolved.coreDbPath, { readonly: true });

  try {
    const ftsColumns = tableColumns(db, "main", "chunks_fts");
    const hasFtsIdColumn = ftsColumns.includes("id");
    const hasFtsPathColumn = ftsColumns.includes("path");
    const hasFtsTextColumn = ftsColumns.includes("text");
    const report = {
      mode: "dry_run",
      generated_at: new Date().toISOString(),
      root_dir: resolved.rootDir,
      memory_dir: resolved.memoryDir,
      core_db_path: resolved.coreDbPath,
      engine_db_path: resolved.engineDbPath,
      confirm_token_required: CONFIRMED_SMART_ADD_PROPAGATION_STALE_CLEANUP_CONFIRM_TOKEN,
      confirmed_paths: confirmedPaths,
      confirmed_stale_chunk_count: 0,
      confirmed_stale_fts_row_count: 0,
      affected_paths: [],
      matched_markers: [],
      clean_keyword_residuals_ignored: [],
      would_delete_chunk_ids: [],
      would_delete_confidence_chunk_ids: [],
      marker_status: [],
      quarantine_log_path: resolve(resolved.memoryDir, "quarantined-smart-add-propagation", "quarantine-log.jsonl"),
      memory_confidence_cleanup_strategy: existsSync(resolved.engineDbPath)
        ? "delete_matching_chunk_ids_if_table_exists"
        : "engine_db_missing_skip_confidence_cleanup",
      candidates: [],
      blocked_paths: [],
      diagnostics: {
        fts_has_id_column: hasFtsIdColumn,
        fts_has_path_column: hasFtsPathColumn,
        fts_has_text_column: hasFtsTextColumn,
      },
    };

    for (const confirmedPath of confirmedPaths) {
      const diskPath = resolve(resolved.rootDir, confirmedPath);
      const diskContent = existsSync(diskPath) ? readFileSync(diskPath, "utf8") : "";
      const evidence = readQuarantineEvidence(resolved.memoryDir, confirmedPath, markers);
      const markerStatus = buildMarkerStatus(diskContent, markers, evidence.evidenceByMarker);
      report.marker_status.push({
        path: confirmedPath,
        markers: markerStatus,
      });

      const chunkRows = collectPathChunkRows(db, confirmedPath);
      const candidateRows = [];
      const cleanResiduals = [];
      const blockedMarkerReasons = new Set();
      for (const row of chunkRows) {
        const matchedMarkers = findMatchedMarkers(row.text, markers);
        if (matchedMarkers.length > 0) {
          const ineligibleMarkers = matchedMarkers.filter(marker => {
            const status = markerStatus.find(item => item.marker === marker);
            return !Boolean(status?.has_quarantine_evidence) || Boolean(status?.present_in_disk_file);
          });
          if (ineligibleMarkers.length === 0) {
            candidateRows.push({
              chunk_id: row.id,
              path: confirmedPath,
              matched_markers: matchedMarkers,
              text_preview: row.text.slice(0, 220),
            });
          } else {
            for (const marker of ineligibleMarkers) {
              const status = markerStatus.find(item => item.marker === marker);
              if (!status?.has_quarantine_evidence) blockedMarkerReasons.add(`missing_quarantine_evidence:${marker}`);
              if (status?.present_in_disk_file) blockedMarkerReasons.add(`marker_still_present_in_disk_file:${marker}`);
            }
          }
          continue;
        }

        const residualKeywords = findResidualKeywords(row.text);
        if (residualKeywords.length > 0) {
          cleanResiduals.push({
            chunk_id: row.id,
            path: confirmedPath,
            matched_keywords: residualKeywords,
            ignored_reason: "same_path_clean_raw_log_or_non_confirmed_content",
          });
        }
      }

      const ftsRows = collectFtsRowsByChunkId(db, candidateRows.map(row => row.chunk_id), hasFtsIdColumn);
      if (blockedMarkerReasons.size > 0) {
        report.blocked_paths.push({
          path: confirmedPath,
          reasons: Array.from(blockedMarkerReasons).sort(compareStrings),
          would_delete_chunk_ids: candidateRows.map(row => row.chunk_id),
        });
        report.clean_keyword_residuals_ignored.push(...cleanResiduals);
        continue;
      }

      report.candidates.push({
        path: confirmedPath,
        chunk_ids: candidateRows.map(row => row.chunk_id),
        matched_markers: Array.from(new Set(candidateRows.flatMap(row => row.matched_markers))).sort(compareStrings),
        fts_row_count: ftsRows.length,
      });
      report.clean_keyword_residuals_ignored.push(...cleanResiduals);
      report.would_delete_chunk_ids.push(...candidateRows.map(row => row.chunk_id));
      report.would_delete_confidence_chunk_ids.push(...candidateRows.map(row => row.chunk_id));
      report.confirmed_stale_chunk_count += candidateRows.length;
      report.confirmed_stale_fts_row_count += ftsRows.length;
    }

    report.would_delete_chunk_ids = Array.from(new Set(report.would_delete_chunk_ids)).sort(compareStrings);
    report.would_delete_confidence_chunk_ids = Array.from(new Set(report.would_delete_confidence_chunk_ids)).sort(compareStrings);
    report.affected_paths = report.candidates.filter(item => item.chunk_ids.length > 0).map(item => item.path);
    report.matched_markers = Array.from(new Set(report.candidates.flatMap(item => item.matched_markers))).sort(compareStrings);
    return report;
  } finally {
    db.close();
  }
}

function resolveBackupPath(coreDbPath, options = {}, now = new Date()) {
  const backupDir = options.backupDir || resolve(dirname(coreDbPath), "backups");
  return {
    backupDir,
    backupPath: resolve(
      backupDir,
      `main-before-smart-add-propagation-stale-cleanup-${timestampForFilename(now)}.sqlite`,
    ),
  };
}

function deleteByIds(db, schemaName, tableName, columnName, ids) {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const result = db.prepare(`DELETE FROM ${schemaName}.${tableName} WHERE ${columnName} IN (${placeholders})`).run(...ids);
  return toCount(result?.changes);
}

export function collectConfirmedSmartAddPropagationStaleChunksDryRun(options = {}) {
  return collectConfirmedStaleCandidates(options);
}

export function applyConfirmedSmartAddPropagationStaleChunkCleanup(options = {}) {
  if (options.confirm !== CONFIRMED_SMART_ADD_PROPAGATION_STALE_CLEANUP_CONFIRM_TOKEN) {
    throw new Error(`apply mode requires --confirm ${CONFIRMED_SMART_ADD_PROPAGATION_STALE_CLEANUP_CONFIRM_TOKEN}`);
  }

  const pre = collectConfirmedStaleCandidates(options);
  const resolved = resolveDbPaths(options);
  const { backupDir, backupPath } = resolveBackupPath(resolved.coreDbPath, options);
  mkdirSync(backupDir, { recursive: true });
  copyFileSync(resolved.coreDbPath, backupPath);
  if (!existsSync(backupPath)) {
    throw new Error(`backup file was not created: ${backupPath}`);
  }

  const db = openCoreDb(resolved.coreDbPath, { readonly: false });
  let engineAttached = false;
  try {
    engineAttached = attachEngine(db, resolved.engineDbPath);
    const hasConfidenceTable = engineAttached && tableExists(db, "engine", "memory_confidence");
    const ftsColumns = tableColumns(db, "main", "chunks_fts");
    if (!ftsColumns.includes("id")) {
      throw new Error("chunks_fts lacks id column; cannot safely delete confirmed stale rows without risking clean same-path FTS rows");
    }

    const chunkIds = pre.would_delete_chunk_ids.slice();
    const tx = db.transaction(() => {
      const deletedFtsRowCount = deleteByIds(db, "main", "chunks_fts", "id", chunkIds);
      const deletedChunkCount = deleteByIds(db, "main", "chunks", "id", chunkIds);
      const deletedConfidenceRowCount = hasConfidenceTable
        ? deleteByIds(db, "engine", "memory_confidence", "chunk_id", chunkIds)
        : 0;
      return {
        deletedFtsRowCount,
        deletedChunkCount,
        deletedConfidenceRowCount,
      };
    });
    const deleted = tx();

    const post = collectConfirmedStaleCandidates(options);
    const markerResidualCounts = {
      chunk_rows: 0,
      fts_rows: 0,
    };
    if (pre.confirmed_paths.length > 0) {
      const postMarkers = pre.matched_markers.length > 0 ? pre.matched_markers : listStrings(options.markers?.length ? options.markers : DEFAULT_STALE_MARKERS);
      const placeholders = postMarkers.map(() => "text LIKE ?").join(" OR ");
      markerResidualCounts.chunk_rows = toCount(db.prepare(`
        SELECT COUNT(*) AS c
        FROM chunks
        WHERE path = ? AND (${placeholders})
      `).get(pre.confirmed_paths[0], ...postMarkers.map(marker => `%${marker}%`))?.c);
      markerResidualCounts.fts_rows = toCount(db.prepare(`
        SELECT COUNT(*) AS c
        FROM chunks_fts
        WHERE path = ? AND (${placeholders})
      `).get(pre.confirmed_paths[0], ...postMarkers.map(marker => `%${marker}%`))?.c);
    }

    return {
      ...pre,
      mode: "apply",
      backup_path: backupPath,
      deleted_chunk_count: deleted.deletedChunkCount,
      deleted_fts_row_count: deleted.deletedFtsRowCount,
      deleted_confidence_row_count: deleted.deletedConfidenceRowCount,
      memory_confidence_cleanup_strategy: hasConfidenceTable
        ? "deleted_matching_chunk_ids"
        : "memory_confidence_missing_skip_confidence_cleanup",
      post_apply_confirmed_stale_chunk_count: post.confirmed_stale_chunk_count,
      post_apply_confirmed_stale_fts_row_count: post.confirmed_stale_fts_row_count,
      post_apply_marker_residual_counts: markerResidualCounts,
      post_apply_clean_keyword_residuals_ignored: post.clean_keyword_residuals_ignored,
    };
  } finally {
    if (engineAttached) {
      try { db.exec("DETACH DATABASE engine"); } catch {}
    }
    db.close();
  }
}

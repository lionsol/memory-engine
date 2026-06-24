import Database from "better-sqlite3";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

export const STALE_QUARANTINED_CHUNK_CONFIRM_TOKEN = "cleanup-stale-quarantined-chunks";

function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function normalizeAbsolutePath(value) {
  return String(value ?? "").replace(/\\/g, "/");
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

function isRootDailyPath(path) {
  return /^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(normalizePath(path));
}

function readQuarantineLog(memoryDir) {
  const logPath = resolve(memoryDir, "legacy-daily-mirrors", "quarantine-log.jsonl");
  if (!existsSync(logPath)) {
    return {
      logPath,
      entries: [],
      byMovedFrom: new Map(),
    };
  }

  const lines = readFileSync(logPath, "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  const entries = [];
  const byMovedFrom = new Map();

  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const movedFrom = normalizePath(parsed?.moved_from);
    const movedTo = normalizePath(parsed?.moved_to);
    const reason = String(parsed?.reason || "");
    const entry = {
      moved_at: parsed?.moved_at || null,
      moved_from: movedFrom,
      moved_to: movedTo,
      reason,
      similarity: parsed?.similarity ?? null,
    };
    entries.push(entry);
    if (movedFrom) byMovedFrom.set(movedFrom, entry);
  }

  return { logPath, entries, byMovedFrom };
}

function resolveOptions(options = {}) {
  const home = homedir();
  const rootDir = options.rootDir || process.env.MEMORY_ENGINE_WORKSPACE_DIR || resolve(home, ".openclaw/workspace");
  const memoryDir = options.memoryDir || resolve(rootDir, "memory");
  const coreDbPath = options.coreDbPath
    || process.env.CORE_DB_PATH
    || process.env.MEMORY_ENGINE_CORE_DB
    || process.env.MEMORY_ENGINE_CORE_DB_PATH
    || resolve(home, ".openclaw/memory/main.sqlite");
  return { rootDir, memoryDir, coreDbPath };
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

function collectGroupedRows(db) {
  const chunkRows = db.prepare(`
    SELECT path, COUNT(*) AS chunk_count
    FROM chunks
    GROUP BY path
    ORDER BY path ASC
  `).all();

  const ftsRows = db.prepare(`
    SELECT path, COUNT(*) AS fts_row_count
    FROM chunks_fts
    GROUP BY path
    ORDER BY path ASC
  `).all();

  const byPath = new Map();
  for (const row of chunkRows) {
    const path = normalizePath(row.path);
    if (!isRootDailyPath(path)) continue;
    byPath.set(path, {
      path,
      chunk_count: toCount(row.chunk_count),
      fts_row_count: 0,
    });
  }
  for (const row of ftsRows) {
    const path = normalizePath(row.path);
    if (!isRootDailyPath(path)) continue;
    const existing = byPath.get(path) || {
      path,
      chunk_count: 0,
      fts_row_count: 0,
    };
    existing.fts_row_count = toCount(row.fts_row_count);
    byPath.set(path, existing);
  }
  return Array.from(byPath.values()).sort((a, b) => compareStrings(a.path, b.path));
}

function classifyPathGroup(group, { rootDir, memoryDir, quarantineByMovedFrom }) {
  const rootFilePath = resolve(rootDir, group.path);
  const rootExists = existsSync(rootFilePath);
  const quarantineEntry = quarantineByMovedFrom.get(group.path) || null;
  const movedToExists = quarantineEntry?.moved_to
    ? existsSync(resolve(rootDir, quarantineEntry.moved_to))
    : false;
  const confirmedQuarantine = !rootExists
    && Boolean(quarantineEntry)
    && quarantineEntry.reason === "legacy_daily_mirror_candidate"
    && movedToExists;

  const base = {
    path: group.path,
    chunk_count: group.chunk_count,
    fts_row_count: group.fts_row_count,
    root_file_exists: rootExists,
    moved_to: quarantineEntry?.moved_to || null,
    moved_to_exists: movedToExists,
    quarantine_reason: quarantineEntry?.reason || null,
  };

  if (confirmedQuarantine) {
    return {
      bucket: "stale_quarantined_legacy_mirror_chunks",
      ...base,
    };
  }

  if (rootExists) {
    return {
      bucket: "existing_root_daily_chunks",
      ...base,
    };
  }

  return {
    bucket: "missing_file_chunks_not_in_quarantine_log",
    ...base,
  };
}

export function auditStaleQuarantinedChunks(options = {}) {
  const resolved = resolveOptions(options);
  const { rootDir, memoryDir, coreDbPath } = resolved;
  const quarantine = readQuarantineLog(memoryDir);
  const db = openCoreDb(coreDbPath, { readonly: true });

  try {
    const grouped = collectGroupedRows(db);
    const report = {
      mode: "dry_run",
      generated_at: new Date().toISOString(),
      root_dir: normalizeAbsolutePath(rootDir),
      memory_dir: normalizeAbsolutePath(memoryDir),
      core_db_path: normalizeAbsolutePath(coreDbPath),
      quarantine_log_path: normalizeAbsolutePath(quarantine.logPath),
      stale_quarantined_legacy_mirror_chunks: [],
      missing_file_chunks_not_in_quarantine_log: [],
      existing_root_daily_chunks: [],
      would_delete_chunk_count: 0,
      would_delete_fts_row_count: 0,
      affected_paths: [],
    };

    for (const group of grouped) {
      const classified = classifyPathGroup(group, {
        rootDir,
        memoryDir,
        quarantineByMovedFrom: quarantine.byMovedFrom,
      });
      report[classified.bucket].push(classified);
    }

    report.stale_quarantined_legacy_mirror_chunks.sort((a, b) => compareStrings(a.path, b.path));
    report.missing_file_chunks_not_in_quarantine_log.sort((a, b) => compareStrings(a.path, b.path));
    report.existing_root_daily_chunks.sort((a, b) => compareStrings(a.path, b.path));
    report.would_delete_chunk_count = report.stale_quarantined_legacy_mirror_chunks.reduce(
      (sum, item) => sum + toCount(item.chunk_count),
      0,
    );
    report.would_delete_fts_row_count = report.stale_quarantined_legacy_mirror_chunks.reduce(
      (sum, item) => sum + toCount(item.fts_row_count),
      0,
    );
    report.affected_paths = report.stale_quarantined_legacy_mirror_chunks.map(item => item.path);
    return report;
  } finally {
    db.close();
  }
}

function resolveBackupPath(options, coreDbPath, now = new Date()) {
  const backupDir = options.backupDir || resolve(dirname(coreDbPath), "backups");
  return {
    backupDir,
    backupPath: resolve(
      backupDir,
      `main-before-stale-quarantined-chunk-cleanup-${timestampForFilename(now)}.sqlite`,
    ),
  };
}

function deleteRowsForPaths(db, paths) {
  const deleteFts = db.prepare("DELETE FROM chunks_fts WHERE path = ?");
  const deleteChunks = db.prepare("DELETE FROM chunks WHERE path = ?");
  let deletedFtsRowCount = 0;
  let deletedChunkCount = 0;
  for (const path of paths) {
    deletedFtsRowCount += toCount(deleteFts.run(path)?.changes);
    deletedChunkCount += toCount(deleteChunks.run(path)?.changes);
  }
  return { deletedChunkCount, deletedFtsRowCount };
}

export function applyStaleQuarantinedChunkCleanup(options = {}) {
  if (options.confirm !== STALE_QUARANTINED_CHUNK_CONFIRM_TOKEN) {
    throw new Error(`apply mode requires --confirm ${STALE_QUARANTINED_CHUNK_CONFIRM_TOKEN}`);
  }

  const resolved = resolveOptions(options);
  const pre = auditStaleQuarantinedChunks(resolved);
  const { backupDir, backupPath } = resolveBackupPath(options, resolved.coreDbPath);
  mkdirSync(backupDir, { recursive: true });
  copyFileSync(resolved.coreDbPath, backupPath);
  if (!existsSync(backupPath)) {
    throw new Error(`backup file was not created: ${backupPath}`);
  }

  const db = openCoreDb(resolved.coreDbPath, { readonly: false });
  try {
    const tx = db.transaction((paths) => deleteRowsForPaths(db, paths));
    const result = tx(pre.affected_paths);
    return {
      mode: "apply",
      started_at: new Date().toISOString(),
      core_db_path: normalizeAbsolutePath(resolved.coreDbPath),
      backup_path: normalizeAbsolutePath(backupPath),
      deleted_chunk_count: result.deletedChunkCount,
      deleted_fts_row_count: result.deletedFtsRowCount,
      affected_paths: pre.affected_paths,
      stale_quarantined_legacy_mirror_chunks: pre.stale_quarantined_legacy_mirror_chunks,
    };
  } finally {
    db.close();
  }
}

import Database from "better-sqlite3";
import { existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { localDateKey } from "../date-utils.js";
import {
  DB_PATH,
  INDEX_SYNC_WATCH_DIRS,
  WORKSPACE,
  getSharedMemoryManager,
} from "../memory-manager-runtime.js";

function tableExists(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(name);
  return !!row;
}

function collectIndexedFiles(memoryRoot) {
  const files = [];
  for (const dirRel of INDEX_SYNC_WATCH_DIRS) {
    const absDir = resolve(memoryRoot, dirRel);
    if (!existsSync(absDir)) continue;

    let entries = [];
    try {
      entries = readdirSync(absDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const absPath = resolve(absDir, entry);
      let stat;
      try {
        stat = statSync(absPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const relPath = absPath.replace(memoryRoot + "/", "");
      files.push({ relPath, mtimeMs: stat.mtimeMs });
    }
  }
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return files;
}

function readIndexedPathState(db, pathList) {
  if (!Array.isArray(pathList) || pathList.length === 0) {
    return { paths: [], updatedAt: {} };
  }
  if (!tableExists(db, "chunks")) {
    return { paths: [], updatedAt: {} };
  }

  const placeholders = pathList.map(() => "?").join(", ");
  const rows = db.prepare([
    "SELECT path, MAX(updated_at) AS updated_at",
    "FROM chunks",
    `WHERE path IN (${placeholders})`,
    "GROUP BY path",
  ].join(" ")).all(...pathList);

  const paths = rows.map(row => row.path).sort((a, b) => a.localeCompare(b));
  const updatedAt = {};
  for (const row of rows) {
    updatedAt[row.path] = row.updated_at ?? null;
  }
  return { paths, updatedAt };
}

function withDb(fn, dbPath = DB_PATH) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function safeWithDb(fn, dbPath = DB_PATH, fallbackValue = null) {
  try {
    return { value: withDb(fn, dbPath), error: null };
  } catch (error) {
    return { value: fallbackValue, error: String(error?.message || error) };
  }
}

function parseArgs(argv) {
  return {
    force: argv.includes("--force"),
    help: argv.includes("-h") || argv.includes("--help"),
  };
}

function printUsage() {
  console.log("Usage: node scripts/sync-memory-index.js [--force]");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const managerResult = await getSharedMemoryManager({ purpose: "cli", allowImplicit: false });
  if (!managerResult.manager) {
    throw new Error(managerResult.error || "memory manager unavailable");
  }

  const manager = managerResult.manager;
  try {
    const statusBefore = typeof manager.status === "function" ? manager.status() : null;
    const memoryRoot = statusBefore?.workspaceDir || WORKSPACE;
    const dbPathBefore = statusBefore?.dbPath || DB_PATH;
    const scannedFiles = collectIndexedFiles(memoryRoot);
    const scannedPaths = scannedFiles.map(file => file.relPath);

    const beforeResult = safeWithDb(db => readIndexedPathState(db, scannedPaths), dbPathBefore, { paths: [], updatedAt: {} });
    const before = beforeResult.value;
    const dirtyBefore = Boolean(statusBefore?.dirty);

    const syncPayload = { reason: "cli-sync", ...(args.force ? { force: true } : {}) };
    const syncResult = await manager.sync(syncPayload);

    const statusAfter = typeof manager.status === "function" ? manager.status() : null;
    const dbPath = statusAfter?.dbPath || statusBefore?.dbPath || DB_PATH;
    const afterResult = safeWithDb(db => readIndexedPathState(db, scannedPaths), dbPath, { paths: [], updatedAt: {} });
    const after = afterResult.value;

    const indexedCount = after.paths.length;
    const updatedCount = after.paths.filter(path => (before.updatedAt[path] ?? null) !== (after.updatedAt[path] ?? null)).length;
    const skippedCount = scannedPaths.filter(path => !after.paths.includes(path)).length;

    const todayRelPath = `memory/smart-add/${localDateKey()}.md`;
    const todayChunkResult = safeWithDb(db => {
      if (!tableExists(db, "chunks")) return 0;
      const row = db.prepare("SELECT COUNT(*) AS c FROM chunks WHERE path = ?").get(todayRelPath);
      return row?.c || 0;
    }, dbPath, 0);
    const todayChunkCount = todayChunkResult.value;

    const output = {
      reason: "cli-sync",
      force: args.force,
      memory_root: memoryRoot,
      db_path: dbPath,
      db_error_before: beforeResult.error,
      db_error_after: afterResult.error,
      dirty_before: dirtyBefore,
      file_scan: {
        total: scannedPaths.length,
        indexed: indexedCount,
        updated: updatedCount,
        skipped: skippedCount,
      },
      manager_status: statusAfter || null,
      sync_result: syncResult ?? null,
      today_smart_add_path: todayRelPath,
      today_chunk_exists: todayChunkCount > 0,
      today_chunk_count: todayChunkCount,
      today_chunk_error: todayChunkResult.error,
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await manager.close?.();
  }
}

main().catch(error => {
  console.error(`[sync-memory-index] ${String(error?.message || error)}`);
  process.exit(1);
});

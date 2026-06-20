const Database = require("better-sqlite3");
const { execFileSync } = require("node:child_process");

async function loadRuntimeDeps() {
  const [
    { dateStrInTimeZone },
    { tableExists },
    { getSmartAddTimeZone },
    { collectIndexedFiles, readIndexedPathState },
    runtime,
  ] = await Promise.all([
    import("../date-utils.js"),
    import("../lib/db/schema.js"),
    import("../lib/config/helpers.js"),
    import("../lib/sync/index-sync.js"),
    import("../memory-manager-runtime.js"),
  ]);

  return {
    dateStrInTimeZone,
    tableExists,
    getSmartAddTimeZone,
    collectIndexedFiles,
    readIndexedPathState,
    CORE_DB_PATH: runtime.CORE_DB_PATH,
    INDEX_SYNC_WATCH_DIRS: runtime.INDEX_SYNC_WATCH_DIRS,
    WORKSPACE: runtime.WORKSPACE,
    getSharedMemoryManager: runtime.getSharedMemoryManager,
  };
}

function withDb(fn, dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function safeWithDb(fn, dbPath, fallbackValue = null) {
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
  console.log("Usage: node bin/sync-memory-index.js [--force]");
}

function runOpenClawMemoryIndexCli({
  force = false,
  execFileSyncImpl = execFileSync,
  openClawCommand = "openclaw",
  agentId = process.env.OPENCLAW_AGENT_ID || "main",
} = {}) {
  const args = ["memory", "index", "--agent", agentId];
  if (force) args.push("--force");

  try {
    const stdout = String(execFileSyncImpl(openClawCommand, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }) || "");
    if (/Memory search disabled\./i.test(stdout)) {
      return {
        ok: false,
        delegated_to: `${openClawCommand} ${args.join(" ")}`,
        stdout,
        stderr: "",
        error: "OpenClaw memory index is unavailable because memory search is disabled",
      };
    }
    return {
      ok: true,
      delegated_to: `${openClawCommand} ${args.join(" ")}`,
      stdout,
      stderr: "",
    };
  } catch (error) {
    const stdout = String(error?.stdout || "");
    const stderr = String(error?.stderr || "");
    if (/Memory search disabled\./i.test(`${stdout}\n${stderr}`)) {
      return {
        ok: false,
        delegated_to: `${openClawCommand} ${args.join(" ")}`,
        stdout,
        stderr,
        error: "OpenClaw memory index is unavailable because memory search is disabled",
      };
    }
    return {
      ok: false,
      delegated_to: `${openClawCommand} ${args.join(" ")}`,
      stdout,
      stderr,
      error: stderr.trim() || stdout.trim() || String(error?.message || error),
    };
  }
}

async function runSyncMemoryIndex({
  force = false,
  getSharedMemoryManagerImpl = null,
  openClawCliSyncImpl = null,
} = {}) {
  const {
    dateStrInTimeZone,
    tableExists,
    getSmartAddTimeZone,
    collectIndexedFiles,
    readIndexedPathState,
    CORE_DB_PATH,
    INDEX_SYNC_WATCH_DIRS,
    WORKSPACE,
    getSharedMemoryManager,
  } = await loadRuntimeDeps();
  const getSharedMemoryManagerImplResolved = getSharedMemoryManagerImpl || getSharedMemoryManager;
  const managerResult = await getSharedMemoryManagerImplResolved({ purpose: "cli", allowImplicit: false });
  const manager = managerResult.manager || null;
  const smartAddTimeZone = getSmartAddTimeZone(managerResult.cfg || null);
  const statusBefore = manager && typeof manager.status === "function" ? manager.status() : null;
  const memoryRoot = statusBefore?.workspaceDir || WORKSPACE;
  const dbPathBefore = statusBefore?.dbPath || CORE_DB_PATH;
  const scannedFiles = collectIndexedFiles(memoryRoot, INDEX_SYNC_WATCH_DIRS);
  const scannedPaths = scannedFiles.map(file => file.relPath);
  const beforeResult = safeWithDb(db => readIndexedPathState(db, scannedPaths), dbPathBefore, { paths: [], updatedAt: {} });
  const before = beforeResult.value;
  const dirtyBefore = Boolean(statusBefore?.dirty);
  const openClawCliSync = openClawCliSyncImpl || runOpenClawMemoryIndexCli;

  try {
    let syncResult = null;
    let statusAfter = statusBefore;

    if (manager) {
      const syncPayload = { reason: "cli-sync", ...(force ? { force: true } : {}) };
      syncResult = await manager.sync(syncPayload);
      statusAfter = typeof manager.status === "function" ? manager.status() : null;
    } else {
      const delegated = await openClawCliSync({ force });
      if (!delegated?.ok) {
        const errorParts = [
          managerResult.error || "memory manager unavailable",
          delegated?.error ? `fallback openclaw memory index failed: ${delegated.error}` : null,
        ].filter(Boolean);
        throw new Error(errorParts.join("; "));
      }
      syncResult = {
        delegated: true,
        via: "openclaw memory index",
        delegated_to: delegated.delegated_to,
        stdout: delegated.stdout,
        stderr: delegated.stderr,
      };
      statusAfter = null;
    }

    const dbPath = statusAfter?.dbPath || statusBefore?.dbPath || CORE_DB_PATH;
    const afterResult = safeWithDb(db => readIndexedPathState(db, scannedPaths), dbPath, { paths: [], updatedAt: {} });
    const after = afterResult.value;

    const indexedCount = after.paths.length;
    const updatedCount = after.paths.filter(path => (before.updatedAt[path] ?? null) !== (after.updatedAt[path] ?? null)).length;
    const skippedCount = scannedPaths.filter(path => !after.paths.includes(path)).length;

    const todayRelPath = `memory/smart-add/${dateStrInTimeZone(0, smartAddTimeZone)}.md`;
    const todayChunkResult = safeWithDb(db => {
      if (!tableExists(db, "chunks")) return 0;
      const row = db.prepare("SELECT COUNT(*) AS c FROM chunks WHERE path = ?").get(todayRelPath);
      return row?.c || 0;
    }, dbPath, 0);
    const todayChunkCount = todayChunkResult.value;

    const output = {
      reason: "cli-sync",
      force,
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
      manager_error: manager ? null : (managerResult.error || null),
      sync_result: syncResult ?? null,
      today_smart_add_path: todayRelPath,
      today_chunk_exists: todayChunkCount > 0,
      today_chunk_count: todayChunkCount,
      today_chunk_error: todayChunkResult.error,
    };

    return output;
  } finally {
    await manager?.close?.();
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return 0;
  }
  const output = await runSyncMemoryIndex({ force: args.force });
  console.log(JSON.stringify(output, null, 2));
  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exit(code);
  }).catch(error => {
    console.error(`[sync-memory-index] ${String(error?.message || error)}`);
    process.exit(1);
  });
}

module.exports = {
  runSyncMemoryIndex,
  main,
  runOpenClawMemoryIndexCli,
};

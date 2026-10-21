const Database = require("better-sqlite3");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { readFileSync, statSync } = require("node:fs");
const { resolve, relative, sep, isAbsolute } = require("node:path");
const { parseSmartAddEntries } = require("../lib/smart-add-entry-contract.cjs");
const { getCoreStoreDescriptor } = require("../lib/db/core-store.cjs");

const SMART_ADD_FINGERPRINT_RE = /<!--\s*smart-add-fingerprint:\s*([a-f0-9]{8,64})\s*-->/gi;

async function loadRuntimeDeps() {
  const [
    { collectIndexedFiles, readIndexedPathState },
    runtime,
  ] = await Promise.all([
    import("../lib/sync/index-sync.js"),
    import("../memory-manager-runtime.js"),
  ]);

  return {
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
    getCoreStoreDescriptor(db, { schema: "main" });
    return fn(db);
  } finally {
    db.close();
  }
}

function coreReadErrorStatus(error) {
  const message = String(error?.message || error);
  if (error?.code === "CORE_SCHEMA_UNSUPPORTED"
    || /^Unsupported OpenClaw Core store schema\b/i.test(message)
    || /no such column:/i.test(message)) {
    return "schema_unsupported";
  }
  return "query_error";
}

function safeWithDb(fn, dbPath, withDbImpl = withDb) {
  try {
    return { status: "ok", value: withDbImpl(fn, dbPath), error: null };
  } catch (error) {
    return {
      status: coreReadErrorStatus(error),
      value: null,
      error: String(error?.message || error),
    };
  }
}

function summarizeManagerSyncResult(value) {
  if (value === null || value === undefined) return null;
  return {
    returned: true,
    ok: typeof value?.ok === "boolean" ? value.ok : null,
  };
}

function extractCoreChunkFingerprints(text) {
  const fingerprints = new Set();
  SMART_ADD_FINGERPRINT_RE.lastIndex = 0;
  let match;
  while ((match = SMART_ADD_FINGERPRINT_RE.exec(String(text || ""))) !== null) {
    fingerprints.add(String(match[1]).toLowerCase());
  }
  SMART_ADD_FINGERPRINT_RE.lastIndex = 0;
  return fingerprints;
}

function readTargetIndexedContentEvidence(db, targetPath) {
  getCoreStoreDescriptor(db, { schema: "main" });
  const columns = new Set(db.prepare("PRAGMA table_info(chunks)").all().map(row => String(row.name)));
  if (!columns.has("path") || !columns.has("text")) {
    const error = new Error("Core chunks path/text columns unavailable");
    error.code = "CORE_SCHEMA_UNSUPPORTED";
    throw error;
  }
  const rows = db.prepare("SELECT text FROM chunks WHERE path = ?").all(targetPath);
  const fingerprints = new Set();
  for (const row of rows) {
    for (const fingerprint of extractCoreChunkFingerprints(row.text)) fingerprints.add(fingerprint);
  }
  return {
    status: "ok",
    path_present: rows.length > 0,
    chunk_count: rows.length,
    fingerprints: [...fingerprints],
    error: null,
  };
}

function validTargetDate(value) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function snapshotTargetFile(filePath) {
  const stat = statSync(filePath);
  if (!stat.isFile()) throw new Error("target path is not a regular file");
  const bytes = readFileSync(filePath);
  const content = bytes.toString("utf8");
  const fingerprints = new Set(parseSmartAddEntries(content)
    .filter(entry => entry.provenance === "session_flush" && entry.category === "raw_log")
    .map(entry => entry.fingerprint)
    .filter(value => typeof value === "string" && /^[a-f0-9]{8,64}$/i.test(value))
    .map(value => value.toLowerCase()));
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    fingerprints,
  };
}

function assessTargetDateCoverage({
  targetDate,
  targetPath,
  scannedPaths,
  sourceBefore,
  sourceAfter,
  sourceBeforeError,
  sourceAfterError,
  indexedResult,
}) {
  const requiredFingerprints = sourceBefore?.fingerprints instanceof Set
    ? sourceBefore.fingerprints.size
    : null;
  const coverage = {
    status: "unverified",
    target_date: targetDate,
    path: targetPath,
    required_fingerprints: requiredFingerprints,
    matched_fingerprints: null,
    missing_fingerprints: null,
    source_stable: false,
    indexed_path_present: null,
    indexed_chunk_count: null,
    reason: null,
  };

  if (sourceBeforeError) {
    coverage.status = "missing";
    coverage.reason = `target file unavailable before indexing: ${sourceBeforeError}`;
    return coverage;
  }
  if (sourceAfterError) {
    coverage.status = "read_error";
    coverage.reason = `target file post-read failed: ${sourceAfterError}`;
    return coverage;
  }
  if (sourceBefore.sha256 !== sourceAfter.sha256) {
    coverage.status = "stale";
    coverage.reason = "target file changed during Core indexing";
    return coverage;
  }
  coverage.source_stable = true;
  if (!scannedPaths.includes(targetPath)) {
    coverage.status = "stale";
    coverage.reason = "target file was outside the enumerated index scan scope";
    return coverage;
  }
  if (indexedResult?.status === "schema_unsupported" || indexedResult?.status === "query_error") {
    coverage.status = indexedResult.status;
    coverage.reason = indexedResult.error;
    return coverage;
  }
  if (indexedResult?.error || indexedResult?.status === "read_error") {
    coverage.status = "query_error";
    coverage.reason = indexedResult.error || "Core target read failed";
    return coverage;
  }
  if (!indexedResult || (indexedResult.status && indexedResult.status !== "ok")) {
    coverage.status = "query_error";
    coverage.reason = "Core target read did not return a successful result";
    return coverage;
  }
  if (typeof indexedResult.path_present !== "boolean"
    || !Number.isInteger(indexedResult.chunk_count)
    || indexedResult.chunk_count < 0
    || !Array.isArray(indexedResult.fingerprints)) {
    coverage.status = "query_error";
    coverage.reason = "Core target read returned an invalid result shape";
    return coverage;
  }

  coverage.indexed_path_present = indexedResult.path_present;
  coverage.indexed_chunk_count = indexedResult.chunk_count;
  if (requiredFingerprints !== null) {
    coverage.matched_fingerprints = 0;
    coverage.missing_fingerprints = requiredFingerprints;
  }
  if (!indexedResult?.path_present) {
    coverage.status = "missing";
    coverage.reason = "target path has no indexed Core chunks";
    return coverage;
  }
  if (coverage.required_fingerprints === 0) {
    coverage.status = "unverified";
    coverage.reason = "target file has no verifiable session_flush fingerprints";
    return coverage;
  }

  const indexedFingerprints = new Set(indexedResult.fingerprints || []);
  for (const fingerprint of sourceBefore.fingerprints) {
    if (indexedFingerprints.has(fingerprint)) coverage.matched_fingerprints += 1;
  }
  coverage.missing_fingerprints = coverage.required_fingerprints - coverage.matched_fingerprints;
  if (coverage.missing_fingerprints > 0) {
    coverage.status = "stale";
    coverage.reason = "Core target path does not contain all current session_flush fingerprints";
    return coverage;
  }

  coverage.status = "complete";
  coverage.reason = null;
  return coverage;
}

function parseArgs(argv) {
  let targetDate = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target-date") targetDate = argv[index + 1] || null;
    else if (arg.startsWith("--target-date=")) targetDate = arg.slice("--target-date=".length) || null;
  }
  return {
    force: argv.includes("--force"),
    targetDate,
    help: argv.includes("-h") || argv.includes("--help"),
  };
}

function printUsage() {
  console.log("Usage: node bin/sync-memory-index.js [--force] [--target-date YYYY-MM-DD]");
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
  targetDate = null,
  force = false,
  getSharedMemoryManagerImpl = null,
  openClawCliSyncImpl = null,
  runtimeDepsImpl = null,
  withDbImpl = withDb,
  readTargetIndexedContentEvidenceImpl = readTargetIndexedContentEvidence,
} = {}) {
  if (targetDate !== null && !validTargetDate(targetDate)) {
    return {
      ok: false,
      index_invocation: { status: "not_started", error: "targetDate must be a valid YYYY-MM-DD date" },
      target_date_coverage: { status: "unverified", target_date: targetDate, path: null, reason: "invalid targetDate" },
    };
  }
  const deps = await (runtimeDepsImpl || loadRuntimeDeps)();
  const {
    collectIndexedFiles,
    readIndexedPathState,
    CORE_DB_PATH,
    INDEX_SYNC_WATCH_DIRS,
    WORKSPACE,
    getSharedMemoryManager,
  } = deps;
  const getSharedMemoryManagerImplResolved = getSharedMemoryManagerImpl || getSharedMemoryManager;
  const managerResult = await getSharedMemoryManagerImplResolved({ purpose: "cli", allowImplicit: false });
  const manager = managerResult.manager || null;
  const statusBefore = manager && typeof manager.status === "function" ? manager.status() : null;
  const memoryRoot = statusBefore?.workspaceDir || WORKSPACE;
  const dbPathBefore = statusBefore?.dbPath || CORE_DB_PATH;
  const scannedFiles = collectIndexedFiles(memoryRoot, INDEX_SYNC_WATCH_DIRS);
  const scannedPaths = scannedFiles.map(file => file.relPath);
  const beforeResult = safeWithDb(db => readIndexedPathState(db, scannedPaths), dbPathBefore, withDbImpl);
  const before = beforeResult.status === "ok" ? beforeResult.value : null;
  const dirtyBefore = Boolean(statusBefore?.dirty);
  const openClawCliSync = openClawCliSyncImpl || runOpenClawMemoryIndexCli;
  const targetPath = targetDate ? `memory/smart-add/${targetDate}.md` : null;
  const targetAbsPath = targetPath ? resolve(memoryRoot, targetPath) : null;
  const targetRelative = targetAbsPath ? relative(resolve(memoryRoot), targetAbsPath) : null;
  const targetPathSafe = !targetPath || (
    targetRelative && targetRelative !== ".." && !targetRelative.startsWith(`..${sep}`)
    && !isAbsolute(targetRelative)
  );
  const sourceBeforeResult = targetPath && targetPathSafe
    ? (() => {
      try { return { value: snapshotTargetFile(targetAbsPath), error: null }; }
      catch (error) { return { value: null, error: String(error?.message || error) }; }
    })()
    : { value: null, error: targetPath ? "unsafe target path" : null };
  let invocation = { status: "not_started", via: null, error: null };
  let syncResult = null;
  let statusAfter = statusBefore;

  try {
    if (manager) {
      const syncPayload = { reason: "cli-sync", ...(force ? { force: true } : {}) };
      syncResult = await manager.sync(syncPayload);
      if (syncResult?.ok === false) {
        throw new Error(syncResult.error || "OpenClaw memory manager reported index failure");
      }
      statusAfter = typeof manager.status === "function" ? manager.status() : null;
      invocation = { status: "succeeded", via: "memory_manager", error: null };
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
      };
      statusAfter = null;
      invocation = { status: "succeeded", via: "openclaw_cli", error: null };
    }
  } catch (error) {
    invocation = {
      status: "failed",
      via: manager ? "memory_manager" : "openclaw_cli",
      error: String(error?.message || error),
    };
  }

  const dbPath = statusAfter?.dbPath || statusBefore?.dbPath || CORE_DB_PATH;
  const afterResult = safeWithDb(db => readIndexedPathState(db, scannedPaths), dbPath, withDbImpl);
  const after = afterResult.status === "ok" ? afterResult.value : null;
  const indexedCount = after ? after.paths.length : null;
  const updatedCount = after && before
    ? after.paths.filter(path => (before.updatedAt[path] ?? null) !== (after.updatedAt[path] ?? null)).length
    : null;
  const skippedCount = after
    ? scannedPaths.filter(path => !after.paths.includes(path)).length
    : null;

  const sourceAfterResult = targetPath && targetPathSafe
    ? (() => {
      try { return { value: snapshotTargetFile(targetAbsPath), error: null }; }
      catch (error) { return { value: null, error: String(error?.message || error) }; }
    })()
    : { value: null, error: targetPath ? "unsafe target path" : null };
  const indexedTargetResult = targetPath && targetPathSafe
    ? safeWithDb(db => readTargetIndexedContentEvidenceImpl(db, targetPath), dbPath, withDbImpl)
    : { status: targetPath ? "query_error" : "ok", value: null, error: targetPath ? "unsafe target path" : null };
  const targetCoverage = targetDate
    ? assessTargetDateCoverage({
      targetDate,
      targetPath,
      scannedPaths,
      sourceBefore: sourceBeforeResult.value,
      sourceAfter: sourceAfterResult.value,
      sourceBeforeError: sourceBeforeResult.error,
      sourceAfterError: sourceAfterResult.error,
      indexedResult: indexedTargetResult.status === "ok"
        ? indexedTargetResult.value
        : { status: indexedTargetResult.status, error: indexedTargetResult.error },
    })
    : { status: "not_requested", target_date: null, path: null, reason: null };

  const output = {
    ok: invocation.status === "succeeded"
      && beforeResult.status === "ok"
      && afterResult.status === "ok"
      && (targetCoverage.status === "complete" || targetCoverage.status === "not_requested"),
    reason: "cli-sync",
    force,
    memory_root: memoryRoot,
    db_path: dbPath,
    index_invocation: invocation,
    target_date_coverage: targetCoverage,
    db_status_before: beforeResult.status,
    db_status_after: afterResult.status,
    db_error_before: beforeResult.error,
    db_error_after: afterResult.error,
    dirty_before: dirtyBefore,
    file_scan: {
      status: afterResult.status,
      baseline_status: beforeResult.status,
      total: scannedPaths.length,
      indexed: indexedCount,
      updated: updatedCount,
      skipped: skippedCount,
      target_date_limited: false,
    },
    manager_status: statusAfter || null,
    manager_error: manager ? null : (managerResult.error || null),
    sync_result: manager ? summarizeManagerSyncResult(syncResult) : (syncResult ?? null),
    target_smart_add_path: targetPath,
  };
  await manager?.close?.();
  return output;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return 0;
  }
  const output = await runSyncMemoryIndex({ force: args.force, targetDate: args.targetDate });
  console.log(JSON.stringify(output, null, 2));
  return output.ok === false ? 1 : 0;
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
  withDb,
  readTargetIndexedContentEvidence,
};

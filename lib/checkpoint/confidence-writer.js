const { existsSync, readFileSync } = require("node:fs");

const checkpointDate = require("./date");
const { withDb, ensureCheckpointTables } = require("./db");
const { withEngineDbIsolated } = require("../db/isolated-dbs.js");
const { getRuntime } = require("./runtime");
const {
  assignStableMemoryIdentity,
  stableMemoryIdentitySchemaState,
} = require("../db/stable-memory-identity.cjs");
const {
  parseCanonicalSmartAddBlocks,
  parseLineNumber,
  resolveSourcePath,
} = require("./smart-add-entry-identity.js");

const CHECKPOINT_ENTRY_IDENTITY_NOT_FOUND = "CHECKPOINT_ENTRY_IDENTITY_NOT_FOUND";
const CHECKPOINT_ENTRY_IDENTITY_AMBIGUOUS = "CHECKPOINT_ENTRY_IDENTITY_AMBIGUOUS";
const CHECKPOINT_ENTRY_CATEGORY_MISMATCH = "CHECKPOINT_ENTRY_CATEGORY_MISMATCH";
const CHECKPOINT_ENTRY_SOURCE_UNAVAILABLE = "CHECKPOINT_ENTRY_SOURCE_UNAVAILABLE";
const CHECKPOINT_CORE_IDENTITY_UNAVAILABLE = "CHECKPOINT_CORE_IDENTITY_UNAVAILABLE";
const CHECKPOINT_CHUNK_IDENTITY_AMBIGUOUS = "CHECKPOINT_CHUNK_IDENTITY_AMBIGUOUS";

const IDENTITY_ERROR_CODES = new Set([
  CHECKPOINT_ENTRY_IDENTITY_NOT_FOUND,
  CHECKPOINT_ENTRY_IDENTITY_AMBIGUOUS,
  CHECKPOINT_ENTRY_CATEGORY_MISMATCH,
  CHECKPOINT_ENTRY_SOURCE_UNAVAILABLE,
  CHECKPOINT_CORE_IDENTITY_UNAVAILABLE,
  CHECKPOINT_CHUNK_IDENTITY_AMBIGUOUS,
]);

const CATEGORY_PARAMS = Object.freeze({
  preference: { conf: 0.8, tau: 90.0 },
  episodic: { conf: 0.7, tau: 30.0 },
  user_identity: { conf: 0.95, tau: 365.0 },
  kg_node: { conf: 0.85, tau: 90.0 },
  temporary: { conf: 0.4, tau: 2.0 },
  raw_log: { conf: 0.5, tau: 7.0 },
});

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeCategory(value) {
  return String(value || "").trim().toLowerCase();
}

function identityError(error) {
  return error && IDENTITY_ERROR_CODES.has(error.code) ? error : null;
}

function resolveSourceEntry({ workspaceDir, fileRel, entryId, category, readFile = readFileSync }) {
  if (typeof entryId !== "string" || !entryId.trim()) {
    throw codedError(CHECKPOINT_ENTRY_IDENTITY_NOT_FOUND);
  }
  const normalizedEntryId = entryId.trim();
  const normalizedCategory = normalizeCategory(category);
  if (!normalizedCategory) throw codedError(CHECKPOINT_ENTRY_CATEGORY_MISMATCH);

  const sourcePath = resolveSourcePath(workspaceDir, fileRel);
  if (!sourcePath) throw codedError(CHECKPOINT_ENTRY_SOURCE_UNAVAILABLE);

  let blocks;
  try {
    blocks = parseCanonicalSmartAddBlocks(readFile(sourcePath, "utf8"));
  } catch (error) {
    throw codedError(CHECKPOINT_ENTRY_SOURCE_UNAVAILABLE);
  }

  const matches = blocks.filter(block => block.entryId === normalizedEntryId);
  if (matches.length === 0) throw codedError(CHECKPOINT_ENTRY_IDENTITY_NOT_FOUND);
  if (matches.length > 1) throw codedError(CHECKPOINT_ENTRY_IDENTITY_AMBIGUOUS);

  const entry = matches[0];
  if (normalizeCategory(entry.category) !== normalizedCategory) {
    throw codedError(CHECKPOINT_ENTRY_CATEGORY_MISMATCH);
  }

  const startLine = parseLineNumber(entry.startLine);
  const endLine = parseLineNumber(entry.endLine);
  if (startLine === null || endLine === null || startLine > endLine) {
    throw codedError(CHECKPOINT_ENTRY_SOURCE_UNAVAILABLE);
  }

  return {
    entryId: normalizedEntryId,
    category: normalizedCategory,
    fileRel,
    sourcePath,
    startLine,
    endLine,
  };
}

function resolveCoreChunkIds({ fileRel, entry, withCoreDb: withCoreDbImpl = withDb }) {
  let rows;
  try {
    rows = withCoreDbImpl(db => db.prepare(`
      SELECT id, path, start_line, end_line
      FROM chunks
      WHERE path = ?
    `).all(fileRel));
  } catch (error) {
    const known = identityError(error);
    if (known) throw known;
    throw codedError(CHECKPOINT_CORE_IDENTITY_UNAVAILABLE);
  }

  if (!Array.isArray(rows)) throw codedError(CHECKPOINT_CORE_IDENTITY_UNAVAILABLE);
  const normalizedRows = rows.map(row => {
    const id = typeof row?.id === "string" ? row.id.trim() : String(row?.id ?? "").trim();
    const path = typeof row?.path === "string" ? row.path : "";
    const startLine = parseLineNumber(row?.start_line);
    const endLine = parseLineNumber(row?.end_line);
    return { id, path, startLine, endLine };
  });
  if (normalizedRows.some(row => (
    !row.id
    || row.path !== fileRel
    || row.startLine === null
    || row.endLine === null
    || row.startLine > row.endLine
  ))) {
    throw codedError(CHECKPOINT_CORE_IDENTITY_UNAVAILABLE);
  }

  const overlapping = normalizedRows.filter(row => (
    row.startLine <= entry.endLine && row.endLine >= entry.startLine
  ));
  const crossing = overlapping.some(row => (
    row.startLine < entry.startLine || row.endLine > entry.endLine
  ));
  if (crossing) throw codedError(CHECKPOINT_CHUNK_IDENTITY_AMBIGUOUS);

  const seen = new Set();
  return overlapping
    .filter(row => row.startLine >= entry.startLine && row.endLine <= entry.endLine)
    .map(row => row.id)
    .filter(id => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function inspectConfidenceBinding(entryId, category, options = {}) {
  const rt = getRuntime();
  const fileRel = options.fileRel !== undefined
    ? options.fileRel
    : `memory/smart-add/${checkpointDate.todayDateStr(rt.now(), rt.timeZone)}.md`;
  let entry;
  let chunkIds;
  try {
    entry = resolveSourceEntry({
      workspaceDir: rt.workspaceDir,
      fileRel,
      entryId,
      category,
      readFile: options.readFile || readFileSync,
    });
    chunkIds = resolveCoreChunkIds({
      fileRel,
      entry,
      withCoreDb: options.withCoreDb || withDb,
    });
  } catch (error) {
    if (error?.code === CHECKPOINT_CHUNK_IDENTITY_AMBIGUOUS) {
      return { status: "deferred", reason: "ambiguous_core_identity", errorCode: error.code };
    }
    if (IDENTITY_ERROR_CODES.has(error?.code)) {
      return { status: "deferred", reason: "identity_unavailable", errorCode: error.code };
    }
    throw error;
  }

  const resultBase = { entryId: entry.entryId, fileRel, chunkIds };
  if (chunkIds.length === 0) {
    return { ...resultBase, status: "pending", reason: "exact_core_chunk_not_indexed" };
  }

  const { coreDbPath, engineDbPath } = rt;
  if (!existsSync(engineDbPath)) return { ...resultBase, status: "ready" };

  return withEngineDbIsolated((engineDb) => {
    const hasConfidenceTable = Boolean(engineDb.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_confidence'",
    ).get());
    if (!hasConfidenceTable) return { ...resultBase, status: "ready" };

    const stableIdentityState = stableMemoryIdentitySchemaState(engineDb);
    if (stableIdentityState === "partial" || stableIdentityState === "error") {
      return {
        ...resultBase,
        status: "deferred",
        reason: "stable_identity_schema_incomplete",
      };
    }

    const columns = new Set(
      engineDb.prepare("PRAGMA table_info(memory_confidence)").all().map(row => String(row.name || "")),
    );
    const entityProjection = columns.has("entity_id") ? "entity_id" : "NULL AS entity_id";
    const placeholders = chunkIds.map(() => "?").join(", ");
    const rows = engineDb.prepare(`
      SELECT chunk_id, ${entityProjection}
      FROM memory_confidence
      WHERE chunk_id IN (${placeholders})
    `).all(...chunkIds);
    const byChunkId = new Map(rows.map(row => [String(row.chunk_id), row]));
    const complete = chunkIds.every(chunkId => {
      const row = byChunkId.get(String(chunkId));
      if (!row) return false;
      return stableIdentityState !== "migrated" || String(row.entity_id || "").trim();
    });
    return {
      ...resultBase,
      status: complete ? "already_initialized" : "ready",
    };
  }, {
    coreDbPath,
    engineDbPath,
    readonly: true,
  });
}

function writeConfidence(entryId, text, category, options = {}) {
  void text;
  const rt = getRuntime();
  const fileRel = options.fileRel !== undefined
    ? options.fileRel
    : `memory/smart-add/${checkpointDate.todayDateStr(rt.now(), rt.timeZone)}.md`;
  const entry = resolveSourceEntry({
    workspaceDir: rt.workspaceDir,
    fileRel,
    entryId,
    category,
    readFile: options.readFile || readFileSync,
  });
  const chunkIds = resolveCoreChunkIds({
    fileRel,
    entry,
    withCoreDb: options.withCoreDb || withDb,
  });

  const resultBase = {
    ok: true,
    entryId: entry.entryId,
    fileRel,
    chunkIds,
    initialized: 0,
  };
  if (chunkIds.length === 0) {
    return {
      ...resultBase,
      status: "pending",
      reason: "exact_core_chunk_not_indexed",
    };
  }

  const params = CATEGORY_PARAMS[entry.category] || CATEGORY_PARAMS.raw_log;
  const rawNowSec = options.nowSec !== undefined
    ? Number(options.nowSec)
    : Math.floor(Date.now() / 1000);
  const nowSec = Number.isFinite(rawNowSec) ? Math.floor(rawNowSec) : Math.floor(Date.now() / 1000);
  const { coreDbPath, engineDbPath } = getRuntime();
  const initialized = withEngineDbIsolated((engineDb) => {
    const hasConfidenceTable = Boolean(engineDb.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_confidence'",
    ).get());
    if (!hasConfidenceTable) ensureCheckpointTables(engineDb);
    const stableIdentityState = stableMemoryIdentitySchemaState(engineDb);
    if (stableIdentityState === "partial" || stableIdentityState === "error") {
      throw new Error("stable memory identity schema incomplete; confidence write halted");
    }
    const stableIdentityReady = stableIdentityState === "migrated";
    let inserted = 0;
    // Stable identity assignment preserves the previous INSERT OR IGNORE
    // behavior for an already initialized confidence row.
    const transaction = engineDb.transaction(() => {
      for (const chunkId of chunkIds) {
        if (stableIdentityReady) {
          const result = assignStableMemoryIdentity(engineDb, {
            skipSchema: true,
            chunkId,
            path: fileRel,
            source: "core",
            initialConfidence: params.conf,
            confidence: params.conf,
            lastConfidenceUpdate: nowSec,
            baseTau: params.tau,
            category: entry.category,
          });
          if (result.confidence?.created) inserted += 1;
        } else {
          const result = engineDb.prepare(`
            INSERT OR IGNORE INTO memory_confidence
              (chunk_id, initial_confidence, confidence, last_confidence_update,
               base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
            VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
          `).run(chunkId, params.conf, params.conf, nowSec, params.tau, entry.category);
          if (Number(result?.changes || 0) > 0) inserted += 1;
        }
      }
    });
    transaction();
    return inserted;
  }, {
    coreDbPath,
    engineDbPath,
  });

  return {
    ...resultBase,
    status: initialized > 0 ? "initialized" : "already_initialized",
    initialized,
    existing: chunkIds.length - initialized,
    stable_identity_state: withEngineDbIsolated(engineDb => (
      stableMemoryIdentitySchemaState(engineDb)
    ), {
      coreDbPath,
      engineDbPath,
      readonly: true,
    }),
  };
}

module.exports = {
  CHECKPOINT_CHUNK_IDENTITY_AMBIGUOUS,
  CHECKPOINT_CORE_IDENTITY_UNAVAILABLE,
  CHECKPOINT_ENTRY_CATEGORY_MISMATCH,
  CHECKPOINT_ENTRY_IDENTITY_AMBIGUOUS,
  CHECKPOINT_ENTRY_IDENTITY_NOT_FOUND,
  CHECKPOINT_ENTRY_SOURCE_UNAVAILABLE,
  inspectConfidenceBinding,
  resolveCoreChunkIds,
  resolveSourceEntry,
  writeConfidence,
};

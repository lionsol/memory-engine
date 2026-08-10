const { getSFKey, getSFBaseUrl } = require("./config");
const { withDb } = require("./db");
const { withEngineDbIsolated } = require("../db/isolated-dbs.js");
const { getRuntime } = require("./runtime");
const {
  collectEligibleSessionFlushCoreRows,
} = require("./session-flush-reconciliation.js");

const MAX_LANCE_WRITES_PER_CYCLE = 10;
const LANCE_QUERY_BATCH_SIZE = 400;

function chunked(values, size = LANCE_QUERY_BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function buildIdPredicate(ids) {
  const escaped = ids.map(id => `'${String(id).replace(/'/g, "''")}'`);
  return escaped.length === 1
    ? `id = ${escaped[0]}`
    : `id IN (${escaped.join(", ")})`;
}

async function materializeRows(value) {
  const resolved = await value;
  if (Array.isArray(resolved)) return resolved;
  if (resolved && typeof resolved[Symbol.asyncIterator] === "function") {
    const rows = [];
    for await (const page of resolved) rows.push(...(Array.isArray(page) ? page : [page]));
    return rows;
  }
  if (resolved && typeof resolved[Symbol.iterator] === "function") return [...resolved];
  return [];
}

async function readScopedLanceIds(table, ids) {
  const lanceIds = new Set();
  for (const batch of chunked(ids)) {
    if (batch.length === 0) continue;
    let query = typeof table?.query === "function"
      ? table.query()
      : typeof table?.search === "function"
        ? table.search(new Array(2560).fill(0))
        : null;
    if (!query || typeof query.where !== "function") {
      throw new Error("scoped Lance reconciliation requires filtered query support");
    }
    query = query.where(buildIdPredicate(batch)) || query;
    if (typeof query.select === "function") query = query.select(["id"]) || query;
    if (typeof query.limit === "function") query = query.limit(batch.length) || query;
    let rows;
    if (typeof query.toArray === "function") {
      rows = await materializeRows(query.toArray());
    } else if (typeof query.execute === "function") {
      rows = await materializeRows(query.execute());
    } else if (query && typeof query[Symbol.asyncIterator] === "function") {
      rows = [];
      for await (const page of query) rows.push(...(Array.isArray(page) ? page : [page]));
    } else {
      throw new Error("scoped Lance reconciliation requires a materializable filtered query");
    }
    for (const row of rows || []) {
      if (row?.id !== undefined && row?.id !== null) lanceIds.add(String(row.id));
    }
  }
  return lanceIds;
}

function readScopedEngineRows(runtime, ids) {
  return withEngineDbIsolated((engineDb) => {
    const rows = [];
    for (const batch of chunked(ids)) {
      if (batch.length === 0) continue;
      const placeholders = batch.map(() => "?").join(", ");
      rows.push(...engineDb.prepare(`
        SELECT chunk_id, is_archived
        FROM memory_confidence
        WHERE chunk_id IN (${placeholders})
      `).all(...batch));
    }
    return rows;
  }, {
    ...runtime.dbOptions,
    readonly: true,
  });
}

function requestEmbedding(text) {
  const https = require("node:https");
  const key = getSFKey();
  if (!key) return Promise.resolve(null);

  const embBody = JSON.stringify({
    model: "Qwen/Qwen3-Embedding-4B",
    input: String(text || "").slice(0, 8000),
  });
  return new Promise((resolve, reject) => {
    const url = new URL("/v1/embeddings", getSFBaseUrl());
    const req = https.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    }, (resp) => {
      let data = "";
      resp.on("data", chunk => data += chunk);
      resp.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.data?.[0]?.embedding || null);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.write(embBody);
    req.end();
  });
}

function scopedFailure({ trigger, eligible, active, missing, error, failed = missing } = {}) {
  return {
    ok: false,
    trigger,
    lance_eligible: active,
    lance_existing: Math.max(0, eligible - missing),
    lance_missing_before: missing,
    lance_added: 0,
    lance_failed: failed,
    lance_backlog_remaining: missing,
    lance_converged: false,
    error: error?.message ? String(error.message) : String(error),
  };
}

async function reconcileScopedSessionFlushVectors(options = {}) {
  const runtime = getRuntime();
  const trigger = options.trigger || "nightly_checkpoint";
  let eligibleCoreRows = Array.isArray(options.eligibleCoreRows)
    ? options.eligibleCoreRows
    : null;
  if (!eligibleCoreRows) {
    const collection = collectEligibleSessionFlushCoreRows({ trigger });
    if (!collection.ok) {
      return scopedFailure({
        trigger,
        eligible: 0,
        active: 0,
        missing: 0,
        error: new Error(collection.error),
        failed: 0,
      });
    }
    eligibleCoreRows = collection.eligibleCoreRows;
  }

  if (options.engineReconciliation?.ok === false) {
    return scopedFailure({
      trigger,
      eligible: eligibleCoreRows.length,
      active: 0,
      missing: eligibleCoreRows.length,
      error: new Error(options.engineReconciliation.error || "Engine reconciliation incomplete"),
    });
  }

  const eligibleIds = [...new Set(eligibleCoreRows.map(row => String(row.id)).filter(Boolean))];
  if (eligibleIds.length === 0) {
    return {
      ok: true,
      trigger,
      lance_eligible: 0,
      lance_existing: 0,
      lance_missing_before: 0,
      lance_added: 0,
      lance_failed: 0,
      lance_backlog_remaining: 0,
      lance_converged: true,
    };
  }

  let engineRows;
  try {
    engineRows = readScopedEngineRows(runtime, eligibleIds);
  } catch (error) {
    return scopedFailure({
      trigger,
      eligible: eligibleIds.length,
      active: 0,
      missing: eligibleIds.length,
      error,
    });
  }

  const engineById = new Map(engineRows.map(row => [String(row.chunk_id), row]));
  const activeRows = eligibleCoreRows.filter(row => {
    const engineRow = engineById.get(String(row.id));
    return engineRow && Number(engineRow.is_archived || 0) === 0;
  });
  if (activeRows.length === 0) {
    return {
      ok: true,
      trigger,
      lance_eligible: 0,
      lance_existing: 0,
      lance_missing_before: 0,
      lance_added: 0,
      lance_failed: 0,
      lance_backlog_remaining: 0,
      lance_converged: true,
    };
  }

  let lancedb;
  let table;
  try {
    lancedb = require("@lancedb/lancedb");
    const db = await lancedb.connect(runtime.lancedbDir);
    table = await db.openTable("chunks");
  } catch (error) {
    return scopedFailure({
      trigger,
      eligible: activeRows.length,
      active: activeRows.length,
      missing: activeRows.length,
      error,
    });
  }

  let lanceIds;
  try {
    lanceIds = await readScopedLanceIds(table, activeRows.map(row => String(row.id)));
  } catch (error) {
    return scopedFailure({
      trigger,
      eligible: activeRows.length,
      active: activeRows.length,
      missing: activeRows.length,
      error,
    });
  }

  const missingRows = activeRows.filter(row => !lanceIds.has(String(row.id)));
  const selectedRows = missingRows.slice(0, MAX_LANCE_WRITES_PER_CYCLE);
  let added = 0;
  let failed = 0;
  const embedText = typeof options.embedText === "function" ? options.embedText : requestEmbedding;

  for (const row of selectedRows) {
    try {
      const chunk = withDb(db => db.prepare("SELECT text FROM chunks WHERE id = ?").get(row.id));
      if (!chunk || !chunk.text) throw new Error("Core chunk text unavailable");
      const vector = await embedText(String(chunk.text).slice(0, 2000), row);
      if (!Array.isArray(vector) || vector.length === 0) throw new Error("embedding unavailable");
      await table.add([{
        id: String(row.id),
        text: String(chunk.text).slice(0, 2000),
        vector,
        timestamp: Date.now(),
      }]);
      added += 1;
    } catch (error) {
      failed += 1;
      console.warn(`  ↳ Failed to reconcile session_flush ${String(row.id).slice(0, 16)}: ${error.message}`);
    }
  }

  const backlog = missingRows.length - added;
  return {
    ok: failed === 0 && backlog === 0,
    trigger,
    lance_eligible: activeRows.length,
    lance_existing: lanceIds.size,
    lance_missing_before: missingRows.length,
    lance_added: added,
    lance_failed: failed,
    lance_backlog_remaining: backlog,
    lance_converged: failed === 0 && backlog === 0,
  };
}

async function repairGlobalOrphanVectors() {
  let repaired = 0;
  try {
    const lancedb = require("@lancedb/lancedb");
    const runtime = getRuntime();
    const LANCEDB_PATH = runtime.lancedbDir;

    const sqliteIds = withEngineDbIsolated((engineDb) => {
      return engineDb.prepare("SELECT chunk_id, category FROM memory_confidence WHERE is_archived = 0").all();
    }, {
      ...runtime.dbOptions,
      readonly: true,
    });

    let lanceIds = new Set();
    try {
      const ldb = await lancedb.connect(LANCEDB_PATH);
      const table = await ldb.openTable("chunks");
      const count = await table.countRows();
      if (count > 1000) {
        console.log(`[checkpoint] LanceDB has ${count} rows, skipping full scan`);
        return 0;
      }
      const dummyVec = new Array(2560).fill(0);
      const raw = await table.search(dummyVec).limit(count + 10).execute();
      const items = [];
      if (typeof raw[Symbol.asyncIterator] === "function") {
        for await (const batch of raw) { for (const row of batch) items.push(row); }
      }
      lanceIds = new Set(items.map(r => r.id));
    } catch (e) {
      console.warn("[checkpoint] LanceDB scan failed:", e.message);
      return 0;
    }

    const missing = sqliteIds.filter(r => !lanceIds.has(r.chunk_id));
    if (missing.length === 0) {
      console.log("[checkpoint] No orphan vectors to repair");
      return 0;
    }

    console.log(`[checkpoint] Found ${missing.length} SQLite entries missing from LanceDB, repairing...`);

    const ldb = await lancedb.connect(LANCEDB_PATH);
    const table = await ldb.openTable("chunks");
    const BATCH = 10;

    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      for (const row of batch) {
        try {
          const chunk = withDb(db => {
            return db.prepare("SELECT text FROM chunks WHERE id = ?").get(row.chunk_id);
          });
          if (!chunk || !chunk.text) continue;

          const text = chunk.text.slice(0, 2000);

          const vec = await requestEmbedding(text);
          if (vec && vec.length > 0) {
            await table.add([{
              id: row.chunk_id,
              text: text.slice(0, 2000),
              vector: vec,
              timestamp: Date.now(),
            }]);
            repaired++;
          }
        } catch (e) {
          console.warn(`  ↳ Failed to repair ${row.chunk_id.slice(0, 16)}: ${e.message}`);
        }
      }
    }

    console.log(`[checkpoint] Repaired ${repaired}/${missing.length} missing LanceDB vectors`);
  } catch (e) {
    console.warn("[checkpoint] Orphan repair skipped:", e.message);
  }
  return repaired;
}

async function repairOrphanVectors(options = {}) {
  if (options && options.scope === "session_flush") {
    return reconcileScopedSessionFlushVectors(options);
  }
  return repairGlobalOrphanVectors();
}

module.exports = {
  MAX_LANCE_WRITES_PER_CYCLE,
  repairOrphanVectors,
  reconcileScopedSessionFlushVectors,
};

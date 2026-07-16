const { resolve } = require("node:path");
const { getSFKey, getSFBaseUrl } = require("./config");
const { withDb } = require("./db");
const { withEngineDbIsolated } = require("../db/isolated-dbs.js");
const { getRuntime } = require("./runtime");

async function repairOrphanVectors() {
  let repaired = 0;
  try {
    const lancedb = require("@lancedb/lancedb");
    const LANCEDB_PATH = resolve(getRuntime().memoryDir, "lancedb");

    const { coreDbPath, engineDbPath } = getRuntime();
    const sqliteIds = withEngineDbIsolated((engineDb) => {
      return engineDb.prepare("SELECT chunk_id, category FROM memory_confidence WHERE is_archived = 0").all();
    }, {
      coreDbPath,
      engineDbPath,
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

          const https = require("node:https");
          const key = getSFKey();
          if (!key) continue;

          const embBody = JSON.stringify({
            model: "Qwen/Qwen3-Embedding-4B",
            input: text.slice(0, 8000),
          });
          const embResult = await new Promise((res, rej) => {
            const url = new URL("/v1/embeddings", getSFBaseUrl());
            const req = https.request(url, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            }, (resp) => {
              let d = "";
              resp.on("data", c => d += c);
              resp.on("end", () => {
                try { res(JSON.parse(d)); } catch (e) { rej(e); }
              });
            });
            req.on("error", rej);
            req.write(embBody);
            req.end();
          });

          const vec = embResult.data?.[0]?.embedding;
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

module.exports = {
  repairOrphanVectors,
};

#!/usr/bin/env node
/**
 * backfill-lancedb.js — 为所有有效 chunk 生成 embedding 并写入 LanceDB
 *
 * 运行方式：node scripts/backfill-lancedb.js
 *
 * 从 memory-engine.sqlite 读取所有 memory_confidence 条目，
 * 关联 main.sqlite 的 chunks 获取文本，检查是否已在 LanceDB，
 * 缺失的逐批生成 embedding 并写入。
 */

const https = require("node:https");
const path = require("node:path");
const { homedir } = require("node:os");
const { resolve } = require("node:path");
const { readFileSync, existsSync } = require("node:fs");
const Database = require("better-sqlite3");

const HOME = homedir();
const DB_PATH = resolve(HOME, ".openclaw/memory/main.sqlite");
const ME_DB_PATH = resolve(HOME, ".openclaw/memory/memory-engine/memory-engine.sqlite");
const LANCEDB_PATH = resolve(HOME, ".openclaw/memory/lancedb");
const CONFIG_JSON = resolve(HOME, ".openclaw/openclaw.json");

function getConfig() {
  return JSON.parse(readFileSync(CONFIG_JSON, "utf-8"));
}

function getSFKey() {
  try {
    return getConfig().models?.providers?.siliconflow?.apiKey || "";
  } catch {
    return "";
  }
}

function getSFBaseUrl() {
  try {
    return getConfig().models?.providers?.siliconflow?.baseUrl || "https://api.siliconflow.cn/v1";
  } catch {
    return "https://api.siliconflow.cn/v1";
  }
}

/**
 * Generate a single embedding via SiliconFlow API.
 */
function generateEmbedding(text) {
  return new Promise((resolve, reject) => {
    const apiKey = getSFKey();
    if (!apiKey) return reject(new Error("SiliconFlow API key not found"));

    const url = new URL("/v1/embeddings", getSFBaseUrl());
    const body = JSON.stringify({
      model: "Qwen/Qwen3-Embedding-4B",
      input: text.slice(0, 8000),
    });

    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            const embedding = parsed.data?.[0]?.embedding;
            if (!embedding) return reject(new Error("No embedding in response"));
            resolve(embedding);
          } catch (e) {
            reject(new Error(`Parse failed: ${e.message}`));
          }
        });
      }
    );
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("Embedding request timed out")); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log("=== LanceDB Backfill ===");
  const start = Date.now();

  // Step 1: Get all valid confidence entries (chunks that exist in main.sqlite)
  console.log("\n[1/4] Reading confidence entries...");
  const meDb = new Database(ME_DB_PATH, { readonly: true });
  const mainDb = new Database(DB_PATH, { readonly: true });

  // Join across two DBs
  const confIds = meDb.prepare(`
    SELECT mc.chunk_id, mc.category FROM memory_confidence mc WHERE mc.is_archived = 0
  `).all().map(r => r.chunk_id);

  // Build a set of chunk_ids that exist in main.sqlite
  const validChunks = new Set();
  const chunkLookup = mainDb.prepare("SELECT id, text, path FROM chunks WHERE id = ?");
  const chunkData = [];

  for (const id of confIds) {
    const row = chunkLookup.get(id);
    if (row) {
      validChunks.add(id);
      chunkData.push(row);
    }
  }

  meDb.close();
  mainDb.close();

  console.log(`  Confidence entries: ${confIds.length}`);
  console.log(`  Valid chunks: ${chunkData.length} (${confIds.length - chunkData.length} orphaned references)`);

  // Step 2: Check which ones already exist in LanceDB
  console.log("\n[2/4] Checking LanceDB...");
  let lancedb;
  let table;
  let existingIds = new Set();
  try {
    const lancedbModule = require("@lancedb/lancedb");
    lancedb = await lancedbModule.connect(LANCEDB_PATH);
    const tableNames = await lancedb.tableNames();
    if (tableNames.includes("chunks")) {
      table = await lancedb.openTable("chunks");
      const count = await table.countRows();
      console.log(`  LanceDB has ${count} existing vectors`);
      if (count > 0) {
        // Scan existing IDs via streaming
        const stream = await table.query().limit(count).toArray();
        for (const row of stream) {
          if (row.id) existingIds.add(row.id);
        }
        console.log(`  Existing unique IDs: ${existingIds.size}`);
      }
    } else {
      console.log("  No 'chunks' table in LanceDB, creating...");
    }
  } catch (e) {
    console.error(`  LanceDB access error: ${e.message}`);
    return;
  }

  // Step 3: Find missing chunks
  console.log("\n[3/4] Identifying missing chunks...");
  const toBackfill = chunkData.filter(row => !existingIds.has(row.id));
  console.log(`  Need to backfill: ${toBackfill.length} chunks`);

  if (toBackfill.length === 0) {
    console.log("\n✅ All chunks already have vectors. Nothing to do.");
    await lancedb.close();
    return;
  }

  // Step 4: Backfill in batches
  console.log("\n[4/4] Generating embeddings and writing to LanceDB...");
  const BATCH = 5; // concurrent API calls
  let done = 0;
  let errors = 0;
  let skipped = 0;

  // Ensure table exists
  if (!table) {
    table = await lancedb.createTable("chunks", [
      { id: "init", text: "", vector: new Array(2560).fill(0), timestamp: Date.now() },
    ]);
    // Delete the dummy row
    await table.delete(`id = 'init'`);
  }

  for (let i = 0; i < toBackfill.length; i += BATCH) {
    const batch = toBackfill.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (row) => {
        const text = (row.text || "").slice(0, 2000);
        if (!text.trim()) { skipped++; return null; }
        const embedding = await generateEmbedding(text);
        return {
          id: row.id,
          text: text,
          vector: embedding,
          timestamp: Date.now(),
        };
      })
    );

    const toAdd = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        toAdd.push(result.value);
        done++;
      } else if (result.status === "rejected") {
        errors++;
        if (errors <= 5) console.warn(`  ✗ Error: ${result.reason?.message?.slice(0, 80)}`);
        // Wait a bit on errors (rate limiting)
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (toAdd.length > 0) {
      await table.add(toAdd);
    }

    const pct = Math.min(100, Math.round(((i + BATCH) / toBackfill.length) * 100));
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`  ${pct}% (${done} written, ${errors} errors, ${skipped} skipped) — ${elapsed}s elapsed`);

    // Small delay between batches to avoid rate limiting
    if (i + BATCH < toBackfill.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\n=== Done in ${elapsed}s ===`);
  console.log(`  ✅ Written: ${done}`);
  console.log(`  ❌ Errors: ${errors}`);
  console.log(`  ⏭ Skipped (empty): ${skipped}`);

  // Verify final count
  const finalCount = await table.countRows();
  console.log(`  LanceDB now has: ${finalCount} vectors`);

  await lancedb.close();
}

main().catch((e) => {
  console.error(`\nFATAL: ${e.message}`);
  process.exit(1);
});

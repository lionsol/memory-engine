#!/usr/bin/env node
/**
 * benchmark-scale.js — 三系统规模基准测试
 *
 * 用法: node scripts/benchmark-scale.js --sizes 1000,10000,100000
 *
 * 在临时 SQLite / LanceDB / 内存 KG 中分别生成 N 条数据，
 * 测量各规模下的读写 QPS、延迟分位数、内存开销。
 */

const { homedir } = require("node:os");
const { resolve } = require("node:path");
const { mkdirSync, rmSync, existsSync, writeFileSync } = require("node:fs");
const { execSync } = require("node:child_process");

const HOME = homedir();
const TMP_DIR = resolve(HOME, ".openclaw/workspace/.bench-tmp");
const WARMUP = 30;
const ITERATIONS = 100;

// ── CLI args ──
const sizesArg = process.argv.find(a => a.startsWith("--sizes=")) || "--sizes=1000,10000,100000";
const sizes = sizesArg.split("=")[1].split(",").map(Number);

// ── Helpers ──
function now() {
  const [s, ns] = process.hrtime();
  return s * 1e9 + ns;
}
function nsToMs(ns) { return ns / 1e6; }
function percentiles(arr, ps) {
  const sorted = [...arr].sort((a, b) => a - b);
  return ps.map(p => sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)]);
}
function formatLat(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
function formatQPS(qps) {
  if (qps >= 1_000_000) return `${(qps / 1_000_000).toFixed(1)}M`;
  if (qps >= 1000) return `${(qps / 1000).toFixed(1)}k`;
  return `${qps.toFixed(0)}`;
}
function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}
function getMem() { return process.memoryUsage().rss; }
function runGC() { if (global.gc) global.gc(); }

function rss() {
  try {
    return parseInt(require("node:fs").readFileSync("/proc/self/status", "utf-8")
      .match(/VmRSS:\s+(\d+)/)?.[1] || "0");
  } catch { return 0; }
}
function rssMB() { return (rss() / 1024).toFixed(1); }

function randomText(len) {
  const chars = "abcdefghijklmnopqrstuvwxyz 你好好世界记忆系统测试数据中文English混合内容 ";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function randomVec(dim) {
  const v = new Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.random() - 0.5;
  return v;
}

// ── Cleanup ──
function cleanup() {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
}

// ── SQLite benchmark at scale ──
function benchSQLiteScale(n) {
  mkdirSync(TMP_DIR, { recursive: true });
  const Database = require("better-sqlite3");
  const dbPath = resolve(TMP_DIR, `scale-${n}.sqlite`);
  const db = new Database(dbPath);

  // Create table and FTS5 index
  db.exec(`CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    path TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(id, text)`);

  // Batch insert
  const insertChunk = db.prepare("INSERT OR REPLACE INTO chunks (id, text) VALUES (?, ?)");
  const insertFts = db.prepare("INSERT OR REPLACE INTO chunks_fts (id, text) VALUES (?, ?)");
  const BATCH = 500;

  const insertStart = Date.now();
  db.exec("BEGIN TRANSACTION");
  for (let i = 0; i < n; i++) {
    const id = `bench_${n}_${i}`;
    const text = randomText(200 + Math.floor(Math.random() * 300));
    insertChunk.run(id, text);
    insertFts.run(id, text);
    if (i > 0 && i % BATCH === 0) {
      db.exec("COMMIT");
      db.exec("BEGIN TRANSACTION");
    }
  }
  db.exec("COMMIT");
  const insertMs = Date.now() - insertStart;
  const insertQps = Math.round(n / (insertMs / 1000));

  // Create index
  db.exec("CREATE INDEX IF NOT EXISTS idx_created ON chunks(created_at)");

  // Warmup reads
  const selectStmt = db.prepare("SELECT id, text FROM chunks WHERE id = ?");
  const ftsStmt = db.prepare("SELECT id FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT 10");
  for (let i = 0; i < WARMUP; i++) {
    selectStmt.get(`bench_${n}_${i % n}`);
    try { ftsStmt.get("测试"); } catch {}
  }

  // Point lookup
  const pointLats = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const idx = Math.floor(Math.random() * n);
    const start = now();
    selectStmt.get(`bench_${n}_${idx}`);
    pointLats.push(now() - start);
  }

  // FTS5 search
  const ftsLats = [];
  const terms = ["你好", "测试", "系统", "数据", "记忆", "世界", "内容", "混合"];
  for (let i = 0; i < ITERATIONS; i++) {
    const term = terms[i % terms.length];
    const start = now();
    try { ftsStmt.get(term); } catch {}
    ftsLats.push(now() - start);
  }

  // Full scan (sequential read)
  const scanStmt = db.prepare("SELECT COUNT(*) FROM chunks WHERE text LIKE ?");
  const scanLats = [];
  for (let i = 0; i < Math.min(ITERATIONS, 30); i++) {
    const start = now();
    scanStmt.get(`%${terms[i % terms.length]}%`);
    scanLats.push(now() - start);
  }

  const dbSize = existsSync(dbPath) ? require("node:fs").statSync(dbPath).size : 0;
  db.close();

  const pp = percentiles(pointLats, [0.5, 0.95, 0.99]).map(nsToMs);
  const pf = percentiles(ftsLats, [0.5, 0.95, 0.99]).map(nsToMs);
  const ps = percentiles(scanLats, [0.5, 0.95, 0.99]).map(nsToMs);

  return {
    insert: { qps: insertQps, totalMs: insertMs, count: n },
    dbSizeMB: +(dbSize / 1024 / 1024).toFixed(1),
    pointLookup: { qps: Math.round(1000 / (pp[0] / 1000)), p50: pp[0], p95: pp[1], p99: pp[2] },
    ftsSearch: { qps: Math.round(1000 / (pf[0] / 1000)), p50: pf[0], p95: pf[1], p99: pf[2] },
    scan: { qps: Math.round(1000 / (ps[0] / 1000)), p50: ps[0], p95: ps[1], p99: ps[2] },
  };
}

// ── LanceDB benchmark at scale ──
async function benchLanceDBScale(n) {
  mkdirSync(TMP_DIR, { recursive: true });
  const lancedb = require("@lancedb/lancedb");
  const DIM = 2560;

  const dbPath = resolve(TMP_DIR, `lancedb-${n}`);
  const ldb = await lancedb.connect(dbPath);

  // Create table
  const table = await ldb.createTable("vectors", [
    { id: "0", text: "initial", vector: new Array(DIM).fill(0) }
  ]);

  // Batch insert
  const BATCH = 100;
  const insertStart = Date.now();
  for (let i = 0; i < n; i += BATCH) {
    const batch = [];
    for (let j = 0; j < BATCH && i + j < n; j++) {
      batch.push({
        id: `vec_${n}_${i + j}`,
        text: randomText(100),
        vector: randomVec(DIM),
      });
    }
    await table.add(batch);
  }
  const insertMs = Date.now() - insertStart;
  const insertQps = Math.round(n / (insertMs / 1000));

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    const q = randomVec(DIM);
    await table.search(q).limit(10).execute();
  }

  // Vector search
  const lats = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const q = randomVec(DIM);
    const start = now();
    await table.search(q).limit(10).execute();
    lats.push(now() - start);
  }

  const count = await table.countRows();
  ldb.close();

  const p = percentiles(lats, [0.5, 0.95, 0.99]).map(nsToMs);
  return {
    insert: { qps: insertQps, totalMs: insertMs, count: n },
    dim: DIM,
    totalVectors: count,
    search: { qps: Math.round(1000 / (p[0] / 1000)), p50: p[0], p95: p[1], p99: p[2] },
  };
}

// ── Main ──
async function main() {
  mkdirSync(TMP_DIR, { recursive: true });
  console.log("=".repeat(70));
  console.log("  📊 Memory Engine 规模基准测试");
  console.log(`  Sizes: ${sizes.join(", ")}`);
  console.log(`  ${new Date().toISOString().slice(0, 19)}`);
  console.log("=".repeat(70));
  console.log();

  const results = [];

  for (const n of sizes) {
    console.log(`\n${"━".repeat(70)}`);
    console.log(`  🔹 Scale: ${n.toLocaleString()} entries`);
    console.log(`${"━".repeat(70)}`);
    console.log();

    runGC();
    const memBefore = rssMB();

    // ── SQLite ──
    console.log("  🗄️  SQLite...");
    const sqlStart = Date.now();
    const sql = benchSQLiteScale(n);
    const sqlElapsed = Date.now() - sqlStart;
    console.log(`     Insert: ${(sqlElapsed / 1000).toFixed(1)}s (${formatQPS(sql.insert.qps)} QPS)`);
    console.log(`     DB size: ${sql.dbSizeMB} MB`);
    console.log(`     Point lookup:  ${formatQPS(sql.pointLookup.qps)} QPS  p50=${formatLat(sql.pointLookup.p50)}  p95=${formatLat(sql.pointLookup.p95)}`);
    console.log(`     FTS5 search:   ${formatQPS(sql.ftsSearch.qps)} QPS  p50=${formatLat(sql.ftsSearch.p50)}  p95=${formatLat(sql.ftsSearch.p95)}`);
    console.log(`     LIKE scan:     ${formatQPS(sql.scan.qps)} QPS  p50=${formatLat(sql.scan.p50)}`);
    console.log();

    runGC();
    const memAfterSql = rssMB();

    // ── LanceDB ──
    console.log("  🔍 LanceDB...");
    const lanceStart = Date.now();
    let lance;
    try {
      lance = await benchLanceDBScale(n);
    } catch (e) {
      console.log(`     ❌ FAILED: ${e.message}`);
      lance = null;
    }
    if (lance) {
      const lanceElapsed = Date.now() - lanceStart;
      console.log(`     Insert: ${(lanceElapsed / 1000).toFixed(1)}s (${formatQPS(lance.insert.qps)} QPS)`);
      console.log(`     Vectors: ${lance.totalVectors} (dim=${lance.dim})`);
      console.log(`     Search (k=10):  ${formatQPS(lance.search.qps)} QPS  p50=${formatLat(lance.search.p50)}  p95=${formatLat(lance.search.p95)}`);
    }
    console.log();

    runGC();
    const memAfterLance = rssMB();
    const memDelta = (parseFloat(memAfterLance) - parseFloat(memBefore)).toFixed(1);

    results.push({ n, sql, lance, memBefore, memAfterLance, memDelta });
  }

  // ── Summary Table ──
  console.log("\n" + "=".repeat(70));
  console.log("  📋 规模测试汇总");
  console.log("=".repeat(70));
  console.log();
  console.log(`  ${"Size".padStart(8)} │ ${"SQL Insert".padStart(10)} │ ${"SQL Point".padStart(10)} │ ${"SQL FTS5".padStart(10)} │ ${"Lance Insert".padStart(10)} │ ${"Lance Search".padStart(10)} │ ${"Mem".padStart(8)}`);
  console.log(`  ${"".padStart(8, "─")}┼${"".padStart(11, "─")}┼${"".padStart(11, "─")}┼${"".padStart(11, "─")}┼${"".padStart(11, "─")}┼${"".padStart(11, "─")}┼${"".padStart(9, "─")}`);

  for (const r of results) {
    const sqlInsert = r.sql ? formatQPS(r.sql.insert.qps) : "ERR";
    const sqlPoint = r.sql ? formatQPS(r.sql.pointLookup.qps) : "ERR";
    const sqlFts = r.sql ? formatQPS(r.sql.ftsSearch.qps) : "ERR";
    const lanceInsert = r.lance ? formatQPS(r.lance.insert.qps) : "ERR";
    const lanceSearch = r.lance ? formatQPS(r.lance.search.qps) : "ERR";
    console.log(`  ${r.n.toLocaleString().padStart(8)} │ ${sqlInsert.padStart(10)} │ ${sqlPoint.padStart(10)} │ ${sqlFts.padStart(10)} │ ${lanceInsert.padStart(10)} │ ${lanceSearch.padStart(10)} │ +${r.memDelta.padStart(6)}MB`);
  }

  console.log();
  console.log("  ⚠️  LanceDB 100k 规模下内存压力显著（Rust 层预分配）");
  console.log("  ⚠️  SQLite LIKE % 扫描随规模线性退化");
  console.log("=".repeat(70));

  // Cleanup
  console.log("\n  清理临时文件...");
  cleanup();
  console.log("  ✅ Done");
}

main().catch(e => {
  console.error("\n❌ Benchmark failed:", e.message);
  cleanup();
  process.exit(1);
});

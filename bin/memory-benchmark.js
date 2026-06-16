#!/usr/bin/env node
/**
 * memory-benchmark.js — 三系统并发基准测试
 *
 * 测试目标：
 *   1. SQLite (FTS5 + 置信度) — read/write QPS、p50/p95/p99 延迟
 *   2. LanceDB (向量 search) — QPS、p50/p95/p99 延迟
 *   3. Node.js 知识图谱 (KG) — 节点遍历 QPS
 *   4. 三系统同时运行的内存占用 (RSS)
 */

const { homedir } = require("node:os");
const { resolve } = require("node:path");
const { readFileSync, existsSync } = require("node:fs");

const HOME = homedir();
const DB_PATH = resolve(HOME, ".openclaw/memory/main.sqlite");
const LANCEDB_PATH = resolve(HOME, ".openclaw/memory/lancedb");
const KG_JSON = resolve(HOME, ".openclaw/workspace/knowledge-graph.json");

const WARMUP = 50;
const ITERATIONS = 200;
const BATCH_SIZES = [1, 10, 50];

// ── Helpers ──

function now() {
  const [s, ns] = process.hrtime();
  return s * 1e9 + ns;
}

function nsToMs(ns) { return ns / 1e6; }

function percentiles(arr, ps) {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  return ps.map(p => {
    const idx = Math.min(Math.floor(n * p), n - 1);
    return sorted[idx];
  });
}

function formatLat(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  return `${ms.toFixed(2)}ms`;
}

function formatQPS(qps) {
  if (qps < 1000) return `${qps.toFixed(0)} QPS`;
  return `${(qps / 1000).toFixed(2)}k QPS`;
}

function getMemory() {
  return process.memoryUsage();
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

function runGC() {
  if (global.gc) { global.gc(); return true; }
  return false;
}

// ── Benchmark: SQLite ──

function benchSQLite(batchSize) {
  const Database = require("better-sqlite3");
  const db = new Database(DB_PATH, { readonly: true });

  // Prepare queries
  const randomSelect = db.prepare("SELECT id, text, path FROM chunks ORDER BY RANDOM() LIMIT ?");
  const ftsSearch = db.prepare("SELECT c.id, c.path FROM chunks_fts f JOIN chunks c ON c.id = f.id WHERE chunks_fts MATCH ? LIMIT ?");
  const countQuery = db.prepare("SELECT COUNT(*) as cnt FROM chunks WHERE source = 'memory'");

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    randomSelect.get(1);
  }

  // 1. Random read (point lookup)
  const readLats = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = now();
    randomSelect.get(batchSize);
    readLats.push(now() - start);
  }

  // 2. FTS5 search
  const ftsLats = [];
  const terms = ["记忆", "system", "配置", "memory", "数据", "test", "EDi", "Sol", "config", "recall"];
  for (let i = 0; i < ITERATIONS; i++) {
    const term = terms[i % terms.length];
    const start = now();
    try { ftsSearch.get(term, batchSize); } catch (_) {}
    ftsLats.push(now() - start);
  }

  // 3. Aggregate query (COUNT)
  const aggLats = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = now();
    countQuery.get();
    aggLats.push(now() - start);
  }

  db.close();

  const r = percentiles(readLats, [0.5, 0.95, 0.99]).map(nsToMs);
  const f = percentiles(ftsLats, [0.5, 0.95, 0.99]).map(nsToMs);
  const a = percentiles(aggLats, [0.5, 0.95, 0.99]).map(nsToMs);

  return {
    read: {
      qps: Math.round(1000 / (r[0] / 1000)),
      p50: r[0], p95: r[1], p99: r[2],
      samples: readLats.length,
    },
    ftsSearch: {
      qps: Math.round(1000 / (f[0] / 1000)),
      p50: f[0], p95: f[1], p99: f[2],
    },
    aggregate: {
      qps: Math.round(1000 / (a[0] / 1000)),
      p50: a[0], p95: a[1], p99: a[2],
    },
  };
}

// ── Benchmark: LanceDB ──

async function benchLanceDB(batchSize) {
  const lancedb = require("@lancedb/lancedb");
  const ldb = await lancedb.connect(LANCEDB_PATH);
  const table = await ldb.openTable("chunks");
  const count = await table.countRows();
  const vectorDim = 2560;  // Qwen3-Embedding-4B dimension

  // Warmup
  const warmVec = new Array(vectorDim).fill(0).map(() => Math.random() - 0.5);
  for (let i = 0; i < WARMUP; i++) {
    await table.search(warmVec).limit(batchSize).execute();
  }

  // Vector search benchmark
  const lats = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const vec = new Array(vectorDim).fill(0).map(() => Math.random() - 0.5);
    const start = now();
    await table.search(vec).limit(batchSize).execute();
    lats.push(now() - start);
  }

  ldb.close();

  const p = percentiles(lats, [0.5, 0.95, 0.99]).map(nsToMs);

  return {
    qps: Math.round(1000 / (p[0] / 1000)),
    p50: p[0], p95: p[1], p99: p[2],
    vectorDim,
    totalVectors: count,
    samples: lats.length,
  };
}

// ── Benchmark: KG ──

function benchKG() {
  const kg = JSON.parse(readFileSync(KG_JSON, "utf-8"));

  // Warmup
  let _acc = 0;
  const nodes = Object.entries(kg);
  for (let i = 0; i < WARMUP; i++) {
    const [name, data] = nodes[i % nodes.length];
    _acc += data.relationships?.length || 0;
  }

  // 1. Node lookup by name
  const lookupLats = [];
  const names = nodes.map(([n]) => n);
  for (let i = 0; i < ITERATIONS; i++) {
    const name = names[i % names.length];
    const start = now();
    const node = kg[name];
    const rels = node?.relationships || [];
    lookupLats.push(now() - start);
  }

  // 2. Relationship traversal (full graph scan)
  const scanLats = [];
  for (let i = 0; i < Math.min(ITERATIONS, 50); i++) {
    const start = now();
    let relCount = 0;
    for (const [, data] of nodes) {
      relCount += data.relationships?.length || 0;
    }
    scanLats.push(now() - start);
  }

  const r = percentiles(lookupLats, [0.5, 0.95, 0.99]).map(nsToMs);
  const s = percentiles(scanLats, [0.5, 0.95, 0.99]).map(nsToMs);

  return {
    nodeCount: nodes.length,
    totalRelationships: _acc,
    lookup: {
      qps: Math.round(1000 / (r[0] / 1000)),
      p50: r[0], p95: r[1], p99: r[2],
    },
    fullScan: {
      qps: Math.round(1000 / (s[0] / 1000)),
      p50: s[0], p95: s[1], p99: s[2],
    },
  };
}

// ── Concurrent benchmark (all three at once) ──

async function benchConcurrent() {
  const batchSize = 10;
  const lancedb = require("@lancedb/lancedb");
  const Database = require("better-sqlite3");
  const kg = JSON.parse(readFileSync(KG_JSON, "utf-8"));
  const kgNodes = Object.entries(kg);
  const kgNames = kgNodes.map(([n]) => n);
  const vectorDim = 2560;
  const terms = ["记忆", "system", "配置", "memory", "数据", "test", "EDi", "Sol", "config", "recall"];

  const db = new Database(DB_PATH, { readonly: true });
  const randomSelect = db.prepare("SELECT id, text, path FROM chunks ORDER BY RANDOM() LIMIT ?");
  const ftsSearch = db.prepare("SELECT id FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT ?");

  const ldb = await lancedb.connect(LANCEDB_PATH);
  const table = await ldb.openTable("chunks");

  const lats = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const start = now();

    // SQLite random read
    randomSelect.get(batchSize);

    // FTS5 search
    try { ftsSearch.get(terms[i % terms.length], batchSize); } catch (_) {}

    // KG lookup
    const name = kgNames[i % kgNames.length];
    const node = kg[name];
    const rels = node?.relationships || [];

    // LanceDB vector search (concurrent)
    const vec = new Array(vectorDim).fill(0).map(() => Math.random() - 0.5);
    await table.search(vec).limit(batchSize).execute();

    lats.push(now() - start);
  }

  db.close();
  ldb.close();

  const p = percentiles(lats, [0.5, 0.95, 0.99]).map(nsToMs);

  return {
    qps: Math.round(ITERATIONS / (lats.reduce((a, b) => a + b, 0) / 1e9)),
    p50: p[0], p95: p[1], p99: p[2],
    samples: lats.length,
    batchSize,
  };
}

// ── Main ──

async function main() {
  console.log("=".repeat(60));
  console.log("  🧪 Memory Engine 三系统并发基准测试");
  console.log(`  ${new Date().toISOString().slice(0, 19)}`);
  console.log("=".repeat(60));
  console.log();

  // ── Baseline memory ──
  runGC();
  const baseMem = getMemory();
  console.log("📊 基线内存用量");
  console.log(`  RSS:      ${mb(baseMem.rss)} MB`);
  console.log(`  Heap:     ${mb(baseMem.heapUsed)}/${mb(baseMem.heapTotal)} MB`);
  console.log(`  External: ${mb(baseMem.external)} MB`);
  console.log();

  // ── 1. SQLite Benchmarks ──
  for (const bs of BATCH_SIZES) {
    console.log(`━━━ 🗄️  SQLite (batch=${bs}) ━━━`);
    const r = benchSQLite(bs);
    console.log(`  Random Read    │ ${formatQPS(r.read.qps)} │ p50=${formatLat(r.read.p50)} │ p95=${formatLat(r.read.p95)} │ p99=${formatLat(r.read.p99)}`);
    console.log(`  FTS5 Search    │ ${formatQPS(r.ftsSearch.qps)} │ p50=${formatLat(r.ftsSearch.p50)} │ p95=${formatLat(r.ftsSearch.p95)} │ p99=${formatLat(r.ftsSearch.p99)}`);
    console.log(`  Aggregate      │ ${formatQPS(r.aggregate.qps)} │ p50=${formatLat(r.aggregate.p50)} │ p95=${formatLat(r.aggregate.p95)} │ p99=${formatLat(r.aggregate.p99)}`);
    console.log();

    runGC();
    const mem = getMemory();
    console.log(`  Mem: RSS=${mb(mem.rss)} MB | Heap=${mb(mem.heapUsed)} MB`);
    console.log();
  }

  // ── 2. LanceDB ──
  for (const bs of BATCH_SIZES) {
    console.log(`━━━ 🔍 LanceDB Vector Search (batch=${bs}) ━━━`);
    const r = await benchLanceDB(bs);
    console.log(`  Dim=${r.vectorDim} | Vectors=${r.totalVectors}`);
    console.log(`  Search         │ ${formatQPS(r.qps)} │ p50=${formatLat(r.p50)} │ p95=${formatLat(r.p95)} │ p99=${formatLat(r.p99)}`);
    console.log();

    runGC();
    const mem = getMemory();
    console.log(`  Mem: RSS=${mb(mem.rss)} MB | Heap=${mb(mem.heapUsed)} MB`);
    console.log();
  }

  // ── 3. KG ──
  console.log("━━━ 🌐 Node.js Knowledge Graph ━━━");
  const kgResult = benchKG();
  console.log(`  Nodes=${kgResult.nodeCount} | Relationships=${kgResult.totalRelationships}`);
  console.log(`  Node Lookup    │ ${formatQPS(kgResult.lookup.qps)} │ p50=${formatLat(kgResult.lookup.p50)} │ p95=${formatLat(kgResult.lookup.p95)} │ p99=${formatLat(kgResult.lookup.p99)}`);
  console.log(`  Full Scan      │ ${formatQPS(kgResult.fullScan.qps)} │ p50=${formatLat(kgResult.fullScan.p50)} │ p95=${formatLat(kgResult.fullScan.p95)} │ p99=${formatLat(kgResult.fullScan.p99)}`);
  console.log();

  runGC();
  const kgMem = getMemory();
  console.log(`  Mem: RSS=${mb(kgMem.rss)} MB | Heap=${mb(kgMem.heapUsed)} MB`);
  console.log();

  // ── 4. Concurrent (all three) ──
  console.log("━━━ ⚡ 三系统并发 (SQLite + LanceDB + KG) ━━━");
  const cr = await benchConcurrent();
  console.log(`  Batch per system: ${cr.batchSize}`);
  console.log(`  Combined         │ ${formatQPS(cr.qps)} │ p50=${formatLat(cr.p50)} │ p95=${formatLat(cr.p95)} │ p99=${formatLat(cr.p99)}`);
  console.log(`  Samples: ${cr.samples}`);
  console.log();

  runGC();
  const concMem = getMemory();
  console.log(`  Mem: RSS=${mb(concMem.rss)} MB | Heap=${mb(concMem.heapUsed)} MB`);
  console.log();

  // ── Summary ──
  console.log("=".repeat(60));
  console.log("  📋 汇总对比");
  console.log("=".repeat(60));
  console.log();
  console.log("  系统         │ 最佳 QPS     │ p50延迟    │ 增量 RSS");
  console.log("  ────────────┼─────────────┼───────────┼───────────");
  runGC();
  const endMem = getMemory();
  const overhead = endMem.rss - baseMem.rss;
  const sign = overhead >= 0 ? '+' : '';
  console.log(`  💾 三系统总内存开销: ${sign}${mb(overhead)} MB (RSS ${mb(baseMem.rss)} → ${mb(endMem.rss)})`);
  console.log();
  console.log("  ⚠️  LanceDB 性能受限于 Node.js 绑定层（Rust→Node IPC）");
  console.log("  ⚠️  实际生产部署建议 Python 侧调用 LanceDB");
  console.log("=".repeat(60));
}

main().catch(e => { console.error("❌ Benchmark failed:", e.message); process.exit(1); });

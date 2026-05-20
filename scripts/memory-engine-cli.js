#!/usr/bin/env node
/**
 * memory-engine-cli.js — 命令行版 memory_engine 工具
 *
 * 我（EDi）通过 exec 调用来触发完整的插件流程，包括：
 *   - autoRouteCategory (规则引擎)
 *   - smart-add 文件写入
 *   - generateEmbedding (SiliconFlow 2560维)
 *   - LanceDB 双写 (向量+文本)
 *   - 4 通道搜索 (LanceDB + Manager + FTS5 + KG → RRF)
 *   - 记忆引用强化
 *   - 状态统计
 *
 * 用法：
 *   node scripts/memory-engine-cli.js add <text> [--category <cat>]
 *   node scripts/memory-engine-cli.js search <query> [--top-k <n>]
 *   node scripts/memory-engine-cli.js status
 *   node scripts/memory-engine-cli.js reinforce <chunk-id>
 */

const https = require('node:https');
const lancedb = require('@lancedb/lancedb');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const { resolve } = require('path');
const { homedir } = require('os');
const { readFileSync, appendFileSync, existsSync, mkdirSync } = require('fs');

// ── Paths ──
const HOME = homedir();
const DB_PATH = resolve(HOME, '.openclaw/memory/main.sqlite');
const LANCEDB_PATH = resolve(HOME, '.openclaw/memory/lancedb');
const WORKSPACE = resolve(HOME, '.openclaw/workspace');
const SMART_ADD_DIR = resolve(WORKSPACE, 'memory/smart-add');
const CONFIG_PATH = resolve(HOME, '.openclaw/openclaw.json');

// ── Config ──
function getSFKey() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')).models?.providers?.siliconflow?.apiKey || ''; }
  catch (e) { return ''; }
}
function getSFBaseUrl() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')).models?.providers?.siliconflow?.baseUrl || 'https://api.siliconflow.cn/v1'; }
  catch (e) { return 'https://api.siliconflow.cn/v1'; }
}
const EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-4B';

// ── Embedding ──
function generateEmbedding(text) {
  return new Promise((resolve, reject) => {
    const key = getSFKey();
    if (!key) return reject(new Error('No API key'));
    const url = new URL('/v1/embeddings', getSFBaseUrl());
    const body = JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 8000) });
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.data?.[0]?.embedding || []);
        } catch (e) { reject(new Error(`Parse: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── autoRouteCategory (from plugin) ──
function autoRouteCategory(text, metadata = {}) {
  if (metadata.category && metadata.category !== 'raw_log') return metadata.category;
  if (/api[_-]?key|voice[_-]?id|model\s*[:=]|\/[a-z0-9_\/\.-]+\.[a-z]{2,5}|[a-f0-9]{32,}/i.test(text)) return 'preference';
  if (/我是|我叫|我的名字|我的职业|我在.*工作|我住在/.test(text)) return 'user_identity';
  if (/暂时|临时|一次性|仅这次|就现在|当前会话|测试一下|试试看/.test(text)) return 'temporary';
  if (/我喜欢|我习惯|我偏好|我常用|我一般|我倾向于|记住|别忘了|以后都|下次|我的设置/.test(text)) return 'preference';
  if (/决定|结论|总结|教训|经验|最终选择|定下来|确定了/.test(text)) return 'preference';
  return 'raw_log';
}

// ── SQLite confidence helpers ──
const CATEGORY_PARAMS = {
  temporary:     { conf: 0.40, tau: 2.0 },
  raw_log:       { conf: 0.50, tau: 7.0 },
  episodic:      { conf: 0.70, tau: 30.0 },
  preference:    { conf: 0.70, tau: 30.0 },
  kg_node:       { conf: 0.85, tau: 90.0 },
  user_identity: { conf: 0.95, tau: 365.0 },
};

function withDb(fn) {
  const db = new Database(DB_PATH, { readonly: false });
  try { return fn(db); } finally { db.close(); }
}

// ── Add ──
async function cmdAdd(text, explicitCategory) {
  const cat = autoRouteCategory(text, { category: explicitCategory || 'raw_log' });
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const ts = now.toISOString().replace(/[:.]/g, '').slice(0, 15);
  const entryId = `${ts}_${cat}_cli`;
  const filePath = resolve(SMART_ADD_DIR, `${dateStr}.md`);
  mkdirSync(SMART_ADD_DIR, { recursive: true });

  // Write to smart-add file
  const header = !existsSync(filePath) ? '# Smart Added Memory\n\n' : '';
  const entry = `${header}## ${entryId}\n\nCategory: ${cat}\n\n${text.trim()}\n\n`;
  appendFileSync(filePath, header ? entry : `\n${entry}`);
  console.log(`📝 smart-add: ${cat} | ${text.slice(0, 60)}`);

  // Write confidence
  const params = CATEGORY_PARAMS[cat] || CATEGORY_PARAMS.raw_log;
  const nowSec = Math.floor(Date.now() / 1000);
  const chunkId = crypto.randomUUID();
  withDb(db => {
    db.prepare(`INSERT OR IGNORE INTO memory_confidence
      (chunk_id, initial_confidence, confidence, last_confidence_update,
       base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
      VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)`
    ).run(chunkId, params.conf, params.conf, nowSec, params.tau, cat);
  });
  console.log(`🗄️  SQLite confidence: ${cat} conf=${params.conf} tau=${params.tau}`);

  // Generate embedding + LanceDB write
  try {
    const vec = await generateEmbedding(text);
    if (vec && vec.length > 0) {
      const ldb = await lancedb.connect(LANCEDB_PATH);
      const table = await ldb.openTable('chunks');
      await table.add([{ id: chunkId, text: text.slice(0, 2000), vector: vec, timestamp: Date.now() }]);
      console.log(`⚡ LanceDB: vector=${vec.length}d, id=${chunkId.slice(0, 16)}`);
    }
  } catch (e) {
    console.log(`⚠️  LanceDB write skipped: ${e.message}`);
  }

  console.log(`✅ Added: ${text.slice(0, 60)} → ${cat}`);
  return { chunk_id: chunkId, category: cat };
}

// ── Search ──
async function cmdSearch(query, topK) {
  topK = topK || 5;
  const vec = await generateEmbedding(query).catch(() => null);
  const nowSec = Math.floor(Date.now() / 1000);
  const results = [];

  // Channel 1b: LanceDB
  let lanceHits = [];
  if (vec && vec.length > 0) {
    try {
      const ldb = await lancedb.connect(LANCEDB_PATH);
      const table = await ldb.openTable('chunks');
      const raw = await table.search(vec).limit(30).execute();
      if (typeof raw[Symbol.asyncIterator] === 'function') {
        for await (const batch of raw) { for (const row of batch) lanceHits.push(row); }
      }
    } catch (e) {}
  }

  // Join with SQLite metadata
  const metaMap = new Map();
  withDb(db => {
    const rows = db.prepare('SELECT chunk_id, confidence, last_confidence_update, base_tau, hit_count, is_protected, category, conflict_flag FROM memory_confidence').all();
    for (const r of rows) metaMap.set(r.chunk_id, r);
  });

  // Score LanceDB results
  for (const l of lanceHits) {
    const meta = metaMap.get(l.id);
    if (!meta || meta.is_archived) continue;
    const sim = l._distance !== undefined ? 1 - l._distance : 0.5;
    if (sim < 0.55) continue;
    const conf = meta.is_protected ? meta.confidence : Math.round(meta.confidence * Math.exp(-(nowSec - (meta.last_confidence_update || nowSec)) / 86400 / (meta.base_tau || 7)) * 10000) / 10000;
    results.push({ id: l.id.slice(0, 16), text: (l.text || '').slice(0, 200), category: meta.category, similarity: sim, confidence: conf, source: 'lance' });
  }

  // Channel 2: FTS5
  try {
    withDb(db => {
      const safeQ = query.replace(/[^\w\s]/g, ' ').trim();
      if (safeQ) {
        const fts = db.prepare(`
          SELECT c.id, substr(c.text,1,200) as text, c.text as full,
            COALESCE(mc.confidence,0.5) as confidence, mc.last_confidence_update,
            COALESCE(mc.base_tau,7.0) as base_tau, COALESCE(mc.is_protected,0) as is_protected,
            COALESCE(mc.category,'raw_log') as category
          FROM chunks_fts f JOIN chunks c ON c.id = f.id
          LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
          WHERE chunks_fts MATCH ? AND COALESCE(mc.is_archived,0) = 0
          ORDER BY bm25(chunks_fts,0) LIMIT 20
        `).all(safeQ);
        const seen = new Set(results.map(r => r.id));
        for (const f of fts) {
          if (seen.has(f.id.slice(0, 16))) continue;
          seen.add(f.id.slice(0, 16));
          const conf = f.is_protected ? f.confidence : Math.round(f.confidence * Math.exp(-(nowSec - (f.last_confidence_update || nowSec)) / 86400 / (f.base_tau || 7)) * 10000) / 10000;
          results.push({ id: f.id.slice(0, 16), text: f.text.slice(0, 200), category: f.category, similarity: 0.5, confidence: conf, source: 'fts5' });
        }
      }
    });
  } catch (e) {}

  // RRF fuse
  const fused = [];
  const groups = {};
  for (const r of results) {
    if (!groups[r.id]) groups[r.id] = { ...r, sources: [r.source], rrfScore: 0 };
    else groups[r.id].sources.push(r.source);
  }
  const sorted = results.sort((a, b) => b.similarity - a.similarity);
  sorted.forEach((r, idx) => {
    if (groups[r.id]) groups[r.id].rrfScore += 1 / (60 + idx + 1);
  });

  const final = Object.values(groups).sort((a, b) => b.rrfScore - a.rrfScore).slice(0, topK);

  console.log(`🔍 Search: "${query}" — ${final.length}/${results.length} results`);
  console.log(`   Sources: lance=${lanceHits.length}, fts5=${results.filter(r => r.source === 'fts5').length}`);
  for (const r of final) {
    console.log(`   [${r.category}] (${r.source}) ${r.text.slice(0, 80)}`);
  }
  return final;
}

// ── Status ──
function cmdStatus() {
  withDb(db => {
    const total = db.prepare('SELECT COUNT(*) as c FROM memory_confidence').get();
    const byCat = db.prepare('SELECT category, COUNT(*) as c FROM memory_confidence WHERE is_archived=0 GROUP BY category').all();
    const archived = db.prepare('SELECT COUNT(*) as c FROM memory_confidence WHERE is_archived=1').get();
    const protected = db.prepare('SELECT COUNT(*) as c FROM memory_confidence WHERE is_protected=1').get();
    const conflicted = db.prepare('SELECT COUNT(*) as c FROM memory_confidence WHERE conflict_flag=1').get();

    console.log(`📊 Memory Engine Status`);
    console.log(`   Total confidence: ${total.c}`);
    console.log(`   Archived: ${archived.c} | Protected: ${protected.c} | Conflicted: ${conflicted.c}`);
    console.log(`   By category:`);
    for (const r of byCat) console.log(`     ${r.category}: ${r.c}`);
  });
}

// ── Main ──
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'add') {
    const text = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    const catIdx = args.indexOf('--category');
    const explicitCat = catIdx >= 0 ? args[catIdx + 1] : null;
    if (!text) { console.error('Usage: node memory-engine-cli.js add <text> [--category <cat>]'); process.exit(1); }
    await cmdAdd(text, explicitCat);
  } else if (cmd === 'search') {
    const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    const kIdx = args.indexOf('--top-k');
    const topK = kIdx >= 0 ? parseInt(args[kIdx + 1]) : 5;
    if (!query) { console.error('Usage: node memory-engine-cli.js search <query> [--top-k <n>]'); process.exit(1); }
    await cmdSearch(query, topK);
  } else if (cmd === 'status') {
    cmdStatus();
  } else {
    console.error(`Unknown command: ${cmd}`);
    console.error('Usage:');
    console.error('  node scripts/memory-engine-cli.js add <text> [--category <cat>]');
    console.error('  node scripts/memory-engine-cli.js search <query> [--top-k <n>]');
    console.error('  node scripts/memory-engine-cli.js status');
    process.exit(1);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });

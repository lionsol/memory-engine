#!/usr/bin/env node
/**
 * Command-safe Memory Engine nightly maintenance.
 *
 * This replaces the cron agentTurn wrapper with a deterministic command path.
 * It reads OpenClaw core chunks through an attached read-only namespace and only
 * writes memory-engine owned tables.
 */

const Database = require('better-sqlite3');
const { existsSync, readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { resolve } = require('node:path');
const { patchWriteGuards } = require('../lib/db/core-write-guard.cjs');

const HOME = homedir();
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || resolve(HOME, '.openclaw/workspace');
const ENGINE_DB_PATH = process.env.MEMORY_ENGINE_DB_PATH
  || process.env.MEMORY_ENGINE_DB
  || resolve(HOME, '.openclaw/memory/memory-engine/memory-engine.sqlite');
const CORE_DB_PATH = process.env.MEMORY_ENGINE_CORE_DB
  || resolve(HOME, '.openclaw/memory/main.sqlite');
const KG_PATH = process.env.MEMORY_ENGINE_KG_PATH
  || resolve(WORKSPACE, 'knowledge-graph.json');
const ARCHIVE_THRESHOLD = Number(process.env.MEMORY_ENGINE_ARCHIVE_THRESHOLD || '0.15');
const DRY_RUN = process.argv.includes('--dry-run');

function die(message) {
  console.error(`[nightly-maintenance] ERROR: ${message}`);
  process.exitCode = 1;
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function withBothDbs(fn) {
  if (!existsSync(ENGINE_DB_PATH)) throw new Error(`engine DB not found: ${ENGINE_DB_PATH}`);
  if (!existsSync(CORE_DB_PATH)) throw new Error(`core DB not found: ${CORE_DB_PATH}`);
  const db = new Database(ENGINE_DB_PATH, { readonly: false, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  db.exec(`ATTACH DATABASE '${escapeSqlString(CORE_DB_PATH)}' AS core`);
  patchWriteGuards(db, { message: 'writes to OpenClaw core DB are blocked in nightly maintenance command' });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function tokenize(text) {
  return String(text || '').toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [];
}

function overlap(row) {
  const left = new Set(tokenize(`${row.path1 || ''}\n${row.text1 || ''}`));
  const right = new Set(tokenize(`${row.path2 || ''}\n${row.text2 || ''}`));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

function calcRealtimeConfidence(row, nowSec) {
  if (Number(row.is_protected || 0) === 1) return Number(row.confidence || 0);
  if (!row.last_confidence_update) return Number(row.confidence || 0);
  const tau = Math.max(0.1, Number(row.base_tau || 7));
  const deltaDays = Math.max(0, (nowSec - Number(row.last_confidence_update)) / 86400);
  return Number(row.confidence || 0) * Math.exp(-deltaDays / tau);
}

function recordMemoryEvent(db, eventType, memoryId, source, metadata = {}) {
  db.prepare([
    'INSERT INTO memory_events',
    '(event_type, memory_id, source, metadata_json)',
    'VALUES (?, ?, ?, ?)',
  ].join(' ')).run(eventType, memoryId || null, source, JSON.stringify(metadata));
}

function detectConflicts(db) {
  const rows = db.prepare([
    'SELECT m1.chunk_id AS id1, m2.chunk_id AS id2,',
    'm1.category, m1.confidence AS c1, m2.confidence AS c2,',
    'm1.hit_count AS h1, m2.hit_count AS h2,',
    'c1.text AS text1, c2.text AS text2,',
    'c1.path AS path1, c2.path AS path2',
    'FROM memory_confidence m1',
    'JOIN memory_confidence m2 ON m1.category = m2.category',
    'AND m1.chunk_id < m2.chunk_id',
    'JOIN core.chunks c1 ON c1.id = m1.chunk_id',
    'JOIN core.chunks c2 ON c2.id = m2.chunk_id',
    'WHERE m1.is_archived = 0 AND m2.is_archived = 0',
    'AND ABS(m1.confidence - m2.confidence) > 0.3',
    'AND ABS(m1.hit_count - m2.hit_count) > 3',
    'ORDER BY m1.category, MAX(m1.last_confidence_update, m2.last_confidence_update) DESC',
    'LIMIT 500',
  ].join(' ')).all();

  const toFlag = [];
  for (const row of rows) {
    if (overlap(row) < 0.2) continue;
    toFlag.push(row.c1 < row.c2 ? row.id1 : row.id2);
  }
  const unique = [...new Set(toFlag)];
  if (!DRY_RUN && unique.length > 0) {
    const flag = db.prepare('UPDATE memory_confidence SET conflict_flag = 1 WHERE chunk_id = ? AND is_archived = 0');
    const tx = db.transaction(() => {
      for (const id of unique) {
        flag.run(id);
        recordMemoryEvent(db, 'memory_conflict_flagged', id, 'nightly-maintenance.detect-conflicts', {
          pairs_checked: rows.length,
        });
      }
    });
    tx();
  }
  return { pairs_checked: rows.length, flagged_as_conflict: unique.length, dry_run: DRY_RUN };
}

function archiveLowConfidence(db, nowSec) {
  const rows = db.prepare([
    'SELECT chunk_id, confidence, last_confidence_update, hit_count, base_tau,',
    'is_protected, category',
    'FROM memory_confidence',
    'WHERE is_archived = 0 AND is_protected = 0 AND category != \'user_identity\'',
  ].join(' ')).all();
  const toArchive = [];
  for (const row of rows) {
    if (calcRealtimeConfidence(row, nowSec) < ARCHIVE_THRESHOLD) toArchive.push(row.chunk_id);
  }
  if (!DRY_RUN && toArchive.length > 0) {
    const update = db.prepare('UPDATE memory_confidence SET is_archived = 1 WHERE chunk_id = ? AND is_archived = 0');
    const tx = db.transaction(() => {
      for (const id of toArchive) {
        update.run(id);
        recordMemoryEvent(db, 'memory_archived', id, 'nightly-maintenance.archive', { threshold: ARCHIVE_THRESHOLD });
      }
    });
    tx();
  }
  return { scanned: rows.length, archived: toArchive.length, threshold: ARCHIVE_THRESHOLD, dry_run: DRY_RUN };
}

function kgBridge(db) {
  if (!existsSync(KG_PATH)) return { skipped: true, reason: `knowledge graph not found: ${KG_PATH}` };
  const kgRaw = JSON.parse(readFileSync(KG_PATH, 'utf-8'));
  const nodes = kgRaw.nodes || kgRaw.concepts || [];
  const edges = kgRaw.edges || kgRaw.relationships || [];
  const subgraph = {
    node_count: nodes.length,
    edge_count: edges.length,
    nodes: nodes.slice(0, 20).map((n) => ({
      id: n.id || n.name,
      name: n.name || n.id,
      type: n.type || 'concept',
      properties: n.properties || {},
    })),
    edges: edges.slice(0, 30).map((e) => ({
      source: e.source || e.from,
      target: e.target || e.to,
      type: e.type || 'RELATED_TO',
    })),
  };
  const matches = db.prepare([
    'SELECT chunk_id FROM memory_confidence',
    "WHERE category IN ('kg_node', 'raw_log')",
    'ORDER BY last_confidence_update DESC',
    'LIMIT 10',
  ].join(' ')).all();
  if (!DRY_RUN && matches.length > 0) {
    const update = db.prepare('UPDATE memory_confidence SET kg_data = ? WHERE chunk_id = ?');
    const kgJson = JSON.stringify(subgraph);
    const tx = db.transaction(() => {
      for (const row of matches) update.run(kgJson, row.chunk_id);
      recordMemoryEvent(db, 'kg_bridge_synced', null, 'nightly-maintenance.kg-bridge', {
        nodes: nodes.length,
        edges: edges.length,
        chunks_updated: matches.length,
      });
    });
    tx();
  }
  return { success: true, nodes: nodes.length, edges: edges.length, chunks_updated: matches.length, dry_run: DRY_RUN };
}

function status(db) {
  const totalChunks = db.prepare('SELECT COUNT(*) AS c FROM core.chunks').get();
  const confidence = db.prepare([
    'SELECT COUNT(*) AS total,',
    'SUM(is_archived) AS archived,',
    'SUM(is_protected) AS protected,',
    'SUM(conflict_flag) AS conflicted,',
    'ROUND(AVG(confidence), 4) AS avg_confidence,',
    'ROUND(AVG(base_tau), 2) AS avg_tau,',
    'ROUND(AVG(hit_count), 2) AS avg_hits',
    'FROM memory_confidence',
  ].join(' ')).get();
  const byCategory = db.prepare([
    'SELECT category, COUNT(*) AS count',
    'FROM memory_confidence',
    'WHERE is_archived = 0',
    'GROUP BY category',
    'ORDER BY count DESC',
  ].join(' ')).all();
  const missing = db.prepare([
    'SELECT COUNT(*) AS c',
    'FROM core.chunks c',
    'LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id',
    'WHERE mc.chunk_id IS NULL',
  ].join(' ')).get();
  return {
    chunks_total: totalChunks.c,
    confidence_tracked: confidence.total || 0,
    archived: confidence.archived || 0,
    protected: confidence.protected || 0,
    conflicted: confidence.conflicted || 0,
    avg_confidence: confidence.avg_confidence || 0,
    avg_tau: confidence.avg_tau || 0,
    avg_hits: confidence.avg_hits || 0,
    chunks_missing_confidence: missing.c || 0,
    by_category: byCategory,
  };
}

async function main() {
  try {
    const startedAt = new Date().toISOString();
    const nowSec = Math.floor(Date.now() / 1000);
    const result = withBothDbs((db) => {
      const steps = {
        detect_conflicts: detectConflicts(db),
        archive: archiveLowConfidence(db, nowSec),
        kg_bridge: kgBridge(db),
        status: status(db),
      };
      if (!DRY_RUN) {
        recordMemoryEvent(db, 'nightly_maintenance_completed', null, 'nightly-maintenance.command', steps);
      }
      return steps;
    });
    console.log(JSON.stringify({
      ok: true,
      dry_run: DRY_RUN,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      engine_db: ENGINE_DB_PATH,
      core_db: CORE_DB_PATH,
      result,
    }, null, 2));
  } catch (error) {
    die(error.stack || error.message);
  }
}

main();

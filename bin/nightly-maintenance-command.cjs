#!/usr/bin/env node
/**
 * Command-safe Memory Engine nightly maintenance.
 *
 * Reads OpenClaw Core through an attached read-only namespace and delegates
 * Engine lifecycle mutation to the shared lifecycle service primitives.
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

function calcNightlyRealtimeConfidence(row, nowSec) {
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

function readKnowledgeGraph() {
  if (!existsSync(KG_PATH)) return null;
  const raw = JSON.parse(readFileSync(KG_PATH, 'utf-8'));
  return {
    nodes: raw.nodes || raw.concepts || [],
    edges: raw.edges || raw.relationships || [],
  };
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
    const {
      applyKgBridge,
      archiveLowConfidence,
      detectRelatedConflicts,
    } = await import('../lib/lifecycle/operations.js');
    const startedAt = new Date().toISOString();
    const nowSec = Math.floor(Date.now() / 1000);
    const knowledgeGraph = readKnowledgeGraph();

    const result = withBothDbs((db) => {
      const detectConflicts = detectRelatedConflicts(db, {
        chunksTable: 'core.chunks',
        dryRun: DRY_RUN,
        onFlagged(id, pairsChecked) {
          recordMemoryEvent(db, 'memory_conflict_flagged', id, 'nightly-maintenance.detect-conflicts', {
            pairs_checked: pairsChecked,
          });
        },
      });
      const archive = archiveLowConfidence(db, {
        threshold: ARCHIVE_THRESHOLD,
        dryRun: DRY_RUN,
        shouldArchive: row => calcNightlyRealtimeConfidence(row, nowSec) < ARCHIVE_THRESHOLD,
        onArchived(id) {
          recordMemoryEvent(db, 'memory_archived', id, 'nightly-maintenance.archive', {
            threshold: ARCHIVE_THRESHOLD,
          });
        },
      });
      const kgBridge = knowledgeGraph
        ? applyKgBridge(db, {
          ...knowledgeGraph,
          limit: 10,
          dryRun: DRY_RUN,
          onCompleted(metadata) {
            recordMemoryEvent(db, 'kg_bridge_synced', null, 'nightly-maintenance.kg-bridge', metadata);
          },
        })
        : { skipped: true, reason: `knowledge graph not found: ${KG_PATH}`, dry_run: DRY_RUN };
      const steps = {
        detect_conflicts: detectConflicts,
        archive,
        kg_bridge: kgBridge,
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

#!/usr/bin/env node
/**
 * Command-safe Memory Engine nightly maintenance.
 *
 * Core is always opened through an isolated read-only handle. Engine is
 * isolated as well: read-only for --dry-run and writable only for mutating
 * execution. No Core database is attached to the Engine connection.
 */

const { existsSync, readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { resolve } = require('node:path');

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

function closeDb(db) {
  if (db?.open) db.close();
}

function withIsolatedDbs({ openCoreDbReadonly, openEngineDbIsolated }, fn) {
  if (!existsSync(ENGINE_DB_PATH)) throw new Error(`engine DB not found: ${ENGINE_DB_PATH}`);
  if (!existsSync(CORE_DB_PATH)) throw new Error(`core DB not found: ${CORE_DB_PATH}`);
  const dbOptions = {
    coreDbPath: CORE_DB_PATH,
    engineDbPath: ENGINE_DB_PATH,
  };
  const coreDb = openCoreDbReadonly(dbOptions);
  const engineDb = openEngineDbIsolated({
    ...dbOptions,
    readonly: DRY_RUN,
  });
  try {
    return fn({ coreDb, engineDb });
  } finally {
    closeDb(engineDb);
    closeDb(coreDb);
  }
}

function calcNightlyRealtimeConfidence(row, nowSec) {
  if (Number(row.is_protected || 0) === 1) return Number(row.confidence || 0);
  if (!row.last_confidence_update) return Number(row.confidence || 0);
  const tau = Math.max(0.1, Number(row.base_tau || 7));
  const deltaDays = Math.max(0, (nowSec - Number(row.last_confidence_update)) / 86400);
  return Number(row.confidence || 0) * Math.exp(-deltaDays / tau);
}

function recordMemoryEvent(engineDb, eventType, memoryId, source, metadata = {}) {
  engineDb.prepare([
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

function status(coreDb, engineDb) {
  const coreIds = coreDb.prepare('SELECT id FROM chunks').all().map(row => String(row.id));
  const confidence = engineDb.prepare([
    'SELECT COUNT(*) AS total,',
    'SUM(is_archived) AS archived,',
    'SUM(is_protected) AS protected,',
    'SUM(conflict_flag) AS conflicted,',
    'ROUND(AVG(confidence), 4) AS avg_confidence,',
    'ROUND(AVG(base_tau), 2) AS avg_tau,',
    'ROUND(AVG(hit_count), 2) AS avg_hits',
    'FROM memory_confidence',
  ].join(' ')).get();
  const byCategory = engineDb.prepare([
    'SELECT category, COUNT(*) AS count',
    'FROM memory_confidence',
    'WHERE is_archived = 0',
    'GROUP BY category',
    'ORDER BY count DESC',
  ].join(' ')).all();
  const tracked = new Set(
    engineDb.prepare('SELECT chunk_id FROM memory_confidence').all().map(row => String(row.chunk_id)),
  );
  const missingCount = coreIds.reduce((count, id) => count + (tracked.has(id) ? 0 : 1), 0);
  return {
    chunks_total: coreIds.length,
    confidence_tracked: confidence.total || 0,
    archived: confidence.archived || 0,
    protected: confidence.protected || 0,
    conflicted: confidence.conflicted || 0,
    avg_confidence: confidence.avg_confidence || 0,
    avg_tau: confidence.avg_tau || 0,
    avg_hits: confidence.avg_hits || 0,
    chunks_missing_confidence: missingCount,
    by_category: byCategory,
  };
}

async function main() {
  try {
    const {
      openCoreDbReadonly,
      openEngineDbIsolated,
    } = await import('../lib/db/isolated-dbs.js');
    const {
      applyKgBridge,
      archiveLowConfidence,
      detectRelatedConflictsIsolated,
    } = await import('../lib/lifecycle/operations.js');
    const startedAt = new Date().toISOString();
    const nowSec = Math.floor(Date.now() / 1000);
    const knowledgeGraph = readKnowledgeGraph();

    const result = withIsolatedDbs({ openCoreDbReadonly, openEngineDbIsolated }, ({ coreDb, engineDb }) => {
      const withCoreDb = run => run(coreDb);
      const withEngineDb = run => run(engineDb);
      const detectConflicts = detectRelatedConflictsIsolated({
        withCoreDb,
        withEngineDb,
        dryRun: DRY_RUN,
        onFlagged(id, pairsChecked) {
          recordMemoryEvent(engineDb, 'memory_conflict_flagged', id, 'nightly-maintenance.detect-conflicts', {
            pairs_checked: pairsChecked,
          });
        },
      });
      const archive = archiveLowConfidence(engineDb, {
        threshold: ARCHIVE_THRESHOLD,
        dryRun: DRY_RUN,
        shouldArchive: row => calcNightlyRealtimeConfidence(row, nowSec) < ARCHIVE_THRESHOLD,
        onArchived(id) {
          recordMemoryEvent(engineDb, 'memory_archived', id, 'nightly-maintenance.archive', {
            threshold: ARCHIVE_THRESHOLD,
          });
        },
      });
      const kgBridge = knowledgeGraph
        ? applyKgBridge(engineDb, {
          ...knowledgeGraph,
          limit: 10,
          dryRun: DRY_RUN,
          onCompleted(metadata) {
            recordMemoryEvent(engineDb, 'kg_bridge_synced', null, 'nightly-maintenance.kg-bridge', metadata);
          },
        })
        : { skipped: true, reason: `knowledge graph not found: ${KG_PATH}`, dry_run: DRY_RUN };
      const steps = {
        detect_conflicts: detectConflicts,
        archive,
        kg_bridge: kgBridge,
        status: status(coreDb, engineDb),
      };
      if (!DRY_RUN) {
        recordMemoryEvent(engineDb, 'nightly_maintenance_completed', null, 'nightly-maintenance.command', steps);
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

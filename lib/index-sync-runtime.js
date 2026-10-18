import {
  assignStableMemoryIdentity,
  isStableMemoryIdentityReady,
  markMissingCoreSnapshotsUnknown,
} from "./db/stable-memory-identity.cjs";

const CONFIDENCE_BACKFILL_BATCH_SIZE = 500;
const CONFIDENCE_BACKFILL_LIMIT = 500;

export function createBackfillConfidenceForIndexedChunks({
  catParams,
  inferCategoryFromChunk,
  withCoreDb,
  withEngineDb,
} = {}) {
  if (typeof withCoreDb !== "function" || typeof withEngineDb !== "function") {
    throw new TypeError("confidence backfill requires withCoreDb and withEngineDb");
  }

  return function backfillConfidenceForIndexedChunks(nowSec, access = {}) {
    const coreDbWrapper = access.withCoreDb || withCoreDb;
    const engineDbWrapper = access.withEngineDb || withEngineDb;
    // Do not apply the limit here: existing Engine rows must be filtered first.
    const coreRows = coreDbWrapper(db => db.prepare(`
      SELECT c.id, c.path, c.text
      FROM chunks c
      WHERE c.path LIKE 'memory/smart-add/%'
         OR c.path LIKE 'memory/episodes/%'
      ORDER BY c.updated_at DESC
    `).all());
    if (coreRows.length === 0) {
      return engineDbWrapper(db => {
        const stableIdentityReady = isStableMemoryIdentityReady(db);
        const lifecycle = stableIdentityReady
          ? markMissingCoreSnapshotsUnknown(db, [], { nowSec })
          : { changed: 0 };
        return {
          scanned: 0,
          inserted: 0,
          stable_identity_state: stableIdentityReady ? "migrated" : "unmigrated",
          unknown_reindexed: lifecycle.changed,
        };
      });
    }

    return engineDbWrapper(db => {
      const stableIdentityReady = isStableMemoryIdentityReady(db);
      const lifecycle = stableIdentityReady
        ? markMissingCoreSnapshotsUnknown(db, coreRows.map(row => row.id), { nowSec })
        : { changed: 0, entityIds: [] };
      const existingIds = new Set();
      for (let offset = 0; offset < coreRows.length; offset += CONFIDENCE_BACKFILL_BATCH_SIZE) {
        const batch = coreRows
          .slice(offset, offset + CONFIDENCE_BACKFILL_BATCH_SIZE)
          .map(row => row.id);
        if (batch.length === 0) continue;
        const placeholders = batch.map(() => "?").join(", ");
        const existingRows = db.prepare(`
          SELECT chunk_id
          FROM memory_confidence
          WHERE chunk_id IN (${placeholders})
        `).all(...batch);
        for (const row of existingRows) existingIds.add(row.chunk_id);
        if (stableIdentityReady) {
          // A migrated row may retain the historical Engine chunk_id while
          // its current Core snapshot uses a different id.  The stable
          // snapshot is the authoritative existence check in that case;
          // looking only at memory_confidence.chunk_id would create a second
          // confidence row for the same entity_id.
          const identityRows = db.prepare(`
            SELECT core_chunk_id_snapshot AS chunk_id
            FROM memory_identity
            WHERE core_chunk_id_snapshot IN (${placeholders})
              AND state IN ('active', 'recovered')
          `).all(...batch);
          for (const row of identityRows) existingIds.add(row.chunk_id);
        }
      }

      const rows = coreRows
        .filter(row => !existingIds.has(row.id))
        .slice(0, CONFIDENCE_BACKFILL_LIMIT);
      if (rows.length === 0) {
        return {
          scanned: 0,
          inserted: 0,
          stable_identity_state: stableIdentityReady ? "migrated" : "unmigrated",
          unknown_reindexed: lifecycle.changed,
        };
      }

      let inserted = 0;
      const txn = db.transaction(() => {
        const legacyInsert = stableIdentityReady ? null : db.prepare(`
          INSERT OR IGNORE INTO memory_confidence
            (chunk_id, initial_confidence, confidence, last_confidence_update,
             base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
          VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
        `);
        for (const row of rows) {
          const category = inferCategoryFromChunk(row.path, row.text);
          const { conf, tau } = catParams(category, false);
          if (stableIdentityReady) {
            const result = assignStableMemoryIdentity(db, {
              skipSchema: true,
              chunkId: row.id,
              path: row.path,
              source: "core",
              text: row.text,
              initialConfidence: conf,
              confidence: conf,
              lastConfidenceUpdate: nowSec,
              baseTau: tau,
              category,
            });
            if (result.created && result.confidence?.created) inserted += 1;
          } else if (Number(legacyInsert.run(
            row.id,
            conf,
            conf,
            nowSec,
            tau,
            category,
          )?.changes || 0) > 0) {
            inserted += 1;
          }
        }
      });
      txn();
      return {
        scanned: rows.length,
        inserted,
        stable_identity_state: stableIdentityReady ? "migrated" : "unmigrated",
        unknown_reindexed: lifecycle.changed,
      };
    });
  };
}

export function createIndexSyncRuntime({
  memoryRoot,
  watchDirs,
  withCoreDb,
  withEngineDb,
  getSharedMemoryManager,
  collectIndexedFiles,
  readIndexedPathState,
  backfillConfidenceForIndexedChunks,
} = {}) {
  const indexSyncState = {
    lastSyncAt: 0,
    lastMaxMtimeMs: 0,
  };

  return async function syncIndexIfNeeded(reason = "autoRecall") {
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const scannedFiles = collectIndexedFiles(memoryRoot, watchDirs);
    const stats = {
      fileCount: scannedFiles.length,
      maxMtimeMs: scannedFiles.reduce((m, f) => Math.max(m, f.mtimeMs), 0),
    };
    const scannedPaths = scannedFiles.map(f => f.relPath);
    const changed = stats.maxMtimeMs > indexSyncState.lastMaxMtimeMs;
    const needsInitialSync = indexSyncState.lastSyncAt === 0;
    const runBackfill = () => backfillConfidenceForIndexedChunks(nowSec, {
      withCoreDb,
      withEngineDb,
    });
    const beforeState = withCoreDb(db => readIndexedPathState(db, scannedPaths));

    if (!changed && !needsInitialSync) {
      return {
        synced: false,
        reason: "fresh",
        memory_root: memoryRoot,
        watch_dirs: [...watchDirs],
        files: stats.fileCount,
        scanned_paths: scannedPaths,
        indexed_paths_before: beforeState.paths,
        indexed_paths_after: beforeState.paths,
        skipped_paths: scannedPaths.filter(p => !beforeState.paths.includes(p)),
        updated_at: beforeState.updatedAt,
        changed_paths: [],
        manager_dirty_before: null,
        force_sync: false,
        backfill: runBackfill(),
      };
    }

    const previousMaxMtimeMs = indexSyncState.lastMaxMtimeMs;
    const changedPaths = scannedFiles
      .filter(f => f.mtimeMs > previousMaxMtimeMs)
      .map(f => f.relPath);
    indexSyncState.lastMaxMtimeMs = Math.max(indexSyncState.lastMaxMtimeMs, stats.maxMtimeMs);
    try {
      const { manager } = await getSharedMemoryManager();
      if (manager) {
        const managerStatusBefore = typeof manager.status === "function" ? manager.status() : null;
        const managerDirtyBefore = Boolean(managerStatusBefore?.dirty);
        const forceSync = changed && !managerDirtyBefore;
        await manager.sync(forceSync ? { reason, force: true } : { reason });
        indexSyncState.lastSyncAt = nowMs;
        const afterState = withCoreDb(db => readIndexedPathState(db, scannedPaths));
        const backfill = runBackfill();
        return {
          synced: true,
          reason,
          memory_root: memoryRoot,
          watch_dirs: [...watchDirs],
          files: stats.fileCount,
          scanned_paths: scannedPaths,
          indexed_paths_before: beforeState.paths,
          indexed_paths_after: afterState.paths,
          skipped_paths: scannedPaths.filter(p => !afterState.paths.includes(p)),
          updated_at: afterState.updatedAt,
          changed_paths: changedPaths,
          manager_dirty_before: managerDirtyBefore,
          force_sync: forceSync,
          backfill,
        };
      }
    } catch {}

    const fallbackAfterState = withCoreDb(db => readIndexedPathState(db, scannedPaths));
    const backfill = runBackfill();
    return {
      synced: false,
      reason: "manager_unavailable",
      memory_root: memoryRoot,
      watch_dirs: [...watchDirs],
      files: stats.fileCount,
      scanned_paths: scannedPaths,
      indexed_paths_before: beforeState.paths,
      indexed_paths_after: fallbackAfterState.paths,
      skipped_paths: scannedPaths.filter(p => !fallbackAfterState.paths.includes(p)),
      updated_at: fallbackAfterState.updatedAt,
      changed_paths: changedPaths,
      manager_dirty_before: null,
      force_sync: false,
      backfill,
    };
  };
}

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { getMemorySearchManager } from "openclaw/plugin-sdk/memory-core-engine-runtime";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildSmartAddFingerprint } from "./smart-add-fingerprint.js";
import { dateStrInTimeZone } from "./date-utils.js";
import { appendSmartAdd } from "./smart-add.js";
import { getSharedMemoryManager } from "./memory-manager-runtime.js";
import runtimePaths from "./lib/runtime/paths.cjs";
import { createMemoryEngineRuntimeAssembly } from "./lib/runtime/assembly.js";
import { insertMemoryEvent } from "./lib/db/events.js";
import { ensureMemoryEngineTables, migrateLegacyMemoryEventsFromCore } from "./lib/db/schema.js";
import {
  createBackfillConfidenceForIndexedChunks,
  createIndexSyncRuntime,
} from "./lib/index-sync-runtime.js";
import {
  autoRouteCategory,
  batchReinforce,
  calcRealtimeConf,
  calcTau,
  CATEGORY_MAP,
  catParams,
  inferCategoryFromChunk,
  resolvePrefixes,
} from "./lib/memory-confidence.js";
import { createAutoRecallHookLifecycle } from "./lib/recall/auto-recall-hook-lifecycle.js";
import { collectIndexedFiles, readIndexedPathState } from "./lib/sync/index-sync.js";
import { createHybridRuntimeContext } from "./lib/recall/hybrid/runtime-context.js";
import { createMemoryEngineExecute } from "./lib/tools/memory-engine-actions.js";
import {
  createMemoryEngineGetExecute,
  createMemoryEngineSearchExecute,
} from "./lib/tools/memory-engine-actions.js";
import { registerMemoryEngineTools } from "./lib/tools/register-memory-engine-tools.js";
import { generateEmbedding } from "./lib/siliconflow-runtime.js";

const { INDEX_SYNC_WATCH_DIRS } = runtimePaths;

export default definePluginEntry({
  id: "memory-engine",
  name: "Memory Engine",
  description: "Smart memory with confidence scoring, time-decay, and lifecycle management.",
  contracts: {
    tools: true,
  },
  register(api) {
    const assembly = createMemoryEngineRuntimeAssembly({
      apiConfig: api?.config || null,
      pluginConfig: api?.pluginConfig || null,
    });
    const { paths, config, database, lancedb } = assembly;
    const {
      withCoreDb,
      withEngineDbReadonly,
      withEngineDbWritable,
      withHybridDbAccessScope,
    } = database;
    const {
      ensureLanceDBReady,
      getLanceDBRuntime,
      getLancedbTable,
      readyTimeoutMs: vectorReadyTimeoutMs,
    } = lancedb;

    let memoryStorageReady = false;
    const recordMemoryEvent = event => {
      if (!memoryStorageReady) return;
      try {
        withEngineDbWritable(db => {
          insertMemoryEvent(db, event, { defaultSource: null });
        });
      } catch (error) {
        console.warn("[memory-engine] memory event write failed:", error.message);
      }
    };

    const backfillConfidenceForIndexedChunks = createBackfillConfidenceForIndexedChunks({
      catParams,
      inferCategoryFromChunk,
      withCoreDb,
      withEngineDb: withEngineDbWritable,
    });
    const syncIndexIfNeeded = createIndexSyncRuntime({
      memoryRoot: paths.workspaceDir,
      watchDirs: INDEX_SYNC_WATCH_DIRS,
      withCoreDb,
      withEngineDb: withEngineDbWritable,
      getSharedMemoryManager,
      collectIndexedFiles,
      readIndexedPathState,
      backfillConfidenceForIndexedChunks,
    });

    try {
      withEngineDbWritable(db => ensureMemoryEngineTables(db));
      const migration = withCoreDb(coreDb => withEngineDbWritable(engineDb => (
        migrateLegacyMemoryEventsFromCore(engineDb, coreDb)
      )));
      if ((migration?.migrated || 0) > 0) {
        console.log(`[memory-engine] migrated ${migration.migrated} legacy memory_events rows from core DB`);
      }
      memoryStorageReady = database.ensureWritable();
    } catch (error) {
      console.error("[memory-engine] failed to init confidence table:", error.message);
      memoryStorageReady = false;
    }

    void ensureLanceDBReady();

    const effectiveRuntimeConfig = config.effectiveRuntimeConfig;
    const smartAddTimeZone = config.smartAddTimeZone;
    const generateEmbeddingRuntime = text => generateEmbedding(text, {
      cfg: config.embeddingRuntimeConfig,
      apiConfig: api?.config || null,
    });
    const autoRecallConfig = effectiveRuntimeConfig.autoRecall;
    const kgFailClosedMode = effectiveRuntimeConfig.kgFailClosedMode;
    const kgFailClosedCanary = effectiveRuntimeConfig.kgFailClosedCanary;
    const recentFailClosedMode = effectiveRuntimeConfig.recentFailClosedMode;
    const recentFailClosedCanary = effectiveRuntimeConfig.recentFailClosedCanary;

    const autoRecallLifecycle = createAutoRecallHookLifecycle({
      api,
      autoRecallConfig,
      apiConfig: api?.config || null,
      recordMemoryEvent,
      withDb: withEngineDbWritable,
      resolvePrefixes,
      batchReinforce,
    });
    const hybridRuntimeContext = createHybridRuntimeContext({
      dataAccess: {
        withHybridDbAccessScope,
        getLancedbTable,
        getLancedbRuntime: getLanceDBRuntime,
        getMemorySearchManager,
      },
      retrievalPolicy: {
        apiConfig: api?.config || null,
        calcRealtimeConf,
        syncIndexIfNeeded,
        categoryMap: CATEGORY_MAP,
        generateEmbedding: generateEmbeddingRuntime,
        vectorReadyTimeoutMs,
        kgFailClosedMode,
        kgFailClosedCanary,
        recentFailClosedMode,
        recentFailClosedCanary,
      },
      telemetry: {
        recordMemoryEvent,
        resolveTrafficOriginContext: autoRecallLifecycle.resolveTrafficOriginContext,
      },
    });
    autoRecallLifecycle.register(hybridRuntimeContext);

    const executeMemoryEngineAction = createMemoryEngineExecute({
      action: {
        autoRouteCategory,
        dateStrInTimeZone,
        smartAddTimeZone,
        resolve,
        workspaceDir: paths.workspaceDir,
        smartAddDir: paths.smartAddDir,
        buildSmartAddFingerprint,
        appendSmartAdd,
        catParams,
        withCoreDb,
        withEngineDb: withEngineDbWritable,
        existsSync,
        readFileSync,
        kgPath: paths.kgPath,
        resolvePrefixes,
        batchReinforce,
        calcTau,
      },
      hybrid: hybridRuntimeContext,
    });
    const executeMemoryEngineSearch = createMemoryEngineSearchExecute({
      hybrid: hybridRuntimeContext,
    });
    const executeMemoryEngineGet = createMemoryEngineGetExecute({
      hybrid: hybridRuntimeContext,
      get: {
        withCoreDb,
        withEngineDb: withEngineDbReadonly,
        onMemoryEngineGetSuccess: autoRecallLifecycle.onMemoryEngineGetSuccess,
      },
    });

    registerMemoryEngineTools(api, {
      memoryEngine: executeMemoryEngineAction,
      memoryEngineSearch: executeMemoryEngineSearch,
      memoryEngineGet: executeMemoryEngineGet,
    });
  },
});

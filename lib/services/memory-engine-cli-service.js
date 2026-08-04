import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dateStrInTimeZone } from "../../date-utils.js";
import { appendSmartAdd, runMemoryIndexSync } from "../../smart-add.js";
import { buildSmartAddFingerprint } from "../../smart-add-fingerprint.js";
import { getSharedMemoryManager } from "../../memory-manager-runtime.js";
import { createMemoryEngineRuntimeAssembly } from "../runtime/assembly.js";
import { createHybridRuntimeContext } from "../recall/hybrid/runtime-context.js";
import { generateEmbedding } from "../siliconflow-runtime.js";
import {
  autoRouteCategory,
  batchReinforce,
  calcRealtimeConf,
  calcTau,
  CATEGORY_MAP,
  catParams,
  resolvePrefixes,
} from "../memory-confidence.js";
import { insertMemoryEvent } from "../db/events.js";
import { createMemoryEngineExecute } from "../tools/memory-engine-actions.js";

const COMMANDS_REQUIRING_LANCEDB = new Set(["add", "search"]);

function createDefaultCliRuntime(options = {}) {
  const api = { config: options.config || null };
  const assembly = createMemoryEngineRuntimeAssembly({
    apiConfig: api.config,
    pathOverrides: {
      workspaceDir: options.workspaceDir,
      coreDbPath: options.coreDbPath,
      engineDbPath: options.dbPath,
      lancedbDir: options.lancedbDir,
      kgPath: options.kgPath,
    },
  });
  const { paths, config, database, lancedb } = assembly;
  const effectiveRuntimeConfig = config.effectiveRuntimeConfig;
  const syncIndexIfNeeded = () => runMemoryIndexSync({ force: true });
  const getMemorySearchManager = async ({ cfg } = {}) => {
    const resolved = await getSharedMemoryManager({
      purpose: "memory_engine_cli",
      cfg: cfg || api.config,
    });
    return {
      manager: resolved.manager,
      error: resolved.error || null,
    };
  };

  const recordMemoryEvent = event => {
    try {
      database.withDb(db => insertMemoryEvent(db, event, { defaultSource: null }));
    } catch (error) {
      console.warn("[memory-engine] memory event write failed:", error.message);
    }
  };

  const hybridRuntimeContext = createHybridRuntimeContext({
    dataAccess: {
      withDb: database.withDb,
      withHybridDbAccessScope: database.withHybridDbAccessScope,
      getLancedbTable: lancedb.getLancedbTable,
      getLancedbRuntime: lancedb.getLanceDBRuntime,
      getMemorySearchManager,
    },
    retrievalPolicy: {
      apiConfig: api.config,
      calcRealtimeConf,
      syncIndexIfNeeded,
      categoryMap: CATEGORY_MAP,
      generateEmbedding: text => generateEmbedding(text, {
        cfg: config.embeddingRuntimeConfig,
        apiConfig: api.config,
      }),
      vectorReadyTimeoutMs: lancedb.readyTimeoutMs,
      kgFailClosedMode: effectiveRuntimeConfig.kgFailClosedMode,
      kgFailClosedCanary: effectiveRuntimeConfig.kgFailClosedCanary,
      recentFailClosedMode: effectiveRuntimeConfig.recentFailClosedMode,
      recentFailClosedCanary: effectiveRuntimeConfig.recentFailClosedCanary,
    },
    telemetry: {
      recordMemoryEvent,
      hybridObservationSurface: "cli_search",
    },
  });
  const actionRuntime = {
    action: {
      autoRouteCategory,
      dateStrInTimeZone,
      smartAddTimeZone: config.smartAddTimeZone,
      resolve,
      workspaceDir: paths.workspaceDir,
      smartAddDir: paths.smartAddDir,
      buildSmartAddFingerprint,
      appendSmartAdd,
      catParams,
      existsSync,
      readFileSync,
      kgPath: paths.kgPath,
      resolvePrefixes,
      batchReinforce,
      calcTau,
    },
    hybrid: hybridRuntimeContext,
  };

  return {
    engineDbPath: database.engineDbPath,
    coreDbPath: database.coreDbPath,
    executeAction: createMemoryEngineExecute(actionRuntime),
    ensureLancedbReady: lancedb.ensureLanceDBReady,
    assembly,
  };
}

function commandToActionParams(command, options = {}) {
  if (command === "add") {
    return {
      action: "add",
      text: options.text,
      category: options.category || undefined,
      protected: options.protected === true,
    };
  }
  if (command === "search") {
    return {
      action: "search",
      text: options.query,
      top_k: options.topK,
    };
  }
  if (command === "status") return { action: "status" };
  return null;
}

export async function executeMemoryEngineCommand(command, options = {}, runtime = {}) {
  const params = commandToActionParams(command, options);
  if (!params) return { error: `unknown command: ${command}` };

  const serviceRuntime = typeof runtime.executeAction === "function"
    ? runtime
    : createDefaultCliRuntime(options);

  try {
    if (serviceRuntime.engineDbPath && !existsSync(serviceRuntime.engineDbPath)) {
      return { error: `Memory-engine DB not found at ${serviceRuntime.engineDbPath}` };
    }
    if (
      COMMANDS_REQUIRING_LANCEDB.has(command)
      && typeof serviceRuntime.ensureLancedbReady === "function"
    ) {
      await serviceRuntime.ensureLancedbReady();
    }
    const result = await serviceRuntime.executeAction("memory-engine-cli", params);
    if (command === "status" && serviceRuntime.engineDbPath) {
      return { ...result, engineDbPath: serviceRuntime.engineDbPath };
    }
    return result;
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}

export function commandActionParams(command, options = {}) {
  return commandToActionParams(command, options);
}

export { createDefaultCliRuntime };

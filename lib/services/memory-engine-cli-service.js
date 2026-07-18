import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { dateStrInTimeZone } from "../../date-utils.js";
import { appendSmartAdd, runMemoryIndexSync } from "../../smart-add.js";
import { buildSmartAddFingerprint } from "../../smart-add-fingerprint.js";
import {
  HOME_DIR,
  SMART_ADD_DIR,
  WORKSPACE,
  getSharedMemoryManager,
} from "../../memory-manager-runtime.js";
import { generateEmbedding } from "../siliconflow-runtime.js";
import { getSmartAddTimeZone } from "../config/helpers.js";
import {
  autoRouteCategory,
  batchReinforce,
  calcRealtimeConf,
  calcTau,
  CATEGORY_MAP,
  catParams,
  resolvePrefixes,
} from "../memory-confidence.js";
import {
  resolveCoreDbPath,
  resolveEngineDbPath,
  withEngineDb,
  withEngineDbSession,
} from "../db/engine-db.js";
import { createIsolatedHybridDbAccessScope } from "../recall/hybrid/db-access.js";
import { createLanceDbRuntime, DEFAULT_LANCEDB_READY_TIMEOUT_MS } from "../lancedb-runtime.js";
import { insertMemoryEvent } from "../db/events.js";
import { createMemoryEngineExecute } from "../tools/memory-engine-actions.js";

const COMMANDS_REQUIRING_LANCEDB = new Set(["add", "search"]);

function createDatabaseRuntime(options = {}) {
  const engineDbPath = resolveEngineDbPath({ engineDbPath: options.dbPath });
  const coreDbPath = resolveCoreDbPath({ coreDbPath: options.coreDbPath });
  const dbOptions = { engineDbPath, coreDbPath };

  const withDb = (fn, extraOptions = {}) => withEngineDb(fn, {
    ...dbOptions,
    readonly: false,
    ...extraOptions,
  });

  withDb.scoped = function scopedWithDb(run) {
    return withEngineDbSession(session => run((fn, extraOptions = {}) => withDb(fn, {
      ...extraOptions,
      session,
    })));
  };

  return {
    engineDbPath,
    coreDbPath,
    withDb,
    withHybridDbAccessScope: createIsolatedHybridDbAccessScope({
      ...dbOptions,
      withLegacyDb: withDb,
    }),
  };
}

function createDefaultCliRuntime(options = {}) {
  const api = { config: options.config || null };
  const database = createDatabaseRuntime(options);
  const lancedb = createLanceDbRuntime({
    dbPath: resolve(HOME_DIR, ".openclaw/memory/lancedb"),
    readyTimeoutMs: DEFAULT_LANCEDB_READY_TIMEOUT_MS,
  });
  const smartAddTimeZone = getSmartAddTimeZone(api.config);
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

  const runtime = {
    api,
    autoRouteCategory,
    dateStrInTimeZone,
    SMART_ADD_TIME_ZONE: smartAddTimeZone,
    resolve,
    WORKSPACE,
    SMART_ADD_DIR,
    buildSmartAddFingerprint,
    appendSmartAdd,
    syncIndexIfNeeded,
    catParams,
    withDb: database.withDb,
    withHybridDbAccessScope: database.withHybridDbAccessScope,
    hybridObservationSurface: "cli_search",
    getLancedbTable: lancedb.getLancedbTable,
    generateEmbedding: text => generateEmbedding(text, {
      cfg: api.config,
      apiConfig: api.config,
    }),
    recordMemoryEvent,
    getMemorySearchManager,
    calcRealtimeConf,
    existsSync,
    readFileSync,
    KG_PATH: resolve(WORKSPACE, "knowledge-graph.json"),
    resolvePrefixes,
    batchReinforce,
    CATEGORY_MAP,
    calcTau,
  };

  return {
    engineDbPath: database.engineDbPath,
    coreDbPath: database.coreDbPath,
    executeAction: createMemoryEngineExecute(runtime),
    ensureLancedbReady: lancedb.ensureLanceDBReady,
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

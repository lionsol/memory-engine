import { createMemoryEngineConfigContext } from "./config-context.js";
import { createMemoryEngineDbRuntime } from "./db-runtime.js";
import {
  createLanceDbRuntime,
  DEFAULT_LANCEDB_READY_TIMEOUT_MS,
} from "../lancedb-runtime.js";

export function createMemoryEngineRuntimeAssembly({
  apiConfig = null,
  pluginConfig = null,
  pluginEntryConfig = undefined,
  pathOverrides = {},
  dbOptions = {},
  lancedbOptions = {},
} = {}) {
  const context = createMemoryEngineConfigContext({
    apiConfig,
    pluginConfig,
    pluginEntryConfig,
    pathOverrides,
  });
  const database = createMemoryEngineDbRuntime({
    ...dbOptions,
    paths: context.paths,
  });
  const lancedb = createLanceDbRuntime({
    ...lancedbOptions,
    dbPath: context.paths.lancedbDir,
    readyTimeoutMs: lancedbOptions.readyTimeoutMs ?? DEFAULT_LANCEDB_READY_TIMEOUT_MS,
  });

  return {
    ...context,
    database,
    lancedb,
  };
}

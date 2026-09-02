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
  env = process.env,
  timeZone = undefined,
  dbOptions = {},
  lancedbOptions = {},
} = {}) {
  const context = createMemoryEngineConfigContext({
    apiConfig,
    pluginConfig,
    pluginEntryConfig,
    pathOverrides,
    env,
    timeZone,
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

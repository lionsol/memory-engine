import { insertMemoryEvent } from "../../lib/db/events.js";
import runtimePaths from "../../lib/runtime/paths.cjs";
import { createMemoryEngineDbRuntime } from "../../lib/runtime/db-runtime.js";
import {
  ensureMemoryConfidenceTable,
  ensureMemoryEventsTable,
  migrateLegacyMemoryEventsFromCore,
  tableExists,
} from "../../lib/db/schema.js";
const { resolveMemoryEnginePaths } = runtimePaths;
const paths = resolveMemoryEnginePaths();
const database = createMemoryEngineDbRuntime({ paths });

export { ensureMemoryConfidenceTable, ensureMemoryEventsTable, tableExists };

export const DB_PATH = database.engineDbPath;
export const CORE_PATH = database.coreDbPath;

export function withCoreDb(fn) {
  return database.withCoreDb(fn);
}

export function initConsoleStorage() {
  database.withEngineDbWritable(db => {
    ensureMemoryEventsTable(db);
    ensureMemoryConfidenceTable(db);
  });
  return database.withCoreDb(coreDb => database.withEngineDbWritable(engineDb => (
    migrateLegacyMemoryEventsFromCore(engineDb, coreDb)
  )));
}

// Compatibility name for Console services that only use Engine-owned tables.
// This no longer exposes an attached Core schema.
export function withDb(fn, options = {}) {
  const readonly = Boolean(options.readonly);
  const run = readonly ? database.withEngineDbReadonly : database.withEngineDbWritable;
  return run(db => {
    if (!readonly) {
      ensureMemoryEventsTable(db);
      ensureMemoryConfidenceTable(db);
    }
    return fn(db);
  });
}

export function safeJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function recordEvent(db, event) {
  insertMemoryEvent(db, event, { defaultSource: "console" });
}

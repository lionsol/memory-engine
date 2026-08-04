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

export function openDb(options = {}) {
  return database.openDb({ readonly: options.readonly ?? false });
}

export function initConsoleStorage() {
  const db = openDb();
  try {
    ensureMemoryEventsTable(db);
    ensureMemoryConfidenceTable(db);
    migrateLegacyMemoryEventsFromCore(db);
  } finally {
    db.close();
  }
}

export function withDb(fn, options = {}) {
  const readonly = Boolean(options.readonly);
  const db = openDb({ readonly });
  try {
    if (!readonly) {
      ensureMemoryEventsTable(db);
      ensureMemoryConfidenceTable(db);
      migrateLegacyMemoryEventsFromCore(db);
    }
    return fn(db);
  } finally {
    db.close();
  }
}

export function safeJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function recordEvent(db, event) {
  insertMemoryEvent(db, event, { defaultSource: "console" });
}

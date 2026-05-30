import { insertMemoryEvent } from "../../lib/db/events.js";
import { openEngineDb } from "../../lib/db/engine-db.js";
import {
  ensureMemoryConfidenceTable,
  ensureMemoryEventsTable,
  migrateLegacyMemoryEventsFromCore,
  tableExists,
} from "../../lib/db/schema.js";
import { CORE_DB_PATH, ENGINE_DB_PATH } from "../../memory-manager-runtime.js";

export { ensureMemoryConfidenceTable, ensureMemoryEventsTable, tableExists };

export const DB_PATH = ENGINE_DB_PATH;
export const CORE_PATH = CORE_DB_PATH;

export function openDb(options = {}) {
  return openEngineDb({ readonly: options.readonly ?? false });
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

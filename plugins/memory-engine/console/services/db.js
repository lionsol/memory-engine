import Database from "better-sqlite3";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { insertMemoryEvent } from "../../lib/db/events.js";
import {
  ensureMemoryConfidenceTable,
  ensureMemoryEventsTable,
  tableExists,
} from "../../lib/db/schema.js";

export { ensureMemoryConfidenceTable, ensureMemoryEventsTable, tableExists };

export const DB_PATH = process.env.MEMORY_ENGINE_DB || resolve(homedir(), ".openclaw/memory/main.sqlite");

export function openDb(options = {}) {
  return new Database(DB_PATH, { readonly: options.readonly ?? false, fileMustExist: false });
}

export function initConsoleStorage() {
  const db = openDb();
  try {
    ensureMemoryEventsTable(db);
    ensureMemoryConfidenceTable(db);
  } finally {
    db.close();
  }
}

export function withDb(fn, options = {}) {
  const db = openDb(options);
  try {
    ensureMemoryEventsTable(db);
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

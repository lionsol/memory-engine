import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import {
  resolveCoreDbPath,
  resolveEngineDbDir,
  resolveEngineDbPath,
} from "./db-paths.js";

const ENGINE_DB_SESSION_STATE = Symbol("memoryEngineDbSessionState");

export { resolveCoreDbPath, resolveEngineDbPath, resolveEngineDbDir };

export function openEngineDb(options = {}) {
  const readonly = Boolean(options.readonly);
  const engineDbPath = resolveEngineDbPath(options);
  const engineDbDir = resolveEngineDbDir(options);
  mkdirSync(engineDbDir, { recursive: true });

  const db = new Database(engineDbPath, {
    readonly,
    fileMustExist: false,
  });
  db.pragma("busy_timeout = 5000");
  if (!readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }
  return db;
}

function getEngineDbSessionState(session) {
  if (!session || (typeof session !== "object" && typeof session !== "function")) return null;
  if (!session[ENGINE_DB_SESSION_STATE]) {
    session[ENGINE_DB_SESSION_STATE] = {
      closed: false,
      handles: new Map(),
    };
  }
  return session[ENGINE_DB_SESSION_STATE];
}

function getEngineDbSessionKey(options = {}) {
  const mode = Boolean(options.readonly) ? "readonly" : "readwrite";
  return `${mode}:${resolveEngineDbPath(options)}`;
}

function getSessionEngineDb(session, options = {}) {
  const state = getEngineDbSessionState(session);
  if (!state) return null;
  if (state.closed) {
    throw new Error("memory-engine DB session is already closed");
  }
  const key = getEngineDbSessionKey(options);
  let db = state.handles.get(key);
  if (!db) {
    db = openEngineDb(options);
    state.handles.set(key, db);
  }
  return db;
}

export function createEngineDbSession() {
  return {
    [ENGINE_DB_SESSION_STATE]: {
      closed: false,
      handles: new Map(),
    },
  };
}

export function closeEngineDbSession(session) {
  const state = getEngineDbSessionState(session);
  if (!state || state.closed) return;
  state.closed = true;
  for (const db of state.handles.values()) {
    db.close();
  }
  state.handles.clear();
}

export function withEngineDbSession(fn) {
  const session = createEngineDbSession();
  try {
    const result = fn(session);
    if (result && typeof result.then === "function") {
      return result.finally(() => {
        closeEngineDbSession(session);
      });
    }
    closeEngineDbSession(session);
    return result;
  } catch (error) {
    closeEngineDbSession(session);
    throw error;
  }
}

export function withEngineDb(fn, options = {}) {
  const sessionDb = getSessionEngineDb(options.session, options);
  if (sessionDb) return fn(sessionDb);

  const db = openEngineDb(options);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function ensureEngineWritable(options = {}) {
  return withEngineDb((db) => {
    db.prepare("SELECT 1").get();
    return true;
  }, { ...options, readonly: false });
}

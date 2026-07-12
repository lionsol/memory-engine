import Database from "better-sqlite3";
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  resolveCoreDbPath,
  resolveEngineDbDir,
  resolveEngineDbPath,
} from "./engine-db.js";

const DEFAULT_BUSY_TIMEOUT = 5000;
const ISOLATED_SESSION_STATE = Symbol("isolatedDbSessionState");

function busyTimeout(options = {}) {
  const value = options.busyTimeout ?? DEFAULT_BUSY_TIMEOUT;
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError("busyTimeout must be a non-negative integer");
  }
  return value;
}

function explicitOrResolved(options, key, resolver) {
  return options[key] || resolver();
}

function getPaths(options = {}) {
  const engineDbPath = explicitOrResolved(options, "engineDbPath", resolveEngineDbPath);
  return {
    coreDbPath: explicitOrResolved(options, "coreDbPath", resolveCoreDbPath),
    engineDbPath,
    engineDbDir: options.engineDbDir || dirname(engineDbPath) || resolveEngineDbDir(),
  };
}

function canonicalPath(path) {
  const absolute = resolve(String(path));
  if (existsSync(absolute)) return realpathSync(absolute);

  const suffix = [];
  let cursor = absolute;
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(basename(cursor));
    cursor = parent;
  }
  return resolve(realpathSync(cursor), ...suffix);
}

function assertDistinctDatabaseFiles({ coreDbPath, engineDbPath }) {
  const coreCanonical = canonicalPath(coreDbPath);
  const engineCanonical = canonicalPath(engineDbPath);
  if (coreCanonical === engineCanonical) {
    throw new Error("Core DB and Engine DB must be different physical files");
  }

  if (existsSync(coreDbPath) && existsSync(engineDbPath)) {
    const coreStat = statSync(coreDbPath);
    const engineStat = statSync(engineDbPath);
    if (coreStat.dev === engineStat.dev && coreStat.ino === engineStat.ino) {
      throw new Error("Core DB and Engine DB must be different physical files");
    }
  }
}

function setBusyTimeout(db, timeout) {
  db.pragma(`busy_timeout = ${timeout}`);
}

/**
 * Open a standalone readonly Core handle. This is a structural connection
 * boundary, not an OS sandbox: code that opens the file independently can
 * still bypass this API. This returns a raw handle whose caller is responsible
 * for closing it; trusted business code should prefer withCoreDbReadonly().
 */
export function openCoreDbReadonly(options = {}) {
  const paths = getPaths(options);
  assertDistinctDatabaseFiles(paths);
  const timeout = busyTimeout(options);
  let db;
  try {
    db = new Database(paths.coreDbPath, {
      readonly: true,
      fileMustExist: true,
      timeout,
    });
    setBusyTimeout(db, timeout);
    return db;
  } catch (error) {
    if (db?.open) db.close();
    throw error;
  }
}

/**
 * Open a standalone Engine handle without attaching Core. This API does not
 * use the SQL guard; isolation comes from separate database connections and
 * the absence of ATTACH. This returns a raw handle whose caller is responsible
 * for closing it; trusted business code should prefer withEngineDbIsolated().
 */
export function openEngineDbIsolated(options = {}) {
  const readonly = Boolean(options.readonly);
  const paths = getPaths(options);
  assertDistinctDatabaseFiles(paths);
  if (!readonly) mkdirSync(paths.engineDbDir, { recursive: true });
  const timeout = busyTimeout(options);
  let db;
  try {
    db = new Database(paths.engineDbPath, {
      readonly,
      fileMustExist: readonly,
      timeout,
    });
    setBusyTimeout(db, timeout);
    if (!readonly) {
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
    }
    return db;
  } catch (error) {
    if (db?.open) db.close();
    throw error;
  }
}

function sessionState(session) {
  if (!session || typeof session !== "object") return null;
  return session[ISOLATED_SESSION_STATE] || null;
}

function assertSessionPaths(state, options = {}) {
  const requested = getPaths(options);
  if (options.coreDbPath && requested.coreDbPath !== state.paths.coreDbPath) {
    throw new Error("isolated DB session Core path cannot change");
  }
  if (options.engineDbPath && requested.engineDbPath !== state.paths.engineDbPath) {
    throw new Error("isolated DB session Engine path cannot change");
  }
}

function getSessionHandle(session, kind, options = {}) {
  const state = sessionState(session);
  if (!state) return null;
  if (state.closed) throw new Error("isolated DB session is already closed");
  assertSessionPaths(state, options);
  if (!state.handles[kind]) {
    const paths = {
      coreDbPath: state.paths.coreDbPath,
      engineDbPath: state.paths.engineDbPath,
    };
    state.handles[kind] = kind === "core"
      ? openCoreDbReadonly({ ...options, ...paths })
      : openEngineDbIsolated({ ...options, ...paths, readonly: kind === "engineReadonly" });
  }
  return state.handles[kind];
}

export function createIsolatedDbSession(options = {}) {
  const paths = getPaths(options);
  assertDistinctDatabaseFiles(paths);
  return {
    [ISOLATED_SESSION_STATE]: {
      closed: false,
      paths,
      handles: {
        core: null,
        engine: null,
        engineReadonly: null,
      },
    },
  };
}

export function closeIsolatedDbSession(session) {
  const state = sessionState(session);
  if (!state || state.closed) return;
  state.closed = true;
  for (const key of Object.keys(state.handles)) {
    const db = state.handles[key];
    if (db?.open) db.close();
    state.handles[key] = null;
  }
}

function withHandle(fn, db) {
  try {
    const result = fn(db);
    if (result && typeof result.then === "function") return result.finally(() => db.close());
    db.close();
    return result;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function withCoreDbReadonly(fn, options = {}) {
  const sessionDb = getSessionHandle(options.session, "core", options);
  if (sessionDb) return fn(sessionDb);
  return withHandle(fn, openCoreDbReadonly(options));
}

export function withEngineDbIsolated(fn, options = {}) {
  const kind = options.readonly ? "engineReadonly" : "engine";
  const sessionDb = getSessionHandle(options.session, kind, options);
  if (sessionDb) return fn(sessionDb);
  return withHandle(fn, openEngineDbIsolated(options));
}

export function withIsolatedDbSession(fn, options = {}) {
  const session = createIsolatedDbSession(options);
  try {
    const result = fn(session);
    if (result && typeof result.then === "function") {
      return result.finally(() => closeIsolatedDbSession(session));
    }
    closeIsolatedDbSession(session);
    return result;
  } catch (error) {
    closeIsolatedDbSession(session);
    throw error;
  }
}

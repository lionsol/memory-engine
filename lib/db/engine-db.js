import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import {
  CORE_DB_PATH,
  ENGINE_DB_DIR,
  ENGINE_DB_PATH,
} from "../../memory-manager-runtime.js";

const CORE_SCHEMA = "core";

function escapeSqliteString(value) {
  return String(value || "").replace(/'/g, "''");
}

function attachReadonlyCore(db) {
  if (!existsSync(CORE_DB_PATH)) {
    throw new Error(`OpenClaw core DB not found: ${CORE_DB_PATH}`);
  }
  db.exec(`ATTACH DATABASE '${escapeSqliteString(CORE_DB_PATH)}' AS ${CORE_SCHEMA}`);
}

function isWriteSql(sql) {
  const normalized = String(sql || "").trim().toLowerCase();
  return /^(insert|update|delete|replace|alter|drop|create|vacuum|reindex|truncate)\b/.test(normalized);
}

function writeTargetIsCore(sql) {
  const normalized = String(sql || "").toLowerCase().replace(/\s+/g, " ");
  // Check if the INSERT/UPDATE/DELETE directly targets a core.* table
  // INSERT INTO core.xxx / UPDATE core.xxx / DELETE FROM core.xxx
  // Does NOT block INSERT ... SELECT FROM core.xxx (migration pattern)
  if (/^insert\s+(or\s+\w+\s+)?into\s+core\./.test(normalized)) return true;
  if (/^update\s+core\./.test(normalized)) return true;
  if (/^delete\s+from\s+core\./.test(normalized)) return true;
  if (/^replace\s+into\s+core\./.test(normalized)) return true;
  if (/^alter\s+table\s+core\./.test(normalized)) return true;
  if (/^drop\s+table\s+core\./.test(normalized)) return true;
  if (/^create\s+(virtual\s+)?table\s+core\./.test(normalized)) return true;
  return false;
}

function assertNoCoreWrites(sql) {
  if (!isWriteSql(sql)) return;
  if (!writeTargetIsCore(sql)) return;
  throw new Error("writes to OpenClaw core DB are blocked in memory-engine");
}

function patchWriteGuards(db) {
  const rawPrepare = db.prepare.bind(db);
  const rawExec = db.exec.bind(db);
  db.prepare = (sql) => {
    assertNoCoreWrites(sql);
    return rawPrepare(sql);
  };
  db.exec = (sql) => {
    assertNoCoreWrites(sql);
    return rawExec(sql);
  };
}

export function openEngineDb(options = {}) {
  const readonly = Boolean(options.readonly);
  mkdirSync(ENGINE_DB_DIR, { recursive: true });

  const db = new Database(ENGINE_DB_PATH, {
    readonly,
    fileMustExist: false,
  });
  db.pragma("busy_timeout = 5000");
  if (!readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }
  attachReadonlyCore(db);
  patchWriteGuards(db);
  return db;
}

export function withEngineDb(fn, options = {}) {
  const db = openEngineDb(options);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function ensureEngineWritable() {
  return withEngineDb((db) => {
    db.prepare("SELECT 1").get();
    db.prepare("SELECT 1 FROM core.chunks LIMIT 1").get();
    return true;
  }, { readonly: false });
}

const LEADING_SQL_NOISE = /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/;

function normalizeSql(sql) {
  let normalized = String(sql || "");
  while (LEADING_SQL_NOISE.test(normalized)) {
    normalized = normalized.replace(LEADING_SQL_NOISE, "");
  }
  return normalized.toLowerCase().replace(/\s+/g, " ");
}

function isWriteSql(sql) {
  const normalized = normalizeSql(sql);
  return /^(insert|update|delete|replace|alter|drop|create|vacuum|reindex|truncate)\b/.test(normalized);
}

function writeTargetIsCore(sql) {
  const normalized = normalizeSql(sql);
  if (/^insert\s+(or\s+\w+\s+)?into\s+core\./.test(normalized)) return true;
  if (/^update\s+core\./.test(normalized)) return true;
  if (/^delete\s+from\s+core\./.test(normalized)) return true;
  if (/^replace\s+into\s+core\./.test(normalized)) return true;
  if (/^alter\s+table\s+core\./.test(normalized)) return true;
  if (/^drop\s+table\s+core\./.test(normalized)) return true;
  if (/^create\s+(virtual\s+)?table\s+core\./.test(normalized)) return true;
  return false;
}

function assertNoCoreWrites(sql, options = {}) {
  if (!isWriteSql(sql)) return;
  if (!writeTargetIsCore(sql)) return;
  throw new Error(options.message || "writes to OpenClaw core DB are blocked in memory-engine");
}

function patchWriteGuards(db, options = {}) {
  const rawPrepare = db.prepare.bind(db);
  const rawExec = db.exec.bind(db);
  db.prepare = (sql) => {
    assertNoCoreWrites(sql, options);
    return rawPrepare(sql);
  };
  db.exec = (sql) => {
    assertNoCoreWrites(sql, options);
    return rawExec(sql);
  };
}

module.exports = {
  assertNoCoreWrites,
  isWriteSql,
  patchWriteGuards,
  writeTargetIsCore,
};

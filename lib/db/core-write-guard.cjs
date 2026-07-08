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
  if (/^drop\s+index\s+(if\s+exists\s+)?core\./.test(normalized)) return true;
  if (/^create\s+(virtual\s+)?table\s+core\./.test(normalized)) return true;
  if (/^create\s+(unique\s+)?index\s+(if\s+not\s+exists\s+)?core\./.test(normalized)) return true;
  if (/^create\s+(unique\s+)?index\s+(if\s+not\s+exists\s+)?[\w"`\[\].]+\s+on\s+core\./.test(normalized)) return true;
  if (/^reindex\s+core(?:\.|\b)/.test(normalized)) return true;
  return false;
}

function splitSqlStatements(sql) {
  return String(sql || "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function assertNoCoreWrites(sql, options = {}) {
  for (const statement of splitSqlStatements(sql)) {
    if (!isWriteSql(statement)) continue;
    if (!writeTargetIsCore(statement)) continue;
    throw new Error(options.message || "writes to OpenClaw core DB are blocked in memory-engine");
  }
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
  splitSqlStatements,
  writeTargetIsCore,
};

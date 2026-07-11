const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const Database = require("better-sqlite3");
const betterSqlite3Package = require("better-sqlite3/package.json");

const MIGRATION_IMPACT = [
  { file: "lib/db/engine-db.js", categories: ["Engine DB is main; unqualified engine tables; core attached as core; main-connection transactions; main WAL/synchronous"] },
  { file: "lib/checkpoint/db.js", categories: ["Engine DB is main; unqualified memory_confidence; core attached as chunks_db; main-connection transactions; main busy_timeout/WAL assumptions"] },
  { file: "bin/memory-engine-cli.js", categories: ["Engine DB helper is main; unqualified engine tables; explicit core.* reads; transactions through the main connection"] },
  { file: "bin/nightly-maintenance-command.cjs", categories: ["unqualified engine tables; explicit core.* reads; transactions through the main connection"] },
  { file: "bin/export-archived-raw-log-rescue-candidates.cjs", categories: ["readonly Engine DB is main; core attached as core; unqualified engine reads and explicit core.* reads"] },
  { file: "lib/db/core-chunk-time-migration.js", categories: ["Core DB is main; engine attached as engine; unqualified core tables; main-connection transaction"] },
  { file: "lib/quality/confirmed-smart-add-propagation-stale-cleanup.js", categories: ["unqualified chunks/chunks_fts and engine tables; transaction on supplied main connection"] },
  { file: "lib/quality/confirmed-legacy-singleton-stale-cleanup.js", categories: ["unqualified chunks/chunks_fts and engine tables; transaction on supplied main connection"] },
  { file: "lib/quality/stale-quarantined-chunk-cleanup.js", categories: ["unqualified chunks/chunks_fts writes; transaction on supplied main connection"] },
  { file: "lib/quality/orphan-confidence-cleanup.js", categories: ["unqualified memory_confidence writes with core.* joins; transaction on supplied main connection"] },
  { file: "lib/quality/chunks-without-confidence-audit.js", categories: ["explicit core.* reads mixed with unqualified engine tables"] },
  { file: "lib/quality/collect-quality-candidates.js", categories: ["explicit core.* reads mixed with unqualified engine tables"] },
  { file: "lib/checkpoint/confidence-writer.js", categories: ["unqualified chunks and memory_confidence; main-connection transaction"] },
  { file: "lib/checkpoint/raw-log.js", categories: ["chunks_db.* reads plus unqualified memory_confidence; schema-specific PRAGMA"] },
  { file: "lib/checkpoint/smart-add-writer.js", categories: ["chunks_db.* reads plus unqualified engine tables"] },
  { file: "lib/checkpoint/conflict-resolver.js", categories: ["chunks_db.* reads plus unqualified memory_confidence writes; main-connection transaction"] },
  { file: "lib/quality/memory-process-boundary-audit.js", categories: ["explicit core.* reads"] },
  { file: "lib/quality/timestamp-pollution-audit.js", categories: ["explicit core.* reads"] },
  { file: "lib/quality/legacy-singleton-review.js", categories: ["explicit core.* reads"] },
  { file: "lib/annotation/export-annotation-candidates.js", categories: ["explicit core.* reads"] },
];

const WRITE_CASES = [
  { name: "update", sql: "UPDATE core.chunks SET text = 'updated' WHERE id = 'chunk-1'" },
  { name: "cte_update", sql: "WITH x AS (SELECT 1) UPDATE core.chunks SET text = 'cte' WHERE id = 'chunk-1'" },
  { name: "insert", sql: "INSERT INTO core.chunks (id, text) VALUES ('chunk-insert', 'inserted')" },
  { name: "delete", sql: "DELETE FROM core.chunks WHERE id = 'chunk-1'" },
  { name: "write_pragma", sql: "PRAGMA core.user_version = 9" },
];

const MAIN_WRITE_CASES = WRITE_CASES.map((item) => ({
  ...item,
  sql: item.sql.replaceAll("core.", "").replace("PRAGMA user_version", "PRAGMA user_version"),
}));

function makeFixtures(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const corePath = resolve(root, "core fixture.sqlite");
  const enginePath = resolve(root, "engine fixture.sqlite");
  const core = new Database(corePath);
  core.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY, text TEXT); INSERT INTO chunks VALUES ('chunk-1', 'original');");
  core.close();
  const engine = new Database(enginePath);
  engine.exec("CREATE TABLE memory_confidence (chunk_id TEXT PRIMARY KEY, confidence REAL); INSERT INTO memory_confidence VALUES ('chunk-1', 0.5); CREATE TABLE probe_items (id INTEGER PRIMARY KEY, value TEXT);");
  engine.pragma("journal_mode = WAL");
  engine.close();
  return { root, corePath, enginePath };
}

function errorEvidence(name, sql, error, status) {
  return { name, sql, status, error: error ? { code: error.code, message: error.message } : null };
}

function runSql(db, sql) {
  if (/^\s*PRAGMA\b/i.test(sql)) return db.exec(sql);
  return db.prepare(sql).run();
}

function sqliteError(error) {
  return error ? { code: error.code, message: error.message } : null;
}

function classifyWrite(name, sql, action) {
  try {
    action();
    return errorEvidence(name, sql, null, "write_succeeded");
  } catch (error) {
    return errorEvidence(name, sql, error, error.code === "SQLITE_READONLY" ? "sqlite_readonly_error" : error.code?.startsWith("SQLITE_CONSTRAINT") ? "constraint_error" : "error");
  }
}

function uriVariants() {
  return [
    "file_absolute_raw_mode_ro",
    "file_slash_absolute_mode_ro",
    "path_to_file_url_mode_ro",
    "path_to_file_url_mode_ro_immutable",
    "file_slash_absolute_mode_ro_immutable",
  ];
}

function uriFilename(variant, corePath) {
  const encodedPath = encodeURI(corePath);
  const fileUrl = pathToFileURL(corePath).href;
  if (variant === "file_absolute_raw_mode_ro") return `file:${corePath}?mode=ro`;
  if (variant === "file_slash_absolute_mode_ro") return `file://${encodedPath}?mode=ro`;
  if (variant === "path_to_file_url_mode_ro") return `${fileUrl}?mode=ro`;
  if (variant === "path_to_file_url_mode_ro_immutable") return `${fileUrl}?mode=ro&immutable=1`;
  return `file://${encodedPath}?mode=ro&immutable=1`;
}

function probeUriVariant(variant) {
  const fixture = makeFixtures("memory engine uri probe ");
  const result = { variant, filename: uriFilename(variant, fixture.corePath), attach_status: "not_run", read_status: "not_run", write_results: [] };
  let db;
  try {
    db = new Database(fixture.enginePath);
    try {
      db.exec(`ATTACH DATABASE '${result.filename.replace(/'/g, "''")}' AS core`);
      result.attach_status = "succeeded";
    } catch (error) {
      result.attach_status = "sqlite_error";
      result.attach_error = sqliteError(error);
    }
    if (result.attach_status === "succeeded") {
      try {
        const row = db.prepare("SELECT text FROM core.chunks WHERE id = 'chunk-1'").get();
        result.read_status = row?.text === "original" ? "succeeded" : "unexpected";
      } catch (error) {
        result.read_status = "sqlite_error";
        result.read_error = sqliteError(error);
      }
      for (const item of WRITE_CASES) {
        result.write_results.push(result.read_status === "succeeded"
          ? classifyWrite(item.name, item.sql, () => runSql(db, item.sql))
          : errorEvidence(item.name, item.sql, null, "not_run_read_failed"));
      }
    } else {
      result.write_results = WRITE_CASES.map((item) => errorEvidence(item.name, item.sql, null, "not_run_attach_failed"));
    }
  } catch (error) {
    result.attach_status = "probe_error";
    result.attach_error = sqliteError(error);
  } finally {
    if (db?.open) db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
  result.supported = result.attach_status === "succeeded"
    && result.read_status === "succeeded"
    && result.write_results.every((item) => item.status === "sqlite_readonly_error");
  return result;
}

function probeUriReadonlyAttach() {
  const control = { direct_path_open: "not_run", direct_uri_open: "not_run", interpretation: "inconclusive" };
  const controlFixture = makeFixtures("memory engine uri control ");
  try {
    const direct = new Database(controlFixture.corePath, { readonly: true, fileMustExist: true });
    direct.prepare("SELECT 1 FROM chunks").get();
    direct.close();
    control.direct_path_open = "succeeded";
    const directUri = pathToFileURL(controlFixture.corePath).href + "?mode=ro";
    let uriDb;
    try {
      uriDb = new Database(directUri, { readonly: true, fileMustExist: true });
      uriDb.prepare("SELECT 1 FROM chunks").get();
      control.direct_uri_open = "succeeded";
      control.interpretation = "uri_parsing_observed_for_direct_open_but_attach_requires_separate_validation";
    } catch (error) {
      control.direct_uri_open = "sqlite_error";
      control.direct_uri_error = sqliteError(error);
      control.interpretation = "inconclusive";
    } finally {
      if (uriDb?.open) uriDb.close();
    }
  } catch (error) {
    control.direct_path_error = sqliteError(error);
    control.interpretation = "inconclusive";
  } finally {
    rmSync(controlFixture.root, { recursive: true, force: true });
  }
  const results = uriVariants().map((variant) => probeUriVariant(variant));
  const selected = results.find((item) => item.supported)?.variant || null;
  return {
    supported: Boolean(selected),
    attach_succeeded: results.some((item) => item.attach_status === "succeeded"),
    core_writes_blocked_by_sqlite: Boolean(selected),
    selected_variant: selected,
    uri_parse_control: control,
    evidence: [{ name: "better_sqlite3_api_inspection", status: "observed", detail: "local better-sqlite3 Database options expose readonly/fileMustExist/timeout but no ATTACH URI flag; native source uses sqlite3_open_v2 without SQLITE_OPEN_URI" }, ...results],
  };
}

function probeReadonlyCoreMain() {
  const fixture = makeFixtures("memory engine reverse probe ");
  const evidence = [];
  let db;
  let control;
  let persisted;
  try {
    control = new Database(fixture.enginePath, { fileMustExist: true });
    control.prepare("INSERT INTO probe_items(value) VALUES (?)").run("control");
    control.close();
    control = null;
    evidence.push({ name: "engine_fixture_write_control", status: "succeeded" });

    db = new Database(fixture.corePath, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 500");
    db.exec(`ATTACH DATABASE '${fixture.enginePath.replace(/'/g, "''")}' AS engine`);
    evidence.push({ name: "attach_engine", status: "succeeded" });
    const coreRow = db.prepare("SELECT * FROM chunks WHERE id = 'chunk-1'").get();
    evidence.push({ name: "core_read", status: coreRow?.text === "original" ? "succeeded" : "unexpected", row: coreRow });
    for (const item of MAIN_WRITE_CASES) evidence.push(classifyWrite(item.name, item.sql, () => runSql(db, item.sql)));

    const join = db.prepare("SELECT c.id, mc.confidence FROM chunks c JOIN engine.memory_confidence mc ON mc.chunk_id = c.id").get();
    const busyTimeout = Number(db.prepare("PRAGMA busy_timeout").pluck().get());
    const engineBusyTimeout = Number(db.prepare("PRAGMA engine.busy_timeout").pluck().get());
    const engineJournalMode = String(db.prepare("PRAGMA engine.journal_mode").pluck().get());
    evidence.push({ name: "cross_db_join", status: join?.id === "chunk-1" && join?.confidence === 0.5 ? "succeeded" : "unexpected", row: join });
    evidence.push({ name: "busy_timeout", status: busyTimeout === 500 && engineBusyTimeout === 500 ? "succeeded" : "unexpected", main: busyTimeout, engine: engineBusyTimeout });
    evidence.push({ name: "engine_wal", status: engineJournalMode === "wal" ? "succeeded" : "observed", journal_mode: engineJournalMode });
    evidence.push(classifyWrite("engine_writes", "INSERT/UPDATE engine.probe_items", () => {
      db.prepare("INSERT INTO engine.probe_items (value) VALUES (?)").run("attached");
      db.prepare("UPDATE engine.probe_items SET value = ? WHERE value = 'attached'").run("attached-updated");
    }));
    evidence.push(classifyWrite("engine_transaction", "INSERT transaction; UPDATE existing memory_confidence", () => {
      db.transaction(() => {
        db.prepare("INSERT INTO engine.probe_items(value) VALUES ('transaction')").run();
        db.prepare("UPDATE engine.memory_confidence SET confidence = 0.9 WHERE chunk_id = 'chunk-1'").run();
      })();
    }));
  } catch (error) {
    evidence.push(errorEvidence("probe", "", error, error.code === "SQLITE_READONLY" ? "sqlite_readonly_error" : "error"));
  } finally {
    if (control?.open) control.close();
    if (db?.open) db.close();
    try {
      const engine = new Database(fixture.enginePath, { readonly: true, fileMustExist: true });
      const core = new Database(fixture.corePath, { readonly: true, fileMustExist: true });
      try {
        persisted = {
          probeItems: engine.prepare("SELECT value FROM probe_items ORDER BY id").all().map((row) => row.value),
          confidence: engine.prepare("SELECT confidence FROM memory_confidence WHERE chunk_id = 'chunk-1'").get()?.confidence,
          coreText: core.prepare("SELECT text FROM chunks WHERE id = 'chunk-1'").get()?.text,
        };
      } finally {
        engine.close();
        core.close();
      }
    } catch (error) {
      persisted = { error: sqliteError(error) };
      evidence.push(errorEvidence("persistence", "reopen fixtures", error, "error"));
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
  const writeEvidence = evidence.filter((item) => MAIN_WRITE_CASES.some((write) => write.name === item.name));
  const coreWritesBlocked = writeEvidence.length === MAIN_WRITE_CASES.length && writeEvidence.every((item) => item.status === "sqlite_readonly_error");
  const engineWrites = evidence.find((item) => item.name === "engine_writes");
  const transaction = evidence.find((item) => item.name === "engine_transaction");
  const controlWrite = evidence.find((item) => item.name === "engine_fixture_write_control");
  const crossDb = evidence.some((item) => item.name === "cross_db_join" && item.status === "succeeded");
  const persistenceSucceeded = persisted?.coreText === "original"
    && (transaction?.status === "succeeded" ? persisted.confidence === 0.9 && persisted.probeItems.includes("transaction") : !persisted.probeItems.includes("transaction") && persisted.confidence === 0.5);
  return {
    supported: coreWritesBlocked && controlWrite?.status === "succeeded" && engineWrites?.status === "succeeded" && transaction?.status === "succeeded" && crossDb && persistenceSucceeded,
    core_writes_blocked_by_sqlite: coreWritesBlocked,
    engine_writes_succeeded: engineWrites?.status === "succeeded" && transaction?.status === "succeeded",
    cross_db_reads_succeeded: crossDb,
    evidence: [...evidence, { name: "persistence", status: persistenceSucceeded ? "succeeded" : "unexpected", persisted }],
  };
}

function runProbe() {
  const uriReadonlyAttach = probeUriReadonlyAttach();
  const reverse = probeReadonlyCoreMain();
  const versionDb = new Database(":memory:");
  const versions = {
    better_sqlite3: betterSqlite3Package.version,
    sqlite: versionDb.prepare("SELECT sqlite_version() AS version").get().version,
    sqlite_use_uri_compile_option: versionDb.prepare("SELECT sqlite_compileoption_used('USE_URI') AS enabled").get().enabled === 1,
  };
  versionDb.close();
  return {
    versions,
    uri_readonly_attach: uriReadonlyAttach,
    readonly_core_main_with_writable_engine_attach: reverse,
    recommendation: reverse.supported
      ? "Prefer a readonly Core main connection with the writable Engine DB attached; validate and migrate connection/schema assumptions before production changes."
      : "Do not adopt either candidate yet; the probe did not establish a complete SQLite-enforced boundary.",
    migration_impact: MIGRATION_IMPACT,
  };
}

module.exports = { runProbe };

if (require.main === module) {
  console.log(JSON.stringify(runProbe(), null, 2));
}

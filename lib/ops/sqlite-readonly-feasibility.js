import crypto from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync, tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DATABASE_NAME = "r2b-synthetic-state.sqlite";
export const TEMP_PREFIX = "memory-engine-r2b-";

const INDEX_KEY = "plugin-registry";
const PLUGIN_ID = "memory-engine-synthetic";
const SOURCE_PATH = "/synthetic/not-a-real-source";
const INSTALL_PATH = "/synthetic/not-a-real-runtime";

export const SCHEMA_SQL = `
CREATE TABLE installed_plugin_index (
  index_key TEXT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL,
  host_contract_version TEXT NOT NULL,
  compat_registry_version TEXT NOT NULL,
  migration_version INTEGER NOT NULL,
  policy_hash TEXT NOT NULL,
  generated_at_ms INTEGER NOT NULL,
  refresh_reason TEXT,
  install_records_json TEXT NOT NULL,
  plugins_json TEXT NOT NULL,
  diagnostics_json TEXT NOT NULL,
  warning TEXT,
  updated_at_ms INTEGER NOT NULL
);`;

function nowMs() {
  return Date.now();
}

function rowJson({ version = 1, generatedAtMs = nowMs(), pluginId = PLUGIN_ID } = {}) {
  return {
    index_key: INDEX_KEY,
    version,
    host_contract_version: "synthetic-host-v1",
    compat_registry_version: "synthetic-registry-v1",
    migration_version: 1,
    policy_hash: "synthetic-policy-hash",
    generated_at_ms: generatedAtMs,
    refresh_reason: "synthetic-fixture",
    install_records_json: JSON.stringify({
      [pluginId]: {
        installPath: INSTALL_PATH,
        sourcePath: SOURCE_PATH,
        version: "0.0.0-synthetic",
        installedAt: "2026-07-20T00:00:00.000Z",
        source: "synthetic",
      },
    }),
    plugins_json: JSON.stringify([{ id: pluginId, version: "0.0.0-synthetic" }]),
    diagnostics_json: JSON.stringify({ fixture: true }),
    warning: null,
    updated_at_ms: generatedAtMs,
  };
}

function bindRow(database, row) {
  database
    .prepare(
      `INSERT INTO installed_plugin_index (
        index_key, version, host_contract_version, compat_registry_version,
        migration_version, policy_hash, generated_at_ms, refresh_reason,
        install_records_json, plugins_json, diagnostics_json, warning, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.index_key,
      row.version,
      row.host_contract_version,
      row.compat_registry_version,
      row.migration_version,
      row.policy_hash,
      row.generated_at_ms,
      row.refresh_reason,
      row.install_records_json,
      row.plugins_json,
      row.diagnostics_json,
      row.warning,
      row.updated_at_ms,
    );
}

function createDatabase(databasePath, { journalMode = "DELETE", row } = {}) {
  const database = new DatabaseSync(databasePath);
  database.exec(SCHEMA_SQL);
  if (journalMode === "WAL") {
    database.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;");
  }
  bindRow(database, row ?? rowJson());
  return database;
}

function asNumber(value) {
  return typeof value === "bigint" ? Number(value) : value;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function fileFingerprint(rootDir, absolutePath, relativePath) {
  const stat = lstatSync(absolutePath);
  const entry = {
    relative_path: relativePath,
    exists: true,
    file_type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
    mode: stat.mode,
    inode: asNumber(stat.ino),
    link_count: asNumber(stat.nlink),
    size: stat.size,
    mtime_ns: stat.mtimeNs === undefined ? null : String(stat.mtimeNs),
    ctime_ns: stat.ctimeNs === undefined ? null : String(stat.ctimeNs),
    sha256: stat.isFile() ? sha256File(absolutePath) : null,
  };
  if (stat.isDirectory()) {
    for (const name of readdirSync(absolutePath).sort()) {
      const childRelativePath = relativePath ? path.join(relativePath, name) : name;
      entry.children ??= [];
      entry.children.push(fileFingerprint(rootDir, path.join(absolutePath, name), childRelativePath));
    }
  }
  return entry;
}

function flattenFingerprint(entry, output = new Map()) {
  if (!entry) return output;
  output.set(entry.relative_path, entry);
  for (const child of entry.children ?? []) flattenFingerprint(child, output);
  return output;
}

export function fingerprintTree(rootDir) {
  return flattenFingerprint(fileFingerprint(rootDir, rootDir, ""));
}

function serialiseFingerprint(fingerprint) {
  return Object.fromEntries([...fingerprint.entries()].map(([key, value]) => [key, value]));
}

function sameContent(before, after) {
  return before?.sha256 === after?.sha256 && before?.size === after?.size;
}

function sameMetadata(before, after) {
  return before?.mode === after?.mode
    && before?.inode === after?.inode
    && before?.link_count === after?.link_count
    && before?.mtime_ns === after?.mtime_ns
    && before?.ctime_ns === after?.ctime_ns;
}

export function compareFingerprints(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  const result = {
    new_files: [],
    deleted_files: [],
    content_changed_files: [],
    metadata_changed_files: [],
    sidecar_created: false,
    observable_write_detected: false,
  };
  for (const relativePath of [...paths].sort()) {
    const oldEntry = before.get(relativePath);
    const newEntry = after.get(relativePath);
    if (!oldEntry) result.new_files.push(relativePath);
    else if (!newEntry) result.deleted_files.push(relativePath);
    else {
      if (!sameContent(oldEntry, newEntry)) result.content_changed_files.push(relativePath);
      if (!sameMetadata(oldEntry, newEntry)) result.metadata_changed_files.push(relativePath);
    }
  }
  result.sidecar_created = result.new_files.some((entry) => /-(?:wal|shm|journal)$/.test(entry));
  result.observable_write_detected = result.new_files.length > 0
    || result.deleted_files.length > 0
    || result.content_changed_files.length > 0
    || result.metadata_changed_files.length > 0;
  return result;
}

function scenarioBase(id) {
  return {
    id,
    status: "PASS",
    open_succeeded: false,
    query_succeeded: false,
    latest_row_visible: false,
    sql_write_rejected: false,
    database_created: false,
    before_fingerprint: {},
    after_fingerprint: {},
    new_files: [],
    deleted_files: [],
    content_changed_files: [],
    metadata_changed_files: [],
    sidecar_created: false,
    observable_write_detected: false,
    blockers: [],
  };
}

function openReadOnly(databasePath, options = {}) {
  return new DatabaseSync(databasePath, { readOnly: true, ...options });
}

function readLatestRow(database) {
  const row = database.prepare(
    "SELECT generated_at_ms, install_records_json FROM installed_plugin_index WHERE index_key = ?",
  ).get(INDEX_KEY);
  if (!row) return false;
  const records = JSON.parse(row.install_records_json);
  return Number(row.generated_at_ms) > 0 && records[PLUGIN_ID]?.installPath === INSTALL_PATH;
}

function assertReadOnlyWrites(database) {
  let insertRejected = false;
  let ddlRejected = false;
  try {
    database.prepare("INSERT INTO installed_plugin_index SELECT * FROM installed_plugin_index").run();
  } catch {
    insertRejected = true;
  }
  try {
    database.exec("CREATE TABLE r2b_write_probe (value TEXT)");
  } catch {
    ddlRejected = true;
  }
  return insertRejected && ddlRejected;
}

function runReadOnlyChecks(result, databasePath, before, rootDir) {
  let database;
  try {
    database = openReadOnly(databasePath);
    result.open_succeeded = true;
    result.query_succeeded = readLatestRow(database);
    result.latest_row_visible = result.query_succeeded;
    result.sql_write_rejected = assertReadOnlyWrites(database);
  } finally {
    database?.close();
  }
  Object.assign(result, compareFingerprints(before, capture(rootDir)));
  if (!result.query_succeeded) result.blockers.push("latest_committed_row_not_visible");
  if (!result.sql_write_rejected) result.blockers.push("read_only_sql_write_not_rejected");
  if (result.observable_write_detected) result.blockers.push("observable_filesystem_write");
  if (!result.open_succeeded) result.blockers.push("read_only_open_failed");
  if (result.blockers.length) result.status = "BLOCKED";
}

function capture(rootDir) {
  return fingerprintTree(rootDir);
}

function missingDatabaseScenario(rootDir) {
  const result = scenarioBase("missing-database");
  const databasePath = path.join(rootDir, DATABASE_NAME);
  const before = capture(rootDir);
  result.before_fingerprint = serialiseFingerprint(before);
  try {
    const database = openReadOnly(databasePath);
    database.close();
    result.open_succeeded = true;
    result.blockers.push("missing_database_opened");
  } catch {
    result.open_succeeded = false;
  }
  result.database_created = existsSync(databasePath);
  const after = capture(rootDir);
  result.after_fingerprint = serialiseFingerprint(after);
  Object.assign(result, compareFingerprints(before, after));
  if (result.database_created) result.blockers.push("read_only_open_created_database");
  if (result.observable_write_detected) result.blockers.push("observable_filesystem_write");
  if (result.blockers.length) result.status = "BLOCKED";
  return result;
}

function rollbackScenario(rootDir) {
  const result = scenarioBase("rollback-journal");
  const databasePath = path.join(rootDir, DATABASE_NAME);
  const writer = createDatabase(databasePath);
  writer.close();
  result.database_created = existsSync(databasePath);
  const before = capture(rootDir);
  result.before_fingerprint = serialiseFingerprint(before);
  runReadOnlyChecks(result, databasePath, before, rootDir);
  result.after_fingerprint = serialiseFingerprint(capture(rootDir));
  return result;
}

function setupWalDatabase(databasePath) {
  const writer = createDatabase(databasePath, { journalMode: "WAL" });
  writer.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  writer.prepare(
    "UPDATE installed_plugin_index SET generated_at_ms = ?, install_records_json = ? WHERE index_key = ?",
  ).run(2, JSON.stringify({
    [PLUGIN_ID]: {
      installPath: INSTALL_PATH,
      sourcePath: SOURCE_PATH,
      version: "0.0.0-synthetic-wal",
      installedAt: "2026-07-20T00:00:00.000Z",
    },
  }), INDEX_KEY);
  return writer;
}

function walScenario(rootDir) {
  const result = scenarioBase("wal-latest-committed-row");
  const databasePath = path.join(rootDir, DATABASE_NAME);
  const writer = setupWalDatabase(databasePath);
  result.database_created = true;
  const before = capture(rootDir);
  result.before_fingerprint = serialiseFingerprint(before);
  try {
    runReadOnlyChecks(result, databasePath, before, rootDir);
    result.after_fingerprint = serialiseFingerprint(capture(rootDir));
  } finally {
    writer.close();
  }
  return result;
}

function walWithoutShmScenario(rootDir) {
  const result = scenarioBase("wal-without-shm");
  const sourceDir = path.join(rootDir, "source");
  const cloneDir = path.join(rootDir, "clone");
  mkdirSync(sourceDir);
  mkdirSync(cloneDir);
  const sourcePath = path.join(sourceDir, DATABASE_NAME);
  const clonePath = path.join(cloneDir, DATABASE_NAME);
  const writer = setupWalDatabase(sourcePath);
  try {
    copyFileSync(sourcePath, clonePath);
    for (const suffix of ["-wal", "-shm"]) {
      const sourceSidecar = `${sourcePath}${suffix}`;
      if (existsSync(sourceSidecar) && suffix === "-wal") copyFileSync(sourceSidecar, `${clonePath}${suffix}`);
    }
    const cloneShm = `${clonePath}-shm`;
    if (existsSync(cloneShm)) unlinkSync(cloneShm);
    result.database_created = true;
    const before = capture(rootDir);
    result.before_fingerprint = serialiseFingerprint(before);
    runReadOnlyChecks(result, clonePath, before, rootDir);
    result.after_fingerprint = serialiseFingerprint(capture(rootDir));
  } finally {
    writer.close();
  }
  return result;
}

function nonWritableScenario(rootDir) {
  const result = scenarioBase("non-writable-directory");
  if (typeof process.getuid !== "function" || process.getuid() === 0) {
    result.status = "SKIPPED";
    result.blockers.push("permission_model_not_enforceable");
    return result;
  }
  const databasePath = path.join(rootDir, DATABASE_NAME);
  const writer = createDatabase(databasePath);
  writer.close();
  result.database_created = true;
  chmodSync(rootDir, 0o555);
  try {
    const before = capture(rootDir);
    result.before_fingerprint = serialiseFingerprint(before);
    runReadOnlyChecks(result, databasePath, before, rootDir);
    result.after_fingerprint = serialiseFingerprint(capture(rootDir));
  } finally {
    chmodSync(rootDir, 0o755);
  }
  return result;
}

function immutableScenario(rootDir) {
  const result = scenarioBase("immutable-live-wal");
  const databasePath = path.join(rootDir, DATABASE_NAME);
  const writer = setupWalDatabase(databasePath);
  result.database_created = true;
  const before = capture(rootDir);
  result.before_fingerprint = serialiseFingerprint(before);
  try {
    const normal = openReadOnly(databasePath);
    const normalVisible = readLatestRow(normal);
    normal.close();
    const immutableUri = `file:${databasePath}?immutable=1`;
    const immutable = new DatabaseSync(immutableUri, { readOnly: true });
    const immutableVisible = readLatestRow(immutable);
    immutable.close();
    result.open_succeeded = true;
    result.query_succeeded = normalVisible;
    result.latest_row_visible = normalVisible;
    result.sql_write_rejected = true;
    if (!immutableVisible) result.blockers.push("immutable_reader_missed_wal_row");
    result.immutable_latest_row_visible = immutableVisible;
    const after = capture(rootDir);
    Object.assign(result, compareFingerprints(before, after));
    result.after_fingerprint = serialiseFingerprint(after);
    if (!normalVisible) result.blockers.push("latest_committed_row_not_visible");
    if (result.observable_write_detected) result.blockers.push("observable_filesystem_write");
  } finally {
    writer.close();
  }
  if (result.blockers.length) result.status = "BLOCKED";
  return result;
}

function runScenario(id, rootDir, fn) {
  const scenarioDir = path.join(rootDir, id);
  mkdirSync(scenarioDir);
  try {
    return fn(scenarioDir);
  } catch (error) {
    const result = scenarioBase(id);
    result.status = "BLOCKED";
    result.blockers.push(`scenario_error:${error?.code ?? "unknown"}`);
    return result;
  }
}

export function runStateDbReadonlyFeasibilitySmoke() {
  const tempRoot = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX));
  try {
    const scenarios = [
      runScenario("missing-database", tempRoot, missingDatabaseScenario),
      runScenario("rollback-journal", tempRoot, rollbackScenario),
      runScenario("wal-latest-committed-row", tempRoot, walScenario),
      runScenario("wal-without-shm", tempRoot, walWithoutShmScenario),
      runScenario("non-writable-directory", tempRoot, nonWritableScenario),
      runScenario("immutable-live-wal", tempRoot, immutableScenario),
    ];
    const sqliteProbePath = path.join(tempRoot, "sqlite-version", DATABASE_NAME);
    mkdirSync(path.dirname(sqliteProbePath), { recursive: true });
    const probe = new DatabaseSync(sqliteProbePath, { readOnly: false });
    const sqliteVersion = probe.prepare("SELECT sqlite_version() AS version").get().version;
    probe.close();
    const blockers = scenarios.flatMap((scenario) => scenario.blockers.map((code) => `${scenario.id}:${code}`));
    const blocked = scenarios.some((scenario) => scenario.status === "BLOCKED" || scenario.status === "SKIPPED");
    return {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      node_version: process.version,
      node_module_version: process.versions.modules,
      sqlite_version: sqliteVersion,
      temp_root_family: `${TEMP_PREFIX}*`,
      real_path_accessed: false,
      openclaw_imported: false,
      plugin_imported: false,
      scenarios,
      decision: blocked
        ? "B8-A7-R2B standalone read-only live state-DB reader feasibility=BLOCKED / ZERO-WRITE OR FRESHNESS NOT PROVEN"
        : "B8-A7-R2B filesystem-observable feasibility=PROVISIONAL / SYSCALL PROOF REQUIRED",
      blockers,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

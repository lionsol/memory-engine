import crypto from "node:crypto";
import {
  accessSync,
  chmodSync,
  copyFileSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { mkdtempSync, tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

export const DATABASE_NAME = "r2b-synthetic-state.sqlite";
export const TEMP_PREFIX = "memory-engine-r2b-";

const INDEX_KEY = "plugin-registry";
const PLUGIN_ID = "memory-engine-synthetic";
const SOURCE_PATH = "/synthetic/not-a-real-source";
const INSTALL_PATH = "/synthetic/not-a-real-runtime";
export const CHECKPOINT_REVISION = "checkpointed-A";
export const WAL_REVISION = "wal-committed-B";
export const POST_OPEN_WAL_REVISION = "wal-post-open-C";
const CHECKPOINT_GENERATED_AT_MS = 1000;
const WAL_GENERATED_AT_MS = 2000;
const POST_OPEN_GENERATED_AT_MS = 3000;

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

function rowJson({
  version = 1,
  generatedAtMs = CHECKPOINT_GENERATED_AT_MS,
  pluginId = PLUGIN_ID,
  fixtureRevision = CHECKPOINT_REVISION,
} = {}) {
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
        fixtureRevision,
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

export const createSyntheticDatabase = createDatabase;

export function updateFixtureRevision(writer, {
  revision,
  generatedAtMs,
} = {}) {
  writer.prepare(
    "UPDATE installed_plugin_index SET generated_at_ms = ?, updated_at_ms = ?, install_records_json = ? WHERE index_key = ?",
  ).run(generatedAtMs, generatedAtMs, JSON.stringify({
    [PLUGIN_ID]: {
      installPath: INSTALL_PATH,
      sourcePath: SOURCE_PATH,
      version: "0.0.0-synthetic-wal",
      installedAt: "2026-07-20T00:00:00.000Z",
      fixtureRevision: revision,
    },
  }), INDEX_KEY);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function bigintString(value) {
  return typeof value === "bigint" ? value.toString() : String(value);
}

function fileFingerprint(absolutePath, relativePath) {
  const stat = lstatSync(absolutePath, { bigint: true });
  const entry = {
    relative_path: relativePath,
    exists: true,
    file_type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
    mode: bigintString(stat.mode),
    inode: bigintString(stat.ino),
    link_count: bigintString(stat.nlink),
    size: bigintString(stat.size),
    mtime_ns: stat.mtimeNs === undefined ? null : bigintString(stat.mtimeNs),
    ctime_ns: stat.ctimeNs === undefined ? null : bigintString(stat.ctimeNs),
    sha256: stat.isFile() ? sha256File(absolutePath) : null,
  };
  if (stat.isDirectory()) {
    for (const name of readdirSync(absolutePath).sort()) {
      const childRelativePath = relativePath ? path.join(relativePath, name) : name;
      entry.children ??= [];
      entry.children.push(fileFingerprint(path.join(absolutePath, name), childRelativePath));
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
  return flattenFingerprint(fileFingerprint(rootDir, ""));
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
    sql_write_rejections: {
      insert: false,
      update: false,
      delete: false,
      ddl: false,
    },
    expected_revision: null,
    observed_revision: null,
    observed_generated_at_ms: null,
    normal_observed_revision: null,
    immutable_observed_revision: null,
    normal_initial_revision: null,
    normal_post_update_revision: null,
    immutable_initial_revision: null,
    immutable_post_update_revision: null,
    normal_initial_latest_visible: false,
    normal_post_update_latest_visible: false,
    immutable_initial_revision_visible: false,
    immutable_post_update_revision_visible: false,
    normal_latest_row_visible: false,
    immutable_latest_row_visible: false,
    normal_location_matches: false,
    immutable_location_matches: false,
    immutable_candidate_allowed: false,
    immutable_behavior: null,
    reader_phase_1_diff: {},
    reader_phase_2_diff: {},
    reader_phase_2_before_fingerprint: {},
    reader_phase_2_after_fingerprint: {},
    immutable_database_shape_verified: false,
    fixture_wal_present: false,
    fixture_shm_present: false,
    directory_writable_before: null,
    directory_writable_during: null,
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
  if (!row) return {
    query_succeeded: false,
    observed_revision: null,
    observed_generated_at_ms: null,
  };
  const records = JSON.parse(row.install_records_json);
  return {
    query_succeeded: true,
    observed_revision: records[PLUGIN_ID]?.fixtureRevision ?? null,
    observed_generated_at_ms: Number(row.generated_at_ms),
  };
}

export function probeSqlWriteRejections(database) {
  const rejected = {
    insert: false,
    update: false,
    delete: false,
    ddl: false,
  };
  try {
    database.prepare(
      `INSERT INTO installed_plugin_index (
        index_key, version, host_contract_version, compat_registry_version,
        migration_version, policy_hash, generated_at_ms, refresh_reason,
        install_records_json, plugins_json, diagnostics_json, warning, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "plugin-registry-write-probe-insert",
      1,
      "synthetic-host-v1",
      "synthetic-registry-v1",
      1,
      "synthetic-probe-policy",
      9000,
      "write-probe",
      "{}",
      "[]",
      "{}",
      null,
      9000,
    );
  } catch {
    rejected.insert = true;
  }
  try {
    database.prepare("UPDATE installed_plugin_index SET warning = ? WHERE index_key = ?").run("probe", INDEX_KEY);
  } catch {
    rejected.update = true;
  }
  try {
    database.prepare("DELETE FROM installed_plugin_index WHERE index_key = ?").run(INDEX_KEY);
  } catch {
    rejected.delete = true;
  }
  try {
    database.exec("CREATE TABLE r2b_write_probe (value TEXT)");
  } catch {
    rejected.ddl = true;
  }
  return rejected;
}

export function runReadOnlyChecks(result, databasePath, before, rootDir) {
  let database;
  try {
    database = openReadOnly(databasePath);
    result.open_succeeded = true;
  } catch (error) {
    result.open_error_code = error?.code ?? error?.constructor?.name ?? "open_error";
    result.blockers.push("read_only_open_failed");
  }
  try {
    if (database) {
      const observed = readLatestRow(database);
      result.query_succeeded = observed.query_succeeded;
      result.observed_revision = observed.observed_revision;
      result.observed_generated_at_ms = observed.observed_generated_at_ms;
      result.latest_row_visible = result.observed_revision === result.expected_revision;
      if (!result.query_succeeded) result.blockers.push("latest_committed_row_not_visible");
      else if (!result.latest_row_visible) result.blockers.push("unexpected_revision_observed");
      const writeRejections = probeSqlWriteRejections(database);
      result.sql_write_rejections = writeRejections;
      result.sql_write_rejected = Object.values(writeRejections).every(Boolean);
      if (!result.sql_write_rejected) result.blockers.push("read_only_sql_write_not_rejected");
    }
  } catch (error) {
    result.query_error_code = error?.code ?? error?.constructor?.name ?? "query_error";
    result.blockers.push("read_only_query_failed");
  } finally {
    if (database) {
      try {
        database.close();
      } catch (error) {
        result.close_error_code = error?.code ?? error?.constructor?.name ?? "close_error";
        result.blockers.push("read_only_close_failed");
      }
    }
    const after = capture(rootDir);
    result.after_fingerprint = serialiseFingerprint(after);
    Object.assign(result, compareFingerprints(before, after));
  }
  if (result.observable_write_detected) result.blockers.push("observable_filesystem_write");
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
  result.expected_revision = CHECKPOINT_REVISION;
  const before = capture(rootDir);
  result.before_fingerprint = serialiseFingerprint(before);
  runReadOnlyChecks(result, databasePath, before, rootDir);
  result.after_fingerprint = serialiseFingerprint(capture(rootDir));
  return result;
}

function setupWalDatabase(databasePath) {
  const writer = createDatabase(databasePath, {
    journalMode: "WAL",
    row: rowJson({
      generatedAtMs: CHECKPOINT_GENERATED_AT_MS,
      fixtureRevision: CHECKPOINT_REVISION,
    }),
  });
  writer.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  updateFixtureRevision(writer, {
    revision: WAL_REVISION,
    generatedAtMs: WAL_GENERATED_AT_MS,
  });
  return writer;
}

function walScenario(rootDir) {
  const result = scenarioBase("wal-latest-committed-row");
  const databasePath = path.join(rootDir, DATABASE_NAME);
  const writer = setupWalDatabase(databasePath);
  result.database_created = true;
  result.expected_revision = WAL_REVISION;
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
    result.expected_revision = WAL_REVISION;
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
  const writer = setupWalDatabase(databasePath);
  result.database_created = true;
  result.expected_revision = WAL_REVISION;
  result.fixture_wal_present = existsSync(`${databasePath}-wal`);
  result.fixture_shm_present = existsSync(`${databasePath}-shm`);
  result.directory_writable_before = canWrite(rootDir);
  if (!result.fixture_wal_present || !result.fixture_shm_present) {
    result.blockers.push("wal_fixture_sidecars_missing");
  }
  chmodSync(rootDir, 0o555);
  result.directory_writable_during = canWrite(rootDir);
  try {
    const before = capture(rootDir);
    result.before_fingerprint = serialiseFingerprint(before);
    runReadOnlyChecks(result, databasePath, before, rootDir);
    result.after_fingerprint = serialiseFingerprint(capture(rootDir));
  } finally {
    chmodSync(rootDir, 0o755);
    writer.close();
  }
  if (result.blockers.length) result.status = "BLOCKED";
  return result;
}

function canWrite(directoryPath) {
  try {
    accessSync(directoryPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function errorCode(error, fallback) {
  return error?.code ?? error?.constructor?.name ?? fallback;
}

function readRevisionSafely(database, result, field) {
  try {
    return readLatestRow(database);
  } catch (error) {
    result[`${field}_error_code`] = errorCode(error, `${field}_error`);
    return null;
  }
}

function verifyDatabaseLocation(database, databasePath, result, prefix) {
  try {
    const location = database.location();
    const matches = typeof location === "string"
      && path.resolve(location) === path.resolve(databasePath);
    result[`${prefix}_location_matches`] = matches;
    if (!matches) {
      result.blockers.push(prefix === "normal"
        ? "database_location_not_proven"
        : "immutable_uri_semantics_not_proven");
    }
    return matches;
  } catch (error) {
    result[`${prefix}_location_error_code`] = errorCode(error, "location_error");
    result[`${prefix}_location_matches`] = false;
    result.blockers.push(prefix === "normal"
      ? "database_location_not_proven"
      : "immutable_uri_semantics_not_proven");
    return false;
  }
}

function mergePhaseDiffs(first, second) {
  const merged = {};
  for (const key of [
    "new_files",
    "deleted_files",
    "content_changed_files",
    "metadata_changed_files",
  ]) {
    merged[key] = [...new Set([...(first[key] ?? []), ...(second[key] ?? [])])].sort();
  }
  merged.sidecar_created = Boolean(first.sidecar_created || second.sidecar_created);
  merged.observable_write_detected = Boolean(
    first.observable_write_detected || second.observable_write_detected,
  );
  return merged;
}

function immutableScenario(rootDir) {
  const result = scenarioBase("immutable-live-wal");
  const databasePath = path.join(rootDir, DATABASE_NAME);
  const writer = setupWalDatabase(databasePath);
  result.database_created = true;
  result.expected_revision = WAL_REVISION;
  result.immutable_candidate_allowed = false;

  const phaseOneBefore = capture(rootDir);
  result.before_fingerprint = serialiseFingerprint(phaseOneBefore);
  let normal;
  let immutable;
  try {
    try {
      normal = openReadOnly(databasePath);
      result.open_succeeded = true;
      verifyDatabaseLocation(normal, databasePath, result, "normal");
    } catch (error) {
      result.normal_open_error_code = errorCode(error, "normal_open_error");
      result.blockers.push("read_only_open_failed");
    }
    const immutableUrl = pathToFileURL(databasePath);
    immutableUrl.searchParams.set("immutable", "1");
    try {
      immutable = new DatabaseSync(immutableUrl, { readOnly: true });
      result.immutable_open_succeeded = true;
      verifyDatabaseLocation(immutable, databasePath, result, "immutable");
    } catch (error) {
      result.immutable_open_error_code = errorCode(error, "immutable_open_error");
      result.blockers.push("immutable_uri_semantics_not_proven");
    }

    const normalInitial = normal
      ? readRevisionSafely(normal, result, "normal_initial_query")
      : null;
    const immutableInitial = immutable
      ? readRevisionSafely(immutable, result, "immutable_initial_query")
      : null;
    result.normal_initial_revision = normalInitial?.observed_revision ?? null;
    result.immutable_initial_revision = immutableInitial?.observed_revision ?? null;
    result.normal_initial_latest_visible = result.normal_initial_revision === WAL_REVISION;
    result.immutable_initial_revision_visible = result.immutable_initial_revision === WAL_REVISION;
    result.immutable_database_shape_verified = Boolean(immutableInitial?.query_succeeded);

    if (normal) {
      result.sql_write_rejections = probeSqlWriteRejections(normal);
      result.sql_write_rejected = Object.values(result.sql_write_rejections).every(Boolean);
      if (!result.sql_write_rejected) result.blockers.push("read_only_sql_write_not_rejected");
    }
    const phaseOneAfter = capture(rootDir);
    result.reader_phase_1_diff = compareFingerprints(phaseOneBefore, phaseOneAfter);

    try {
      updateFixtureRevision(writer, {
        revision: POST_OPEN_WAL_REVISION,
        generatedAtMs: POST_OPEN_GENERATED_AT_MS,
      });
    } catch (error) {
      result.writer_update_error_code = errorCode(error, "writer_update_error");
      result.blockers.push("post_open_writer_update_failed");
    }

    const phaseTwoBefore = capture(rootDir);
    result.reader_phase_2_before_fingerprint = serialiseFingerprint(phaseTwoBefore);
    const normalPost = normal
      ? readRevisionSafely(normal, result, "normal_post_update_query")
      : null;
    const immutablePost = immutable
      ? readRevisionSafely(immutable, result, "immutable_post_update_query")
      : null;
    result.normal_post_update_revision = normalPost?.observed_revision ?? null;
    result.immutable_post_update_revision = immutablePost?.observed_revision ?? null;
    result.normal_post_update_latest_visible = result.normal_post_update_revision === POST_OPEN_WAL_REVISION;
    result.immutable_post_update_revision_visible = result.immutable_post_update_revision === POST_OPEN_WAL_REVISION;
    result.normal_latest_row_visible = result.normal_initial_latest_visible
      && result.normal_post_update_latest_visible;
    result.latest_row_visible = result.normal_latest_row_visible;
    result.query_succeeded = Boolean(normalInitial?.query_succeeded && normalPost?.query_succeeded);
    result.observed_revision = result.normal_post_update_revision;
    result.observed_generated_at_ms = normalPost?.observed_generated_at_ms ?? null;

    if (!result.normal_initial_latest_visible || !result.normal_post_update_latest_visible) {
      result.blockers.push("latest_committed_row_not_visible");
    }
    try {
      normal?.close();
      normal = null;
    } catch (error) {
      result.normal_close_error_code = errorCode(error, "normal_close_error");
      result.blockers.push("normal_close_failed");
      normal = null;
    }
    try {
      immutable?.close();
      immutable = null;
    } catch (error) {
      result.immutable_close_error_code = errorCode(error, "immutable_close_error");
      result.blockers.push("immutable_close_failed");
      immutable = null;
    }
    const phaseTwoAfter = capture(rootDir);
    result.reader_phase_2_diff = compareFingerprints(phaseTwoBefore, phaseTwoAfter);
    result.reader_phase_2_after_fingerprint = serialiseFingerprint(phaseTwoAfter);
  } catch (error) {
    result.scenario_error_code = errorCode(error, "immutable_scenario_error");
    result.blockers.push(`scenario_error:${result.scenario_error_code}`);
    const after = capture(rootDir);
    result.reader_phase_2_after_fingerprint = serialiseFingerprint(after);
  } finally {
    try {
      normal?.close();
    } catch (error) {
      result.normal_close_error_code = errorCode(error, "normal_close_error");
      result.blockers.push("normal_close_failed");
    }
    try {
      immutable?.close();
    } catch (error) {
      result.immutable_close_error_code = errorCode(error, "immutable_close_error");
      result.blockers.push("immutable_close_failed");
    }
    try {
      writer.close();
    } catch (error) {
      result.writer_close_error_code = errorCode(error, "writer_close_error");
      result.blockers.push("writer_close_failed");
    }
  }

  const phaseDiff = mergePhaseDiffs(result.reader_phase_1_diff, result.reader_phase_2_diff);
  Object.assign(result, phaseDiff);
  result.after_fingerprint = result.reader_phase_2_after_fingerprint;
  if (result.observable_write_detected) result.blockers.push("observable_filesystem_write");
  if (!result.immutable_location_matches) result.blockers.push("immutable_uri_semantics_not_proven");
  if (result.immutable_post_update_query_error_code) result.immutable_behavior = "query-failed-after-update";
  else if (result.immutable_post_update_revision === POST_OPEN_WAL_REVISION) result.immutable_behavior = "saw-post-open-update";
  else if (result.immutable_post_update_revision === WAL_REVISION) result.immutable_behavior = "retained-stale-snapshot";
  else if (!result.immutable_location_matches) result.immutable_behavior = "uri-or-location-unproven";
  else result.immutable_behavior = "other";
  if (result.blockers.length) result.status = "BLOCKED";
  return result;
}

function runScenario(id, rootDir, fn) {
  const scenarioDir = path.join(rootDir, id);
  mkdirSync(scenarioDir);
  const before = capture(scenarioDir);
  try {
    return fn(scenarioDir);
  } catch (error) {
    const result = scenarioBase(id);
    result.status = "BLOCKED";
    result.scenario_error_code = error?.code ?? error?.constructor?.name ?? "scenario_error";
    const after = capture(scenarioDir);
    result.before_fingerprint = serialiseFingerprint(before);
    result.after_fingerprint = serialiseFingerprint(after);
    Object.assign(result, compareFingerprints(before, after));
    if (result.observable_write_detected) result.blockers.push("observable_filesystem_write");
    result.blockers.push(`scenario_error:${result.scenario_error_code}`);
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

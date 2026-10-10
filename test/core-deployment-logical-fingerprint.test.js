import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import Database from "better-sqlite3";

import fingerprint from "../bin/core-deployment-logical-fingerprint.js";

const {
  captureFingerprint,
  compareFingerprints,
  FINGERPRINT_CONTRACT,
  runCli,
  withReadSnapshot,
} = fingerprint;

function createCurrentCoreDb(path) {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE schema_meta (
      meta_key TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      app_version TEXT,
      updated_at INTEGER
    );
    CREATE TABLE memory_index_chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT,
      start_line INTEGER,
      end_line INTEGER,
      hash TEXT,
      model TEXT,
      text TEXT,
      embedding BLOB,
      updated_at INTEGER
    );
    CREATE VIRTUAL TABLE memory_index_chunks_fts USING fts5(id UNINDEXED, text, path UNINDEXED);
    CREATE TABLE memory_index_sources (
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      hash TEXT,
      mtime INTEGER,
      size INTEGER,
      PRIMARY KEY(path, source)
    );
    CREATE TABLE memory_embedding_cache (
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      hash TEXT NOT NULL,
      embedding BLOB,
      dims INTEGER,
      updated_at INTEGER,
      PRIMARY KEY(provider, model, provider_key, hash)
    );
    CREATE TABLE memory_index_meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE memory_index_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL);
    CREATE INDEX memory_index_chunks_path_idx ON memory_index_chunks(path);
    INSERT INTO schema_meta VALUES ('primary', 'agent', 1, 'main', 1720000000, '1.0.0', 1720000001);
    INSERT INTO memory_index_chunks VALUES
      ('chunk-1', 'memory/a.md', 'memory', 1, 3, 'chunk-hash', 'model-a', 'alpha content', X'0001FF', 1720000002);
    INSERT INTO memory_index_chunks_fts VALUES ('chunk-1', 'alpha content', 'memory/a.md');
    INSERT INTO memory_index_sources VALUES ('memory/a.md', 'memory', 'source-hash', 1720000000, 42);
    INSERT INTO memory_embedding_cache VALUES ('provider-a', 'model-a', 'key-a', 'cache-hash', X'010203', 3, 1720000003);
    INSERT INTO memory_index_meta VALUES ('format', 'v1');
    INSERT INTO memory_index_state VALUES (1, 7);
  `);
  db.close();
}

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "core-logical-fingerprint-"));
  const coreDbPath = join(root, "openclaw-agent.sqlite");
  createCurrentCoreDb(coreDbPath);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, coreDbPath };
}

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function invokeCli(argv) {
  let stdout = "";
  let stderr = "";
  const status = await runCli(argv, {
    stdout: { write: value => { stdout += value; } },
    stderr: { write: value => { stderr += value; } },
  });
  return { status, stdout, stderr };
}

function compareCli(baselinePath, coreDbPath, extraArgs = []) {
  return invokeCli(["--compare", baselinePath, "--core-db", coreDbPath, ...extraArgs]);
}

function parseCliReport(result) {
  assert.ok(result.stdout, JSON.stringify({ status: result.status, stderr: result.stderr, signal: result.signal, error: result.error?.message }));
  return JSON.parse(result.stdout);
}

function setBaseline(path, report) {
  writeFileSync(path, `${JSON.stringify(report)}\n`, "utf8");
}

function assertQuickCheck(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
  } finally {
    db.close();
  }
}

async function assertOutputRejected(coreDbPath, outputPath, expectedMessage) {
  const before = fileSha256(coreDbPath);
  const result = await invokeCli(["--core-db", coreDbPath, "--out", outputPath]);
  assert.equal(result.status, 64, result.stderr);
  assert.match(result.stderr, expectedMessage);
  assert.equal(fileSha256(coreDbPath), before);
  assertQuickCheck(coreDbPath);
}

test("captures deterministic current-dialect fingerprints read-only and supports --out", async t => {
  const { root, coreDbPath } = createFixture(t);
  const beforeDigest = fileSha256(coreDbPath);
  const first = await captureFingerprint({ coreDbPath });
  const second = await captureFingerprint({ coreDbPath });

  assert.equal(first.contract, FINGERPRINT_CONTRACT);
  assert.equal(first.dialect, "openclaw_memory_index");
  assert.equal(first.core_db_path, resolve(coreDbPath));
  assert.equal(first.deployment_invariant_sha256, second.deployment_invariant_sha256);
  assert.deepEqual(first.canonical_content, second.canonical_content);
  assert.deepEqual(first.schema_identity, second.schema_identity);
  assert.deepEqual(first.schema_surface, second.schema_surface);
  assert.equal(first.physical.sha256, null);
  assert.equal(fileSha256(coreDbPath), beforeDigest);

  const outputPath = join(root, "reports", "capture.json");
  const cli = await invokeCli(["--core-db", coreDbPath, "--physical-sha256", "--pretty", "--out", outputPath]);
  assert.equal(cli.status, 0, cli.stderr);
  const saved = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.match(saved.physical.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(saved.deployment_invariant_sha256, first.deployment_invariant_sha256);
  assert.equal(fileSha256(coreDbPath), beforeDigest);

  const refused = await invokeCli(["--core-db", coreDbPath, "--out", coreDbPath]);
  assert.equal(refused.status, 64);
  assert.match(refused.stderr, /--out resolves to protected Core storage/u);
  assert.equal(fileSha256(coreDbPath), beforeDigest);
});

test("uses shared resolver current-agent Core default", async t => {
  const root = mkdtempSync(join(tmpdir(), "core-logical-default-"));
  const openclawHome = join(root, ".openclaw");
  const coreDbPath = join(openclawHome, "agents", "main", "agent", "openclaw-agent.sqlite");
  mkdirSync(dirname(coreDbPath), { recursive: true });
  createCurrentCoreDb(coreDbPath);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const previousEnv = new Map();
  for (const key of [
    "OPENCLAW_HOME", "MEMORY_ENGINE_CORE_DB_PATH", "MEMORY_ENGINE_CORE_DB", "CORE_DB_PATH",
    "MEMORY_ENGINE_AGENT_ID", "OPENCLAW_AGENT_ID",
  ]) {
    previousEnv.set(key, process.env[key]);
  }
  process.env.OPENCLAW_HOME = openclawHome;
  delete process.env.MEMORY_ENGINE_CORE_DB_PATH;
  delete process.env.MEMORY_ENGINE_CORE_DB;
  delete process.env.CORE_DB_PATH;
  let result;
  try {
    result = await invokeCli([]);
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).core_db_path, resolve(coreDbPath));
});

test("rejects symlink and hardlink aliases to Core", async t => {
  const { root, coreDbPath } = createFixture(t);
  const symlinkAlias = join(root, "core-alias");
  const hardlinkAlias = join(root, "core-hardlink");
  symlinkSync(coreDbPath, symlinkAlias);
  linkSync(coreDbPath, hardlinkAlias);

  await assertOutputRejected(coreDbPath, symlinkAlias, /--out resolves to protected Core storage/u);
  await assertOutputRejected(coreDbPath, hardlinkAlias, /--out resolves to protected Core storage/u);
});

test("rejects future Core WAL, SHM, and journal paths", async t => {
  const { coreDbPath } = createFixture(t);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    await assertOutputRejected(coreDbPath, `${coreDbPath}${suffix}`, /--out resolves to protected Core storage/u);
  }
});

test("rejects symlinked-parent aliases to Core", async t => {
  const { root, coreDbPath } = createFixture(t);
  const aliasDir = join(root, "alias-dir");
  symlinkSync(root, aliasDir, "dir");

  await assertOutputRejected(coreDbPath, join(aliasDir, "openclaw-agent.sqlite"), /--out resolves to protected Core storage/u);
});

test("rejects baseline symlink and hardlink aliases", async t => {
  const { root, coreDbPath } = createFixture(t);
  const baselinePath = join(root, "before.json");
  setBaseline(baselinePath, await captureFingerprint({ coreDbPath }));
  const baselineSymlink = join(root, "before-symlink.json");
  const baselineHardlink = join(root, "before-hardlink.json");
  symlinkSync(baselinePath, baselineSymlink);
  linkSync(baselinePath, baselineHardlink);

  for (const alias of [baselineSymlink, baselineHardlink]) {
    const result = await invokeCli(["--compare", alias, "--core-db", coreDbPath, "--out", alias]);
    assert.equal(result.status, 64, result.stderr);
    assert.match(result.stderr, /--out resolves to the comparison baseline/u);
    assert.equal(readFileSync(baselinePath, "utf8"), readFileSync(alias, "utf8"));
  }
});

test("atomically replaces a normal existing JSON output", async t => {
  const { root, coreDbPath } = createFixture(t);
  const outputPath = join(root, "report.json");
  writeFileSync(outputPath, "old report\n");
  const result = await invokeCli(["--core-db", coreDbPath, "--out", outputPath]);
  assert.equal(result.status, 0, result.stderr);
  const saved = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(saved.core_db_path, resolve(coreDbPath));
  assert.notEqual(readFileSync(outputPath, "utf8"), "old report\n");
});

test("read snapshot keeps a stable view across a concurrent writer commit", t => {
  const root = mkdtempSync(join(tmpdir(), "core-logical-snapshot-"));
  const snapshotPath = join(root, "snapshot.sqlite");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const setup = new Database(snapshotPath);
  setup.exec("PRAGMA journal_mode = WAL; CREATE TABLE values_table (value TEXT); INSERT INTO values_table VALUES ('before')");
  setup.close();

  const reader = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  const writer = new Database(snapshotPath, { fileMustExist: true });
  t.after(() => {
    reader.close();
    writer.close();
  });

  const observed = withReadSnapshot(reader, () => {
    assert.equal(reader.inTransaction, true);
    const before = reader.prepare("SELECT value FROM values_table").get().value;
    writer.prepare("UPDATE values_table SET value = 'after'").run();
    const after = reader.prepare("SELECT value FROM values_table").get().value;
    return { before, after };
  });
  assert.deepEqual(observed, { before: "before", after: "before" });
  assert.equal(writer.prepare("SELECT value FROM values_table").get().value, "after");
});

test("schema_meta.updated_at changes are allowed by compare", async t => {
  const { root, coreDbPath } = createFixture(t);
  const before = await captureFingerprint({ coreDbPath });
  const baselinePath = join(root, "before.json");
  setBaseline(baselinePath, before);
  const db = new Database(coreDbPath);
  db.prepare("UPDATE schema_meta SET updated_at = updated_at + 1 WHERE meta_key = 'primary'").run();
  db.close();

  const result = await compareCli(baselinePath, coreDbPath);
  assert.equal(result.status, 0, result.stderr);
  const after = parseCliReport(result);
  assert.equal(after.deployment_invariant_sha256, before.deployment_invariant_sha256);
  assert.equal(after.comparison.deployment_invariant_equal, true);
  assert.deepEqual(after.comparison.allowed_metadata_changes, ["schema_meta.updated_at"]);
});

test("schema_meta.app_version changes are informational", async t => {
  const { root, coreDbPath } = createFixture(t);
  const before = await captureFingerprint({ coreDbPath });
  const baselinePath = join(root, "before.json");
  setBaseline(baselinePath, before);
  const db = new Database(coreDbPath);
  db.prepare("UPDATE schema_meta SET app_version = '2.0.0' WHERE meta_key = 'primary'").run();
  db.close();

  const result = await compareCli(baselinePath, coreDbPath);
  assert.equal(result.status, 0, result.stderr);
  const after = parseCliReport(result);
  assert.equal(after.comparison.deployment_invariant_equal, true);
  assert.deepEqual(after.comparison.allowed_metadata_changes, ["schema_meta.app_version"]);
});

async function assertMutationDetected(t, mutate, expectedSection) {
  const { root, coreDbPath } = createFixture(t);
  const before = await captureFingerprint({ coreDbPath });
  const baselinePath = join(root, "before.json");
  setBaseline(baselinePath, before);
  const db = new Database(coreDbPath);
  mutate(db);
  db.close();
  const after = await captureFingerprint({ coreDbPath });
  const fingerprintValue = value => (value && typeof value === "object" && "sha256" in value)
    ? value.sha256
    : value;
  assert.notEqual(fingerprintValue(after[expectedSection]), fingerprintValue(before[expectedSection]));
  const result = await compareCli(baselinePath, coreDbPath);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(parseCliReport(result).comparison.deployment_invariant_equal, false);
}

async function assertProtectedTableIndexMutationDetected(t, { prepare, mutate }) {
  const { root, coreDbPath } = createFixture(t);
  const setup = new Database(coreDbPath);
  prepare(setup);
  setup.close();

  const before = await captureFingerprint({ coreDbPath });
  const baselinePath = join(root, "before.json");
  setBaseline(baselinePath, before);

  const db = new Database(coreDbPath);
  mutate(db);
  db.close();

  const after = await captureFingerprint({ coreDbPath });
  assert.equal(after.canonical_content.sha256, before.canonical_content.sha256);
  assert.equal(after.schema_identity.sha256, before.schema_identity.sha256);
  assert.equal(after.pragma_user_version, before.pragma_user_version);
  assert.notEqual(after.schema_surface.sha256, before.schema_surface.sha256);

  const result = await compareCli(baselinePath, coreDbPath);
  assert.equal(result.status, 2, result.stderr);
  const comparison = parseCliReport(result).comparison;
  assert.equal(comparison.canonical_content_equal, true);
  assert.equal(comparison.schema_identity_equal, true);
  assert.equal(comparison.user_version_equal, true);
  assert.equal(comparison.schema_surface_equal, false);
  assert.equal(comparison.deployment_invariant_equal, false);
}

test("chunk text mutation changes canonical content and fails comparison", async t => {
  await assertMutationDetected(t, db => db.prepare("UPDATE memory_index_chunks SET text = 'changed' WHERE id = 'chunk-1'").run(), "canonical_content");
});

test("embedding cache mutation changes canonical content and fails comparison", async t => {
  await assertMutationDetected(t, db => db.prepare("UPDATE memory_embedding_cache SET embedding = X'0908' WHERE provider_key = 'key-a'").run(), "canonical_content");
});

test("source mutation changes canonical content and fails comparison", async t => {
  await assertMutationDetected(t, db => db.prepare("UPDATE memory_index_sources SET hash = 'changed' WHERE path = 'memory/a.md'").run(), "canonical_content");
});

test("memory_index_meta mutation changes canonical content and fails comparison", async t => {
  await assertMutationDetected(t, db => db.prepare("UPDATE memory_index_meta SET value = 'v2' WHERE key = 'format'").run(), "canonical_content");
});

test("memory_index_state revision mutation changes canonical content and fails comparison", async t => {
  await assertMutationDetected(t, db => db.prepare("UPDATE memory_index_state SET revision = revision + 1 WHERE id = 1").run(), "canonical_content");
});

test("schema identity mutation fails comparison", async t => {
  await assertMutationDetected(t, db => db.prepare("UPDATE schema_meta SET schema_version = 2 WHERE meta_key = 'primary'").run(), "schema_identity");
});

test("PRAGMA user_version mutation fails comparison", async t => {
  await assertMutationDetected(t, db => db.pragma("user_version = 2"), "pragma_user_version");
});

test("memory-index schema surface mutation fails comparison", async t => {
  await assertMutationDetected(t, db => db.exec("CREATE TABLE memory_index_future_table (id INTEGER PRIMARY KEY, value TEXT)"), "schema_surface");
});

test("target protected-table index CREATE changes only schema surface", async t => {
  await assertProtectedTableIndexMutationDetected(t, {
    prepare: () => {},
    mutate: db => db.exec("CREATE INDEX idx_memory_index_chunks_recent_cover ON memory_index_chunks(updated_at DESC, id ASC, path)"),
  });
});

test("arbitrary-name protected-table index CREATE changes only schema surface", async t => {
  await assertProtectedTableIndexMutationDetected(t, {
    prepare: () => {},
    mutate: db => db.exec("CREATE INDEX arbitrary_chunk_index ON memory_index_chunks(path)"),
  });
});

test("target protected-table index definition changes are detected", async t => {
  await assertProtectedTableIndexMutationDetected(t, {
    prepare: db => db.exec("CREATE INDEX idx_memory_index_chunks_recent_cover ON memory_index_chunks(updated_at DESC, id ASC, path)"),
    mutate: db => db.exec("DROP INDEX idx_memory_index_chunks_recent_cover; CREATE INDEX idx_memory_index_chunks_recent_cover ON memory_index_chunks(path, id)"),
  });
});

test("arbitrary-name protected-table index definition changes are detected", async t => {
  await assertProtectedTableIndexMutationDetected(t, {
    prepare: db => db.exec("CREATE INDEX arbitrary_chunk_index ON memory_index_chunks(path)"),
    mutate: db => db.exec("DROP INDEX arbitrary_chunk_index; CREATE INDEX arbitrary_chunk_index ON memory_index_chunks(updated_at, id)"),
  });
});

test("target protected-table index DROP changes only schema surface", async t => {
  await assertProtectedTableIndexMutationDetected(t, {
    prepare: db => db.exec("CREATE INDEX idx_memory_index_chunks_recent_cover ON memory_index_chunks(updated_at DESC, id ASC, path)"),
    mutate: db => db.exec("DROP INDEX idx_memory_index_chunks_recent_cover"),
  });
});

test("arbitrary-name protected-table index DROP changes only schema surface", async t => {
  await assertProtectedTableIndexMutationDetected(t, {
    prepare: db => db.exec("CREATE INDEX arbitrary_chunk_index ON memory_index_chunks(path)"),
    mutate: db => db.exec("DROP INDEX arbitrary_chunk_index"),
  });
});

test("physical SHA mismatch is diagnostic and does not fail an equal logical invariant", async t => {
  const { root, coreDbPath } = createFixture(t);
  const baseline = await captureFingerprint({ coreDbPath, physicalSha256: true });
  baseline.physical.sha256 = baseline.physical.sha256 === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64);
  const baselinePath = join(root, "before.json");
  setBaseline(baselinePath, baseline);

  const result = await compareCli(baselinePath, coreDbPath, ["--physical-sha256"]);
  assert.equal(result.status, 0, result.stderr);
  const after = parseCliReport(result);
  assert.equal(after.comparison.physical_sha_equal, false);
  assert.equal(after.comparison.deployment_invariant_equal, true);
});

test("comparison rejects a different Core path even when logical hashes match", async t => {
  const { root, coreDbPath } = createFixture(t);
  const before = await captureFingerprint({ coreDbPath });
  const baselinePath = join(root, "before.json");
  setBaseline(baselinePath, before);
  const copyPath = join(root, "copy.sqlite");
  writeFileSync(copyPath, readFileSync(coreDbPath));
  const result = await compareCli(baselinePath, copyPath);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(parseCliReport(result).comparison.core_path_equal, false);
  assert.equal(parseCliReport(result).comparison.deployment_invariant_equal, false);
});

test("unsupported databases and invalid arguments exit 64", async t => {
  const root = mkdtempSync(join(tmpdir(), "core-logical-invalid-"));
  const path = join(root, "unsupported.sqlite");
  const db = new Database(path);
  db.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY)");
  db.close();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const unsupported = await invokeCli(["--core-db", path]);
  assert.equal(unsupported.status, 64);
  assert.match(unsupported.stderr, /Unsupported Core DB/u);
  const invalid = await invokeCli(["--not-an-option"]);
  assert.equal(invalid.status, 64);
});

test("compare helper reports allowed volatile fields without including them in identity", async t => {
  const { coreDbPath } = createFixture(t);
  const before = await captureFingerprint({ coreDbPath });
  const after = structuredClone(before);
  after.volatile_metadata.schema_meta_app_version = "new-version";
  after.volatile_metadata.schema_meta_updated_at = 9;
  const comparison = compareFingerprints(before, after, "/tmp/before.json");
  assert.equal(comparison.deployment_invariant_equal, true);
  assert.deepEqual(comparison.allowed_metadata_changes, ["schema_meta.updated_at", "schema_meta.app_version"]);
});

import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRequire } from "node:module";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_OPENCLAW_HOME = process.env.OPENCLAW_HOME;
const ORIGINAL_MEMORY_ENGINE_CORE_DB = process.env.MEMORY_ENGINE_CORE_DB;
const ORIGINAL_MEMORY_ENGINE_CORE_DB_PATH = process.env.MEMORY_ENGINE_CORE_DB_PATH;
const ORIGINAL_CORE_DB_PATH = process.env.CORE_DB_PATH;
const isolatedHome = mkdtempSync(join(tmpdir(), "memory-engine-forensic-home-"));
const decoyCoreDbPath = join(isolatedHome, "ignored-generic-core.sqlite");
process.env.HOME = isolatedHome;
process.env.OPENCLAW_HOME = isolatedHome;
process.env.MEMORY_ENGINE_CORE_DB = decoyCoreDbPath;
process.env.MEMORY_ENGINE_CORE_DB_PATH = decoyCoreDbPath;
process.env.CORE_DB_PATH = decoyCoreDbPath;
const migration = await import("../lib/db/core-chunk-time-migration.js");
after(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
  if (ORIGINAL_OPENCLAW_HOME === undefined) delete process.env.OPENCLAW_HOME;
  else process.env.OPENCLAW_HOME = ORIGINAL_OPENCLAW_HOME;
  if (ORIGINAL_MEMORY_ENGINE_CORE_DB === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
  else process.env.MEMORY_ENGINE_CORE_DB = ORIGINAL_MEMORY_ENGINE_CORE_DB;
  if (ORIGINAL_MEMORY_ENGINE_CORE_DB_PATH === undefined) delete process.env.MEMORY_ENGINE_CORE_DB_PATH;
  else process.env.MEMORY_ENGINE_CORE_DB_PATH = ORIGINAL_MEMORY_ENGINE_CORE_DB_PATH;
  if (ORIGINAL_CORE_DB_PATH === undefined) delete process.env.CORE_DB_PATH;
  else process.env.CORE_DB_PATH = ORIGINAL_CORE_DB_PATH;
  rmSync(isolatedHome, { recursive: true, force: true });
});
const CLI_FILES = [
  "bin/preview-core-chunk-event-time-migration-impact.js",
  "bin/audit-raw-log-provenance.js",
  "bin/migrate-core-chunk-times.js",
  "bin/audit-core-chunk-event-time-recovery.js",
  "bin/reconcile-event-at-audit-counts.js",
  "bin/export-event-at-manual-recovery-candidates.js",
  "bin/inspect-unrecoverable-event-at-raw-log.js",
];
const DB_FORENSIC_SOURCES = [...CLI_FILES, "lib/db/core-chunk-time-migration.js"];
const REQUIRED_SOURCE_HELP = "--core-db <path>";
const REQUIRED_SOURCE_ERROR = "--core-db is required for historical Core forensic operations";

function makeTempRoot(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function createLegacyFixture(root) {
  const coreDbPath = join(root, "historical-core.sqlite");
  const engineDbPath = join(root, "historical-engine.sqlite");
  const sessionsDir = join(root, "sessions");
  const memoryDir = join(root, "memory");
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });

  const core = new Database(coreDbPath);
  core.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      path TEXT,
      source TEXT,
      start_line INTEGER,
      end_line INTEGER,
      hash TEXT,
      model TEXT,
      text TEXT,
      embedding TEXT,
      updated_at INTEGER,
      event_at INTEGER,
      created_at INTEGER
    )
  `);
  core.close();

  const engine = new Database(engineDbPath);
  engine.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      last_confidence_update INTEGER,
      category TEXT NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0
    )
  `);
  engine.close();

  return { coreDbPath, engineDbPath, sessionsDir, memoryDir };
}

function missingSourceArgs(root) {
  const date = "2026-06-15";
  return [
    ["--json"],
    ["--legacy-date", date, "--json"],
    ["--json"],
    ["--json"],
    ["--legacy-date", date, "--json"],
    ["--date", date, "--out", join(root, "missing-source.jsonl"), "--json"],
    ["--date", date, "--json"],
  ];
}

function explicitSourceArgs(root, fixture) {
  const date = "2026-06-15";
  const source = ["--core-db", fixture.coreDbPath];
  const engine = ["--engine-db", fixture.engineDbPath];
  const sessions = ["--sessions-dir", fixture.sessionsDir];
  return [
    [...source, "--json"],
    ["--legacy-date", date, ...source, ...engine, ...sessions, "--json"],
    [...source, "--json"],
    [...source, "--json"],
    ["--legacy-date", date, ...source, ...engine, ...sessions, "--json"],
    ["--date", date, ...source, "--out", join(root, "explicit-source.jsonl"), "--json"],
    ["--date", date, ...source, "--json"],
  ];
}

function invokeMissingSource(file, module, args) {
  if (file === CLI_FILES[1]) {
    return module.parseArgs(args);
  }
  if (file === CLI_FILES[4]) {
    return module.parseArgs(args);
  }
  return module.main(args);
}

test("B2 forensic CLI entry points require explicit --core-db before opening any database", async () => {
  const root = makeTempRoot("memory-engine-forensic-source-missing-");
  const decoy = join(root, "generic-env-core.sqlite");
  mkdirSync(isolatedHome, { recursive: true });
  const previousMemoryEngineCoreDb = process.env.MEMORY_ENGINE_CORE_DB;
  const previousCoreDbPath = process.env.CORE_DB_PATH;
  process.env.MEMORY_ENGINE_CORE_DB = decoy;
  process.env.CORE_DB_PATH = decoy;
  try {
    for (const [index, file] of CLI_FILES.entries()) {
      const module = require(resolve(repoRoot, file));
      const args = missingSourceArgs(root)[index];
      if (file === CLI_FILES[1] || file === CLI_FILES[4]) {
        assert.throws(
          () => invokeMissingSource(file, module, args),
          { message: REQUIRED_SOURCE_ERROR },
          file,
        );
      } else {
        await assert.rejects(
          invokeMissingSource(file, module, args),
          { message: REQUIRED_SOURCE_ERROR },
          file,
        );
      }
    }
    assert.equal(existsSync(decoy), false);
    assert.equal(existsSync(decoyCoreDbPath), false);
    assert.equal(existsSync(join(isolatedHome, ".openclaw", "memory", "main.sqlite")), false);
  } finally {
    if (previousMemoryEngineCoreDb === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = previousMemoryEngineCoreDb;
    if (previousCoreDbPath === undefined) delete process.env.CORE_DB_PATH;
    else process.env.CORE_DB_PATH = previousCoreDbPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("forensic help and source contract identify explicit historical Core attribution", () => {
  for (const file of DB_FORENSIC_SOURCES) {
    const source = readFileSync(resolve(repoRoot, file), "utf8");
    assert.doesNotMatch(source, /\.openclaw\/memory\/main\.sqlite|memory\/main\.sqlite/, file);
    assert.doesNotMatch(source, /MEMORY_ENGINE_CORE_DB|CORE_DB_PATH/, file);
  }

  for (const file of CLI_FILES) {
    const source = readFileSync(resolve(repoRoot, file), "utf8");
    assert.ok(source.includes(REQUIRED_SOURCE_HELP), file);
    assert.ok(source.includes("Required historical/forensic Core DB source"), file);
  }
});

test("all forensic DB-backed library operations accept explicit legacy Core and report its absolute source", () => {
  const root = makeTempRoot("memory-engine-forensic-source-explicit-");
  const fixture = createLegacyFixture(root);
  try {
    for (const [index, file] of CLI_FILES.entries()) {
      const module = require(resolve(repoRoot, file));
      const parsed = module.parseArgs(explicitSourceArgs(root, fixture)[index]);
      assert.equal(parsed.coreDbPath, fixture.coreDbPath, file);
    }

    const options = { ...fixture, sessionTranscriptRecovery: false };
    const reports = [
      migration.inspectCoreChunkTimeMigration(options),
      migration.auditCoreChunkEventTimeRecovery(options),
      migration.previewCoreChunkEventTimeMigrationImpact(options),
      migration.inspectUnrecoverableEventAtRawLog({ ...options, date: "2026-06-15" }),
      migration.exportEventAtManualRecoveryCandidates({
        ...options,
        date: "2026-06-15",
        outPath: join(root, "manual-recovery.jsonl"),
      }),
      require(resolve(repoRoot, CLI_FILES[1])).auditRawLogProvenance({
        ...options,
        legacyDate: "2026-06-15",
      }),
      require(resolve(repoRoot, CLI_FILES[4])).reconcile({
        ...options,
        legacyDate: "2026-06-15",
      }),
    ];
    for (const report of reports) assert.equal(report.core_db_path, fixture.coreDbPath);
    assert.equal(existsSync(join(isolatedHome, ".openclaw", "memory", "main.sqlite")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DB-backed library API fails closed while file-only label initialization needs no Core DB", () => {
  const root = makeTempRoot("memory-engine-forensic-api-source-");
  try {
    assert.throws(() => migration.inspectCoreChunkTimeMigration({}), { message: REQUIRED_SOURCE_ERROR });

    const candidatesPath = join(root, "empty-candidates.jsonl");
    const outPath = join(root, "labels.jsonl");
    writeFileSync(candidatesPath, "", "utf8");
    const report = migration.initEventAtManualRecoveryLabels({ candidatesPath, outPath });
    assert.equal(report.candidate_count, 0);
    assert.equal(readFileSync(outPath, "utf8"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import legacySingletonCli from "../bin/review-legacy-singleton-memory.js";
import {
  buildLegacySingletonReview,
  normalizeReviewPath,
  renderLegacySingletonReviewMarkdown,
  runLegacySingletonReview,
} from "../lib/quality/legacy-singleton-review.js";

const { parseArgs, main } = legacySingletonCli;

function createFixture({
  createFile = false,
  fileText = "",
  chunkText = "legacy daily note from singleton file",
  hasConfidenceRecord = false,
  retrievedCount = 0,
  injectedCount = 0,
} = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "legacy-singleton-review-"));
  const corePath = resolve(root, "core.sqlite");
  const engineDir = resolve(root, "engine");
  const enginePath = resolve(engineDir, "memory-engine.sqlite");
  const memoryDir = resolve(root, "memory");
  mkdirSync(engineDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });

  const coreDb = new Database(corePath);
  const engineDb = new Database(enginePath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT,
        source TEXT,
        text TEXT,
        updated_at INTEGER,
        start_line INTEGER,
        end_line INTEGER,
        hash TEXT
      );
      CREATE TABLE memory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        session_id TEXT,
        trace_id TEXT,
        memory_id TEXT,
        latency_ms INTEGER,
        candidate_count INTEGER,
        injected_count INTEGER,
        cited_count INTEGER,
        vector_score REAL,
        fts_score REAL,
        final_score REAL,
        source TEXT,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    engineDb.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        initial_confidence REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.5,
        last_confidence_update INTEGER,
        base_tau REAL NOT NULL DEFAULT 7.0,
        hit_count INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        is_protected INTEGER NOT NULL DEFAULT 0,
        conflict_flag INTEGER NOT NULL DEFAULT 0,
        category TEXT,
        kg_data TEXT
      );
      CREATE TABLE memory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        session_id TEXT,
        trace_id TEXT,
        memory_id TEXT,
        latency_ms INTEGER,
        candidate_count INTEGER,
        injected_count INTEGER,
        cited_count INTEGER,
        vector_score REAL,
        fts_score REAL,
        final_score REAL,
        source TEXT,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    coreDb.prepare(`
      INSERT INTO chunks (id, path, source, text, updated_at, start_line, end_line, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "legacy-singleton-1",
      "memory/daily.md",
      "memory",
      chunkText,
      Date.parse("2026-06-29T01:00:00.000Z"),
      1,
      2,
      "hash-legacy-singleton",
    );

    if (hasConfidenceRecord) {
      engineDb.prepare(`
        INSERT INTO memory_confidence
        (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("legacy-singleton-1", 0.6, 0.7, 1782698400, 7, 1, 0, 0, 0, "raw_log", null);
    }

    for (let i = 0; i < retrievedCount; i += 1) {
      engineDb.prepare(`
        INSERT INTO memory_events
        (event_type, session_id, trace_id, memory_id, source, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "memory_candidate_retrieved",
        `session-r-${i}`,
        `trace-r-${i}`,
        "legacy-singleton",
        "autoRecall",
        JSON.stringify({ path: "memory/daily.md", id: "legacy-singleton-1" }),
        `2026-06-29 01:0${i}:00`,
      );
    }

    for (let i = 0; i < injectedCount; i += 1) {
      engineDb.prepare(`
        INSERT INTO memory_events
        (event_type, session_id, trace_id, memory_id, source, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "memory_injected",
        `session-i-${i}`,
        `trace-i-${i}`,
        "legacy-singleton",
        "autoRecall",
        JSON.stringify({ path: "memory/daily.md", id: "legacy-singleton-1" }),
        `2026-06-29 01:1${i}:00`,
      );
    }
  } finally {
    coreDb.close();
    engineDb.close();
  }

  if (createFile) {
    writeFileSync(resolve(memoryDir, "daily.md"), fileText || chunkText, "utf8");
  }

  return { root, corePath, enginePath };
}

async function withFixtureEnv(fixture, fn) {
  const oldCore = process.env.MEMORY_ENGINE_CORE_DB;
  const oldEngine = process.env.MEMORY_ENGINE_DB;
  const oldEnginePath = process.env.MEMORY_ENGINE_DB_PATH;
  process.env.MEMORY_ENGINE_CORE_DB = fixture.corePath;
  process.env.MEMORY_ENGINE_DB = fixture.enginePath;
  process.env.MEMORY_ENGINE_DB_PATH = fixture.enginePath;
  try {
    return await fn();
  } finally {
    if (oldCore === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = oldCore;
    if (oldEngine === undefined) delete process.env.MEMORY_ENGINE_DB;
    else process.env.MEMORY_ENGINE_DB = oldEngine;
    if (oldEnginePath === undefined) delete process.env.MEMORY_ENGINE_DB_PATH;
    else process.env.MEMORY_ENGINE_DB_PATH = oldEnginePath;
  }
}

async function captureConsole(fn) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const result = await fn();
    return { result, output: logs.join("\n"), error: errors.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("parseArgs accepts review flags and rejects invalid paths or destructive flags", () => {
  assert.deepEqual(parseArgs(["--json", "--path", "memory/daily.md", "--sample-limit", "4"]), {
    help: false,
    json: true,
    markdown: false,
    out: null,
    path: "memory/daily.md",
    sampleLimit: 4,
  });
  assert.throws(() => normalizeReviewPath("../memory/daily.md"), /path must stay under memory/);
  assert.throws(() => normalizeReviewPath("docs/devlog.md"), /path must stay under memory/);
  assert.throws(() => parseArgs(["--fix"]), /unsupported destructive flag/);
});

test("missing on-disk file with indexed chunk is a stale index candidate", async () => {
  const fixture = createFixture();
  await withFixtureEnv(fixture, async () => {
    const report = runLegacySingletonReview({
      projectRoot: fixture.root,
    });
    assert.equal(report.target_path, "memory/daily.md");
    assert.equal(report.exists_on_disk, false);
    assert.equal(report.indexed_chunk_count, 1);
    assert.deepEqual(report.chunk_ids, ["legacy-singleton-1"]);
    assert.equal(report.likely_classification, "stale_index_candidate");
    assert.equal(report.suggested_action, "safe_to_review_for_stale_index_or_legacy_file");
    assert.equal(report.chunk_matches_file_excerpt, "unknown");
  });
});

test("file excerpt match marks the singleton as a legacy file candidate", async () => {
  const fixture = createFixture({
    createFile: true,
    fileText: "legacy daily note from singleton file\nsecond line",
  });
  await withFixtureEnv(fixture, async () => {
    const report = runLegacySingletonReview({
      projectRoot: fixture.root,
    });
    assert.equal(report.exists_on_disk, true);
    assert.equal(report.chunk_matches_file_excerpt, true);
    assert.equal(report.likely_classification, "legacy_file_candidate");
    assert.equal(report.suggested_action, "safe_to_review_for_stale_index_or_legacy_file");
    assert.deepEqual(report.side_effects, {
      db_writes: false,
      memory_file_mutation: false,
      config_mutation: false,
      archive: false,
      quarantine: false,
      reinforce: false,
      confidence_backfill: false,
      llm: false,
      network: false,
    });
  });
});

test("generated or healthcheck-looking file content still classifies as legacy file candidate", async () => {
  const fixture = createFixture({
    createFile: true,
    fileText: "healthcheck generated singleton artifact",
    chunkText: "different indexed text",
  });
  await withFixtureEnv(fixture, async () => {
    const report = runLegacySingletonReview({
      projectRoot: fixture.root,
    });
    assert.equal(report.chunk_matches_file_excerpt, false);
    assert.equal(report.likely_classification, "legacy_file_candidate");
  });
});

test("usage or confidence forces manual review", async () => {
  const fixture = createFixture({
    createFile: true,
    hasConfidenceRecord: true,
    retrievedCount: 1,
    injectedCount: 1,
  });
  await withFixtureEnv(fixture, async () => {
    const report = runLegacySingletonReview({
      projectRoot: fixture.root,
    });
    assert.equal(report.has_confidence_record_count, 1);
    assert.equal(report.retrieved_count, 1);
    assert.equal(report.injected_count, 1);
    assert.equal(report.last_retrieved_at, "2026-06-29 01:00:00");
    assert.equal(report.last_injected_at, "2026-06-29 01:10:00");
    assert.equal(report.likely_classification, "manual_review_required");
    assert.equal(report.suggested_action, "manual_review_required");
  });
});

test("build and markdown rendering keep deterministic fields", async () => {
  const fixture = createFixture();
  await withFixtureEnv(fixture, async () => {
    const report = runLegacySingletonReview({
      projectRoot: fixture.root,
    });
    const markdown = renderLegacySingletonReviewMarkdown(report);
    assert.equal(markdown.includes("# Legacy Singleton Review"), true);
    assert.equal(markdown.includes("target_path: memory/daily.md"), true);
    assert.equal(markdown.includes("chunk_matches_file_excerpt: unknown"), true);
  });
});

test("CLI --help exits cleanly and --out writes review output", async () => {
  const fixture = createFixture({
    createFile: true,
  });
  const outPath = resolve(fixture.root, "legacy-singleton-review.json");
  await withFixtureEnv(fixture, async () => {
    const help = await captureConsole(() => main(["--help"]));
    assert.equal(help.result, 0);
    assert.equal(help.output.includes("Legacy Singleton Review"), true);
    assert.equal(help.output.includes("--path <path>"), true);

    const previousCwd = process.cwd();
    process.chdir(fixture.root);
    try {
      const review = await captureConsole(() => main(["--json", "--out", outPath]));
      assert.equal(review.result, 0);
      assert.equal(existsSync(outPath), true);
      const parsed = JSON.parse(readFileSync(outPath, "utf8"));
      assert.equal(parsed.target_path, "memory/daily.md");
      assert.equal(JSON.parse(review.output).likely_classification, "legacy_file_candidate");
    } finally {
      process.chdir(previousCwd);
    }
  });
});

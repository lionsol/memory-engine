import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import memoryQualityCli from "../bin/memory-quality-eval.js";

const { main, parseArgs, runMemoryQualityEval } = memoryQualityCli;

function createCliFixtureDbs() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-quality-cli-"));
  const corePath = resolve(root, "core.sqlite");
  const engineDir = resolve(root, "engine");
  const enginePath = resolve(engineDir, "memory-engine.sqlite");
  mkdirSync(engineDir, { recursive: true });

  const coreDb = new Database(corePath);
  const engineDb = new Database(enginePath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT,
        source TEXT,
        start_line INTEGER,
        end_line INTEGER,
        hash TEXT,
        text TEXT,
        updated_at INTEGER
      )
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
        category TEXT NOT NULL DEFAULT 'raw_log',
        kg_data TEXT
      )
    `);
    engineDb.exec(`
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
      )
    `);

    coreDb.prepare(`
      INSERT INTO chunks (id, path, source, start_line, end_line, hash, text, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("aaaaaaaaaaaaaaaa-1", "memory/episodes/a.md", "fixture", 1, 5, "ha", "Episode memory with file docs/runtime-sync.md and commit abc1234", 1718600000);
    coreDb.prepare(`
      INSERT INTO chunks (id, path, source, start_line, end_line, hash, text, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("bbbbbbbbbbbbbbbb-1", "memory/stats-history.md", "fixture", 6, 10, "hb", "stats history", 1718600100);

    engineDb.prepare(`
      INSERT INTO memory_confidence
      (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("aaaaaaaaaaaaaaaa-1", 0.7, 0.9, 1718600000, 30, 3, 0, 0, 0, "episodic", null);

    engineDb.prepare(`
      INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("memory_candidate_retrieved", "s1", "t1", "aaaaaaaaaaaaaaaa", "autoRecall", "2026-06-19 10:00:00");
  } finally {
    coreDb.close();
    engineDb.close();
  }

  return { corePath, enginePath, root };
}

async function captureConsole(fn) {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => {
    lines.push(args.join(" "));
  };
  try {
    const result = await fn();
    return { result, output: lines.join("\n") };
  } finally {
    console.log = originalLog;
  }
}

test("parseArgs accepts supported options", () => {
  const parsed = parseArgs([
    "--json",
    "--top", "50",
    "--scope", "all",
    "--path-family", "episodes",
    "--include-stats-history",
    "--category", "episodic",
    "--path-prefix", "memory/episodes",
    "--include-archived",
  ]);

  assert.deepEqual(parsed, {
    json: true,
    top: 50,
    scope: "all",
    pathFamily: "episodes",
    includeStatsHistory: true,
    category: "episodic",
    pathPrefix: "memory/episodes",
    includeArchived: true,
    help: false,
  });
});

test("parseArgs rejects forbidden flags", () => {
  assert.throws(() => parseArgs(["--fix"]), /unsupported destructive flag/);
  assert.throws(() => parseArgs(["--llm-judge"]), /unsupported destructive flag/);
});

test("CLI --help exits cleanly", async () => {
  const captured = await captureConsole(() => main(["--help"]));
  assert.equal(captured.result, 0);
  assert.equal(captured.output.includes("Memory Quality Eval MVP v4"), true);
  assert.equal(captured.output.includes("--include-stats-history"), true);
});

test("CLI --json prints JSON summary and writes reports", async () => {
  const { corePath, enginePath, root } = createCliFixtureDbs();
  const outputDir = resolve(root, "out");
  const oldCore = process.env.MEMORY_ENGINE_CORE_DB;
  const oldEngine = process.env.MEMORY_ENGINE_DB;
  const oldOut = process.env.MEMORY_QUALITY_OUTPUT_DIR;
  process.env.MEMORY_ENGINE_CORE_DB = corePath;
  process.env.MEMORY_ENGINE_DB = enginePath;
  process.env.MEMORY_QUALITY_OUTPUT_DIR = outputDir;
  try {
    const captured = await captureConsole(() => main(["--json"]));
    assert.equal(captured.result, 0);
    const parsed = JSON.parse(captured.output);
    assert.equal(parsed.total_evaluated, 1);
    assert.equal(typeof parsed.average_score, "number");
    assert.equal(existsSync(resolve(outputDir, "latest.json")), true);
    assert.equal(existsSync(resolve(outputDir, "latest.md")), true);
  } finally {
    if (oldCore === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = oldCore;
    if (oldEngine === undefined) delete process.env.MEMORY_ENGINE_DB;
    else process.env.MEMORY_ENGINE_DB = oldEngine;
    if (oldOut === undefined) delete process.env.MEMORY_QUALITY_OUTPUT_DIR;
    else process.env.MEMORY_QUALITY_OUTPUT_DIR = oldOut;
  }
});

test("CLI --include-stats-history includes stats-history item", async () => {
  const { corePath, enginePath, root } = createCliFixtureDbs();
  const outputDir = resolve(root, "out");
  const oldCore = process.env.MEMORY_ENGINE_CORE_DB;
  const oldEngine = process.env.MEMORY_ENGINE_DB;
  const oldOut = process.env.MEMORY_QUALITY_OUTPUT_DIR;
  process.env.MEMORY_ENGINE_CORE_DB = corePath;
  process.env.MEMORY_ENGINE_DB = enginePath;
  process.env.MEMORY_QUALITY_OUTPUT_DIR = outputDir;
  try {
    const captured = await captureConsole(() => main(["--json", "--include-stats-history"]));
    assert.equal(captured.result, 0);
    const parsed = JSON.parse(captured.output);
    assert.equal(parsed.total_evaluated, 2);
  } finally {
    if (oldCore === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = oldCore;
    if (oldEngine === undefined) delete process.env.MEMORY_ENGINE_DB;
    else process.env.MEMORY_ENGINE_DB = oldEngine;
    if (oldOut === undefined) delete process.env.MEMORY_QUALITY_OUTPUT_DIR;
    else process.env.MEMORY_QUALITY_OUTPUT_DIR = oldOut;
  }
});

test("CLI --top is accepted and latest report remains readable", async () => {
  const { corePath, enginePath, root } = createCliFixtureDbs();
  const outputDir = resolve(root, "out");
  const oldCore = process.env.MEMORY_ENGINE_CORE_DB;
  const oldEngine = process.env.MEMORY_ENGINE_DB;
  const oldOut = process.env.MEMORY_QUALITY_OUTPUT_DIR;
  process.env.MEMORY_ENGINE_CORE_DB = corePath;
  process.env.MEMORY_ENGINE_DB = enginePath;
  process.env.MEMORY_QUALITY_OUTPUT_DIR = outputDir;
  try {
    const result = await runMemoryQualityEval({
      scope: "active-memory",
      includeArchived: false,
      includeStatsHistory: false,
      top: 1,
      pathFamily: null,
      category: null,
      pathPrefix: null,
      json: false,
    });
    assert.equal(result.summary.total_evaluated, 1);
    const markdown = readFileSync(resolve(outputDir, "latest.md"), "utf8");
    assert.equal(markdown.includes("## Worst Memories"), true);
  } finally {
    if (oldCore === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = oldCore;
    if (oldEngine === undefined) delete process.env.MEMORY_ENGINE_DB;
    else process.env.MEMORY_ENGINE_DB = oldEngine;
    if (oldOut === undefined) delete process.env.MEMORY_QUALITY_OUTPUT_DIR;
    else process.env.MEMORY_QUALITY_OUTPUT_DIR = oldOut;
  }
});

test("CLI supports --path-family episodes and dreaming", async () => {
  const { corePath, enginePath, root } = createCliFixtureDbs();
  const outputDir = resolve(root, "out");
  const oldCore = process.env.MEMORY_ENGINE_CORE_DB;
  const oldEngine = process.env.MEMORY_ENGINE_DB;
  const oldOut = process.env.MEMORY_QUALITY_OUTPUT_DIR;
  process.env.MEMORY_ENGINE_CORE_DB = corePath;
  process.env.MEMORY_ENGINE_DB = enginePath;
  process.env.MEMORY_QUALITY_OUTPUT_DIR = outputDir;
  try {
    const episodes = await runMemoryQualityEval({
      scope: "active-memory",
      includeArchived: false,
      includeStatsHistory: false,
      top: 5,
      pathFamily: "episodes",
      category: null,
      pathPrefix: null,
      json: false,
    });
    assert.equal(episodes.summary.total_evaluated, 1);

    const dreaming = await runMemoryQualityEval({
      scope: "active-memory",
      includeArchived: false,
      includeStatsHistory: false,
      top: 5,
      pathFamily: "dreaming",
      category: null,
      pathPrefix: null,
      json: false,
    });
    assert.equal(dreaming.summary.total_evaluated, 0);
  } finally {
    if (oldCore === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = oldCore;
    if (oldEngine === undefined) delete process.env.MEMORY_ENGINE_DB;
    else process.env.MEMORY_ENGINE_DB = oldEngine;
    if (oldOut === undefined) delete process.env.MEMORY_QUALITY_OUTPUT_DIR;
    else process.env.MEMORY_QUALITY_OUTPUT_DIR = oldOut;
  }
});

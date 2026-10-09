import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const stats = require("../bin/memory-stats.js");
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const NIGHTLY = join(repoRoot, "bin/nightly-maintenance-command.cjs");
const WEEKLY = join(repoRoot, "bin/memory-weekly-stats.js");

function makeOpenClawLayout(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const openclawDir = join(root, ".openclaw");
  const workspaceDir = join(openclawDir, "workspace");
  const coreDbPath = join(openclawDir, "agents/main/agent/openclaw-agent.sqlite");
  const engineDbPath = join(openclawDir, "memory/memory-engine/memory-engine.sqlite");
  mkdirSync(join(openclawDir, "agents/main/agent"), { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  return {
    root,
    openclawDir,
    workspaceDir,
    coreDbPath,
    engineDbPath,
    legacyCoreDbPath: join(openclawDir, "memory/main.sqlite"),
  };
}

function createCurrentCore(coreDbPath, { id = "current-1", path = "memory/current.md" } = {}) {
  const db = new Database(coreDbPath);
  try {
    db.exec(`
      CREATE TABLE memory_index_chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'memory',
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        hash TEXT NOT NULL,
        model TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE memory_index_chunks_fts USING fts5(
        id UNINDEXED,
        text,
        path UNINDEXED
      );
      CREATE TABLE memory_index_sources (path TEXT PRIMARY KEY);
      CREATE TABLE memory_embedding_cache (hash TEXT PRIMARY KEY, embedding TEXT);
    `);
    db.prepare(`
      INSERT INTO memory_index_chunks
        (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
      VALUES (?, ?, 'memory', 10, 12, 'hash-current', 'current-model', ?, '[0.1,0.2]', ?)
    `).run(id, path, "current OpenClaw memory", Date.now());
    db.prepare(
      "INSERT INTO memory_index_chunks_fts (id, text, path) VALUES (?, ?, ?)",
    ).run(id, "current OpenClaw memory", path);
  } finally {
    db.close();
  }
}

function createEngine(engineDbPath, { withEvent = false } = {}) {
  mkdirSync(resolve(engineDbPath, ".."), { recursive: true });
  const db = new Database(engineDbPath);
  try {
    db.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        confidence REAL NOT NULL DEFAULT 0.5,
        last_confidence_update INTEGER,
        base_tau REAL NOT NULL DEFAULT 7,
        hit_count INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        is_protected INTEGER NOT NULL DEFAULT 0,
        conflict_flag INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'raw_log',
        kg_data TEXT
      );
      CREATE TABLE memory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        memory_id TEXT,
        source TEXT,
        metadata_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.prepare(`
      INSERT INTO memory_confidence
        (chunk_id, confidence, last_confidence_update, base_tau, hit_count, category)
      VALUES ('current-1', 0.75, ?, 7, 3, 'project')
    `).run(Math.floor(Date.now() / 1000));
    if (withEvent) {
      db.prepare(`
        INSERT INTO memory_events
          (event_type, memory_id, source, metadata_json, created_at)
        VALUES ('auto_recall_debug', 'current-1', 'fixture', ?, ?)
      `).run(JSON.stringify({
        gate_decisions: [{ id: "current-1", category: "project" }],
        post_rerank_topK: [{ id: "current-1", category: "project" }],
        candidate_count: 1,
        candidate_count_before_gate: 1,
        candidate_count_after_gate: 1,
        injected_count: 1,
        vector_ms: 3,
      }), new Date().toISOString());
    }
  } finally {
    db.close();
  }
}

function fileDigest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function cleanPathEnv(layout) {
  const env = { ...process.env };
  for (const key of [
    "MEMORY_ENGINE_CORE_DB_PATH",
    "MEMORY_ENGINE_CORE_DB",
    "CORE_DB_PATH",
    "MEMORY_ENGINE_DB_PATH",
    "MEMORY_ENGINE_DB",
    "ENGINE_DB_PATH",
    "OPENCLAW_WORKSPACE",
    "MEMORY_ENGINE_WORKSPACE_DIR",
    "MEMORY_ENGINE_KG_PATH",
  ]) delete env[key];
  env.OPENCLAW_HOME = layout.openclawDir;
  env.OPENCLAW_AGENT_ID = "main";
  return env;
}

test("nightly dry-run resolves the current agent Core DB by default", () => {
  const layout = makeOpenClawLayout("memory-engine-nightly-current-core-");
  try {
    createCurrentCore(layout.coreDbPath);
    createEngine(layout.engineDbPath);
    const result = spawnSync(process.execPath, [NIGHTLY, "--dry-run"], {
      env: cleanPathEnv(layout),
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    if (!result.stdout.trim()) {
      throw new Error(JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message, stderr: result.stderr }));
    }
    const output = JSON.parse(result.stdout);
    assert.equal(output.core_db, layout.coreDbPath);
    assert.equal(existsSync(layout.legacyCoreDbPath), false);
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("daily stats reads current Core dialect and writes health only to Engine", async () => {
  const layout = makeOpenClawLayout("memory-engine-daily-current-core-");
  try {
    createCurrentCore(layout.coreDbPath);
    const before = fileDigest(layout.coreDbPath);
    const result = await stats.main({
      homeDir: layout.root,
      env: { OPENCLAW_HOME: layout.openclawDir },
      dateStr: "2026-10-09",
      timeZone: "UTC",
    });

    assert.equal(result.runtime.coreDbPath, layout.coreDbPath);
    assert.equal(fileDigest(layout.coreDbPath), before);
    assert.equal(existsSync(layout.legacyCoreDbPath), false);

    const core = new Database(layout.coreDbPath, { readonly: true, fileMustExist: true });
    try {
      assert.equal(core.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('memory_daily_stats', 'memory_engine_events')",
      ).get().count, 0);
    } finally {
      core.close();
    }

    const engine = new Database(layout.engineDbPath, { readonly: true, fileMustExist: true });
    try {
      assert.equal(engine.prepare(
        "SELECT value FROM memory_daily_stats WHERE date = '2026-10-09' AND metric = 'health.with_embedding'",
      ).get().value, 1);
    } finally {
      engine.close();
    }
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("weekly stats reads chunk paths from current Core and categories/events from Engine", () => {
  const layout = makeOpenClawLayout("memory-engine-weekly-current-core-");
  try {
    createCurrentCore(layout.coreDbPath, { path: "memory/current-core.md" });
    createEngine(layout.engineDbPath, { withEvent: true });
    const before = fileDigest(layout.coreDbPath);
    const result = spawnSync(process.execPath, [WEEKLY], {
      env: cleanPathEnv(layout),
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(readFileSync(join(layout.workspaceDir, "memory/stats-history.md"), "utf8"), /memory\/current-core\.md/);
    assert.match(readFileSync(join(layout.workspaceDir, "memory/stats-history.md"), "utf8"), /project: 1 条/);
    assert.equal(fileDigest(layout.coreDbPath), before);
    assert.equal(existsSync(layout.legacyCoreDbPath), false);
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("maintenance commands retire the legacy default Core path contract", () => {
  for (const relativePath of [
    "bin/nightly-maintenance-command.cjs",
    "bin/memory-stats.js",
    "bin/memory-weekly-stats.js",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /\.openclaw\/memory\/main\.sqlite/);
    assert.match(source, /resolveMemoryEnginePaths/);
  }
});

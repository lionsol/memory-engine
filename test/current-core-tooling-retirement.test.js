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
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { detectCoreStoreDialect, getCoreFtsReference } from "../lib/db/core-store.js";
import { openCoreDbReadonly } from "../lib/db/isolated-dbs.js";
import { runSmartAddPropagationAudit } from "../lib/quality/smart-add-propagation-audit.js";
import { auditStaleQuarantinedChunks } from "../lib/quality/stale-quarantined-chunk-cleanup.js";
import {
  collectConfirmedLegacySingletonStaleCleanupDryRun,
} from "../lib/quality/confirmed-legacy-singleton-stale-cleanup.js";

const require = createRequire(import.meta.url);
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const qualityCli = require("../bin/memory-quality-eval.js");
const rescueCli = require("../bin/export-archived-raw-log-rescue-candidates.cjs");

const CURRENT_CORE_DEFAULT_FILES = [
  "bin/memory-quality-eval.js",
  "bin/cleanup-orphan-confidence.js",
  "lib/quality/chunks-without-confidence-audit.js",
  "lib/quality/smart-add-propagation-audit.js",
  "lib/quality/stale-quarantined-chunk-cleanup.js",
  "lib/quality/confirmed-legacy-singleton-stale-cleanup.js",
  "bin/export-archived-raw-log-rescue-candidates.cjs",
  "bin/backfill-lancedb.js",
  "bin/memory-benchmark.js",
  "bin/cleanup-confirmed-smart-add-propagation-stale-chunks.js",
  "bin/cleanup-stale-quarantined-chunks.js",
];

const PATH_AUTHORITY_FILES = CURRENT_CORE_DEFAULT_FILES.slice(0, 9);
const HELP_ONLY_FILES = CURRENT_CORE_DEFAULT_FILES.slice(9);

const INTENTIONAL_LEGACY_ALLOWLIST = [
  "lib/runtime/paths.cjs",
];

function makeLayout() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-current-tooling-"));
  const openclawDir = join(root, ".openclaw");
  const workspaceDir = join(openclawDir, "workspace");
  const coreDbPath = join(openclawDir, "agents/main/agent/openclaw-agent.sqlite");
  const engineDbPath = join(openclawDir, "memory/memory-engine/memory-engine.sqlite");
  const legacyCoreDbPath = join(openclawDir, "memory/main.sqlite");
  mkdirSync(join(openclawDir, "agents/main/agent"), { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  return {
    root,
    openclawDir,
    workspaceDir,
    memoryDir: join(workspaceDir, "memory"),
    coreDbPath,
    engineDbPath,
    legacyCoreDbPath,
  };
}

const CORE_ROWS = [
  {
    id: "aaaaaaaaaaaaaaaa-quality",
    path: "memory/episodes/current.md",
    text: "current quality memory",
  },
  {
    id: "bbbbbbbbbbbbbbbb-daily",
    path: "memory/daily.md",
    text: "stale singleton daily memory",
  },
  {
    id: "cccccccccccccccc-quarantine",
    path: "memory/2026-06-20.md",
    text: "quarantined legacy daily mirror",
  },
  {
    id: "dddddddddddddddd-smart",
    path: "memory/smart-add/2026-06-24.md",
    text: "OpenCode provider env prefix important decision",
  },
  {
    id: "eeeeeeeeeeeeeeee-rescue",
    path: "memory/smart-add/2026-10-09.md",
    text: "important project decision for memory-engine",
  },
];

function createCurrentCore(path) {
  const db = new Database(path);
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
        text,
        id UNINDEXED,
        path UNINDEXED,
        source UNINDEXED,
        model UNINDEXED,
        start_line UNINDEXED,
        end_line UNINDEXED
      );
      CREATE TABLE memory_index_sources (path TEXT PRIMARY KEY);
      CREATE TABLE memory_embedding_cache (hash TEXT PRIMARY KEY, embedding TEXT);
    `);

    const insertChunk = db.prepare(`
      INSERT INTO memory_index_chunks
        (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
      VALUES (?, ?, 'memory', 1, 3, ?, 'fixture-model', ?, '[0.1,0.2]', ?)
    `);
    const insertFts = db.prepare(`
      INSERT INTO memory_index_chunks_fts
        (text, id, path, source, model, start_line, end_line)
      VALUES (?, ?, ?, 'memory', 'fixture-model', 1, 3)
    `);
    for (const [index, row] of CORE_ROWS.entries()) {
      insertChunk.run(row.id, row.path, `hash-${index}`, row.text, index + 1);
      insertFts.run(row.text, row.id, row.path);
    }
  } finally {
    db.close();
  }
}

function createEngine(path) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const db = new Database(path);
  try {
    db.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        initial_confidence REAL NOT NULL DEFAULT 0.5,
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
        session_id TEXT,
        trace_id TEXT,
        memory_id TEXT,
        latency_ms REAL,
        candidate_count INTEGER,
        injected_count INTEGER,
        cited_count INTEGER,
        vector_score REAL,
        fts_score REAL,
        final_score REAL,
        source TEXT,
        metadata_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const insertConfidence = db.prepare(`
      INSERT INTO memory_confidence
        (chunk_id, initial_confidence, confidence, last_confidence_update,
         base_tau, hit_count, is_archived, category)
      VALUES (?, 0.5, ?, ?, 7, ?, ?, ?)
    `);
    insertConfidence.run(CORE_ROWS[0].id, 0.8, Math.floor(Date.now() / 1000), 2, 0, "episodic");
    insertConfidence.run(CORE_ROWS[4].id, 0.2, Math.floor(Date.now() / 1000), 0, 1, "raw_log");

    const insertEvent = db.prepare(`
      INSERT INTO memory_events
        (event_type, session_id, trace_id, memory_id, source, metadata_json)
      VALUES (?, 'session-1', 'trace-1', ?, 'fixture', '{}')
    `);
    insertEvent.run("memory_candidate_retrieved", CORE_ROWS[0].id);
    insertEvent.run("memory_injected", CORE_ROWS[0].id);
  } finally {
    db.close();
  }
}

function seedWorkspace(layout) {
  const smartAddDir = join(layout.memoryDir, "smart-add");
  const quarantineDir = join(layout.memoryDir, "legacy-daily-mirrors");
  mkdirSync(smartAddDir, { recursive: true });
  mkdirSync(quarantineDir, { recursive: true });
  writeFileSync(join(smartAddDir, "2026-06-24.md"), [
    "# Smart Added Memory",
    "",
    "## 2026-06-23_episodic_nightly_generated_091523",
    "",
    "Category: episodic",
    "",
    "修复了 opencode provider env: 前缀问题。",
    "",
  ].join("\n"));
  writeFileSync(join(quarantineDir, "2026-06-20.md"), "quarantined mirror");
  writeFileSync(
    join(quarantineDir, "quarantine-log.jsonl"),
    `${JSON.stringify({
      moved_at: "2026-06-24T00:00:00.000Z",
      moved_from: "memory/2026-06-20.md",
      moved_to: "memory/legacy-daily-mirrors/2026-06-20.md",
      reason: "legacy_daily_mirror_candidate",
    })}\n`,
  );
}

async function withCurrentEnvironment(layout, fn) {
  const keys = [
    "OPENCLAW_HOME",
    "OPENCLAW_AGENT_ID",
    "OPENCLAW_WORKSPACE",
    "MEMORY_ENGINE_WORKSPACE_DIR",
    "MEMORY_ENGINE_CORE_DB_PATH",
    "MEMORY_ENGINE_CORE_DB",
    "CORE_DB_PATH",
    "MEMORY_ENGINE_DB_PATH",
    "MEMORY_ENGINE_DB",
    "ENGINE_DB_PATH",
  ];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.OPENCLAW_HOME = layout.openclawDir;
  process.env.OPENCLAW_AGENT_ID = "main";
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertCurrentCoreContract(layout) {
  assert.equal(existsSync(layout.coreDbPath), true);
  assert.equal(existsSync(layout.legacyCoreDbPath), false);
  const db = openCoreDbReadonly({
    coreDbPath: layout.coreDbPath,
    engineDbPath: layout.engineDbPath,
  });
  try {
    assert.equal(detectCoreStoreDialect(db).dialect, "openclaw_memory_index");
    assert.equal(getCoreFtsReference(db).from, "memory_index_chunks_fts");
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM chunks").get().c, CORE_ROWS.length);
  } finally {
    db.close();
  }
}

test("current Core tooling has no retired legacy default", () => {
  assert.deepEqual(INTENTIONAL_LEGACY_ALLOWLIST, ["lib/runtime/paths.cjs"]);
  for (const relativePath of CURRENT_CORE_DEFAULT_FILES) {
    const source = readFileSync(resolve(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /(?:\.openclaw\/)?memory\/main\.sqlite/);
  }
  for (const relativePath of PATH_AUTHORITY_FILES) {
    const source = readFileSync(resolve(repoRoot, relativePath), "utf8");
    assert.match(source, /resolveMemoryEnginePaths|openCoreDbReadonly|PATHS\.coreDbPath|paths\.coreDbPath/);
  }
  for (const relativePath of HELP_ONLY_FILES) {
    const source = readFileSync(resolve(repoRoot, relativePath), "utf8");
    assert.match(source, /shared current Core resolver/);
  }
  for (const relativePath of INTENTIONAL_LEGACY_ALLOWLIST) {
    assert.equal(existsSync(resolve(repoRoot, relativePath)), true);
  }
});

test("current-dialect operational tools resolve Core without creating legacy main.sqlite", async () => {
  const layout = makeLayout();
  createCurrentCore(layout.coreDbPath);
  createEngine(layout.engineDbPath);
  seedWorkspace(layout);
  const before = digest(layout.coreDbPath);

  try {
    await withCurrentEnvironment(layout, async () => {
      assertCurrentCoreContract(layout);

      const quality = await qualityCli.runMemoryQualityEval({
        outputDir: join(layout.root, "quality-output"),
        scope: "all",
        includeArchived: true,
        top: 5,
      });
      assert.ok(quality.summary.total_evaluated >= 1);

      const originalCwd = process.cwd();
      process.chdir(layout.root);
      let orphanCli;
      try {
        const modulePath = resolve(repoRoot, "bin/cleanup-orphan-confidence.js");
        delete require.cache[require.resolve(modulePath)];
        orphanCli = require(modulePath);
        const orphan = await orphanCli.runCleanupOrphanConfidenceCli([
          "--json",
          "--sample-limit",
          "5",
        ]);
        assert.equal(orphan.summary.core_db_path, layout.coreDbPath);
        assert.equal(orphan.summary.mode, "dry-run");
      } finally {
        process.chdir(originalCwd);
      }

      const smart = runSmartAddPropagationAudit({
        rootDir: layout.workspaceDir,
        memoryDir: layout.memoryDir,
      });
      assert.equal(
        smart.core_db_path,
        layout.coreDbPath.replaceAll("\\", "/").replace(/^\/+/, ""),
      );
      assert.ok(smart.summary.stale_index_cleanup_chunk_count >= 1);
      assert.ok(smart.remediation.stale_index_cleanup_candidates[0].fts_row_count >= 1);

      const stale = auditStaleQuarantinedChunks({
        rootDir: layout.workspaceDir,
        memoryDir: layout.memoryDir,
      });
      assert.equal(stale.core_db_path, layout.coreDbPath);
      assert.equal(stale.would_delete_chunk_count, 1);
      assert.equal(stale.would_delete_fts_row_count, 1);

      const confirmed = collectConfirmedLegacySingletonStaleCleanupDryRun({
        rootDir: layout.workspaceDir,
        memoryDir: layout.memoryDir,
      });
      assert.equal(confirmed.preflight_passed, true);
      assert.deepEqual(confirmed.would_delete, {
        core_chunks: 1,
        core_chunks_fts: 1,
        engine_memory_confidence: 0,
      });

      const rescueOutput = join(layout.root, "rescue.jsonl");
      const originalArgv = process.argv;
      process.argv = [
        process.execPath,
        resolve(repoRoot, "bin/export-archived-raw-log-rescue-candidates.cjs"),
        "--keywords", "important",
        "--limit", "10",
        "--out", rescueOutput,
      ];
      try {
        await rescueCli.main();
      } finally {
        process.argv = originalArgv;
      }
      assert.match(readFileSync(rescueOutput, "utf8"), /eeeeeeeeeeeeeeee-rescue/);
    });

    assert.equal(digest(layout.coreDbPath), before);
    assertCurrentCoreContract(layout);
    assert.equal(existsSync(layout.legacyCoreDbPath), false);
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("backfill and benchmark source contracts use shared Core/Lance/FTS access without execution", () => {
  const backfill = readFileSync(resolve(repoRoot, "bin/backfill-lancedb.js"), "utf8");
  assert.match(backfill, /resolveMemoryEnginePaths/);
  assert.match(backfill, /openCoreDbReadonly/);
  assert.match(backfill, /canonical Core chunks view/);
  assert.doesNotMatch(backfill, /memory\/main\.sqlite/);

  const benchmark = readFileSync(resolve(repoRoot, "bin/memory-benchmark.js"), "utf8");
  assert.match(benchmark, /resolveMemoryEnginePaths/);
  assert.match(benchmark, /getCoreFtsReference/);
  assert.match(benchmark, /ensureCoreStoreCompatibility/);
  assert.doesNotMatch(benchmark, /chunks_fts/);
});

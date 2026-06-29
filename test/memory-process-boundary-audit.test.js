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
import memoryProcessBoundaryCli from "../bin/audit-memory-process-boundary.js";
import {
  renderMemoryProcessBoundaryMarkdown,
  runMemoryProcessBoundaryAudit,
  resolveAuditSince,
} from "../lib/quality/memory-process-boundary-audit.js";

const { parseArgs, main } = memoryProcessBoundaryCli;

function createFixture({ dreamingMtimeMs = null } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "memory-process-boundary-"));
  const corePath = resolve(root, "core.sqlite");
  const engineDir = resolve(root, "engine");
  const enginePath = resolve(engineDir, "memory-engine.sqlite");
  const configPath = resolve(root, "openclaw.json");
  mkdirSync(engineDir, { recursive: true });

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
      CREATE TABLE files (
        path TEXT PRIMARY KEY,
        source TEXT,
        mtime INTEGER
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
      "aaaaaaaaaaaaaaaa-1",
      "memory/smart-add/2026-06-29.md",
      "memory",
      "durable smart-add fact",
      Date.parse("2026-06-29T01:00:00.000Z"),
      1,
      3,
      "hash-a",
    );
    coreDb.prepare(`
      INSERT INTO chunks (id, path, source, text, updated_at, start_line, end_line, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "bbbbbbbbbbbbbbbb-1",
      "memory/2026-06-28.md",
      "memory",
      "manual daily note",
      Date.parse("2026-06-28T22:00:00.000Z"),
      1,
      3,
      "hash-b",
    );

    coreDb.prepare(`
      INSERT INTO files (path, source, mtime) VALUES (?, ?, ?)
    `).run("memory/smart-add/2026-06-29.md", "memory", Date.parse("2026-06-29T01:00:00.000Z"));
    coreDb.prepare(`
      INSERT INTO files (path, source, mtime) VALUES (?, ?, ?)
    `).run("memory/2026-06-28.md", "memory", Date.parse("2026-06-28T22:00:00.000Z"));

    if (dreamingMtimeMs !== null) {
      coreDb.prepare(`
        INSERT INTO chunks (id, path, source, text, updated_at, start_line, end_line, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "cccccccccccccccc-1",
        "memory/dreaming/2026-06-29.md",
        "memory",
        "dreaming artifact",
        dreamingMtimeMs,
        1,
        3,
        "hash-c",
      );
      coreDb.prepare(`
        INSERT INTO files (path, source, mtime) VALUES (?, ?, ?)
      `).run("memory/dreaming/2026-06-29.md", "memory", dreamingMtimeMs);
    }

    engineDb.prepare(`
      INSERT INTO memory_confidence
      (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("aaaaaaaaaaaaaaaa-1", 0.8, 0.9, 1782694800, 30, 2, 0, 0, 0, "episodic", null);

    engineDb.prepare(`
      INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, source, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "memory_injected",
      "session-1",
      "trace-1",
      "bbbbbbbbbbbbbbbb",
      "autoRecall",
      JSON.stringify({
        path: "memory/2026-06-28.md",
        category: "raw_log",
        source_type: "memory",
        id: "bbbbbbbbbbbbbbbb-1",
      }),
      "2026-06-29 02:40:00",
    );
  } finally {
    coreDb.close();
    engineDb.close();
  }

  writeFileSync(configPath, JSON.stringify({
    tools: {
      deny: [],
    },
    plugins: {
      slots: {},
      entries: {
        "active-memory": {
          enabled: false,
        },
        "memory-engine": {
          config: {
            autoRecall: {
              enabled: false,
            },
          },
        },
      },
    },
  }, null, 2));

  return { root, corePath, enginePath, configPath };
}

async function withFixtureEnv(fixture, fn) {
  const oldCore = process.env.MEMORY_ENGINE_CORE_DB;
  const oldEngine = process.env.MEMORY_ENGINE_DB;
  const oldEnginePath = process.env.MEMORY_ENGINE_DB_PATH;
  const oldConfig = process.env.OPENCLAW_CONFIG_PATH;
  process.env.MEMORY_ENGINE_CORE_DB = fixture.corePath;
  process.env.MEMORY_ENGINE_DB = fixture.enginePath;
  process.env.MEMORY_ENGINE_DB_PATH = fixture.enginePath;
  process.env.OPENCLAW_CONFIG_PATH = fixture.configPath;
  try {
    return await fn();
  } finally {
    if (oldCore === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = oldCore;
    if (oldEngine === undefined) delete process.env.MEMORY_ENGINE_DB;
    else process.env.MEMORY_ENGINE_DB = oldEngine;
    if (oldEnginePath === undefined) delete process.env.MEMORY_ENGINE_DB_PATH;
    else process.env.MEMORY_ENGINE_DB_PATH = oldEnginePath;
    if (oldConfig === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
    else process.env.OPENCLAW_CONFIG_PATH = oldConfig;
  }
}

async function captureConsole(fn) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => {
    logs.push(args.join(" "));
  };
  console.error = (...args) => {
    errors.push(args.join(" "));
  };
  try {
    const result = await fn();
    return { result, output: logs.join("\n"), error: errors.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("parseArgs accepts supported options", () => {
  const parsed = parseArgs([
    "--markdown",
    "--since", "2026-06-29T03:00:00+08:00",
    "--out", "reports/audit.md",
  ]);

  assert.deepEqual(parsed, {
    json: false,
    markdown: true,
    since: "2026-06-29T03:00:00+08:00",
    out: "reports/audit.md",
    help: false,
  });
});

test("parseArgs rejects conflicting output flags", () => {
  assert.throws(() => parseArgs(["--json", "--markdown"]), /choose exactly one output format/);
});

test("resolveAuditSince defaults to latest local 03:00 boundary", () => {
  const resolved = resolveAuditSince(null, {
    now: new Date("2026-06-29T04:15:00+08:00"),
  });
  assert.equal(resolved.source, "default_latest_local_03_00_boundary");
  assert.equal(resolved.iso, "2026-06-28T19:00:00.000Z");
});

test("audit passes without new dreaming files and keeps historical non-lifecycle injection as warning", async () => {
  const fixture = createFixture();
  await withFixtureEnv(fixture, async () => {
    const report = await runMemoryProcessBoundaryAudit({
      now: new Date("2026-06-29T04:15:00+08:00"),
    });

    assert.equal(report.status, "pass");
    assert.equal(report.since.iso, "2026-06-28T19:00:00.000Z");
    assert.equal(report.dreaming_files_since_boundary.count, 0);
    assert.equal(report.non_lifecycle_recall_warning_summary.status, "warning");
    assert.equal(report.non_lifecycle_recall_warning_summary.historical_non_lifecycle_injected_count, 1);
    assert.equal(report.side_effects.db_writes, false);
    assert.equal(report.side_effects.archive, false);
  });
});

test("audit fails when new dreaming files exist since boundary", async () => {
  const fixture = createFixture({
    dreamingMtimeMs: Date.parse("2026-06-29T03:30:00+08:00"),
  });
  await withFixtureEnv(fixture, async () => {
    const report = await runMemoryProcessBoundaryAudit({
      now: new Date("2026-06-29T04:15:00+08:00"),
    });

    assert.equal(report.status, "fail");
    assert.deepEqual(report.boundary_failures, ["dreaming_mismatch"]);
    assert.equal(report.dreaming_files_since_boundary.count, 1);
    assert.equal(report.dreaming_files_since_boundary.files[0].path, "memory/dreaming/2026-06-29.md");
  });
});

test("audit fails when active-memory is detectably enabled", async () => {
  const fixture = createFixture();
  writeFileSync(fixture.configPath, JSON.stringify({
    tools: {
      deny: [],
    },
    plugins: {
      slots: {},
      entries: {
        "active-memory": {
          enabled: true,
        },
        "memory-engine": {
          config: {
            autoRecall: {
              enabled: false,
            },
          },
        },
      },
    },
  }, null, 2));

  await withFixtureEnv(fixture, async () => {
    const report = await runMemoryProcessBoundaryAudit({
      now: new Date("2026-06-29T04:15:00+08:00"),
    });

    assert.equal(report.status, "fail");
    assert.deepEqual(report.boundary_failures, ["active_memory_mismatch"]);
    const activeMemory = report.config.observations.find(item => item.key === "active_memory");
    assert.equal(activeMemory.status, "mismatch");
  });
});

test("markdown rendering includes baseline, dreaming section, and side effects", async () => {
  const fixture = createFixture({
    dreamingMtimeMs: Date.parse("2026-06-29T03:30:00+08:00"),
  });
  await withFixtureEnv(fixture, async () => {
    const report = await runMemoryProcessBoundaryAudit({
      now: new Date("2026-06-29T04:15:00+08:00"),
    });
    const markdown = renderMemoryProcessBoundaryMarkdown(report);

    assert.equal(markdown.includes("## Expected Baseline"), true);
    assert.equal(markdown.includes("## Dreaming Files Since Boundary"), true);
    assert.equal(markdown.includes("memory/dreaming/2026-06-29.md"), true);
    assert.equal(markdown.includes("## Side Effects"), true);
  });
});

test("CLI --help exits cleanly", async () => {
  const captured = await captureConsole(() => main(["--help"]));
  assert.equal(captured.result, 0);
  assert.equal(captured.output.includes("Memory Process Boundary Audit"), true);
  assert.equal(captured.output.includes("--since <time>"), true);
});

test("CLI writes selected output to --out path", async () => {
  const fixture = createFixture();
  const outPath = resolve(fixture.root, "reports", "boundary-audit.json");
  await withFixtureEnv(fixture, async () => {
    const captured = await captureConsole(() => main([
      "--json",
      "--out", outPath,
      "--since", "2026-06-28T19:00:00.000Z",
    ]));

    assert.equal(captured.result, 0);
    assert.equal(existsSync(outPath), true);
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    assert.equal(written.status, "pass");
    assert.equal(JSON.parse(captured.output).status, "pass");
  });
});

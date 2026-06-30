import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import unknownMemoryPathCli from "../bin/audit-unknown-memory-paths.js";
import {
  buildUnknownMemoryPathAudit,
  renderUnknownMemoryPathMarkdown,
} from "../lib/quality/unknown-memory-path-audit.js";

const { parseArgs, main } = unknownMemoryPathCli;
const SYNTHETIC_UNKNOWN_PATH = "memory/custom/odd.md";

function createFixtureDb() {
  const root = mkdtempSync(resolve(tmpdir(), "unknown-memory-path-audit-"));
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
        text TEXT,
        updated_at INTEGER,
        start_line INTEGER,
        end_line INTEGER,
        hash TEXT
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
      )
    `);

    const insertChunk = coreDb.prepare(`
      INSERT INTO chunks (id, path, source, text, updated_at, start_line, end_line, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertChunk.run("unknown-1", SYNTHETIC_UNKNOWN_PATH, "memory", "orphan unknown memory path", 1782698400000, 1, 2, "h1");
    insertChunk.run("smart-1", "memory/smart-add/2026-06-29.md", "memory", "smart add", 1782698401000, 1, 2, "h2");
    insertChunk.run("episode-1", "memory/episodes/2026-06-29.md", "memory", "episode", 1782698402000, 1, 2, "h3");
    insertChunk.run("dream-1", "memory/dreaming/2026-06-29.md", "memory", "dream", 1782698403000, 1, 2, "h4");
    insertChunk.run("daily-root-1", "memory/2026-06-29.md", "memory", "daily root", 1782698404000, 1, 2, "h5");
    insertChunk.run("memory-root-1", "MEMORY.md", "memory", "memory root", 1782698405000, 1, 2, "h6");

    const insertConfidence = engineDb.prepare(`
      INSERT INTO memory_confidence
      (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertConfidence.run("smart-1", 0.7, 0.8, 1782698401, 30, 1, 0, 0, 0, "episodic", null);

    const insertEvent = engineDb.prepare(`
      INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, source, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertEvent.run(
      "memory_candidate_retrieved",
      "s1",
      "t1",
      "unknown-1",
      "audit-test",
      JSON.stringify({ path: SYNTHETIC_UNKNOWN_PATH, id: "unknown-1" }),
      "2026-06-29 01:00:00",
    );
  } finally {
    coreDb.close();
    engineDb.close();
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

function buildCandidate(overrides = {}) {
  return {
    id: "unknown-1",
    path: SYNTHETIC_UNKNOWN_PATH,
    path_family: "memory-other",
    quality_scope_owner: "unknown",
    quality_scope_family: "unknown",
    expected_confidence: true,
    has_confidence_record: false,
    category: null,
    retrieved_count: 0,
    injected_count: 0,
    last_retrieved_at: null,
    last_injected_at: null,
    text: "legacy unknown memory path",
    ...overrides,
  };
}

test("parseArgs accepts supported flags", () => {
  assert.deepEqual(parseArgs(["--json"]), {
    help: false,
    json: true,
    markdown: false,
    out: null,
    includeArchived: false,
    sampleLimit: 20,
  });
  assert.deepEqual(parseArgs(["--markdown", "--out", "/tmp/report.md", "--include-archived", "--sample-limit", "7"]), {
    help: false,
    json: false,
    markdown: true,
    out: "/tmp/report.md",
    includeArchived: true,
    sampleLimit: 7,
  });
});

test("parseArgs rejects unknown or destructive flags and conflicting formats", () => {
  assert.throws(() => parseArgs(["--wat"]), /unknown argument/);
  assert.throws(() => parseArgs(["--json", "--markdown"]), /choose exactly one output format/);
  assert.throws(() => parseArgs(["--fix"]), /unsupported destructive flag/);
  assert.throws(() => parseArgs(["--delete"]), /unsupported destructive flag/);
  assert.throws(() => parseArgs(["--archive"]), /unsupported destructive flag/);
  assert.throws(() => parseArgs(["--quarantine"]), /unsupported destructive flag/);
  assert.throws(() => parseArgs(["--apply"]), /unsupported destructive flag/);
  assert.throws(() => parseArgs(["--write-db"]), /unsupported destructive flag/);
  assert.throws(() => parseArgs(["--backfill-confidence"]), /unsupported destructive flag/);
});

test("CLI --help exits cleanly and prints supported options", async () => {
  const captured = await captureConsole(() => main(["--help"]));
  assert.equal(captured.result, 0);
  assert.equal(captured.output.includes("Unknown Memory Path Audit"), true);
  assert.equal(captured.output.includes("--sample-limit <n>"), true);
});

test("audit filtering includes unknown path and excludes known families", () => {
  const report = buildUnknownMemoryPathAudit({
    candidateSource: {
      candidates: [
        buildCandidate(),
        buildCandidate({
          id: "known-smart-add",
          path: "memory/smart-add/2026-06-29.md",
          path_family: "smart-add",
          quality_scope_owner: "memory_engine_lifecycle",
          quality_scope_family: "smart_add",
          expected_confidence: true,
        }),
        buildCandidate({
          id: "known-daily-root",
          path: "memory/2026-06-29.md",
          path_family: "daily-root",
          quality_scope_owner: "openclaw_core",
          quality_scope_family: "daily_memory",
          expected_confidence: false,
        }),
      ],
    },
  });

  assert.equal(report.summary.unknown_count, 1);
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].path, SYNTHETIC_UNKNOWN_PATH);
});

test("suggested_action becomes manual_review_required for injected, retrieved, or confidence cases", () => {
  const injected = buildUnknownMemoryPathAudit({
    candidateSource: { candidates: [buildCandidate({ injected_count: 1 })] },
  });
  assert.equal(injected.items[0].suggested_action, "manual_review_required");

  const retrieved = buildUnknownMemoryPathAudit({
    candidateSource: { candidates: [buildCandidate({ retrieved_count: 1 })] },
  });
  assert.equal(retrieved.items[0].suggested_action, "manual_review_required");

  const withConfidence = buildUnknownMemoryPathAudit({
    candidateSource: { candidates: [buildCandidate({ has_confidence_record: true })] },
  });
  assert.equal(withConfidence.items[0].suggested_action, "manual_review_required");

  const stale = buildUnknownMemoryPathAudit({
    candidateSource: { candidates: [buildCandidate()] },
  });
  assert.equal(stale.items[0].suggested_action, "safe_to_review_for_stale_index_or_legacy_file");
});

test("safe-action candidate stays read-only with all side effects disabled", () => {
  const report = buildUnknownMemoryPathAudit({
    candidateSource: {
      candidates: [
        buildCandidate({
          retrieved_count: 0,
          injected_count: 0,
          has_confidence_record: false,
        }),
      ],
    },
  });
  assert.equal(report.items[0].suggested_action, "safe_to_review_for_stale_index_or_legacy_file");
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

test("markdown rendering includes unknown item and side effects", () => {
  const report = buildUnknownMemoryPathAudit({
    candidateSource: { candidates: [buildCandidate()] },
  });
  const markdown = renderUnknownMemoryPathMarkdown(report);
  assert.equal(markdown.includes("# Unknown Memory Path Audit"), true);
  assert.equal(markdown.includes(SYNTHETIC_UNKNOWN_PATH), true);
  assert.equal(markdown.includes("## Side Effects"), true);
  assert.equal(markdown.includes("audit_only: true"), true);
});

test("CLI --out writes report file", async () => {
  const fixture = createFixtureDb();
  const outPath = resolve(fixture.root, "unknown-memory-path-audit.json");
  const result = spawnSync(process.execPath, [
    resolve(process.cwd(), "bin/audit-unknown-memory-paths.js"),
    "--json",
    "--out", outPath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      MEMORY_ENGINE_CORE_DB: fixture.corePath,
      MEMORY_ENGINE_DB: fixture.enginePath,
      MEMORY_ENGINE_DB_PATH: fixture.enginePath,
    },
  });

  assert.equal(result.status, 0);
  assert.equal(existsSync(outPath), true);
  const parsed = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(parsed.summary.unknown_count, 1);
});

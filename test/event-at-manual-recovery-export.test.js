import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  exportEventAtManualRecoveryCandidates,
} from "../lib/db/core-chunk-time-migration.js";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const scriptPath = resolve(repoRoot, "bin/export-event-at-manual-recovery-candidates.js");

function hash(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-manual-recovery-export-"));
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  const sessionsDir = resolve(root, "sessions");
  const memoryDir = resolve(root, "memory");
  const reportDir = resolve(root, "reports");
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(reportDir, { recursive: true });

  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'memory',
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        hash TEXT NOT NULL,
        model TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    const insert = coreDb.prepare(`
      INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
      VALUES (?, ?, 'memory', 0, 0, ?, 'test', ?, '', ?)
    `);
    insert.run(
      "manual-user",
      "memory/smart-add/2026-06-01.md",
      "h1",
      `**User:** ${"candidate ".repeat(50)}manual review target`,
      Date.parse("2026-06-15T01:00:00.000Z") / 1000,
    );
    insert.run(
      "manual-assistant",
      "memory/smart-add/2026-06-02.md",
      "h2",
      `**Assistant:** ${"assistant context ".repeat(30)}needs evidence`,
      Date.parse("2026-06-15T02:00:00.000Z") / 1000,
    );
    insert.run(
      "ignore-tool",
      "memory/smart-add/2026-06-03.md",
      "h3",
      `**User:** ${"npm test stdout stderr ".repeat(40)}`,
      Date.parse("2026-06-15T03:00:00.000Z") / 1000,
    );
    insert.run(
      "other-day",
      "memory/smart-add/2026-06-04.md",
      "h4",
      "**User:** should be excluded by date",
      Date.parse("2026-06-14T03:00:00.000Z") / 1000,
    );
  } finally {
    coreDb.close();
  }

  const engineDb = new Database(engineDbPath);
  try {
    engineDb.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        category TEXT NOT NULL DEFAULT 'raw_log'
      )
    `);
    const insertConfidence = engineDb.prepare("INSERT INTO memory_confidence (chunk_id, category) VALUES (?, ?)");
    for (const id of ["manual-user", "manual-assistant", "ignore-tool", "other-day"]) {
      insertConfidence.run(id, "raw_log");
    }
  } finally {
    engineDb.close();
  }

  return { coreDbPath, engineDbPath, sessionsDir, memoryDir, reportDir };
}

test("export defaults to dry-run and only exports manual recovery candidates", () => {
  const fixture = createFixture();
  const outPath = resolve(fixture.reportDir, "candidates.jsonl");
  const summary = exportEventAtManualRecoveryCandidates({
    ...fixture,
    date: "2026-06-15",
    format: "jsonl",
    outPath,
  });

  assert.equal(summary.mode, "dry_run");
  assert.equal(summary.writes_db, false);
  assert.equal(summary.candidate_count, 2);
  const lines = readFileSync(outPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines.every((row) => row.recommended_action === "manual_recovery_candidate"), true);
  assert.equal(lines.some((row) => row.id === "ignore-tool"), false);
});

test("preview is capped by default and no raw full text is exported", () => {
  const fixture = createFixture();
  const outPath = resolve(fixture.reportDir, "preview.jsonl");
  const originalText = `**User:** ${"candidate ".repeat(50)}manual review target`;
  exportEventAtManualRecoveryCandidates({
    ...fixture,
    date: "2026-06-15",
    format: "jsonl",
    outPath,
  });
  const rows = readFileSync(outPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(rows.every((row) => typeof row.preview === "string"), true);
  assert.equal(rows.every((row) => row.preview.length <= 243), true);
  assert.equal(rows.some((row) => row.preview.includes("\n")), false);
  const manualUser = rows.find((row) => row.id === "manual-user");
  assert.equal(manualUser.preview.length < originalText.length, true);
  assert.equal(manualUser.preview.endsWith("..."), true);
});

test("--no-preview removes preview field", () => {
  const fixture = createFixture();
  const outPath = resolve(fixture.reportDir, "no-preview.jsonl");
  const summary = exportEventAtManualRecoveryCandidates({
    ...fixture,
    date: "2026-06-15",
    format: "jsonl",
    outPath,
    includePreview: false,
  });
  assert.equal(summary.preview_chars, 0);
  const rows = readFileSync(outPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal("preview" in rows[0], false);
});

test("markdown output contains summary and not raw full text", () => {
  const fixture = createFixture();
  const outPath = resolve(fixture.reportDir, "candidates.md");
  const originalText = `**User:** ${"candidate ".repeat(50)}manual review target`;
  const summary = exportEventAtManualRecoveryCandidates({
    ...fixture,
    date: "2026-06-15",
    format: "md",
    outPath,
  });
  const content = readFileSync(outPath, "utf8");
  assert.equal(summary.output_path, outPath);
  assert.match(content, /# Event-at Manual Recovery Candidates/);
  assert.match(content, /candidate_count: `2`/);
  assert.equal(content.includes("manual review target"), false);
  assert.equal(content.includes(originalText), false);
});

test("CLI supports jsonl and md output and rejects forbidden flags", () => {
  const fixture = createFixture();
  const jsonlPath = resolve(fixture.reportDir, "cli.jsonl");
  const mdPath = resolve(fixture.reportDir, "cli.md");
  const baseEnv = {
    ...process.env,
    MEMORY_ENGINE_CORE_DB: fixture.coreDbPath,
    MEMORY_ENGINE_DB: fixture.engineDbPath,
    MEMORY_ENGINE_DB_PATH: fixture.engineDbPath,
    MEMORY_ENGINE_SESSIONS_DIR: fixture.sessionsDir,
    MEMORY_ENGINE_MEMORY_DIR: fixture.memoryDir,
  };

  const jsonRun = spawnSync(process.execPath, [scriptPath, "--date", "2026-06-15", "--format", "jsonl", "--out", jsonlPath, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: baseEnv,
  });
  assert.equal(jsonRun.status, 0);
  const jsonSummary = JSON.parse(jsonRun.stdout);
  assert.equal(jsonSummary.candidate_count, 2);

  const mdRun = spawnSync(process.execPath, [scriptPath, "--date", "2026-06-15", "--format", "md", "--out", mdPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: baseEnv,
  });
  assert.equal(mdRun.status, 0);
  assert.equal(readFileSync(mdPath, "utf8").includes("raw_text_exported: `false`"), true);

  for (const flag of ["--apply", "--force", "--write-db", "--no-backup"]) {
    const rejected = spawnSync(process.execPath, [scriptPath, "--date", "2026-06-15", flag], {
      cwd: repoRoot,
      encoding: "utf8",
      env: baseEnv,
    });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /unsupported flag/);
  }
});

test("export does not modify core schema or add event_at columns", () => {
  const fixture = createFixture();
  const outPath = resolve(fixture.reportDir, "schema.jsonl");
  exportEventAtManualRecoveryCandidates({
    ...fixture,
    date: "2026-06-15",
    format: "jsonl",
    outPath,
  });

  const db = new Database(fixture.coreDbPath, { readonly: true, fileMustExist: true });
  try {
    const columns = db.prepare("PRAGMA table_info(chunks)").all().map((row) => row.name);
    assert.equal(columns.includes("event_at"), false);
    assert.equal(columns.includes("created_at"), false);
  } finally {
    db.close();
  }
});

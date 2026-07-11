import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { auditRawLogProvenance } from "../bin/audit-raw-log-provenance.js";

const cli = resolve("bin/audit-raw-log-provenance.js");

function fixture() {
  const dir = mkdtempSync(resolve(tmpdir(), "raw-log-provenance-"));
  const corePath = resolve(dir, "core.sqlite");
  const enginePath = resolve(dir, "engine.sqlite");
  const sessionsDir = resolve(dir, "sessions");
  const memoryDir = resolve(dir, "memory");
  mkdirSync(sessionsDir); mkdirSync(memoryDir);
  const core = new Database(corePath);
  core.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY, path TEXT, source TEXT, start_line INTEGER, end_line INTEGER, hash TEXT, model TEXT, text TEXT, embedding TEXT, updated_at INTEGER)");
  core.close();
  const engine = new Database(enginePath);
  engine.exec("CREATE TABLE memory_confidence (chunk_id TEXT PRIMARY KEY, last_confidence_update INTEGER, category TEXT)");
  engine.close();
  return { dir, corePath, enginePath, sessionsDir, memoryDir };
}
function addRows(f, rows) {
  const core = new Database(f.corePath); const engine = new Database(f.enginePath);
  const insertCore = core.prepare("INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?)");
  const insertEngine = engine.prepare("INSERT INTO memory_confidence VALUES (?, ?, 'raw_log')");
  for (const row of rows) { insertCore.run(row.id, row.path, row.source, row.start_line, row.end_line, row.hash, row.model, row.text, row.updated_at); insertEngine.run(row.id, row.last_confidence_update || row.updated_at); }
  core.close(); engine.close();
}

test("audit filters legacy updated_at date, aggregates provenance, and stays read-only", async () => {
  const f = fixture();
  const text = "fixture session message with provenance evidence";
  const timestamp = "2026-06-15T10:00:00.000+08:00";
  const id = (await import("node:crypto")).createHash("sha256").update(text + timestamp + "2026-06-15").digest("hex");
  addRows(f, [
    { id, path: "memory/smart-add/2026-06-15.md", source: "memory", start_line: 0, end_line: 0, hash: (await import("node:crypto")).createHash("sha256").update(text).digest("hex"), model: "flush-script", text, updated_at: 1781488800 },
    { id: "other", path: "memory/episodes/x.md", source: "memory", start_line: 1, end_line: 2, hash: "hash", model: "checkpoint", text: "other secret text", updated_at: 1781575200 },
  ]);
  writeFileSync(resolve(f.sessionsDir, "one.jsonl"), `${JSON.stringify({ type: "message", timestamp, message: { role: "user", content: [{ type: "text", text }] } })}\n`);
  const report = auditRawLogProvenance({ legacyDate: "2026-06-15", coreDbPath: f.corePath, engineDbPath: f.enginePath, sessionsDir: f.sessionsDir, memoryDir: f.memoryDir });
  assert.equal(report.row_count, 1);
  assert.equal(report.path_breakdown["memory/smart-add/2026-06-15.md"], 1);
  assert.equal(report.model_breakdown["flush-script"], 1);
  assert.equal(report.session_formula_match.matching_chunk_id_count, 1);
  assert.equal(report.writer_inventory_result.dominant_writer_signature, "flush-session-rawlog.js");
  assert.equal(report.writes_db, false);
  assert.equal(report.migration_applied, false);
  assert.equal(JSON.stringify(report).includes(text), false);
});

test("batch write analysis detects same-second and same-minute clustering", async () => {
  const { batchStats } = await import("../bin/audit-raw-log-provenance.js");
  const result = batchStats([100, 100, 100, 101, 101, 102, 180]);
  assert.equal(result.unique_updated_at_count, 4);
  assert.equal(result.largest_same_second_batch, 3);
  assert.equal(result.largest_same_minute_batch, 6);
  assert.equal(result.updated_at_span_seconds, 80);
  assert.equal(result.looks_like_batch_write, false);
});

test("CLI rejects apply and database mutation flags", () => {
  for (const flag of ["--apply", "--force", "--write-db", "--no-backup"]) {
    const result = spawnSync(process.execPath, [cli, flag], { encoding: "utf8" });
    assert.notEqual(result.status, 0, flag);
  }
});

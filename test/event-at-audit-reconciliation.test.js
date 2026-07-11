import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { reconcile } from "../bin/reconcile-event-at-audit-counts.js";

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "event-at-reconciliation-"));
  const coreDbPath = resolve(root, "core.sqlite"); const engineDbPath = resolve(root, "engine.sqlite"); const sessionsDir = resolve(root, "sessions");
  mkdirSync(sessionsDir);
  const core = new Database(coreDbPath); core.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY, text TEXT, updated_at INTEGER)");
  const engine = new Database(engineDbPath); engine.exec("CREATE TABLE memory_confidence (chunk_id TEXT PRIMARY KEY, category TEXT, is_archived INTEGER DEFAULT 0)");
  const rows = [
    ["utc-only", "plain old row", Math.floor(new Date("2026-06-21T20:00:00Z").getTime() / 1000)],
    ["local-only", "[2026-06-21T10:00:00+08:00] text recovery", Math.floor(new Date("2026-06-20T20:00:00Z").getTime() / 1000)],
    ["deleted-match", "deleted session message", Math.floor(new Date("2026-06-21T10:00:00+08:00").getTime() / 1000)],
  ];
  const insertCore = core.prepare("INSERT INTO chunks VALUES (?, ?, ?)"); const insertEngine = engine.prepare("INSERT INTO memory_confidence VALUES (?, 'raw_log', 0)");
  for (const row of rows) { insertCore.run(...row); insertEngine.run(row[0]); }
  const text = rows[2][1]; const timestamp = "2026-06-21T10:00:00+08:00"; const date = "2026-06-21"; const id = createHash("sha256").update(text + timestamp + date).digest("hex");
  core.prepare("UPDATE chunks SET id=? WHERE id='deleted-match'").run(id); engine.prepare("UPDATE memory_confidence SET chunk_id=? WHERE chunk_id='deleted-match'").run(id);
  writeFileSync(resolve(sessionsDir, "session.jsonl.deleted.2026-06-22"), `${JSON.stringify({ type: "message", timestamp, message: { role: "user", content: text } })}\n`);
  core.close(); engine.close();
  return { coreDbPath, engineDbPath, sessionsDir };
}

test("reconciliation keeps UTC migration and local provenance predicates distinct", () => {
  const f = fixture();
  const report = reconcile({ legacyDate: "2026-06-21", ...f });
  assert.equal(report.count_sources[0].joins_memory_confidence, true);
  assert.equal(report.count_sources[0].archived_filter, "none");
  assert.match(report.count_sources[0].predicate_summary, /UTC/);
  assert.match(report.count_sources[1].predicate_summary, /local \+08:00/);
  assert.equal(report.session_scope.deleted_files_included_by_provenance_audit, 1);
  assert.equal(report.session_scope.deleted_files_in_migration_scope, false);
  assert.equal(JSON.stringify(report).includes("deleted session message"), false);
  assert.equal(report.writes_db, false);
  assert.equal(report.migration_applied, false);
});

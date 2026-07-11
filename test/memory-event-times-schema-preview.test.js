import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createMemoryEventTimesTable, inspectMemoryEventTimesSchema, MEMORY_EVENT_TIMES_TABLE } from "../lib/db/memory-event-times.js";
import { previewMemoryEventTimesSchema } from "../bin/preview-memory-event-times-schema.js";

test("schema creates in a temporary engine DB with no core attachment", () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-event-times-schema-"));
  const db = new Database(resolve(root, "engine.sqlite"));
  const before = inspectMemoryEventTimesSchema(db);
  assert.equal(before.exists, false);
  const after = createMemoryEventTimesTable(db);
  assert.equal(after.table, MEMORY_EVENT_TIMES_TABLE);
  assert.equal(after.exists, true);
  assert.equal(after.columns.some((column) => column.name === "event_at"), true);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'").get(), undefined);
  db.close();
});

test("schema preview is read-only and reports whether creation is needed", () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-event-times-preview-"));
  const dbPath = resolve(root, "engine.sqlite"); const db = new Database(dbPath); db.close();
  const report = previewMemoryEventTimesSchema(dbPath);
  assert.equal(report.table, "memory_event_times");
  assert.equal(report.exists, false);
  assert.equal(report.would_create, true);
  assert.equal(report.writes_db, false);
  assert.equal(report.core_db_modified, false);
  const check = new Database(dbPath, { readonly: true });
  assert.equal(check.prepare("SELECT name FROM sqlite_master WHERE name=?").get(MEMORY_EVENT_TIMES_TABLE), undefined);
  check.close();
});

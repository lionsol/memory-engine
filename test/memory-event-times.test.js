import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  MEMORY_EVENT_TIME_WRITE_GUARD,
  createMemoryEventTimesTable,
  getMemoryEventTime,
  listMemoryEventTimes,
  normalizeMemoryEventTime,
  resolveEffectiveEventTime,
  upsertMemoryEventTime,
  validateMemoryEventTime,
} from "../lib/db/memory-event-times.js";

function dbFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-event-times-"));
  const db = new Database(resolve(root, "engine.sqlite"));
  createMemoryEventTimesTable(db);
  return db;
}

const exact = {
  chunk_id: "abc",
  event_at: 1781504580,
  event_date: "2026-06-15",
  precision: "exact",
  source: "session_transcript",
  confidence: "high",
  evidence_type: "session_jsonl_line",
  evidence_ref: "session.jsonl:123",
};

test("exact, date_only, and unknown records validate with their invariants", () => {
  assert.equal(validateMemoryEventTime(exact).valid, true);
  assert.equal(validateMemoryEventTime({
    chunk_id: "date",
    event_at: null,
    event_date: "2026-06-15",
    precision: "date_only",
    source: "smart_add_path",
    confidence: "medium",
  }).valid, true);
  assert.equal(validateMemoryEventTime({
    chunk_id: "unknown",
    event_at: null,
    event_date: null,
    precision: "unknown",
    source: "unknown",
    confidence: "unknown",
  }).valid, true);
});

test("exact rejects missing, millisecond, mismatched-date, weak source, and unverifiable high confidence", () => {
  for (const record of [
    { ...exact, event_at: null },
    { ...exact, event_at: 1781504580000 },
    { ...exact, event_date: "2026-06-16" },
    { ...exact, source: "smart_add_path" },
    { ...exact, source: "unknown" },
    { ...exact, evidence_ref: null },
  ]) assert.equal(validateMemoryEventTime(record).valid, false);
});

test("date_only and unknown reject guessed timestamps and unsupported source claims", () => {
  assert.equal(validateMemoryEventTime({ chunk_id: "x", event_at: 1781504580, event_date: "2026-06-15", precision: "date_only", source: "smart_add_path", confidence: "medium" }).valid, false);
  assert.equal(validateMemoryEventTime({ chunk_id: "x", event_at: null, event_date: null, precision: "unknown", source: "import_metadata", confidence: "unknown" }).valid, false);
  assert.equal(validateMemoryEventTime({ chunk_id: "x", event_at: null, event_date: "2026/06/15", precision: "date_only", source: "smart_add_path", confidence: "medium" }).valid, false);
  assert.equal(validateMemoryEventTime({ chunk_id: "x", event_at: null, event_date: null, precision: "unknown", source: "unknown", confidence: "unknown", evidence_ref: "core.updated_at" }).valid, false);
});

test("rejected sources are explicit unknown evidence and never event-time evidence", () => {
  const rejected = {
    chunk_id: "x",
    event_at: null,
    event_date: null,
    precision: "unknown",
    source: "unknown",
    confidence: "unknown",
    evidence_type: "rejected_source",
    evidence_ref: "core.updated_at",
  };
  assert.equal(validateMemoryEventTime(rejected).valid, true);
  assert.equal(validateMemoryEventTime({ ...rejected, evidence_type: null }).valid, false);
  assert.equal(validateMemoryEventTime({ ...rejected, precision: "exact", event_at: 1781504580, event_date: "2026-06-15", source: "session_transcript", confidence: "high", evidence_ref: "session.jsonl:1" }).valid, false);
  assert.equal(validateMemoryEventTime({ ...rejected, precision: "date_only", event_date: "2026-06-15", source: "smart_add_path", confidence: "medium" }).valid, false);
  assert.equal(validateMemoryEventTime({ ...rejected, event_at: 1781504580 }).valid, false);
});

test("rejected evidence does not affect effective event-time resolution", () => {
  assert.deepEqual(resolveEffectiveEventTime({
    sidecar: {
      chunk_id: "x",
      precision: "unknown",
      event_at: null,
      event_date: null,
      source: "unknown",
      confidence: "unknown",
      evidence_type: "rejected_source",
      evidence_ref: "core.updated_at",
    },
    coreChunk: { updated_at: 1781504580 },
  }), { precision: "unknown", event_at: null, event_date: null, source: "unknown", fallback_used: false });
});

test("normalization derives date only from exact event_at and never creates midnight date_only timestamps", () => {
  const normalized = normalizeMemoryEventTime({ ...exact, event_date: null });
  assert.equal(normalized.event_date, "2026-06-15");
  const dateOnly = normalizeMemoryEventTime({ chunk_id: "date", event_at: null, event_date: "2026-06-15", precision: "date_only", source: "smart_add_path", confidence: "medium" });
  assert.equal(dateOnly.event_at, null);
});

test("fixture repository writes, reads, updates, filters, and has a default write guard", () => {
  const db = dbFixture();
  assert.throws(() => upsertMemoryEventTime(db, exact), new RegExp(MEMORY_EVENT_TIME_WRITE_GUARD));
  const inserted = upsertMemoryEventTime(db, exact, { allowWrite: true, nowSec: 100 });
  assert.equal(inserted.chunk_id, "abc");
  assert.equal(inserted.created_at, 100);
  const updated = upsertMemoryEventTime(db, { ...exact, precision: "date_only", event_at: null, event_date: "2026-06-15", source: "smart_add_path", confidence: "medium" }, { allowWrite: true, nowSec: 200 });
  assert.equal(updated.precision, "date_only");
  assert.equal(updated.created_at, 100);
  assert.equal(updated.updated_at, 200);
  assert.equal(getMemoryEventTime(db, "abc").event_at, null);
  assert.equal(listMemoryEventTimes(db, { precision: "date_only" }).length, 1);
  db.close();
});

test("effective event time uses sidecar precision and never core.updated_at fallback", () => {
  assert.deepEqual(resolveEffectiveEventTime({ sidecar: exact, coreChunk: { updated_at: 999 } }), { precision: "exact", event_at: exact.event_at, event_date: exact.event_date, source: exact.source, fallback_used: false });
  assert.deepEqual(resolveEffectiveEventTime({ sidecar: { precision: "date_only", event_date: "2026-06-15", source: "smart_add_path" }, coreChunk: { updated_at: 999 } }), { precision: "date_only", event_at: null, event_date: "2026-06-15", source: "smart_add_path", fallback_used: false });
  assert.deepEqual(resolveEffectiveEventTime({ sidecar: null, coreChunk: { updated_at: 999 } }), { precision: "unknown", event_at: null, event_date: null, source: "unknown", fallback_used: false });
});

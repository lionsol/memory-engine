import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PAGE_PATH = resolve(process.cwd(), "tools/event-at-recovery-annotator.html");

test("event-at recovery annotator static page exists and contains required review fields", () => {
  const html = readFileSync(PAGE_PATH, "utf8");

  for (const token of [
    "recover_event_at",
    "keep_null",
    "ignore_low_value",
    "needs_more_evidence",
    "event_at",
    "event_at_source",
    "confidence",
    "reviewer_note",
    "manual_review_status",
    "Load candidate JSONL",
    "Load labels JSONL to resume",
    "Export Labels JSONL",
    "file.text()",
    "raw_text_exported: false",
    "capped preview only",
  ]) {
    assert.equal(html.includes(token), true, `missing token: ${token}`);
  }
});

test("event-at recovery annotator shows safety guidance and disallows updated_at source", () => {
  const html = readFileSync(PAGE_PATH, "utf8");

  for (const token of [
    "Do not use updated_at / legacy_updated_at as event_at.",
    "Only choose recover_event_at when there is reliable external or transcript evidence.",
    "When unsure, choose needs_more_evidence.",
    "updated_at / legacy_updated_at are forbidden.",
    "session_transcript",
    "external_note",
    "manual_timestamp",
    "other",
    "null",
  ]) {
    assert.equal(html.includes(token), true, `missing token: ${token}`);
  }

  assert.equal(html.includes('value="updated_at"'), false);
  assert.equal(html.includes('value="legacy_updated_at"'), false);
});

test("event-at recovery annotator stays local-only with no DB write, migration apply, or server upload logic", () => {
  const html = readFileSync(PAGE_PATH, "utf8");

  for (const forbidden of [
    "fetch(",
    "XMLHttpRequest",
    "WebSocket",
    "FormData",
    "navigator.sendBeacon",
    "indexedDB",
    "openDatabase",
    "/api/",
    "INSERT ",
    "UPDATE ",
    "DELETE ",
    "applyCoreChunkTimeMigration",
    "writeDb",
    "upload",
    "http://",
    "https://",
  ]) {
    assert.equal(html.includes(forbidden), false, `forbidden pattern present: ${forbidden}`);
  }

  assert.equal(html.includes('type="file"'), true);
  assert.equal(html.includes("exportLabelsJsonl"), true);
  assert.equal(html.includes("No DB writes. No migration apply. No automatic backfill."), true);
});

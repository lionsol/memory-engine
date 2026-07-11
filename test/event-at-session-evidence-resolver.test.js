import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  buildTranscriptIndex,
  resolveCandidate,
  resolveEvidence,
  sha256Hex,
} from "../lib/event-at-session-evidence.js";

function fixture() {
  const dir = mkdtempSync(resolve(tmpdir(), "event-at-session-evidence-"));
  const sessionsDir = resolve(dir, "sessions");
  mkdirSync(sessionsDir);
  return { dir, sessionsDir };
}

function writeSession(sessionsDir, name, rows) {
  writeFileSync(resolve(sessionsDir, name), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function message(role, text, timestamp) {
  return { type: "message", timestamp, message: { role, content: [{ type: "text", text }] } };
}

function candidate(text, role_hint = "user", overrides = {}) {
  return { id: overrides.id || "candidate-id", date: "2026-06-15", text_sha256_16: "abcdef0123456789", role_hint, text, ...overrides };
}

function label(overrides = {}) {
  return { id: "candidate-id", review_action: "needs_more_evidence", event_at: null, ...overrides };
}

test("exact chunk-id match is unique and high confidence", () => {
  const { sessionsDir } = fixture();
  const text = "A reliable transcript message with enough content to identify the exact event.";
  const timestamp = "2026-06-15T14:23:00.000+08:00";
  const id = sha256Hex(text + timestamp + "2026-06-15");
  writeSession(sessionsDir, "one.jsonl", [message("user", text, timestamp)]);
  const result = resolveCandidate(candidate(text, "user", { id }), label({ id }), buildTranscriptIndex(sessionsDir).messages, { includeContext: false });
  assert.equal(result.resolution_status, "unique_match");
  assert.equal(result.best_match.match_type, "exact_chunk_id");
  assert.equal(result.best_match.confidence, "high");
  assert.equal(result.best_match.eligible_for_event_at_apply, true);
});

test("exact normalized text records deterministic normalization steps", () => {
  const { sessionsDir } = fixture();
  const body = "A normalized transcript message that remains stable after wrapper removal.";
  writeSession(sessionsDir, "one.jsonl", [message("user", `**User:** ${body}`, "2026-06-15T14:23:00+08:00")]);
  const result = resolveCandidate(candidate(body), label(), buildTranscriptIndex(sessionsDir).messages, { includeContext: false });
  assert.equal(result.resolution_status, "unique_match");
  assert.equal(result.best_match.match_type, "exact_normalized_text");
  assert.equal(result.best_match.normalization_steps.includes("strip_role_wrapper"), true);
});

test("substring evidence requires manual confirmation", () => {
  const { sessionsDir } = fixture();
  const excerpt = "This sufficiently long contiguous candidate sentence is deliberately written to exceed the resolver minimum length for manual review.";
  const body = `${excerpt} with small context.`;
  writeSession(sessionsDir, "one.jsonl", [message("assistant", body, "2026-06-15T14:23:00+08:00")]);
  const result = resolveCandidate(candidate(excerpt, "assistant"), label(), buildTranscriptIndex(sessionsDir).messages, { includeContext: false });
  assert.equal(result.best_match.match_type, "substring");
  assert.equal(result.best_match.requires_manual_confirm, true);
  assert.equal(result.best_match.eligible_for_event_at_apply, false);
});

test("fuzzy evidence cannot enter apply suggestion", () => {
  const { sessionsDir } = fixture();
  writeSession(sessionsDir, "one.jsonl", [message("user", "The meeting decision was to keep the evidence resolver read only.", "2026-06-15T14:23:00+08:00")]);
  const result = resolveCandidate(candidate("meeting decision evidence resolver read-only", "user"), label(), buildTranscriptIndex(sessionsDir).messages, { includeContext: false, includeFuzzy: true });
  if (result.best_match) assert.equal(result.best_match.eligible_for_event_at_apply, false);
});

test("duplicate timestamps are ambiguous and role disagreement is conflict", () => {
  const { sessionsDir } = fixture();
  const body = "The same long transcript text appears more than once and must not be accepted automatically.";
  writeSession(sessionsDir, "one.jsonl", [message("user", body, "2026-06-15T14:23:00+08:00"), message("user", body, "2026-06-15T15:23:00+08:00")]);
  const messages = buildTranscriptIndex(sessionsDir).messages;
  const ambiguous = resolveCandidate(candidate(body, "user"), label(), messages, { includeContext: false });
  assert.equal(ambiguous.resolution_status, "ambiguous");

  writeSession(sessionsDir, "two.jsonl", [message("assistant", body, "2026-06-15T16:23:00+08:00")]);
  const conflict = resolveCandidate(candidate(body, "user", { id: "not-a-real-id" }), label({ id: "not-a-real-id" }), buildTranscriptIndex(sessionsDir).messages, { includeContext: false });
  assert.equal(conflict.resolution_status, "conflict");
});

test("missing timestamps are not recoverable", () => {
  const { sessionsDir } = fixture();
  writeSession(sessionsDir, "one.jsonl", [message("user", "A message without a usable timestamp should never produce event_at.", "not-a-time")]);
  const result = resolveCandidate(candidate("A message without a usable timestamp should never produce event_at."), label(), buildTranscriptIndex(sessionsDir).messages, { includeContext: false });
  assert.equal(result.resolution_status, "no_match");
});

test("session scope excludes trajectory and toolResult-only records while counting malformed lines", () => {
  const { sessionsDir } = fixture();
  const keptPath = resolve(sessionsDir, "kept.jsonl.reset.2026-06-15");
  writeFileSync(keptPath, `${[
    { type: "toolResult", timestamp: "2026-06-15T14:23:00+08:00", message: { role: "tool", content: [{ type: "text", text: "do not index" }] } },
    message("user", "index this user message only", "2026-06-15T14:23:00+08:00"),
  ].map((row) => JSON.stringify(row)).join("\n")}\n{malformed\n`);
  writeSession(sessionsDir, "ignored.jsonl.trajectory.2026-06-15", [message("user", "do not index trajectory", "2026-06-15T14:23:00+08:00")]);
  const index = buildTranscriptIndex(sessionsDir);
  assert.equal(index.stats.session_files_scanned, 1);
  assert.equal(index.stats.messages_indexed, 1);
  assert.equal(index.stats.malformed_line_count, 1);
});

test("event_at evidence comes only from message timestamp, never filename or mtime metadata", () => {
  const { sessionsDir } = fixture();
  const body = "A message whose filename date and filesystem mtime are not valid event time evidence.";
  writeSession(sessionsDir, "2020-01-01.jsonl.deleted.2026-06-15", [message("user", body, null)]);
  const result = resolveCandidate(candidate(body), label(), buildTranscriptIndex(sessionsDir).messages, { includeContext: false });
  assert.equal(result.resolution_status, "no_match");
  assert.equal(JSON.stringify(result).includes("updated_at"), false);
});

test("resolver output is read-only and does not export full transcript text", () => {
  const { dir, sessionsDir } = fixture();
  const body = `A long private transcript body that must not be copied into evidence output beyond a capped context window. ${"private detail ".repeat(40)}`;
  writeSession(sessionsDir, "one.jsonl", [message("user", body, "2026-06-15T14:23:00+08:00")]);
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const labelsPath = resolve(dir, "labels.jsonl");
  const outPath = resolve(dir, "evidence.jsonl");
  writeFileSync(candidatesPath, `${JSON.stringify({ ...candidate(body), pilot_sample: true })}\n`);
  writeFileSync(labelsPath, `${JSON.stringify({ ...label(), manual_review_status: "reviewed" })}\n`);
  const summary = resolveEvidence({ candidatesPath, labelsPath, sessionsDir, outPath });
  const output = readFileSync(outPath, "utf8");
  assert.equal(summary.writes_db, false);
  assert.equal(summary.migration_applied, false);
  assert.equal(output.includes(body), false);
  assert.equal(output.includes('"raw_text_exported":false'), true);
});

test("CLI rejects write and migration flags", () => {
  for (const flag of ["--apply", "--force", "--write-db", "--no-backup"]) {
    const result = spawnSync(process.execPath, ["bin/resolve-event-at-session-evidence.js", flag], { encoding: "utf8" });
    assert.notEqual(result.status, 0, flag);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { buildEventAtPilotReviewPacket } from "../lib/db/core-chunk-time-migration.js";

function createFixtureDir() {
  const root = resolve(tmpdir(), "memory-engine-reports");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(resolve(root, "p40-"));
}

function writeJsonl(path, rows) {
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function sha16(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
}

function pilotLabel(id, overrides = {}) {
  return {
    id,
    date: "2026-06-15",
    text_sha256_16: sha16(id),
    manual_review_status: "unreviewed",
    review_action: "needs_more_evidence",
    event_at: null,
    event_at_source: "null",
    confidence: null,
    reviewer_note: "",
    pilot_sample: true,
    pilot_reason: "role=user,length_bucket=500-999,tag=no_tag",
    ...overrides,
  };
}

function candidate(id, overrides = {}) {
  return {
    date: "2026-06-15",
    id,
    path: "memory/smart-add/2026-06-15.md",
    legacy_updated_at: 1718413200,
    legacy_updated_at_date: "2026-06-15",
    text_length: 640,
    text_sha256_16: sha16(id),
    role_hint: "user",
    has_timestamp_prefix: false,
    has_decision_tag: false,
    has_preference_tag: false,
    has_todo_tag: false,
    looks_like_tool_output: false,
    looks_like_checkpoint_generated: false,
    available_in_smart_add_file: false,
    recommended_action: "manual_recovery_candidate",
    manual_review_status: "unreviewed",
    suggested_review_action: "needs_more_evidence",
    event_at_source_required: true,
    preview: `preview for ${id}`,
    ...overrides,
  };
}

test("review packet joins labels and candidates and reports correct count", () => {
  const dir = createFixtureDir();
  const labelsPath = resolve(dir, "pilot50.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const outPath = resolve(dir, "review.md");

  writeJsonl(labelsPath, [
    pilotLabel("chunk-a", { pilot_reason: "role=user,length_bucket=500-999,tag=preference" }),
    pilotLabel("chunk-b", { pilot_reason: "role=assistant,length_bucket=1000+,tag=decision" }),
  ]);
  writeJsonl(candidatesPath, [
    candidate("chunk-a", { role_hint: "user", has_preference_tag: true, text_length: 640, preview: "capped preview a..." }),
    candidate("chunk-b", { role_hint: "assistant", has_decision_tag: true, text_length: 1200, preview: "capped preview b..." }),
  ]);

  const report = buildEventAtPilotReviewPacket({
    labelsPath,
    candidatesPath,
    outPath,
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.writes_db, false);
  assert.equal(report.migration_applied, false);
  assert.equal(report.packet_count, 2);
  assert.equal(report.missing_candidate_count, 0);
  assert.equal(report.raw_text_exported, false);

  const content = readFileSync(outPath, "utf8");
  assert.match(content, /# Event Time Recovery Pilot Review - 2026-06-15/);
  assert.match(content, /count: 2/);
  assert.match(content, /role: user/);
  assert.match(content, /tags: preference/);
  assert.match(content, /capped preview a\.\.\./);
  assert.match(content, /Reviewer fields:/);
});

test("missing candidate ids are reported and not silently skipped", () => {
  const dir = createFixtureDir();
  const labelsPath = resolve(dir, "pilot50.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const outPath = resolve(dir, "review.md");

  writeJsonl(labelsPath, [
    pilotLabel("chunk-a"),
    pilotLabel("chunk-missing"),
  ]);
  writeJsonl(candidatesPath, [
    candidate("chunk-a"),
  ]);

  const report = buildEventAtPilotReviewPacket({
    labelsPath,
    candidatesPath,
    outPath,
  });

  assert.equal(report.packet_count, 1);
  assert.equal(report.missing_candidate_count, 1);
  assert.deepEqual(report.missing_candidate_ids, ["chunk-missing"]);
  const content = readFileSync(outPath, "utf8");
  assert.match(content, /## Missing Candidates/);
  assert.match(content, /chunk-missing/);
});

test("packet uses capped preview only and never emits raw full text", () => {
  const dir = createFixtureDir();
  const labelsPath = resolve(dir, "pilot50.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const outPath = resolve(dir, "review.md");
  const raw = `**User:** ${"very long raw body ".repeat(80)}`;

  writeJsonl(labelsPath, [pilotLabel("chunk-a")]);
  writeJsonl(candidatesPath, [
    candidate("chunk-a", {
      preview: raw,
      text_length: 1400,
    }),
  ]);

  const report = buildEventAtPilotReviewPacket({
    labelsPath,
    candidatesPath,
    outPath,
  });
  const row = report.rows[0];
  assert.equal(row.preview.length <= 243, true);
  assert.equal(row.preview.length < raw.length, true);

  const content = readFileSync(outPath, "utf8");
  assert.equal(content.includes(raw), false);
  assert.match(content, /updated_at is forbidden as event_at_source\./);
});

test("CLI rejects apply-like flags and stays read-only", () => {
  const dir = createFixtureDir();
  const labelsPath = resolve(dir, "pilot50.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const outPath = resolve(dir, "review.md");
  const script = resolve(process.cwd(), "bin/build-event-at-pilot-review-packet.js");

  writeJsonl(labelsPath, [pilotLabel("chunk-a")]);
  writeJsonl(candidatesPath, [candidate("chunk-a")]);

  for (const flag of ["--apply", "--force", "--write-db", "--no-backup"]) {
    const result = spawnSync(process.execPath, [
      script,
      "--labels", labelsPath,
      "--candidates", candidatesPath,
      "--out", outPath,
      flag,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsupported flag/);
  }
});

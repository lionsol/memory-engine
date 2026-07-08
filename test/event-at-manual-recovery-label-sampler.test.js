import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { sampleEventAtManualRecoveryLabels } from "../lib/db/core-chunk-time-migration.js";

function createFixtureDir() {
  const root = resolve(tmpdir(), "memory-engine-reports");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(resolve(root, "p39-"));
}

function writeJsonl(path, rows) {
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function sha16(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function label(id, overrides = {}) {
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
    ...overrides,
  };
}

function candidate(id, overrides = {}) {
  return {
    id,
    date: "2026-06-15",
    text_sha256_16: sha16(id),
    role_hint: "user",
    has_preference_tag: false,
    has_decision_tag: false,
    has_todo_tag: false,
    text_length: 650,
    recommended_action: "manual_recovery_candidate",
    preview: `preview for ${id}`,
    ...overrides,
  };
}

function buildFixture() {
  const reportDir = createFixtureDir();
  const labelsPath = resolve(reportDir, "event-at-manual-recovery-labels-2026-06-15.jsonl");
  const candidatesPath = resolve(reportDir, "event-at-manual-recovery-2026-06-15.jsonl");
  const outPath = resolve(reportDir, "event-at-manual-recovery-labels-2026-06-15-pilot4.jsonl");

  const rows = [
    { id: "user-pref-500", role_hint: "user", has_preference_tag: true, text_length: 650 },
    { id: "assistant-decision-1000", role_hint: "assistant", has_decision_tag: true, text_length: 1200 },
    { id: "user-todo-1000", role_hint: "user", has_todo_tag: true, text_length: 1100 },
    { id: "assistant-none-500", role_hint: "assistant", text_length: 700 },
    { id: "user-none-500-b", role_hint: "user", text_length: 800 },
    { id: "assistant-pref-1000-b", role_hint: "assistant", has_preference_tag: true, text_length: 1400 },
  ];

  writeJsonl(labelsPath, rows.map((row) => label(row.id)));
  writeJsonl(candidatesPath, rows.map((row) => candidate(row.id, row)));

  return { reportDir, labelsPath, candidatesPath, outPath };
}

test("sample output count is correct and keeps label schema without raw text", () => {
  const fixture = buildFixture();
  const report = sampleEventAtManualRecoveryLabels({
    labelsPath: fixture.labelsPath,
    candidatesPath: fixture.candidatesPath,
    count: 4,
    seed: "pilot-seed",
    outPath: fixture.outPath,
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.writes_db, false);
  assert.equal(report.migration_applied, false);
  assert.equal(report.pilot_sample_count, 4);
  assert.equal(report.raw_text_exported, false);

  const rows = readJsonl(fixture.outPath);
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.pilot_sample, true);
    assert.equal(typeof row.pilot_reason, "string");
    assert.equal("preview" in row, false);
    assert.equal("text" in row, false);
    assert.deepEqual(Object.keys(row).sort(), [
      "confidence",
      "date",
      "event_at",
      "event_at_source",
      "id",
      "manual_review_status",
      "pilot_reason",
      "pilot_sample",
      "review_action",
      "reviewer_note",
      "text_sha256_16",
    ].sort());
  }
  assert.equal(readFileSync(fixture.outPath, "utf8").includes("preview for"), false);
});

test("deterministic sampling is stable for the same seed", () => {
  const fixture = buildFixture();
  const outA = resolve(fixture.reportDir, "pilot-a.jsonl");
  const outB = resolve(fixture.reportDir, "pilot-b.jsonl");
  const outC = resolve(fixture.reportDir, "pilot-c.jsonl");

  sampleEventAtManualRecoveryLabels({
    labelsPath: fixture.labelsPath,
    candidatesPath: fixture.candidatesPath,
    count: 4,
    seed: "same-seed",
    outPath: outA,
  });
  sampleEventAtManualRecoveryLabels({
    labelsPath: fixture.labelsPath,
    candidatesPath: fixture.candidatesPath,
    count: 4,
    seed: "same-seed",
    outPath: outB,
  });
  sampleEventAtManualRecoveryLabels({
    labelsPath: fixture.labelsPath,
    candidatesPath: fixture.candidatesPath,
    count: 4,
    seed: "different-seed",
    outPath: outC,
  });

  assert.equal(readFileSync(outA, "utf8"), readFileSync(outB, "utf8"));
  assert.notEqual(readFileSync(outA, "utf8"), readFileSync(outC, "utf8"));
});

test("sample covers role, tag, and length buckets", () => {
  const fixture = buildFixture();
  const outPath = resolve(fixture.reportDir, "pilot6.jsonl");
  sampleEventAtManualRecoveryLabels({
    labelsPath: fixture.labelsPath,
    candidatesPath: fixture.candidatesPath,
    count: 6,
    seed: "coverage-seed",
    outPath,
  });

  const rows = readJsonl(outPath);
  const reasons = rows.map((row) => row.pilot_reason);
  assert.equal(reasons.some((reason) => reason.includes("role=user")), true);
  assert.equal(reasons.some((reason) => reason.includes("role=assistant")), true);
  assert.equal(reasons.some((reason) => reason.includes("tag=preference")), true);
  assert.equal(reasons.some((reason) => reason.includes("tag=decision")), true);
  assert.equal(reasons.some((reason) => reason.includes("tag=todo")), true);
  assert.equal(reasons.some((reason) => reason.includes("tag=no_tag")), true);
  assert.equal(reasons.some((reason) => reason.includes("length_bucket=500-999")), true);
  assert.equal(reasons.some((reason) => reason.includes("length_bucket=1000+")), true);
});

test("CLI rejects apply-like flags and does not write DB", () => {
  const fixture = buildFixture();
  const script = resolve(process.cwd(), "bin/sample-event-at-manual-recovery-labels.js");
  for (const flag of ["--apply", "--force", "--write-db", "--no-backup"]) {
    const result = spawnSync(process.execPath, [
      script,
      "--labels", fixture.labelsPath,
      "--candidates", fixture.candidatesPath,
      "--count", "4",
      "--out", fixture.outPath,
      flag,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsupported flag/);
  }
});

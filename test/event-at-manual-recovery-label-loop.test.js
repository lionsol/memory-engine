import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  initEventAtManualRecoveryLabels,
  previewEventAtManualRecoveryApply,
  summarizeEventAtManualRecoveryLabels,
} from "../lib/db/core-chunk-time-migration.js";

function createFixtureDir() {
  return mkdtempSync(resolve(tmpdir(), "event-at-manual-recovery-label-loop-"));
}

function writeJsonl(path, rows) {
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function candidate(overrides = {}) {
  return {
    date: "2026-06-15",
    id: "chunk-a",
    path: "memory/smart-add/2026-06-01.md",
    legacy_updated_at: 1718413200,
    legacy_updated_at_date: "2026-06-15",
    text_length: 321,
    text_sha256_16: "abcdef1234567890",
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
    preview: "trimmed preview only",
    ...overrides,
  };
}

function label(overrides = {}) {
  return {
    id: "chunk-a",
    date: "2026-06-15",
    text_sha256_16: "abcdef1234567890",
    manual_review_status: "reviewed",
    review_action: "needs_more_evidence",
    event_at: null,
    event_at_source: "null",
    confidence: null,
    reviewer_note: "",
    ...overrides,
  };
}

test("init labels generates one seed per candidate and defaults to unreviewed without raw text", () => {
  const dir = createFixtureDir();
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const labelsPath = resolve(dir, "labels.jsonl");
  writeJsonl(candidatesPath, [
    candidate(),
    candidate({
      id: "chunk-b",
      text_sha256_16: "0123456789abcdef",
      preview: "another preview",
    }),
  ]);

  const report = initEventAtManualRecoveryLabels({
    candidatesPath,
    outPath: labelsPath,
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.writes_db, false);
  assert.equal(report.migration_applied, false);
  assert.equal(report.label_count, 2);

  const rows = readJsonl(labelsPath);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.id), ["chunk-a", "chunk-b"]);
  assert.equal(rows.every((row) => row.manual_review_status === "unreviewed"), true);
  assert.equal(rows.every((row) => row.review_action === "needs_more_evidence"), true);
  assert.equal(rows.every((row) => row.event_at === null), true);
  assert.equal(rows.every((row) => row.event_at_source === "null"), true);
  assert.equal(rows.every((row) => row.confidence === null), true);
  assert.equal(rows.some((row) => "preview" in row), false);
  assert.equal(rows.some((row) => "text" in row), false);
  assert.equal(readFileSync(labelsPath, "utf8").includes("trimmed preview only"), false);
});

test("summary counts review status and action breakdowns", () => {
  const dir = createFixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  writeJsonl(labelsPath, [
    label({
      id: "chunk-1",
      review_action: "recover_event_at",
      event_at: "2026-06-15T09:30:00+08:00",
      event_at_source: "manual_timestamp",
      confidence: "high",
    }),
    label({
      id: "chunk-2",
      review_action: "keep_null",
      manual_review_status: "reviewed",
    }),
    label({
      id: "chunk-3",
      manual_review_status: "unreviewed",
      review_action: "needs_more_evidence",
    }),
    label({
      id: "chunk-4",
      review_action: "ignore_low_value",
      manual_review_status: "reviewed",
    }),
  ]);

  const report = summarizeEventAtManualRecoveryLabels({ labelsPath });
  assert.equal(report.label_count, 4);
  assert.equal(report.review_status_breakdown.reviewed, 3);
  assert.equal(report.review_status_breakdown.unreviewed, 1);
  assert.equal(report.review_action_breakdown.recover_event_at, 1);
  assert.equal(report.review_action_breakdown.keep_null, 1);
  assert.equal(report.review_action_breakdown.needs_more_evidence, 1);
  assert.equal(report.review_action_breakdown.ignore_low_value, 1);
  assert.equal(report.invalid_label_count, 0);
});

test("preview only accepts valid recover_event_at labels", () => {
  const dir = createFixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  writeJsonl(labelsPath, [
    label({
      id: "valid-1",
      text_sha256_16: "1111111111111111",
      review_action: "recover_event_at",
      event_at: "2026-06-15T09:30:00+08:00",
      event_at_source: "session_transcript",
      confidence: "high",
    }),
    label({
      id: "valid-2",
      text_sha256_16: "2222222222222222",
      review_action: "recover_event_at",
      event_at: 1718415000,
      event_at_source: "external_note",
      confidence: "medium",
    }),
    label({
      id: "keep-null",
      text_sha256_16: "3333333333333333",
      review_action: "keep_null",
      manual_review_status: "reviewed",
    }),
  ]);

  const report = previewEventAtManualRecoveryApply({ labelsPath });
  assert.equal(report.mode, "dry_run");
  assert.equal(report.writes_db, false);
  assert.equal(report.migration_applied, false);
  assert.equal(report.candidate_updates_count, 2);
  assert.equal(report.valid_recover_event_at_count, 2);
  assert.equal(report.invalid_recover_event_at_count, 0);
  assert.deepEqual(report.would_update.map((row) => row.id), ["valid-1", "valid-2"]);
  assert.equal(report.would_update[0].event_at, Date.parse("2026-06-15T09:30:00+08:00") / 1000);
  assert.equal(report.would_update[1].event_at, 1718415000);
});

test("preview rejects recover_event_at without explicit timezone", () => {
  const dir = createFixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  writeJsonl(labelsPath, [
    label({
      id: "bad-timezone",
      review_action: "recover_event_at",
      event_at: "2026-06-15T09:30:00",
      event_at_source: "manual_timestamp",
      confidence: "high",
    }),
  ]);

  const report = previewEventAtManualRecoveryApply({ labelsPath });
  assert.equal(report.candidate_updates_count, 0);
  assert.equal(report.invalid_recover_event_at_count, 1);
  assert.equal(report.invalid_labels[0].errors.includes("event_at_timezone_explicit_iso_or_unix_seconds_required"), true);
});

test("preview rejects event_at_source updated_at", () => {
  const dir = createFixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  writeJsonl(labelsPath, [
    label({
      id: "bad-source",
      review_action: "recover_event_at",
      event_at: "2026-06-15T09:30:00Z",
      event_at_source: "updated_at",
      confidence: "high",
    }),
  ]);

  const report = previewEventAtManualRecoveryApply({ labelsPath });
  assert.equal(report.candidate_updates_count, 0);
  assert.equal(report.invalid_recover_event_at_count, 1);
  assert.equal(report.invalid_labels[0].errors.includes("event_at_source_forbidden_updated_at"), true);
});

test("preview is file-only and does not require any DB path", () => {
  const dir = createFixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  writeJsonl(labelsPath, [
    label({
      id: "valid-only",
      review_action: "recover_event_at",
      event_at: "2026-06-15T09:30:00Z",
      event_at_source: "manual_timestamp",
      confidence: "low",
    }),
  ]);

  const report = previewEventAtManualRecoveryApply({ labelsPath });
  assert.equal(report.writes_db, false);
  assert.equal(report.migration_applied, false);
  assert.equal(report.candidate_updates_count, 1);
});

test("CLI rejects apply-like flags for init, summary, and preview", () => {
  const dir = createFixtureDir();
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const labelsPath = resolve(dir, "labels.jsonl");
  writeJsonl(candidatesPath, [candidate()]);
  writeJsonl(labelsPath, [label()]);

  const cliCases = [
    {
      script: resolve(process.cwd(), "bin/init-event-at-manual-recovery-labels.js"),
      baseArgs: ["--candidates", candidatesPath, "--out", resolve(dir, "labels-out.jsonl")],
    },
    {
      script: resolve(process.cwd(), "bin/summarize-event-at-manual-recovery-labels.js"),
      baseArgs: ["--labels", labelsPath, "--json"],
    },
    {
      script: resolve(process.cwd(), "bin/preview-event-at-manual-recovery-apply.js"),
      baseArgs: ["--labels", labelsPath, "--json"],
    },
  ];

  for (const cli of cliCases) {
    for (const flag of ["--apply", "--force", "--write-db", "--no-backup"]) {
      const result = spawnSync(process.execPath, [cli.script, ...cli.baseArgs, flag], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /unsupported flag/);
    }
  }
});

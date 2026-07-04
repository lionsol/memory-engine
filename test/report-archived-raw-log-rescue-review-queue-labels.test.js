import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  buildReviewQueueLabelReport,
  renderMarkdown,
  validateLabelRow,
  validateQueueRow,
} = require("../bin/report-archived-raw-log-rescue-review-queue-labels.cjs");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixtureDir() {
  return mkdtempSync(resolve(tmpdir(), "archived-rescue-queue-label-report-"));
}

function writeJsonl(filePath, rows) {
  writeFileSync(filePath, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function queueRow(id, overrides = {}) {
  return {
    schema_version: 1,
    queue_type: "archived_raw_log_rescue_manual_review",
    queue_priority: 1,
    review_reasons: ["positive_negative_conflict", "raw_yes_capped_to_unsure", "near_boundary"],
    sample_id: `rescue:${id}`,
    memory_id: id,
    chunk_id: id,
    path: "memory/smart-add/2026-06-01.md",
    source_path: "memory/smart-add/2026-06-01.md",
    category: "raw_log",
    is_archived: true,
    primary_bucket: "archived_raw_log_project",
    risk_score: 70,
    risk_signals: ["project:memory-engine", "engineering_evidence_signal", "transient_runtime_noise_signal"],
    score: 55,
    threshold: 55,
    unsure_threshold: 30,
    boundary_distance: 0,
    raw_predicted_keep_active: "yes",
    predicted_keep_active: "unsure",
    manual_review_flags: ["positive_negative_conflict"],
    content_preview: `preview ${id}`,
    safety: {
      db_writes: false,
      unarchive: false,
      category_update: false,
      delete: false,
      quarantine: false,
      reinforce: false,
    },
    ...overrides,
  };
}

function labelRow(id, overrides = {}) {
  return {
    schema_version: 1,
    sample_id: `rescue:${id}`,
    sample_type: "memory",
    memory_id: id,
    chunk_id: id,
    primary_bucket: "archived_raw_log_project",
    source_path: "memory/smart-add/2026-06-01.md",
    annotation: {
      quality: "usable",
      currency: "current",
      auto_recall_eligible: "yes",
      preferred_action: "demote",
      keep_active: "yes",
      target_category: "project",
      rescue_confidence: "medium",
      reason: "manual queue review",
    },
    ...overrides,
  };
}

test("queue and label row validators enforce safety and annotation fields", () => {
  assert.equal(validateQueueRow({ row: queueRow("ok"), line_number: 1 }).valid, true);
  const unsafe = validateQueueRow({
    row: queueRow("unsafe", { safety: { db_writes: true } }),
    line_number: 1,
  });
  assert.equal(unsafe.valid, false);
  assert.ok(unsafe.errors.includes("safety.db_writes"));

  assert.equal(validateLabelRow({ row: labelRow("ok"), line_number: 1 }).valid, true);
  const invalid = validateLabelRow({
    row: labelRow("bad", { annotation: { keep_active: "maybe" } }),
    line_number: 1,
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes("annotation.keep_active"));
  assert.ok(invalid.errors.includes("annotation.reason"));
});

test("review queue label report aligns labels to queue and reports blockers", () => {
  const report = buildReviewQueueLabelReport({
    queuePath: "queue.jsonl",
    queueRows: [
      queueRow("a", { queue_priority: 1 }),
      queueRow("b", { queue_priority: 2 }),
      queueRow("dup", { queue_priority: 3 }),
      queueRow("dup", { queue_priority: 4 }),
      queueRow("unsafe", { queue_priority: 5, safety: { db_writes: true } }),
    ],
    labelRows: [
      labelRow("a"),
      labelRow("a", { annotation: { ...labelRow("a").annotation, reason: "duplicate" } }),
      labelRow("missing"),
      labelRow("b", { memory_id: "different-memory" }),
      labelRow("bad", { annotation: { keep_active: "maybe" } }),
    ],
    sampleLimit: 10,
  });

  assert.equal(report.mode, "archived_raw_log_rescue_review_queue_label_report");
  assert.equal(report.write_db, false);
  assert.deepEqual(report.safety, {
    db_writes: false,
    unarchive: false,
    category_update: false,
    delete: false,
    quarantine: false,
    reinforce: false,
  });
  assert.equal(report.summary.queue_total, 5);
  assert.equal(report.summary.queue_valid, 4);
  assert.equal(report.summary.queue_unique_sample_ids, 3);
  assert.equal(report.summary.queue_invalid, 1);
  assert.equal(report.summary.queue_duplicate_sample_ids, 1);
  assert.equal(report.summary.labels_total, 5);
  assert.equal(report.summary.labels_valid_aligned, 1);
  assert.equal(report.summary.labels_invalid, 1);
  assert.equal(report.summary.labels_not_in_queue, 1);
  assert.equal(report.summary.labels_identity_mismatch, 1);
  assert.equal(report.summary.labels_duplicate_sample_ids, 1);
  assert.equal(report.summary.queue_unlabeled, 2);
  assert.equal(report.summary.coverage_rate, 0.3333);
  assert.equal(report.summary.keep_active_distribution.yes, 1);
  assert.equal(report.summary.preferred_action_distribution.demote, 1);
  assert.equal(report.summary.target_category_distribution.project, 1);
  assert.equal(report.identity_mismatch_labels[0].mismatches.includes("memory_id"), true);
});

test("review queue label report supports preflight with no labels", () => {
  const report = buildReviewQueueLabelReport({
    queuePath: "queue.jsonl",
    queueRows: [queueRow("a"), queueRow("b", { queue_priority: 2 })],
    labelRows: [],
  });

  assert.equal(report.summary.queue_valid, 2);
  assert.equal(report.summary.labels_total, 0);
  assert.equal(report.summary.labels_valid_aligned, 0);
  assert.equal(report.summary.queue_unlabeled, 2);
  assert.equal(report.summary.coverage_rate, 0);
  assert.equal(report.unlabeled_queue_samples.length, 2);
});

test("review queue label report CLI writes JSON and Markdown", () => {
  const dir = fixtureDir();
  const queuePath = resolve(dir, "queue.jsonl");
  const labelsPath = resolve(dir, "labels.jsonl");
  const outJson = resolve(dir, "report.json");
  const outMd = resolve(dir, "report.md");

  writeJsonl(queuePath, [queueRow("a")]);
  writeJsonl(labelsPath, [labelRow("a")]);

  const result = spawnSync(
    process.execPath,
    [
      resolve(repoRoot, "bin/report-archived-raw-log-rescue-review-queue-labels.cjs"),
      "--queue",
      queuePath,
      "--labels",
      labelsPath,
      "--out-json",
      outJson,
      "--out-md",
      outMd,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.labels_valid_aligned, 1);
  assert.equal(parsed.summary.queue_unlabeled, 0);
  assert.equal(existsSync(outJson), true);
  assert.equal(existsSync(outMd), true);
  assert.equal(JSON.parse(readFileSync(outJson, "utf8")).mode, "archived_raw_log_rescue_review_queue_label_report");
  assert.equal(readFileSync(outMd, "utf8").includes("# Archived raw-log rescue review queue label report"), true);
});

test("review queue label report markdown includes safety and unlabeled samples", () => {
  const report = buildReviewQueueLabelReport({
    queuePath: "queue.jsonl",
    queueRows: [queueRow("a")],
    labelRows: [],
  });
  const markdown = renderMarkdown(report);
  assert.equal(markdown.includes("DB writes: false"), true);
  assert.equal(markdown.includes("Queue unlabeled: 1"), true);
  assert.equal(markdown.includes("rescue:a"), true);
});

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
  buildManualReviewQueue,
  renderMarkdown,
  reviewReasons,
} = require("../bin/build-archived-raw-log-rescue-review-queue.cjs");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixtureDir() {
  return mkdtempSync(resolve(tmpdir(), "archived-rescue-review-queue-"));
}

function writeJsonl(filePath, rows) {
  writeFileSync(filePath, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function sample(id, overrides = {}) {
  return {
    sample_type: "memory",
    sample_subtype: "archived_raw_log_rescue",
    sample_id: `rescue:${id}`,
    memory_id: id,
    chunk_id: id,
    path: "memory/smart-add/2026-06-01.md",
    source_path: "memory/smart-add/2026-06-01.md",
    path_family: "smart-add",
    source_file_date: "2026-06-01",
    category: "raw_log",
    is_archived: true,
    confidence: 0.5,
    hit_count: 0,
    conflict_flag: 0,
    text_length: 120,
    primary_bucket: "archived_raw_log_project",
    sample_buckets: ["archived_raw_log_project", "archived_raw_log_rescue"],
    risk_score: 50,
    risk_signals: ["project:memory-engine"],
    quality_flags: ["archived_raw_log", "raw_log_leak"],
    signal_polarity: {
      positive_evidence: [],
      negative_evidence: [],
    },
    content_preview: `preview for ${id}`,
    annotation: {
      quality: null,
      currency: null,
      auto_recall_eligible: null,
      preferred_action: null,
      keep_active: null,
      target_category: null,
      rescue_confidence: null,
      reason: null,
      notes: null,
    },
    ...overrides,
  };
}

test("review reasons prioritize conflict, raw yes cap, near-boundary, then predicted unsure fallback", () => {
  assert.deepEqual(reviewReasons({
    _score_manual_review_flags: ["positive_negative_conflict"],
    _sampler: { is_conflict: true },
    _raw_predicted_keep_active: "yes",
    _predicted_keep_active: "unsure",
    _boundary: 0,
  }, 5), ["positive_negative_conflict", "raw_yes_capped_to_unsure", "near_boundary"]);

  assert.deepEqual(reviewReasons({
    _score_manual_review_flags: [],
    _sampler: { is_conflict: false },
    _raw_predicted_keep_active: "no",
    _predicted_keep_active: "unsure",
    _boundary: 17,
  }, 5), ["predicted_unsure"]);
});

test("manual-review queue builds stable prioritized rows and keeps lifecycle safety read-only", () => {
  const rows = [
    sample("plain-no", {
      primary_bucket: "archived_raw_log_keyword",
      risk_score: 10,
      risk_signals: [],
      content_preview: "keyword-only raw log noise",
    }),
    sample("boundary", {
      primary_bucket: "archived_raw_log_decision",
      risk_score: 60,
      risk_signals: ["project:memory-engine", "decision_signal"],
      sampling: { selection_reason: "boundary" },
      content_preview: "project decision near keep threshold",
    }),
    sample("predicted-unsure", {
      primary_bucket: "archived_raw_log_project",
      risk_score: 50,
      risk_signals: ["project:memory-engine"],
      content_preview: "project raw log without enough positive evidence",
    }),
    sample("conflict", {
      primary_bucket: "archived_raw_log_project",
      risk_score: 95,
      risk_signals: ["project:memory-engine", "engineering_evidence_signal", "transient_runtime_noise_signal"],
      signal_polarity: {
        positive_evidence: ["engineering_evidence_signal"],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
      sampling: { selection_reason: "positive_negative_conflict" },
      content_preview: "engineering evidence mixed with runtime noise",
    }),
    sample("excluded", {
      primary_bucket: "archived_raw_log_decision",
      risk_signals: ["project:memory-engine", "decision_signal"],
    }),
    sample("boundary", {
      primary_bucket: "archived_raw_log_decision",
      risk_signals: ["project:memory-engine", "decision_signal"],
    }),
  ];

  const report = buildManualReviewQueue({
    samples: rows,
    excludedSampleIds: new Set(["rescue:excluded"]),
    limit: 10,
    nearBoundary: 5,
  });

  assert.equal(report.mode, "archived_raw_log_rescue_manual_review_queue");
  assert.equal(report.write_db, false);
  assert.equal(report.memory_side_effects, false);
  assert.equal(report.reinforcement_side_effects, false);
  assert.deepEqual(report.safety, {
    db_writes: false,
    unarchive: false,
    category_update: false,
    delete: false,
    quarantine: false,
    reinforce: false,
  });
  assert.equal(report.summary.input_count, 6);
  assert.equal(report.summary.excluded_count, 1);
  assert.equal(report.summary.duplicate_sample_ids, 1);
  assert.equal(report.summary.selected_count, 3);
  assert.deepEqual(report.queue.map(row => row.sample_id), [
    "rescue:conflict",
    "rescue:boundary",
    "rescue:predicted-unsure",
  ]);
  assert.deepEqual(report.queue.map(row => row.queue_priority), [1, 2, 3]);
  assert.equal(report.queue[0].predicted_keep_active, "unsure");
  assert.equal(report.queue[0].raw_predicted_keep_active, "yes");
  assert.ok(report.queue[0].review_reasons.includes("positive_negative_conflict"));
  assert.ok(report.queue[0].review_reasons.includes("raw_yes_capped_to_unsure"));
  assert.ok(report.queue[1].review_reasons.includes("near_boundary"));
  assert.deepEqual(report.queue[2].review_reasons, ["predicted_unsure"]);
  assert.equal(report.summary.all_reason_distribution.positive_negative_conflict, 1);
  assert.equal(report.summary.all_reason_distribution.raw_yes_capped_to_unsure, 1);
  assert.equal(report.summary.all_reason_distribution.near_boundary, 2);
  assert.equal(report.summary.all_reason_distribution.predicted_unsure, 1);
});

test("manual-review queue CLI writes JSONL and Markdown artifacts with label exclusion", () => {
  const dir = fixtureDir();
  const inputPath = resolve(dir, "samples.jsonl");
  const labelsPath = resolve(dir, "labels.jsonl");
  const outJsonl = resolve(dir, "queue.jsonl");
  const outMd = resolve(dir, "queue.md");

  writeJsonl(inputPath, [
    sample("conflict", {
      risk_score: 95,
      risk_signals: ["project:memory-engine", "engineering_evidence_signal", "transient_runtime_noise_signal"],
      signal_polarity: {
        positive_evidence: ["engineering_evidence_signal"],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
      sampling: { selection_reason: "positive_negative_conflict" },
    }),
    sample("already-labeled", {
      primary_bucket: "archived_raw_log_decision",
      risk_signals: ["project:memory-engine", "decision_signal"],
    }),
  ]);
  writeJsonl(labelsPath, [{ sample_id: "rescue:already-labeled", annotation: { keep_active: "yes" } }]);

  const result = spawnSync(
    process.execPath,
    [
      resolve(repoRoot, "bin/build-archived-raw-log-rescue-review-queue.cjs"),
      "--input",
      inputPath,
      "--exclude-labels",
      labelsPath,
      "--limit",
      "5",
      "--out-jsonl",
      outJsonl,
      "--out-md",
      outMd,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.mode, "archived_raw_log_rescue_manual_review_queue");
  assert.equal(parsed.write_db, false);
  assert.equal(parsed.summary.excluded_count, 1);
  assert.equal(parsed.summary.selected_count, 1);
  assert.equal(existsSync(outJsonl), true);
  assert.equal(existsSync(outMd), true);

  const queueRows = readFileSync(outJsonl, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(queueRows.length, 1);
  assert.equal(queueRows[0].sample_id, "rescue:conflict");
  assert.equal(queueRows[0].safety.db_writes, false);
  assert.equal(queueRows[0].safety.unarchive, false);
  assert.equal(queueRows[0].safety.category_update, false);
  assert.equal(queueRows[0].safety.delete, false);
  assert.equal(queueRows[0].safety.quarantine, false);
  assert.equal(queueRows[0].safety.reinforce, false);

  const markdown = readFileSync(outMd, "utf8");
  assert.equal(markdown.includes("# Archived raw-log rescue manual-review queue"), true);
  assert.equal(markdown.includes("positive_negative_conflict"), true);
  assert.equal(markdown.includes("DB writes: false"), true);
});

test("manual-review queue markdown renders summary and queue index", () => {
  const report = buildManualReviewQueue({
    samples: [
      sample("boundary", {
        primary_bucket: "archived_raw_log_decision",
        risk_signals: ["project:memory-engine", "decision_signal"],
      }),
    ],
    limit: 1,
  });

  const markdown = renderMarkdown(report);
  assert.equal(markdown.includes("## Summary"), true);
  assert.equal(markdown.includes("## Queue index"), true);
  assert.equal(markdown.includes("rescue:boundary"), true);
});

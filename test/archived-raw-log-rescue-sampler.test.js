import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  selectActiveSamplerSamples,
} = require("../lib/annotation/archived-raw-log-rescue-sampler.cjs");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sample(id, overrides = {}) {
  return {
    sample_id: `rescue:${id}`,
    chunk_id: id,
    path: "memory/smart-add/2026-06-01.md",
    primary_bucket: "archived_raw_log_project",
    risk_score: 50,
    risk_signals: ["project:memory-engine"],
    quality_flags: ["archived_raw_log", "raw_log_leak"],
    signal_polarity: {
      positive_evidence: [],
      negative_evidence: [],
    },
    ...overrides,
  };
}

test("active sampler combines conflict, transient, bucket diversity, and boundary selections", () => {
  const input = [
    sample("conflict", {
      primary_bucket: "archived_raw_log_project",
      risk_score: 95,
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
      signal_polarity: {
        positive_evidence: ["engineering_evidence_signal"],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
    }),
    sample("transient", {
      primary_bucket: "archived_raw_log_transient",
      risk_score: 90,
      risk_signals: ["project:openclaw", "transient_runtime_noise_signal"],
      signal_polarity: {
        positive_evidence: [],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
    }),
    sample("decision", {
      primary_bucket: "archived_raw_log_decision",
      risk_score: 80,
      risk_signals: ["project:memory-engine", "decision_signal"],
    }),
    sample("preference", {
      primary_bucket: "archived_raw_log_preference",
      risk_score: 70,
      risk_signals: ["project:memory-engine", "preference_signal"],
    }),
    sample("todo", {
      primary_bucket: "archived_raw_log_todo",
      risk_score: 60,
      risk_signals: ["project:memory-engine", "todo_signal"],
    }),
    sample("keyword", {
      primary_bucket: "archived_raw_log_keyword",
      risk_score: 40,
      risk_signals: ["project:memory-engine", "decision_signal", "preference_signal"],
    }),
    sample("boundary-a", {
      primary_bucket: "archived_raw_log_project",
      risk_score: 55,
      risk_signals: ["project:memory-engine", "decision_signal"],
    }),
    sample("boundary-b", {
      primary_bucket: "archived_raw_log_project",
      risk_score: 54,
      risk_signals: ["project:memory-engine", "decision_signal"],
    }),
  ];

  const result = selectActiveSamplerSamples(input, { limit: 8, threshold: 55 });

  assert.equal(result.mode, "v0.4_active_sampler_diversity_mvp");
  assert.equal(result.selected_count, 8);
  assert.equal(new Set(result.selected.map(s => s.sample_id)).size, 8);
  assert.ok(result.summary.selection_reason_distribution.positive_negative_conflict >= 1);
  assert.ok(result.summary.selection_reason_distribution.transient_sanity_check >= 1);
  assert.ok(result.summary.selection_reason_distribution.bucket_diversity >= 1);
  assert.ok(result.summary.selection_reason_distribution.boundary >= 1);
  assert.ok(result.summary.selected_bucket_distribution.archived_raw_log_transient >= 1);
  assert.ok(Object.keys(result.summary.selected_bucket_distribution).length >= 5);
});

test("sampler exposes positive and negative evidence pool counts", () => {
  const result = selectActiveSamplerSamples([
    sample("positive", {
      risk_signals: ["project:memory-engine", "engineering_evidence_signal"],
      signal_polarity: {
        positive_evidence: ["engineering_evidence_signal"],
        negative_evidence: [],
      },
    }),
    sample("negative", {
      primary_bucket: "archived_raw_log_transient",
      risk_signals: ["project:openclaw", "transient_runtime_noise_signal"],
      signal_polarity: {
        positive_evidence: [],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
    }),
  ], { limit: 2 });

  assert.equal(result.summary.positive_evidence_count, 1);
  assert.equal(result.summary.negative_evidence_count, 1);
  assert.equal(result.summary.transient_pool_count, 1);
});

test("CLI accepts --input path and emits diversity sampler summary", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "archived-rescue-sampler-"));
  const inputPath = resolve(dir, "candidates.jsonl");
  const rows = [
    sample("conflict", {
      risk_signals: ["project:memory-engine", "engineering_evidence_signal", "transient_runtime_noise_signal"],
      signal_polarity: {
        positive_evidence: ["engineering_evidence_signal"],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
    }),
    sample("transient", {
      primary_bucket: "archived_raw_log_transient",
      risk_signals: ["project:openclaw", "transient_runtime_noise_signal"],
      signal_polarity: {
        positive_evidence: [],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
    }),
    sample("decision", {
      primary_bucket: "archived_raw_log_decision",
      risk_signals: ["project:memory-engine", "decision_signal"],
    }),
  ];
  writeFileSync(inputPath, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");

  const result = spawnSync(
    process.execPath,
    [resolve(repoRoot, "bin/v4-active-sampler.cjs"), "--input", inputPath, "--limit", "3"],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.input, inputPath);
  assert.equal(parsed.mode, "v0.4_active_sampler_diversity_mvp");
  assert.equal(parsed.selected_count, 3);
  assert.ok(parsed.summary.conflict_pool_count >= 1);
});

test("CLI excludes sample ids already present in label JSONL files", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "archived-rescue-sampler-exclude-"));
  const inputPath = resolve(dir, "candidates.jsonl");
  const labelsPath = resolve(dir, "labels.jsonl");
  const rows = [
    sample("already-labeled", {
      primary_bucket: "archived_raw_log_project",
      risk_signals: ["project:memory-engine", "engineering_evidence_signal"],
      signal_polarity: {
        positive_evidence: ["engineering_evidence_signal"],
        negative_evidence: [],
      },
    }),
    sample("fresh", {
      primary_bucket: "archived_raw_log_decision",
      risk_signals: ["project:memory-engine", "decision_signal"],
    }),
  ];
  writeFileSync(inputPath, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");
  writeFileSync(labelsPath, `${JSON.stringify({ sample_id: "rescue:already-labeled", annotation: { keep_active: "yes" } })}\n`, "utf8");

  const result = spawnSync(
    process.execPath,
    [
      resolve(repoRoot, "bin/v4-active-sampler.cjs"),
      "--input",
      inputPath,
      "--exclude-labels",
      labelsPath,
      "--limit",
      "2",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.excluded_count, 1);
  assert.deepEqual(parsed.exclude_labels, [labelsPath]);
  assert.equal(parsed.selected_count, 1);
  assert.equal(parsed.samples[0].sample_id, "rescue:fresh");
});

test("CLI can write annotation-ready JSONL with full sample rows and sampling metadata", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "archived-rescue-sampler-out-"));
  const inputPath = resolve(dir, "candidates.jsonl");
  const outPath = resolve(dir, "active-samples.jsonl");
  const rows = [
    sample("conflict", {
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
      content_preview: "engineering evidence with conflicting runtime noise",
      risk_signals: ["project:memory-engine", "engineering_evidence_signal", "transient_runtime_noise_signal"],
      signal_polarity: {
        positive_evidence: ["engineering_evidence_signal"],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
    }),
    sample("transient", {
      primary_bucket: "archived_raw_log_transient",
      annotation: { keep_active: null },
      content_preview: "cron healthcheck prompt",
      risk_signals: ["project:openclaw", "transient_runtime_noise_signal"],
      signal_polarity: {
        positive_evidence: [],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
    }),
  ];
  writeFileSync(inputPath, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");

  const result = spawnSync(
    process.execPath,
    [
      resolve(repoRoot, "bin/v4-active-sampler.cjs"),
      "--input",
      inputPath,
      "--limit",
      "2",
      "--format",
      "jsonl",
      "--out",
      outPath,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(outPath), true);
  const writeSummary = JSON.parse(result.stdout);
  assert.equal(writeSummary.safety.output_file_write, true);
  assert.equal(writeSummary.safety.db_writes, false);
  assert.equal(writeSummary.safety.unarchive, false);
  assert.equal(writeSummary.safety.category_update, false);
  const selectedRows = readFileSync(outPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(selectedRows.length, 2);
  assert.equal(selectedRows[0].sample_id.startsWith("rescue:"), true);
  assert.equal(typeof selectedRows[0].content_preview, "string");
  assert.ok(selectedRows[0].annotation);
  assert.ok(selectedRows[0].sampling);
  assert.ok(selectedRows[0].sampling.selection_reason);
  assert.equal(typeof selectedRows[0].sampling.computed_score, "number");
  assert.ok(Array.isArray(selectedRows[0].sampling.manual_review_flags));
  const conflictRow = selectedRows.find(row => row.sample_id === "rescue:conflict");
  assert.ok(conflictRow);
  assert.equal(conflictRow.sampling.raw_predicted_keep_active, "yes");
  assert.equal(conflictRow.sampling.predicted_keep_active, "unsure");
  assert.deepEqual(conflictRow.sampling.manual_review_flags, ["positive_negative_conflict"]);
});

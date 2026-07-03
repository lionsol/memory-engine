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
  buildCombinedReport,
  renderMarkdown,
} = require("../bin/report-archived-raw-log-rescue-labels.cjs");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixtureDir() {
  return mkdtempSync(resolve(tmpdir(), "archived-rescue-combined-"));
}

function writeJsonl(filePath, rows) {
  writeFileSync(filePath, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function candidate(sampleId, overrides = {}) {
  return {
    sample_id: sampleId,
    primary_bucket: "archived_raw_log_project",
    risk_signals: ["project:memory-engine"],
    quality_flags: ["archived_raw_log", "raw_log_leak"],
    sampling: {
      selection_reason: "boundary",
      manual_review_flags: [],
    },
    ...overrides,
  };
}

function label(sampleId, keepActive, overrides = {}) {
  return {
    sample_id: sampleId,
    primary_bucket: overrides.primary_bucket || "archived_raw_log_project",
    annotation: {
      keep_active: keepActive,
      target_category: overrides.target_category || "project",
      rescue_confidence: overrides.rescue_confidence || "medium",
    },
  };
}

test("combined report merges multiple label/candidate rounds and separates manual review", () => {
  const dir = fixtureDir();
  const labelsA = resolve(dir, "labels-a.jsonl");
  const candidatesA = resolve(dir, "candidates-a.jsonl");
  const labelsB = resolve(dir, "labels-b.jsonl");
  const candidatesB = resolve(dir, "candidates-b.jsonl");

  writeJsonl(candidatesA, [
    candidate("rescue:yes", {
      risk_signals: ["project:memory-engine", "decision_signal"],
      primary_bucket: "archived_raw_log_decision",
      sampling: { selection_reason: "bucket_diversity" },
    }),
    candidate("rescue:conflict-no", {
      risk_signals: ["project:memory-engine", "engineering_evidence_signal", "transient_runtime_noise_signal"],
      signal_polarity: {
        positive_evidence: ["engineering_evidence_signal"],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
      sampling: { selection_reason: "positive_negative_conflict" },
    }),
  ]);
  writeJsonl(labelsA, [
    label("rescue:yes", "yes", { primary_bucket: "archived_raw_log_decision" }),
    label("rescue:conflict-no", "no", { target_category: "raw_log", rescue_confidence: "low" }),
  ]);

  writeJsonl(candidatesB, [
    candidate("rescue:duplicate", {
      risk_signals: ["project:memory-engine", "decision_signal"],
    }),
    candidate("rescue:missing-keep", {
      risk_signals: ["project:memory-engine", "decision_signal"],
    }),
  ]);
  writeJsonl(labelsB, [
    label("rescue:duplicate", "yes"),
    label("rescue:duplicate", "yes"),
    {
      sample_id: "rescue:missing-keep",
      primary_bucket: "archived_raw_log_project",
      annotation: { target_category: "project" },
    },
    label("rescue:not-found", "yes"),
  ]);

  const report = buildCombinedReport({
    pairs: [
      { name: "round_a", labelPath: labelsA, candidatePath: candidatesA },
      { name: "round_b", labelPath: labelsB, candidatePath: candidatesB },
    ],
  });

  assert.equal(report.write_db, false);
  assert.equal(report.memory_side_effects, false);
  assert.equal(report.reinforcement_side_effects, false);
  assert.equal(report.summary.labels_valid, 3);
  assert.equal(report.summary.labels_invalid, 3);
  assert.equal(report.summary.invalid_reasons.duplicate_sample_id, 1);
  assert.equal(report.summary.invalid_reasons.missing_keep_active, 1);
  assert.equal(report.summary.invalid_reasons.candidate_not_found, 1);
  assert.equal(report.scoring.yes_false_positive, 0);
  assert.equal(report.scoring.actual_distribution.yes, 2);
  assert.equal(report.scoring.actual_distribution.no, 1);
  assert.equal(report.manual_review.total, 1);
  assert.equal(report.manual_review.actual_distribution.no, 1);
  assert.equal(report.manual_review.predicted_distribution.unsure, 1);
  assert.equal(report.manual_review.raw_predicted_distribution.yes, 1);
  assert.equal(report.manual_review.flag_distribution.positive_negative_conflict, 1);
  assert.equal(report.by_round.round_a.total, 2);
  assert.equal(report.by_round.round_b.total, 1);
  assert.ok(report.by_selection_reason.positive_negative_conflict);
});

test("combined report renders markdown and CLI can write json and markdown outputs", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const outJson = resolve(dir, "combined.json");
  const outMd = resolve(dir, "combined.md");

  writeJsonl(candidatesPath, [
    candidate("rescue:conflict", {
      risk_signals: ["project:memory-engine", "engineering_evidence_signal", "transient_runtime_noise_signal"],
      signal_polarity: {
        positive_evidence: ["engineering_evidence_signal"],
        negative_evidence: ["transient_runtime_noise_signal"],
      },
      sampling: { selection_reason: "positive_negative_conflict" },
    }),
  ]);
  writeJsonl(labelsPath, [
    label("rescue:conflict", "no", { target_category: "raw_log", rescue_confidence: "low" }),
  ]);

  const report = buildCombinedReport({
    pairs: [{ name: "round", labelPath: labelsPath, candidatePath: candidatesPath }],
  });
  const markdown = renderMarkdown(report);
  assert.equal(markdown.includes("# Archived raw-log rescue combined label report"), true);
  assert.equal(markdown.includes("## Manual review bucket"), true);
  assert.equal(markdown.includes("positive_negative_conflict"), true);

  const result = spawnSync(
    process.execPath,
    [
      resolve(repoRoot, "bin/report-archived-raw-log-rescue-labels.cjs"),
      "--pair",
      `named_round=${labelsPath}:${candidatesPath}`,
      "--out-json",
      outJson,
      "--out-md",
      outMd,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(outJson), true);
  assert.equal(existsSync(outMd), true);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.mode, "archived_raw_log_rescue_combined_label_report");
  assert.ok(parsed.by_round.named_round);
  assert.equal(parsed.manual_review.total, 1);
  assert.equal(readFileSync(outMd, "utf8").includes("Yes false positives"), true);
});

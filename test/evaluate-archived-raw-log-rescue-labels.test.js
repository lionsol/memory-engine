import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  evaluateArchivedRawLogRescueLabels,
} = require("../bin/evaluate-archived-raw-log-rescue-labels.cjs");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixtureDir() {
  return mkdtempSync(resolve(tmpdir(), "archived-rescue-eval-"));
}

function writeJsonl(filePath, rows) {
  writeFileSync(filePath, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function candidate(overrides = {}) {
  return {
    sample_id: "rescue:1",
    primary_bucket: "archived_raw_log_decision",
    risk_signals: ["project:memory-engine", "decision_signal"],
    quality_flags: ["archived_raw_log", "raw_log_leak"],
    ...overrides,
  };
}

function label(overrides = {}) {
  return {
    sample_id: "rescue:1",
    primary_bucket: "archived_raw_log_decision",
    annotation: {
      keep_active: "yes",
      target_category: "project",
      rescue_confidence: "medium",
    },
    ...overrides,
  };
}

test("evaluates joined labels against v0.1 rules and v0.2 scoring", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({ sample_id: "rescue:project-decision" }),
    candidate({
      sample_id: "rescue:keyword",
      primary_bucket: "archived_raw_log_keyword",
      risk_signals: ["project:memory-engine", "decision_signal", "preference_signal"],
    }),
    candidate({
      sample_id: "rescue:todo",
      primary_bucket: "archived_raw_log_todo",
      risk_signals: ["project:memory-engine", "todo_signal"],
    }),
  ]);

  writeJsonl(labelsPath, [
    label({ sample_id: "rescue:project-decision" }),
    label({
      sample_id: "rescue:keyword",
      primary_bucket: "archived_raw_log_keyword",
      annotation: {
        keep_active: "no",
        target_category: "raw_log",
        rescue_confidence: "medium",
      },
    }),
    label({
      sample_id: "rescue:todo",
      primary_bucket: "archived_raw_log_todo",
      annotation: {
        keep_active: "unsure",
        target_category: "project",
        rescue_confidence: "medium",
      },
    }),
  ]);

  const report = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPath,
    candidatesInputPath: candidatesPath,
  });

  assert.equal(report.write_db, false);
  assert.equal(report.memory_side_effects, false);
  assert.equal(report.reinforcement_side_effects, false);
  assert.equal(report.summary.labels_total, 3);
  assert.equal(report.summary.labels_valid, 3);
  assert.equal(report.summary.labels_invalid, 0);
  assert.equal(report.v0_2_scoring.threshold, 55);
  assert.equal(report.v0_2_scoring.total, 3);
  assert.equal(report.v0_2_scoring.exact_match, 3);
  assert.equal(report.v0_2_scoring.yes_false_positive, 0);
  assert.equal(report.v0_2_scoring.yes_false_negative, 0);
  assert.ok(Array.isArray(report.v0_2_scoring.threshold_sweep));
  assert.ok(report.v0_2_scoring.threshold_sweep.some(row => row.threshold === 55));
});

test("reports invalid labels and missing candidates without using them for metrics", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({ sample_id: "rescue:valid" }),
    candidate({ sample_id: "rescue:missing-keep-active" }),
  ]);
  writeJsonl(labelsPath, [
    label({ sample_id: "rescue:valid" }),
    label({
      sample_id: "rescue:missing-keep-active",
      annotation: {
        target_category: "project",
        rescue_confidence: "medium",
      },
    }),
    label({
      sample_id: "rescue:missing-candidate",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "medium",
      },
    }),
  ]);

  const report = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPath,
    candidatesInputPath: candidatesPath,
  });

  assert.equal(report.summary.labels_total, 3);
  assert.equal(report.summary.labels_valid, 1);
  assert.equal(report.summary.labels_invalid, 2);
  assert.equal(report.summary.invalid_reasons.missing_keep_active, 1);
  assert.equal(report.summary.invalid_reasons.candidate_not_found, 1);
  assert.equal(report.v0_2_scoring.total, 1);
});

test("writes JSON report only when out is specified", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const outPath = resolve(dir, "report.json");

  writeJsonl(candidatesPath, [candidate()]);
  writeJsonl(labelsPath, [label()]);

  const report = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPath,
    candidatesInputPath: candidatesPath,
    out: outPath,
  });

  assert.equal(existsSync(outPath), true);
  const written = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(written.summary.labels_valid, report.summary.labels_valid);
});

test("CLI prints a JSON report", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [candidate()]);
  writeJsonl(labelsPath, [label()]);

  const result = spawnSync(
    process.execPath,
    [
      resolve(repoRoot, "bin/evaluate-archived-raw-log-rescue-labels.cjs"),
      "--labels",
      labelsPath,
      "--candidates",
      candidatesPath,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.mode, "archived_raw_log_rescue_label_evaluation");
  assert.equal(parsed.summary.labels_valid, 1);
});

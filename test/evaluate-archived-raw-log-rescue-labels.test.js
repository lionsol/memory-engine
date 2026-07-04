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
  evaluateArchivedRawLogRescueLabels,
} = require("../bin/evaluate-archived-raw-log-rescue-labels.cjs");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixtureDir() {
  return mkdtempSync(resolve(tmpdir(), "archived-rescue-eval-"));
}

function writeJsonl(filePath, rows) {
  writeFileSync(filePath, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
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
  assert.equal(report.what_if_calibration, undefined);
  assert.equal(report.calibration_grid, undefined);
});

test("does not leak label annotations into v0.1 rule predictions", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:label-only-yes",
      primary_bucket: "archived_raw_log_project",
      risk_signals: [],
      quality_flags: ["archived_raw_log", "raw_log_leak"],
      annotation: {},
    }),
  ]);
  writeJsonl(labelsPath, [
    label({
      sample_id: "rescue:label-only-yes",
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

  assert.equal(report.summary.labels_valid, 1);
  assert.equal(report.v0_1_rules.total, 1);
  assert.equal(report.v0_1_rules.exact_match, 0);
  assert.equal(report.v0_1_rules.yes_false_negative, 1);
  assert.equal(report.v0_1_rules.false_negatives[0].sample_id, "rescue:label-only-yes");
  assert.equal(report.v0_1_rules.false_negatives[0].rule_id, "S2_DEFAULT_DROP");
  assert.equal(report.v0_1_rules.diagnostics.prediction_distribution.primary_bucket.archived_raw_log_project, 1);
  assert.equal(report.v0_1_rules.diagnostics.actual_distribution.actual_keep_active.yes, 1);
  assert.equal(report.v0_1_rules.diagnostics.mismatch_distribution.rule_id.S2_DEFAULT_DROP, 1);
  assert.equal(report.v0_1_rules.diagnostics.false_negative_distribution.target_category.project, 1);
  assert.equal(report.v0_1_rules.diagnostics.false_negative_distribution.rescue_confidence.medium, 1);
  assert.equal(report.v0_2_scoring.diagnostics.mismatch_distribution.score_bucket["<0"], 1);
  assert.equal(report.v0_2_scoring.diagnostics.false_negative_distribution.rule_id["archived_raw_log_rescue_v0.2"], 1);
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

test("includes candidate-only calibration variants when requested without changing default metrics", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({ sample_id: "rescue:project-decision" }),
    candidate({
      sample_id: "rescue:todo",
      primary_bucket: "archived_raw_log_todo",
      risk_signals: ["project:memory-engine", "todo_signal"],
    }),
  ]);
  writeJsonl(labelsPath, [
    label({ sample_id: "rescue:project-decision" }),
    label({
      sample_id: "rescue:todo",
      primary_bucket: "archived_raw_log_todo",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "medium",
      },
    }),
  ]);

  const baseline = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPath,
    candidatesInputPath: candidatesPath,
  });
  const report = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPath,
    candidatesInputPath: candidatesPath,
    includeCalibration: true,
  });

  assert.equal(report.v0_1_rules.exact_match, baseline.v0_1_rules.exact_match);
  assert.equal(report.v0_2_scoring.exact_match, baseline.v0_2_scoring.exact_match);
  assert.equal(report.v0_2_scoring.yes_false_negative, baseline.v0_2_scoring.yes_false_negative);
  assert.ok(Array.isArray(report.what_if_calibration));
  assert.ok(report.what_if_calibration.length >= 1);

  const threshold30 = report.what_if_calibration.find(row => row.variant_id === "v0_2_threshold_30");
  assert.ok(threshold30);
  assert.equal(threshold30.total, 2);
  assert.equal(threshold30.yes_true_positive, 2);
  assert.equal(threshold30.yes_false_positive, 0);
  assert.equal(threshold30.yes_false_negative, 0);
  assert.equal(threshold30.false_positive_distribution.rule_id["v0_2_threshold_30"], undefined);
  assert.equal(threshold30.false_negative_distribution.primary_bucket.archived_raw_log_todo, undefined);
  assert.equal(threshold30.diagnostics.prediction_distribution.score_bucket["30-54"], 1);

  const rawLogPenalty25 = report.what_if_calibration.find(row => row.variant_id === "v0_2_raw_log_penalty_25");
  assert.ok(rawLogPenalty25);
  assert.equal(rawLogPenalty25.false_negative_distribution.rule_id["v0_2_raw_log_penalty_25"], 2);
  assert.equal(rawLogPenalty25.false_negative_distribution.primary_bucket.archived_raw_log_todo, 1);
  assert.equal(rawLogPenalty25.false_negative_distribution.primary_bucket.archived_raw_log_decision, 1);
  assert.equal(rawLogPenalty25.diagnostics.false_negative_distribution.score_bucket["0-29"], 1);
});

test("candidate-only calibration is not affected by label target category or rescue confidence", () => {
  const dir = fixtureDir();
  const labelsPathA = resolve(dir, "labels-a.jsonl");
  const labelsPathB = resolve(dir, "labels-b.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:label-only-yes",
      primary_bucket: "archived_raw_log_project",
      risk_signals: [],
      quality_flags: ["archived_raw_log", "raw_log_leak"],
      annotation: {},
    }),
  ]);
  writeJsonl(labelsPathA, [
    label({
      sample_id: "rescue:label-only-yes",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "low",
      },
    }),
  ]);
  writeJsonl(labelsPathB, [
    label({
      sample_id: "rescue:label-only-yes",
      annotation: {
        keep_active: "yes",
        target_category: "raw_log",
        rescue_confidence: "high",
      },
    }),
  ]);

  const reportA = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPathA,
    candidatesInputPath: candidatesPath,
    includeCalibration: true,
  });
  const reportB = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPathB,
    candidatesInputPath: candidatesPath,
    includeCalibration: true,
  });

  assert.deepEqual(
    reportA.what_if_calibration.map(row => ({
      variant_id: row.variant_id,
      exact_match: row.exact_match,
      yes_false_positive: row.yes_false_positive,
      yes_false_negative: row.yes_false_negative,
      false_negative_distribution: {
        predicted_keep_active: row.false_negative_distribution.predicted_keep_active,
        rule_id: row.false_negative_distribution.rule_id,
        primary_bucket: row.false_negative_distribution.primary_bucket,
        score_bucket: row.false_negative_distribution.score_bucket,
      },
    })),
    reportB.what_if_calibration.map(row => ({
      variant_id: row.variant_id,
      exact_match: row.exact_match,
      yes_false_positive: row.yes_false_positive,
      yes_false_negative: row.yes_false_negative,
      false_negative_distribution: {
        predicted_keep_active: row.false_negative_distribution.predicted_keep_active,
        rule_id: row.false_negative_distribution.rule_id,
        primary_bucket: row.false_negative_distribution.primary_bucket,
        score_bucket: row.false_negative_distribution.score_bucket,
      },
    })),
  );
});

test("includes calibration grid when requested without changing default metrics", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({ sample_id: "rescue:project-decision" }),
    candidate({
      sample_id: "rescue:todo",
      primary_bucket: "archived_raw_log_todo",
      risk_signals: ["project:memory-engine", "todo_signal"],
    }),
  ]);
  writeJsonl(labelsPath, [
    label({ sample_id: "rescue:project-decision" }),
    label({
      sample_id: "rescue:todo",
      primary_bucket: "archived_raw_log_todo",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "medium",
      },
    }),
  ]);

  const baseline = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPath,
    candidatesInputPath: candidatesPath,
  });
  const report = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPath,
    candidatesInputPath: candidatesPath,
    includeCalibrationGrid: true,
  });

  assert.equal(report.v0_1_rules.exact_match, baseline.v0_1_rules.exact_match);
  assert.equal(report.v0_2_scoring.exact_match, baseline.v0_2_scoring.exact_match);
  assert.equal(report.v0_2_scoring.yes_false_negative, baseline.v0_2_scoring.yes_false_negative);
  assert.equal(report.what_if_calibration, undefined);
  assert.ok(report.calibration_grid);
  assert.equal(Array.isArray(report.calibration_grid.variants), true);
  assert.equal(report.calibration_grid.variants.length, 36);
  assert.equal(Array.isArray(report.calibration_grid.top_variants), true);
  assert.ok(report.calibration_grid.top_variants.length <= 10);

  const variantIds = report.calibration_grid.variants.map(row => row.variant_id);
  assert.equal(variantIds[0], "v0_2_grid_t35_raw6_tool16");
  assert.equal(variantIds[variantIds.length - 1], "v0_2_grid_t50_raw15_tool8");
  assert.ok(variantIds.includes("v0_2_grid_t45_raw10_tool12"));

  const example = report.calibration_grid.variants.find(row => row.variant_id === "v0_2_grid_t45_raw10_tool12");
  assert.ok(example);
  assert.equal(example.threshold, 45);
  assert.equal(example.weights.rawLogPenalty, -10);
  assert.equal(example.weights.toolOutputPenalty, -12);
  assert.equal(typeof example.total, "number");
  assert.equal(typeof example.exact_match, "number");
  assert.equal(typeof example.exact_accuracy, "number");
  assert.equal(typeof example.yes_true_positive, "number");
  assert.equal(typeof example.yes_false_positive, "number");
  assert.equal(typeof example.yes_false_negative, "number");
  assert.ok(Object.prototype.hasOwnProperty.call(example, "yes_precision"));
  assert.ok(Object.prototype.hasOwnProperty.call(example, "yes_recall"));
  assert.ok(Object.prototype.hasOwnProperty.call(example, "yes_f1"));
  assert.ok(example.false_positive_distribution);
  assert.ok(example.false_negative_distribution);
  assert.ok(example.diagnostics.prediction_distribution.score_bucket);
});

test("calibration grid is candidate-only and unaffected by label target category or rescue confidence", () => {
  const dir = fixtureDir();
  const labelsPathA = resolve(dir, "labels-a.jsonl");
  const labelsPathB = resolve(dir, "labels-b.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:label-only-yes",
      primary_bucket: "archived_raw_log_project",
      risk_signals: [],
      quality_flags: ["archived_raw_log", "raw_log_leak"],
      annotation: {},
    }),
  ]);
  writeJsonl(labelsPathA, [
    label({
      sample_id: "rescue:label-only-yes",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "low",
      },
    }),
  ]);
  writeJsonl(labelsPathB, [
    label({
      sample_id: "rescue:label-only-yes",
      annotation: {
        keep_active: "yes",
        target_category: "raw_log",
        rescue_confidence: "high",
      },
    }),
  ]);

  const reportA = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPathA,
    candidatesInputPath: candidatesPath,
    includeCalibrationGrid: true,
  });
  const reportB = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPathB,
    candidatesInputPath: candidatesPath,
    includeCalibrationGrid: true,
  });

  assert.deepEqual(
    reportA.calibration_grid.variants.map(row => ({
      variant_id: row.variant_id,
      exact_match: row.exact_match,
      yes_false_positive: row.yes_false_positive,
      yes_false_negative: row.yes_false_negative,
      false_negative_distribution: {
        predicted_keep_active: row.false_negative_distribution.predicted_keep_active,
        rule_id: row.false_negative_distribution.rule_id,
        primary_bucket: row.false_negative_distribution.primary_bucket,
        score_bucket: row.false_negative_distribution.score_bucket,
      },
    })),
    reportB.calibration_grid.variants.map(row => ({
      variant_id: row.variant_id,
      exact_match: row.exact_match,
      yes_false_positive: row.yes_false_positive,
      yes_false_negative: row.yes_false_negative,
      false_negative_distribution: {
        predicted_keep_active: row.false_negative_distribution.predicted_keep_active,
        rule_id: row.false_negative_distribution.rule_id,
        primary_bucket: row.false_negative_distribution.primary_bucket,
        score_bucket: row.false_negative_distribution.score_bucket,
      },
    })),
  );
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
  const stdoutPath = resolve(dir, "stdout.json");

  writeJsonl(candidatesPath, [candidate()]);
  writeJsonl(labelsPath, [label()]);

  const result = spawnSync(
    "bash",
    [
      "-lc",
      `${shellQuote(process.execPath)} ${shellQuote(resolve(repoRoot, "bin/evaluate-archived-raw-log-rescue-labels.cjs"))} --labels ${shellQuote(labelsPath)} --candidates ${shellQuote(candidatesPath)} > ${shellQuote(stdoutPath)}`,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(
    result.status,
    0,
    `status=${result.status} signal=${result.signal} stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
  );
  const parsed = JSON.parse(readFileSync(stdoutPath, "utf8"));
  assert.equal(parsed.mode, "archived_raw_log_rescue_label_evaluation");
  assert.equal(parsed.summary.labels_valid, 1);
});

test("CLI prints calibration when requested", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const stdoutPath = resolve(dir, "stdout-calibration.json");

  writeJsonl(candidatesPath, [candidate()]);
  writeJsonl(labelsPath, [label()]);

  const result = spawnSync(
    "bash",
    [
      "-lc",
      `${shellQuote(process.execPath)} ${shellQuote(resolve(repoRoot, "bin/evaluate-archived-raw-log-rescue-labels.cjs"))} --labels ${shellQuote(labelsPath)} --candidates ${shellQuote(candidatesPath)} --include-calibration > ${shellQuote(stdoutPath)}`,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(
    result.status,
    0,
    `status=${result.status} signal=${result.signal} stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
  );
  const parsed = JSON.parse(readFileSync(stdoutPath, "utf8"));
  assert.equal(parsed.mode, "archived_raw_log_rescue_label_evaluation");
  assert.equal(Array.isArray(parsed.what_if_calibration), true);
  assert.ok(parsed.what_if_calibration.some(row => row.variant_id === "v0_2_threshold_30"));
});

test("CLI prints calibration grid when requested", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const stdoutPath = resolve(dir, "stdout-calibration-grid.json");

  writeJsonl(candidatesPath, [candidate()]);
  writeJsonl(labelsPath, [label()]);

  const result = spawnSync(
    "bash",
    [
      "-lc",
      `${shellQuote(process.execPath)} ${shellQuote(resolve(repoRoot, "bin/evaluate-archived-raw-log-rescue-labels.cjs"))} --labels ${shellQuote(labelsPath)} --candidates ${shellQuote(candidatesPath)} --include-calibration-grid > ${shellQuote(stdoutPath)}`,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(
    result.status,
    0,
    `status=${result.status} signal=${result.signal} stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
  );
  const parsed = JSON.parse(readFileSync(stdoutPath, "utf8"));
  assert.equal(parsed.mode, "archived_raw_log_rescue_label_evaluation");
  assert.equal(Array.isArray(parsed.calibration_grid.variants), true);
  assert.equal(parsed.calibration_grid.variants.length, 36);
  assert.ok(parsed.calibration_grid.variants.some(row => row.variant_id === "v0_2_grid_t35_raw6_tool16"));
});

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
  assert.equal(report.conflict_cap_diagnostics, undefined);
  assert.equal(report.tiered_cap_calibration, undefined);
  assert.equal(report.signal_diversity_diagnostics, undefined);
  assert.equal(report.scoring_parts_diagnostics, undefined);
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

test("includes conflict cap diagnostics when requested without changing default metrics", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:cap-no",
      primary_bucket: "archived_raw_log_project",
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
    candidate({
      sample_id: "rescue:cap-yes",
      primary_bucket: "archived_raw_log_project",
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
    candidate({
      sample_id: "rescue:cap-unsure",
      primary_bucket: "archived_raw_log_project",
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
  ]);
  writeJsonl(labelsPath, [
    label({
      sample_id: "rescue:cap-no",
      annotation: {
        keep_active: "no",
        target_category: "raw_log",
        rescue_confidence: "low",
      },
    }),
    label({
      sample_id: "rescue:cap-yes",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "high",
      },
    }),
    label({
      sample_id: "rescue:cap-unsure",
      annotation: {
        keep_active: "unsure",
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
    includeConflictCapDiagnostics: true,
  });

  assert.equal(report.v0_1_rules.exact_match, baseline.v0_1_rules.exact_match);
  assert.equal(report.v0_2_scoring.exact_match, baseline.v0_2_scoring.exact_match);
  assert.equal(report.v0_2_scoring.yes_false_negative, baseline.v0_2_scoring.yes_false_negative);
  assert.ok(report.conflict_cap_diagnostics);
  assert.equal(report.conflict_cap_diagnostics.capped_count, 3);
  assert.equal(report.conflict_cap_diagnostics.capped_false_positive_avoided_count, 2);
  assert.equal(report.conflict_cap_diagnostics.capped_false_negative_caused_count, 1);
  assert.equal(report.conflict_cap_diagnostics.capped_unsure_actual_count, 1);
  assert.equal(report.conflict_cap_diagnostics.capped_actual_distribution.no, 1);
  assert.equal(report.conflict_cap_diagnostics.capped_actual_distribution.yes, 1);
  assert.equal(report.conflict_cap_diagnostics.capped_actual_distribution.unsure, 1);
  assert.equal(report.conflict_cap_diagnostics.capped_primary_bucket_distribution.archived_raw_log_project, 3);
  assert.equal(report.conflict_cap_diagnostics.capped_score_bucket_distribution["55+"], 3);
  assert.equal(report.conflict_cap_diagnostics.capped_rule_id_distribution["archived_raw_log_rescue_v0.2"], 3);
  assert.equal(report.conflict_cap_diagnostics.capped_score_summary.min, 55);
  assert.equal(report.conflict_cap_diagnostics.capped_score_summary.max, 55);
  assert.equal(report.conflict_cap_diagnostics.capped_score_summary.average, 55);
  assert.equal(report.conflict_cap_diagnostics.capped_false_positive_avoided_examples.length, 2);
  assert.equal(report.conflict_cap_diagnostics.capped_false_negative_caused_examples.length, 1);
  assert.equal(report.conflict_cap_diagnostics.capped_false_positive_avoided_examples[0].sample_id, "rescue:cap-no");
  assert.equal(report.conflict_cap_diagnostics.capped_false_negative_caused_examples[0].sample_id, "rescue:cap-yes");
  assert.ok(report.conflict_cap_diagnostics.capped_false_negative_caused_examples[0].reasons.includes("positive_negative_conflict_prediction_cap:0"));
});

test("conflict cap diagnostics are candidate-only and unaffected by label target category or rescue confidence", () => {
  const dir = fixtureDir();
  const labelsPathA = resolve(dir, "labels-a.jsonl");
  const labelsPathB = resolve(dir, "labels-b.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:cap-yes",
      primary_bucket: "archived_raw_log_project",
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
  ]);
  writeJsonl(labelsPathA, [
    label({
      sample_id: "rescue:cap-yes",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "low",
      },
    }),
  ]);
  writeJsonl(labelsPathB, [
    label({
      sample_id: "rescue:cap-yes",
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
    includeConflictCapDiagnostics: true,
  });
  const reportB = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPathB,
    candidatesInputPath: candidatesPath,
    includeConflictCapDiagnostics: true,
  });

  assert.deepEqual(
    {
      capped_count: reportA.conflict_cap_diagnostics.capped_count,
      capped_primary_bucket_distribution: reportA.conflict_cap_diagnostics.capped_primary_bucket_distribution,
      capped_score_bucket_distribution: reportA.conflict_cap_diagnostics.capped_score_bucket_distribution,
      capped_rule_id_distribution: reportA.conflict_cap_diagnostics.capped_rule_id_distribution,
      capped_score_summary: reportA.conflict_cap_diagnostics.capped_score_summary,
      capped_false_positive_avoided_count: reportA.conflict_cap_diagnostics.capped_false_positive_avoided_count,
      capped_false_negative_caused_count: reportA.conflict_cap_diagnostics.capped_false_negative_caused_count,
      capped_unsure_actual_count: reportA.conflict_cap_diagnostics.capped_unsure_actual_count,
      capped_false_negative_caused_examples: reportA.conflict_cap_diagnostics.capped_false_negative_caused_examples.map(row => ({
        sample_id: row.sample_id,
        primary_bucket: row.primary_bucket,
        actual_keep_active: row.actual_keep_active,
        raw_predicted_keep_active: row.raw_predicted_keep_active,
        predicted_keep_active: row.predicted_keep_active,
        score: row.score,
        reasons: row.reasons,
      })),
    },
    {
      capped_count: reportB.conflict_cap_diagnostics.capped_count,
      capped_primary_bucket_distribution: reportB.conflict_cap_diagnostics.capped_primary_bucket_distribution,
      capped_score_bucket_distribution: reportB.conflict_cap_diagnostics.capped_score_bucket_distribution,
      capped_rule_id_distribution: reportB.conflict_cap_diagnostics.capped_rule_id_distribution,
      capped_score_summary: reportB.conflict_cap_diagnostics.capped_score_summary,
      capped_false_positive_avoided_count: reportB.conflict_cap_diagnostics.capped_false_positive_avoided_count,
      capped_false_negative_caused_count: reportB.conflict_cap_diagnostics.capped_false_negative_caused_count,
      capped_unsure_actual_count: reportB.conflict_cap_diagnostics.capped_unsure_actual_count,
      capped_false_negative_caused_examples: reportB.conflict_cap_diagnostics.capped_false_negative_caused_examples.map(row => ({
        sample_id: row.sample_id,
        primary_bucket: row.primary_bucket,
        actual_keep_active: row.actual_keep_active,
        raw_predicted_keep_active: row.raw_predicted_keep_active,
        predicted_keep_active: row.predicted_keep_active,
        score: row.score,
        reasons: row.reasons,
      })),
    },
  );
});

test("includes tiered cap calibration when requested without changing default metrics", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:cap-no-leak",
      primary_bucket: "archived_raw_log_project",
      quality_flags: ["archived_raw_log"],
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
    candidate({
      sample_id: "rescue:cap-leak",
      primary_bucket: "archived_raw_log_project",
      quality_flags: ["archived_raw_log", "raw_log_leak"],
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
  ]);
  writeJsonl(labelsPath, [
    label({
      sample_id: "rescue:cap-no-leak",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "high",
      },
    }),
    label({
      sample_id: "rescue:cap-leak",
      annotation: {
        keep_active: "no",
        target_category: "raw_log",
        rescue_confidence: "low",
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
    includeTieredCapCalibration: true,
  });

  assert.equal(report.v0_1_rules.exact_match, baseline.v0_1_rules.exact_match);
  assert.equal(report.v0_2_scoring.exact_match, baseline.v0_2_scoring.exact_match);
  assert.equal(report.v0_2_scoring.yes_false_negative, baseline.v0_2_scoring.yes_false_negative);
  assert.equal(Array.isArray(report.tiered_cap_calibration), true);

  const variantIds = report.tiered_cap_calibration.map(row => row.variant_id);
  assert.deepEqual(variantIds, [
    "baseline_current_cap",
    "no_conflict_cap",
    "cap_only_when_raw_log_leak",
    "cap_when_raw_log_leak_or_score_below_60",
    "cap_when_raw_log_leak_or_primary_bucket_project",
  ]);

  const baselineVariant = report.tiered_cap_calibration.find(row => row.variant_id === "baseline_current_cap");
  assert.ok(baselineVariant);
  assert.equal(baselineVariant.exact_match, report.v0_2_scoring.exact_match);
  assert.equal(baselineVariant.exact_accuracy, report.v0_2_scoring.exact_accuracy);
  assert.equal(baselineVariant.yes_true_positive, report.v0_2_scoring.yes_true_positive);
  assert.equal(baselineVariant.yes_false_positive, report.v0_2_scoring.yes_false_positive);
  assert.equal(baselineVariant.yes_false_negative, report.v0_2_scoring.yes_false_negative);
  assert.equal(baselineVariant.yes_precision, report.v0_2_scoring.yes_precision);
  assert.equal(baselineVariant.yes_recall, report.v0_2_scoring.yes_recall);
  assert.equal(baselineVariant.yes_f1, report.v0_2_scoring.yes_f1);

  const leakOnly = report.tiered_cap_calibration.find(row => row.variant_id === "cap_only_when_raw_log_leak");
  assert.ok(leakOnly);
  assert.equal(leakOnly.capped_count, 1);
  assert.equal(leakOnly.capped_false_positive_avoided_count, 1);
  assert.equal(leakOnly.capped_false_negative_caused_count, 0);
  assert.equal(leakOnly.uncapped_yes_count, 1);
  assert.equal(leakOnly.yes_false_positive, 0);
  assert.equal(leakOnly.yes_false_negative, 0);
  assert.equal(leakOnly.false_positive_examples.length, 0);
  assert.equal(leakOnly.false_negative_examples.length, 0);
  assert.ok(leakOnly.diagnostics.prediction_distribution.score_bucket["55+"] >= 1);

  const noCap = report.tiered_cap_calibration.find(row => row.variant_id === "no_conflict_cap");
  assert.ok(noCap);
  assert.equal(noCap.capped_count, 0);
  assert.equal(noCap.uncapped_yes_count, 2);
  assert.equal(noCap.yes_false_positive, 1);
  assert.equal(noCap.yes_false_negative, 0);
});

test("tiered cap calibration is candidate-only and unaffected by label target category or rescue confidence", () => {
  const dir = fixtureDir();
  const labelsPathA = resolve(dir, "labels-a.jsonl");
  const labelsPathB = resolve(dir, "labels-b.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:cap-no-leak",
      primary_bucket: "archived_raw_log_project",
      quality_flags: ["archived_raw_log"],
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
  ]);
  writeJsonl(labelsPathA, [
    label({
      sample_id: "rescue:cap-no-leak",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "low",
      },
    }),
  ]);
  writeJsonl(labelsPathB, [
    label({
      sample_id: "rescue:cap-no-leak",
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
    includeTieredCapCalibration: true,
  });
  const reportB = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPathB,
    candidatesInputPath: candidatesPath,
    includeTieredCapCalibration: true,
  });

  assert.deepEqual(
    reportA.tiered_cap_calibration.map(row => ({
      variant_id: row.variant_id,
      exact_match: row.exact_match,
      yes_false_positive: row.yes_false_positive,
      yes_false_negative: row.yes_false_negative,
      capped_count: row.capped_count,
      capped_false_positive_avoided_count: row.capped_false_positive_avoided_count,
      capped_false_negative_caused_count: row.capped_false_negative_caused_count,
      uncapped_yes_count: row.uncapped_yes_count,
      false_negative_distribution: {
        predicted_keep_active: row.false_negative_distribution.predicted_keep_active,
        rule_id: row.false_negative_distribution.rule_id,
        primary_bucket: row.false_negative_distribution.primary_bucket,
        score_bucket: row.false_negative_distribution.score_bucket,
      },
    })),
    reportB.tiered_cap_calibration.map(row => ({
      variant_id: row.variant_id,
      exact_match: row.exact_match,
      yes_false_positive: row.yes_false_positive,
      yes_false_negative: row.yes_false_negative,
      capped_count: row.capped_count,
      capped_false_positive_avoided_count: row.capped_false_positive_avoided_count,
      capped_false_negative_caused_count: row.capped_false_negative_caused_count,
      uncapped_yes_count: row.uncapped_yes_count,
      false_negative_distribution: {
        predicted_keep_active: row.false_negative_distribution.predicted_keep_active,
        rule_id: row.false_negative_distribution.rule_id,
        primary_bucket: row.false_negative_distribution.primary_bucket,
        score_bucket: row.false_negative_distribution.score_bucket,
      },
    })),
  );
});

test("includes signal diversity diagnostics when requested without changing default metrics", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:diversity-fn",
      primary_bucket: "archived_raw_log_project",
      quality_flags: ["archived_raw_log"],
      risk_signals: [
        "project:memory-engine",
        "decision_signal",
        "preference_signal",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
    candidate({
      sample_id: "rescue:diversity-fp",
      primary_bucket: "archived_raw_log_project",
      quality_flags: ["archived_raw_log", "raw_log_leak"],
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
    candidate({
      sample_id: "rescue:diversity-unsure",
      primary_bucket: "archived_raw_log_project",
      quality_flags: ["archived_raw_log", "raw_log_leak"],
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
  ]);
  writeJsonl(labelsPath, [
    label({
      sample_id: "rescue:diversity-fn",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "high",
      },
    }),
    label({
      sample_id: "rescue:diversity-fp",
      annotation: {
        keep_active: "no",
        target_category: "raw_log",
        rescue_confidence: "low",
      },
    }),
    label({
      sample_id: "rescue:diversity-unsure",
      annotation: {
        keep_active: "unsure",
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
    includeSignalDiversityDiagnostics: true,
  });

  assert.equal(report.v0_1_rules.exact_match, baseline.v0_1_rules.exact_match);
  assert.equal(report.v0_2_scoring.exact_match, baseline.v0_2_scoring.exact_match);
  assert.equal(report.v0_2_scoring.yes_false_negative, baseline.v0_2_scoring.yes_false_negative);
  assert.ok(report.signal_diversity_diagnostics);
  assert.equal(report.signal_diversity_diagnostics.capped_false_positive_avoided.count, 1);
  assert.equal(report.signal_diversity_diagnostics.capped_false_negative_caused.count, 1);
  assert.equal(report.signal_diversity_diagnostics.capped_unsure_actual.count, 1);

  const fnExample = report.signal_diversity_diagnostics.capped_false_negative_caused.examples[0];
  const fpExample = report.signal_diversity_diagnostics.capped_false_positive_avoided.examples[0];
  assert.equal(fnExample.sample_id, "rescue:diversity-fn");
  assert.equal(fpExample.sample_id, "rescue:diversity-fp");
  assert.ok(fnExample.positive_signal_family_count > fpExample.positive_signal_family_count);
  assert.equal(fnExample.pattern_flags.high_value_multi_signal_pattern, true);
  assert.equal(fpExample.pattern_flags.project_plus_noise_only_pattern, false);
  assert.equal(report.signal_diversity_diagnostics.capped_false_negative_caused.high_value_signal_distributions.has_decision_signal.true, 1);
  assert.equal(report.signal_diversity_diagnostics.capped_false_positive_avoided.high_value_signal_distributions.has_decision_signal.true, 0);
  assert.equal(report.signal_diversity_diagnostics.candidate_rules_preview.uncap_if_has_decision_or_preference, 1);
  assert.equal(report.signal_diversity_diagnostics.candidate_rules_preview.cap_if_project_plus_noise_only, 0);
});

test("signal diversity diagnostics are candidate-only and unaffected by label target category or rescue confidence", () => {
  const dir = fixtureDir();
  const labelsPathA = resolve(dir, "labels-a.jsonl");
  const labelsPathB = resolve(dir, "labels-b.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:diversity-fn",
      primary_bucket: "archived_raw_log_project",
      quality_flags: ["archived_raw_log"],
      risk_signals: [
        "project:memory-engine",
        "decision_signal",
        "preference_signal",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
  ]);
  writeJsonl(labelsPathA, [
    label({
      sample_id: "rescue:diversity-fn",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "low",
      },
    }),
  ]);
  writeJsonl(labelsPathB, [
    label({
      sample_id: "rescue:diversity-fn",
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
    includeSignalDiversityDiagnostics: true,
  });
  const reportB = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPathB,
    candidatesInputPath: candidatesPath,
    includeSignalDiversityDiagnostics: true,
  });

  assert.deepEqual(
    {
      capped_false_negative_caused: reportA.signal_diversity_diagnostics.capped_false_negative_caused,
      candidate_rules_preview: reportA.signal_diversity_diagnostics.candidate_rules_preview,
    },
    {
      capped_false_negative_caused: reportB.signal_diversity_diagnostics.capped_false_negative_caused,
      candidate_rules_preview: reportB.signal_diversity_diagnostics.candidate_rules_preview,
    },
  );
});

test("includes scoring parts diagnostics when requested without changing default metrics", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:parts-fn",
      primary_bucket: "archived_raw_log_project",
      quality_flags: ["archived_raw_log"],
      risk_signals: [
        "project:memory-engine",
        "decision_signal",
        "preference_signal",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
    candidate({
      sample_id: "rescue:parts-fp",
      primary_bucket: "archived_raw_log_project",
      quality_flags: ["archived_raw_log"],
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
    candidate({
      sample_id: "rescue:parts-unsure",
      primary_bucket: "archived_raw_log_project",
      quality_flags: ["archived_raw_log"],
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
  ]);
  writeJsonl(labelsPath, [
    label({
      sample_id: "rescue:parts-fn",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "high",
      },
    }),
    label({
      sample_id: "rescue:parts-fp",
      annotation: {
        keep_active: "no",
        target_category: "raw_log",
        rescue_confidence: "low",
      },
    }),
    label({
      sample_id: "rescue:parts-unsure",
      annotation: {
        keep_active: "unsure",
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
    includeScoringPartsDiagnostics: true,
  });

  assert.equal(report.v0_1_rules.exact_match, baseline.v0_1_rules.exact_match);
  assert.equal(report.v0_2_scoring.exact_match, baseline.v0_2_scoring.exact_match);
  assert.equal(report.v0_2_scoring.yes_false_negative, baseline.v0_2_scoring.yes_false_negative);
  assert.ok(report.scoring_parts_diagnostics);
  assert.equal(report.scoring_parts_diagnostics.capped_false_positive_avoided.count, 1);
  assert.equal(report.scoring_parts_diagnostics.capped_false_negative_caused.count, 1);
  assert.equal(report.scoring_parts_diagnostics.capped_unsure_actual.count, 1);

  const fnExample = report.scoring_parts_diagnostics.capped_false_negative_caused.examples[0];
  const fpExample = report.scoring_parts_diagnostics.capped_false_positive_avoided.examples[0];
  assert.equal(fnExample.sample_id, "rescue:parts-fn");
  assert.equal(fpExample.sample_id, "rescue:parts-fp");
  assert.equal(fnExample.pattern_flags.high_value_positive_parts_pattern, true);
  assert.equal(fpExample.pattern_flags.project_plus_engineering_only_positive_parts_pattern, true);
  assert.equal(report.scoring_parts_diagnostics.capped_false_negative_caused.boolean_scoring_part_distributions.has_project_decision_signal_part.true, 1);
  assert.equal(report.scoring_parts_diagnostics.capped_false_negative_caused.boolean_scoring_part_distributions.has_preference_signal_part.true, 1);
  assert.equal(report.scoring_parts_diagnostics.capped_false_positive_avoided.boolean_scoring_part_distributions.has_project_decision_signal_part.true, 0);
  assert.equal(report.scoring_parts_diagnostics.candidate_rules_preview.uncap_if_has_project_decision_or_preference_part, 1);
  assert.equal(report.scoring_parts_diagnostics.candidate_rules_preview.uncap_if_high_value_positive_parts_pattern, 1);
  assert.equal(report.scoring_parts_diagnostics.candidate_rules_preview.cap_if_project_plus_engineering_only_positive_parts_pattern, 2);
});

test("scoring parts diagnostics are candidate-only and unaffected by label target category or rescue confidence", () => {
  const dir = fixtureDir();
  const labelsPathA = resolve(dir, "labels-a.jsonl");
  const labelsPathB = resolve(dir, "labels-b.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:parts-fn",
      primary_bucket: "archived_raw_log_project",
      quality_flags: ["archived_raw_log"],
      risk_signals: [
        "project:memory-engine",
        "decision_signal",
        "preference_signal",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
  ]);
  writeJsonl(labelsPathA, [
    label({
      sample_id: "rescue:parts-fn",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "low",
      },
    }),
  ]);
  writeJsonl(labelsPathB, [
    label({
      sample_id: "rescue:parts-fn",
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
    includeScoringPartsDiagnostics: true,
  });
  const reportB = evaluateArchivedRawLogRescueLabels({
    labelsInputPath: labelsPathB,
    candidatesInputPath: candidatesPath,
    includeScoringPartsDiagnostics: true,
  });

  assert.deepEqual(
    {
      capped_false_negative_caused: reportA.scoring_parts_diagnostics.capped_false_negative_caused,
      candidate_rules_preview: reportA.scoring_parts_diagnostics.candidate_rules_preview,
    },
    {
      capped_false_negative_caused: reportB.scoring_parts_diagnostics.capped_false_negative_caused,
      candidate_rules_preview: reportB.scoring_parts_diagnostics.candidate_rules_preview,
    },
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

test("CLI prints conflict cap diagnostics when requested", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const stdoutPath = resolve(dir, "stdout-conflict-cap.json");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:cap-yes",
      primary_bucket: "archived_raw_log_project",
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
  ]);
  writeJsonl(labelsPath, [
    label({
      sample_id: "rescue:cap-yes",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "high",
      },
    }),
  ]);

  const result = spawnSync(
    "bash",
    [
      "-lc",
      `${shellQuote(process.execPath)} ${shellQuote(resolve(repoRoot, "bin/evaluate-archived-raw-log-rescue-labels.cjs"))} --labels ${shellQuote(labelsPath)} --candidates ${shellQuote(candidatesPath)} --include-conflict-cap-diagnostics > ${shellQuote(stdoutPath)}`,
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
  assert.equal(parsed.conflict_cap_diagnostics.capped_count, 1);
  assert.equal(parsed.conflict_cap_diagnostics.capped_false_negative_caused_count, 1);
});

test("CLI prints tiered cap calibration when requested", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const stdoutPath = resolve(dir, "stdout-tiered-cap-calibration.json");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:cap-no-leak",
      primary_bucket: "archived_raw_log_project",
      quality_flags: ["archived_raw_log"],
      risk_signals: [
        "project:memory-engine",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
  ]);
  writeJsonl(labelsPath, [
    label({
      sample_id: "rescue:cap-no-leak",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "high",
      },
    }),
  ]);

  const result = spawnSync(
    "bash",
    [
      "-lc",
      `${shellQuote(process.execPath)} ${shellQuote(resolve(repoRoot, "bin/evaluate-archived-raw-log-rescue-labels.cjs"))} --labels ${shellQuote(labelsPath)} --candidates ${shellQuote(candidatesPath)} --include-tiered-cap-calibration > ${shellQuote(stdoutPath)}`,
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
  assert.equal(Array.isArray(parsed.tiered_cap_calibration), true);
  assert.ok(parsed.tiered_cap_calibration.some(row => row.variant_id === "baseline_current_cap"));
  assert.ok(parsed.tiered_cap_calibration.some(row => row.variant_id === "cap_only_when_raw_log_leak"));
});

test("CLI prints signal diversity diagnostics when requested", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const stdoutPath = resolve(dir, "stdout-signal-diversity.json");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:diversity-fn",
      primary_bucket: "archived_raw_log_project",
      quality_flags: ["archived_raw_log"],
      risk_signals: [
        "project:memory-engine",
        "decision_signal",
        "preference_signal",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
  ]);
  writeJsonl(labelsPath, [
    label({
      sample_id: "rescue:diversity-fn",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "high",
      },
    }),
  ]);

  const result = spawnSync(
    "bash",
    [
      "-lc",
      `${shellQuote(process.execPath)} ${shellQuote(resolve(repoRoot, "bin/evaluate-archived-raw-log-rescue-labels.cjs"))} --labels ${shellQuote(labelsPath)} --candidates ${shellQuote(candidatesPath)} --include-signal-diversity-diagnostics > ${shellQuote(stdoutPath)}`,
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
  assert.equal(parsed.signal_diversity_diagnostics.capped_false_negative_caused.count, 1);
});

test("CLI prints scoring parts diagnostics when requested", () => {
  const dir = fixtureDir();
  const labelsPath = resolve(dir, "labels.jsonl");
  const candidatesPath = resolve(dir, "candidates.jsonl");
  const stdoutPath = resolve(dir, "stdout-scoring-parts.json");

  writeJsonl(candidatesPath, [
    candidate({
      sample_id: "rescue:parts-fn",
      primary_bucket: "archived_raw_log_project",
      quality_flags: ["archived_raw_log"],
      risk_signals: [
        "project:memory-engine",
        "decision_signal",
        "preference_signal",
        "engineering_evidence_signal",
        "transient_runtime_noise_signal",
      ],
    }),
  ]);
  writeJsonl(labelsPath, [
    label({
      sample_id: "rescue:parts-fn",
      annotation: {
        keep_active: "yes",
        target_category: "project",
        rescue_confidence: "high",
      },
    }),
  ]);

  const result = spawnSync(
    "bash",
    [
      "-lc",
      `${shellQuote(process.execPath)} ${shellQuote(resolve(repoRoot, "bin/evaluate-archived-raw-log-rescue-labels.cjs"))} --labels ${shellQuote(labelsPath)} --candidates ${shellQuote(candidatesPath)} --include-scoring-parts-diagnostics > ${shellQuote(stdoutPath)}`,
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
  assert.equal(parsed.scoring_parts_diagnostics.capped_false_negative_caused.count, 1);
});

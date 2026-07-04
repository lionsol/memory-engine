#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  evaluateArchivedRawLogRescueRules,
  normalizeAnnotation,
} = require('../lib/annotation/archived-raw-log-rescue-rules.cjs');
const {
  DEFAULT_RESCUE_SCORING_THRESHOLD,
  DEFAULT_RESCUE_UNSURE_THRESHOLD,
  DEFAULT_RESCUE_SCORING_WEIGHTS,
  computeArchivedRawLogRescueScore,
} = require('../lib/annotation/archived-raw-log-rescue-scoring.cjs');

const VALID_KEEP_ACTIVE = new Set(['yes', 'no', 'unsure']);

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function parseNumber(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  function valueFor(name) {
    const prefix = `${name}=`;
    const exact = args.indexOf(name);
    if (exact >= 0 && args[exact + 1] && !args[exact + 1].startsWith('--')) return args[exact + 1];
    const joined = args.find(a => a.startsWith(prefix));
    return joined ? joined.slice(prefix.length) : undefined;
  }

  return {
    labelsInputPath: valueFor('--labels') || valueFor('--labels-input') || 'reports/archived-raw-log-rescue_labels_seed_v0.1_20samples_20260702.jsonl',
    candidatesInputPath: valueFor('--candidates') || valueFor('--candidates-input') || 'reports/archived-raw-log-rescue-candidates-latest.jsonl',
    out: valueFor('--out'),
    includeCalibration: args.includes('--include-calibration'),
    includeCalibrationGrid: args.includes('--include-calibration-grid'),
    includeConflictCapDiagnostics: args.includes('--include-conflict-cap-diagnostics'),
    includeTieredCapCalibration: args.includes('--include-tiered-cap-calibration'),
    threshold: parseNumber(valueFor('--threshold'), DEFAULT_RESCUE_SCORING_THRESHOLD),
    unsureThreshold: parseNumber(valueFor('--unsure-threshold'), DEFAULT_RESCUE_UNSURE_THRESHOLD),
    sweepMin: parseNumber(valueFor('--sweep-min'), 30),
    sweepMax: parseNumber(valueFor('--sweep-max'), 80),
    sweepStep: parseNumber(valueFor('--sweep-step'), 5),
  };
}

function bySampleId(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row && row.sample_id) map.set(row.sample_id, row);
  }
  return map;
}

function mergeCandidateAndLabel(candidate, label) {
  return {
    ...(candidate || {}),
    ...(label || {}),
    risk_signals: Array.isArray(label?.risk_signals) ? label.risk_signals : (candidate?.risk_signals || []),
    quality_flags: Array.isArray(label?.quality_flags) ? label.quality_flags : (candidate?.quality_flags || []),
    annotation: label?.annotation || {},
  };
}

function buildPredictionSample(candidate = {}, label = {}) {
  return {
    ...candidate,
    sample_id: candidate.sample_id || label.sample_id,
    risk_signals: Array.isArray(candidate.risk_signals) ? candidate.risk_signals : [],
    quality_flags: Array.isArray(candidate.quality_flags) ? candidate.quality_flags : [],
    annotation: candidate.annotation || {},
  };
}

function classifyForThreshold(score, threshold, unsureThreshold) {
  if (score >= threshold) return 'yes';
  if (score >= unsureThreshold) return 'unsure';
  return 'no';
}

function emptyMetrics() {
  return {
    total: 0,
    exact_match: 0,
    exact_accuracy: 0,
    yes_true_positive: 0,
    yes_false_positive: 0,
    yes_false_negative: 0,
    yes_true_negative: 0,
    yes_precision: null,
    yes_recall: null,
    yes_f1: null,
    false_positives: [],
    false_negatives: [],
  };
}

function finalizeMetrics(metrics) {
  metrics.exact_accuracy = metrics.total > 0 ? metrics.exact_match / metrics.total : 0;
  const precisionDen = metrics.yes_true_positive + metrics.yes_false_positive;
  const recallDen = metrics.yes_true_positive + metrics.yes_false_negative;
  metrics.yes_precision = precisionDen > 0 ? metrics.yes_true_positive / precisionDen : null;
  metrics.yes_recall = recallDen > 0 ? metrics.yes_true_positive / recallDen : null;
  metrics.yes_f1 = metrics.yes_precision != null && metrics.yes_recall != null && (metrics.yes_precision + metrics.yes_recall) > 0
    ? 2 * metrics.yes_precision * metrics.yes_recall / (metrics.yes_precision + metrics.yes_recall)
    : null;
  return metrics;
}

function updateMetrics(metrics, row) {
  const actual = row.actual_keep_active;
  const predicted = row.predicted_keep_active;
  metrics.total += 1;
  if (actual === predicted) metrics.exact_match += 1;

  if (actual === 'yes' && predicted === 'yes') metrics.yes_true_positive += 1;
  else if (actual !== 'yes' && predicted === 'yes') {
    metrics.yes_false_positive += 1;
    metrics.false_positives.push(row);
  } else if (actual === 'yes' && predicted !== 'yes') {
    metrics.yes_false_negative += 1;
    metrics.false_negatives.push(row);
  } else {
    metrics.yes_true_negative += 1;
  }
}

function compactMismatch(row) {
  return {
    sample_id: row.sample_id,
    primary_bucket: row.primary_bucket,
    actual_keep_active: row.actual_keep_active,
    predicted_keep_active: row.predicted_keep_active,
    rule_id: row.rule_id,
    score: row.score,
    target_category: row.target_category,
    rescue_confidence: row.rescue_confidence,
    reasons: row.reasons,
  };
}

function incrementCount(map, key) {
  const normalizedKey = key == null || key === '' ? '(missing)' : String(key);
  map[normalizedKey] = (map[normalizedKey] || 0) + 1;
}

function scoreBucket(score) {
  if (!Number.isFinite(score)) return '(missing)';
  if (score < 0) return '<0';
  if (score <= 29) return '0-29';
  if (score <= 54) return '30-54';
  return '55+';
}

function buildDistribution(rows, fields) {
  const out = {};
  for (const field of fields) {
    const key = typeof field === 'function'
      ? field.fieldName
      : field;
    out[key] = {};
  }
  for (const row of rows) {
    for (const field of fields) {
      const value = typeof field === 'function'
        ? field(row)
        : row[field];
      const key = typeof field === 'function'
        ? field.fieldName
        : field;
      incrementCount(out[key], value);
    }
  }
  return out;
}

function buildMismatchDiagnostics(rows, options = {}) {
  const sharedFields = [
    'primary_bucket',
    'target_category',
    'rescue_confidence',
    ...(options.includeScoreBucket ? [Object.assign(row => scoreBucket(row.score), { fieldName: 'score_bucket' })] : []),
  ];
  const predictionFields = ['predicted_keep_active', 'rule_id', ...sharedFields];
  const actualFields = ['actual_keep_active', ...sharedFields];
  const mismatches = rows.filter(row => row.actual_keep_active !== row.predicted_keep_active);
  const falsePositives = rows.filter(row => row.actual_keep_active !== 'yes' && row.predicted_keep_active === 'yes');
  const falseNegatives = rows.filter(row => row.actual_keep_active === 'yes' && row.predicted_keep_active !== 'yes');

  return {
    prediction_distribution: buildDistribution(rows, predictionFields),
    actual_distribution: buildDistribution(rows, actualFields),
    mismatch_distribution: buildDistribution(mismatches, predictionFields),
    false_positive_distribution: buildDistribution(falsePositives, predictionFields),
    false_negative_distribution: buildDistribution(falseNegatives, predictionFields),
  };
}

function buildThresholdSweep(validRows, thresholdOptions) {
  const out = [];
  for (let threshold = thresholdOptions.sweepMin; threshold <= thresholdOptions.sweepMax; threshold += thresholdOptions.sweepStep) {
    const metrics = emptyMetrics();
    for (const row of validRows) {
      const predicted = classifyForThreshold(row.score, threshold, thresholdOptions.unsureThreshold);
      updateMetrics(metrics, {
        ...row,
        predicted_keep_active: predicted,
      });
    }
    finalizeMetrics(metrics);
    out.push({
      threshold,
      exact_accuracy: metrics.exact_accuracy,
      yes_precision: metrics.yes_precision,
      yes_recall: metrics.yes_recall,
      yes_f1: metrics.yes_f1,
      yes_false_positive: metrics.yes_false_positive,
      yes_false_negative: metrics.yes_false_negative,
    });
  }
  return out;
}

function calibrationVariants() {
  return [
    {
      variant_id: 'v0_2_threshold_30',
      threshold: 30,
      unsureThreshold: DEFAULT_RESCUE_UNSURE_THRESHOLD,
      weights: {},
    },
    {
      variant_id: 'v0_2_raw_log_penalty_25',
      threshold: DEFAULT_RESCUE_SCORING_THRESHOLD,
      unsureThreshold: DEFAULT_RESCUE_UNSURE_THRESHOLD,
      weights: { rawLogPenalty: -25 },
    },
    {
      variant_id: 'v0_2_tool_output_penalty_8',
      threshold: DEFAULT_RESCUE_SCORING_THRESHOLD,
      unsureThreshold: DEFAULT_RESCUE_UNSURE_THRESHOLD,
      weights: { toolOutputPenalty: -8 },
    },
    {
      variant_id: 'v0_2_raw_log_penalty_25_threshold_30',
      threshold: 30,
      unsureThreshold: DEFAULT_RESCUE_UNSURE_THRESHOLD,
      weights: { rawLogPenalty: -25 },
    },
  ];
}

function calibrationGridVariants() {
  const thresholds = [35, 40, 45, 50];
  const rawLogPenalties = [-6, -10, -15];
  const toolOutputPenalties = [-16, -12, -8];
  const variants = [];

  for (const threshold of thresholds) {
    for (const rawLogPenalty of rawLogPenalties) {
      for (const toolOutputPenalty of toolOutputPenalties) {
        variants.push({
          variant_id: `v0_2_grid_t${threshold}_raw${Math.abs(rawLogPenalty)}_tool${Math.abs(toolOutputPenalty)}`,
          threshold,
          unsureThreshold: DEFAULT_RESCUE_UNSURE_THRESHOLD,
          weights: {
            rawLogPenalty,
            toolOutputPenalty,
          },
        });
      }
    }
  }

  return variants;
}

function evaluateCalibrationVariant(rows, variant) {
  const metrics = emptyMetrics();
  const variantRows = [];
  for (const row of rows) {
    const scoring = computeArchivedRawLogRescueScore(row.prediction_sample, {
      threshold: variant.threshold,
      unsureThreshold: variant.unsureThreshold,
      weights: variant.weights,
    });
    const variantRow = {
      sample_id: row.sample_id,
      primary_bucket: row.primary_bucket,
      target_category: row.target_category,
      rescue_confidence: row.rescue_confidence,
      actual_keep_active: row.actual_keep_active,
      predicted_keep_active: scoring.predicted_keep_active,
      rule_id: variant.variant_id,
      score: scoring.score,
      reasons: scoring.parts.map(part => `${part.name}:${part.value}`),
    };
    updateMetrics(metrics, variantRow);
    variantRows.push(variantRow);
  }

  finalizeMetrics(metrics);
  const diagnostics = buildMismatchDiagnostics(variantRows, { includeScoreBucket: true });
  return {
    variant_id: variant.variant_id,
    threshold: variant.threshold,
    unsure_threshold: variant.unsureThreshold,
    weights: {
      ...DEFAULT_RESCUE_SCORING_WEIGHTS,
      ...variant.weights,
    },
    ...metrics,
    false_positives: metrics.false_positives.map(compactMismatch),
    false_negatives: metrics.false_negatives.map(compactMismatch),
    false_positive_distribution: diagnostics.false_positive_distribution,
    false_negative_distribution: diagnostics.false_negative_distribution,
    diagnostics,
  };
}

function calibrationGridTopVariants(variants) {
  function compareNullableDesc(a, b) {
    const aValue = a == null ? Number.NEGATIVE_INFINITY : a;
    const bValue = b == null ? Number.NEGATIVE_INFINITY : b;
    return bValue - aValue;
  }

  return variants
    .slice()
    .sort((a, b) => {
      const f1Diff = compareNullableDesc(a.yes_f1, b.yes_f1);
      if (f1Diff !== 0) return f1Diff;
      if (a.yes_false_positive !== b.yes_false_positive) return a.yes_false_positive - b.yes_false_positive;
      const recallDiff = compareNullableDesc(a.yes_recall, b.yes_recall);
      if (recallDiff !== 0) return recallDiff;
      if (a.exact_accuracy !== b.exact_accuracy) return b.exact_accuracy - a.exact_accuracy;
      return a.variant_id.localeCompare(b.variant_id);
    })
    .slice(0, 10)
    .map(variant => ({
      variant_id: variant.variant_id,
      threshold: variant.threshold,
      yes_f1: variant.yes_f1,
      yes_false_positive: variant.yes_false_positive,
      yes_recall: variant.yes_recall,
      exact_accuracy: variant.exact_accuracy,
    }));
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compareConflictExamples(a, b) {
  if (a.score !== b.score) return b.score - a.score;
  if (a.primary_bucket !== b.primary_bucket) return a.primary_bucket.localeCompare(b.primary_bucket);
  return a.sample_id.localeCompare(b.sample_id);
}

function compactConflictExample(row) {
  return {
    sample_id: row.sample_id,
    primary_bucket: row.primary_bucket,
    actual_keep_active: row.actual_keep_active,
    raw_predicted_keep_active: row.raw_predicted_keep_active,
    predicted_keep_active: row.predicted_keep_active,
    score: row.score,
    target_category: row.target_category,
    rescue_confidence: row.rescue_confidence,
    reasons: row.reasons,
  };
}

function buildConflictCapDiagnostics(rows) {
  const cappedRows = rows.filter(row =>
    row.raw_predicted_keep_active === 'yes' &&
    row.predicted_keep_active === 'unsure' &&
    (
      row.manual_review_flags.includes('positive_negative_conflict') ||
      row.reasons.includes('positive_negative_conflict_prediction_cap:0')
    )
  );
  const cappedFalsePositiveAvoided = cappedRows.filter(row => row.actual_keep_active !== 'yes');
  const cappedFalseNegativeCaused = cappedRows.filter(row => row.actual_keep_active === 'yes');
  const cappedUnsureActual = cappedRows.filter(row => row.actual_keep_active === 'unsure');
  const scores = cappedRows.map(row => row.score);

  return {
    capped_count: cappedRows.length,
    capped_actual_distribution: buildDistribution(cappedRows, ['actual_keep_active']).actual_keep_active,
    capped_primary_bucket_distribution: buildDistribution(cappedRows, ['primary_bucket']).primary_bucket,
    capped_score_bucket_distribution: buildDistribution(cappedRows, [Object.assign(row => scoreBucket(row.score), { fieldName: 'score_bucket' })]).score_bucket,
    capped_target_category_distribution: buildDistribution(cappedRows, ['target_category']).target_category,
    capped_rescue_confidence_distribution: buildDistribution(cappedRows, ['rescue_confidence']).rescue_confidence,
    capped_rule_id_distribution: buildDistribution(cappedRows, ['rule_id']).rule_id,
    capped_score_summary: {
      min: scores.length > 0 ? Math.min(...scores) : null,
      max: scores.length > 0 ? Math.max(...scores) : null,
      average: average(scores),
    },
    capped_false_positive_avoided_count: cappedFalsePositiveAvoided.length,
    capped_false_negative_caused_count: cappedFalseNegativeCaused.length,
    capped_unsure_actual_count: cappedUnsureActual.length,
    capped_false_positive_avoided_examples: cappedFalsePositiveAvoided
      .slice()
      .sort(compareConflictExamples)
      .slice(0, 5)
      .map(compactConflictExample),
    capped_false_negative_caused_examples: cappedFalseNegativeCaused
      .slice()
      .sort(compareConflictExamples)
      .slice(0, 5)
      .map(compactConflictExample),
  };
}

function tieredCapCalibrationVariants() {
  return [
    {
      variant_id: 'baseline_current_cap',
      shouldCap: row => row.is_conflict_capped,
    },
    {
      variant_id: 'no_conflict_cap',
      shouldCap: () => false,
    },
    {
      variant_id: 'cap_only_when_raw_log_leak',
      shouldCap: row => row.prediction_sample.quality_flags.includes('raw_log_leak'),
    },
    {
      variant_id: 'cap_when_raw_log_leak_or_score_below_60',
      shouldCap: row => row.prediction_sample.quality_flags.includes('raw_log_leak') || row.score < 60,
    },
    {
      variant_id: 'cap_when_raw_log_leak_or_primary_bucket_project',
      shouldCap: row => row.prediction_sample.quality_flags.includes('raw_log_leak') || row.primary_bucket === 'archived_raw_log_project',
    },
  ];
}

function evaluateTieredCapCalibrationVariant(rows, variant) {
  const metrics = emptyMetrics();
  const variantRows = [];

  for (const row of rows) {
    const keepCap = row.is_conflict_capped ? variant.shouldCap(row) : false;
    const predictedKeepActive = row.is_conflict_capped
      ? (keepCap ? row.predicted_keep_active : row.raw_predicted_keep_active)
      : row.predicted_keep_active;
    const variantRow = {
      sample_id: row.sample_id,
      primary_bucket: row.primary_bucket,
      target_category: row.target_category,
      rescue_confidence: row.rescue_confidence,
      actual_keep_active: row.actual_keep_active,
      raw_predicted_keep_active: row.raw_predicted_keep_active,
      predicted_keep_active: predictedKeepActive,
      rule_id: variant.variant_id,
      score: row.score,
      reasons: row.reasons,
    };
    updateMetrics(metrics, variantRow);
    variantRows.push({
      ...variantRow,
      was_conflict_capped: row.is_conflict_capped,
      cap_applied: row.is_conflict_capped ? keepCap : false,
      uncapped_yes: row.is_conflict_capped && !keepCap && row.raw_predicted_keep_active === 'yes' && predictedKeepActive === 'yes',
    });
  }

  finalizeMetrics(metrics);
  const diagnostics = buildMismatchDiagnostics(variantRows, { includeScoreBucket: true });
  const cappedRows = variantRows.filter(row => row.cap_applied);
  const uncappedYesRows = variantRows.filter(row => row.uncapped_yes);

  return {
    variant_id: variant.variant_id,
    ...metrics,
    capped_count: cappedRows.length,
    capped_false_positive_avoided_count: cappedRows.filter(row => row.actual_keep_active !== 'yes').length,
    capped_false_negative_caused_count: cappedRows.filter(row => row.actual_keep_active === 'yes').length,
    uncapped_yes_count: uncappedYesRows.length,
    false_positives: metrics.false_positives.map(compactMismatch),
    false_negatives: metrics.false_negatives.map(compactMismatch),
    false_positive_examples: metrics.false_positives.slice().sort(compareConflictExamples).slice(0, 5).map(compactMismatch),
    false_negative_examples: metrics.false_negatives.slice().sort(compareConflictExamples).slice(0, 5).map(compactMismatch),
    false_positive_distribution: diagnostics.false_positive_distribution,
    false_negative_distribution: diagnostics.false_negative_distribution,
    diagnostics,
  };
}

function evaluateArchivedRawLogRescueLabels(options = {}) {
  const labelsInputPath = options.labelsInputPath || 'reports/archived-raw-log-rescue_labels_seed_v0.1_20samples_20260702.jsonl';
  const candidatesInputPath = options.candidatesInputPath || 'reports/archived-raw-log-rescue-candidates-latest.jsonl';
  const threshold = options.threshold ?? DEFAULT_RESCUE_SCORING_THRESHOLD;
  const unsureThreshold = options.unsureThreshold ?? DEFAULT_RESCUE_UNSURE_THRESHOLD;

  const labels = readJsonl(labelsInputPath);
  const candidates = fs.existsSync(candidatesInputPath) ? readJsonl(candidatesInputPath) : [];
  const candidateById = bySampleId(candidates);

  const invalid = [];
  const validRows = [];
  const calibrationRows = [];
  const ruleRows = [];
  const scoringRows = [];
  const ruleMetrics = emptyMetrics();
  const scoringMetrics = emptyMetrics();

  for (const label of labels) {
    const candidate = candidateById.get(label.sample_id);
    const merged = mergeCandidateAndLabel(candidate, label);
    const annotation = normalizeAnnotation(merged.annotation || {});
    const actual = annotation.keep_active;

    if (!candidate) {
      invalid.push({
        sample_id: label.sample_id,
        reason: 'candidate_not_found',
      });
      continue;
    }

    if (!VALID_KEEP_ACTIVE.has(actual)) {
      invalid.push({
        sample_id: label.sample_id,
        reason: actual ? 'invalid_keep_active' : 'missing_keep_active',
        keep_active: actual,
      });
      continue;
    }

    const predictionSample = buildPredictionSample(candidate, label);
    const rule = evaluateArchivedRawLogRescueRules(predictionSample);
    const scoring = computeArchivedRawLogRescueScore(predictionSample, { threshold, unsureThreshold });
    const base = {
      sample_id: predictionSample.sample_id,
      primary_bucket: predictionSample.primary_bucket,
      target_category: annotation.target_category,
      rescue_confidence: annotation.rescue_confidence,
      actual_keep_active: actual,
      score: scoring.score,
    };

    const ruleRow = {
      ...base,
      predicted_keep_active: rule.keep_active,
      rule_id: rule.rule_id,
      reasons: rule.reasons,
    };
    const scoringRow = {
      ...base,
      raw_predicted_keep_active: scoring.raw_predicted_keep_active,
      predicted_keep_active: scoring.predicted_keep_active,
      rule_id: scoring.scoring_version,
      manual_review_flags: scoring.manual_review_flags,
      reasons: scoring.parts.map(p => `${p.name}:${p.value}`),
      prediction_sample: predictionSample,
      is_conflict_capped:
        scoring.raw_predicted_keep_active === 'yes' &&
        scoring.predicted_keep_active === 'unsure' &&
        scoring.manual_review_flags.includes('positive_negative_conflict'),
    };

    updateMetrics(ruleMetrics, ruleRow);
    updateMetrics(scoringMetrics, scoringRow);
    ruleRows.push(ruleRow);
    scoringRows.push(scoringRow);
    validRows.push({
      ...base,
      rule_prediction: rule.keep_active,
      rule_id: rule.rule_id,
      scoring_prediction: scoring.predicted_keep_active,
      scoring_parts: scoring.parts,
    });
    calibrationRows.push({
      ...base,
      prediction_sample: predictionSample,
    });
  }

  finalizeMetrics(ruleMetrics);
  finalizeMetrics(scoringMetrics);

  const report = {
    mode: 'archived_raw_log_rescue_label_evaluation',
    write_db: false,
    memory_side_effects: false,
    reinforcement_side_effects: false,
    inputs: {
      labels: labelsInputPath,
      candidates: candidatesInputPath,
    },
    summary: {
      labels_total: labels.length,
      candidates_total: candidates.length,
      labels_valid: validRows.length,
      labels_invalid: invalid.length,
      joined_candidates: validRows.length,
      invalid_reasons: invalid.reduce((acc, row) => {
        acc[row.reason] = (acc[row.reason] || 0) + 1;
        return acc;
      }, {}),
    },
    v0_1_rules: {
      ...ruleMetrics,
      false_positives: ruleMetrics.false_positives.map(compactMismatch),
      false_negatives: ruleMetrics.false_negatives.map(compactMismatch),
      diagnostics: buildMismatchDiagnostics(ruleRows),
    },
    v0_2_scoring: {
      threshold,
      unsure_threshold: unsureThreshold,
      weights: DEFAULT_RESCUE_SCORING_WEIGHTS,
      ...scoringMetrics,
      false_positives: scoringMetrics.false_positives.map(compactMismatch),
      false_negatives: scoringMetrics.false_negatives.map(compactMismatch),
      diagnostics: buildMismatchDiagnostics(scoringRows, { includeScoreBucket: true }),
      threshold_sweep: buildThresholdSweep(validRows, {
        sweepMin: options.sweepMin ?? 30,
        sweepMax: options.sweepMax ?? 80,
        sweepStep: options.sweepStep ?? 5,
        unsureThreshold,
      }),
    },
    invalid_labels: invalid,
  };

  if (options.includeCalibration) {
    report.what_if_calibration = calibrationVariants().map(variant =>
      evaluateCalibrationVariant(calibrationRows, variant)
    );
  }

  if (options.includeCalibrationGrid) {
    const variants = calibrationGridVariants().map(variant =>
      evaluateCalibrationVariant(calibrationRows, variant)
    );
    report.calibration_grid = {
      variants,
      top_variants: calibrationGridTopVariants(variants),
    };
  }

  if (options.includeConflictCapDiagnostics) {
    report.conflict_cap_diagnostics = buildConflictCapDiagnostics(scoringRows);
  }

  if (options.includeTieredCapCalibration) {
    report.tiered_cap_calibration = tieredCapCalibrationVariants().map(variant =>
      evaluateTieredCapCalibrationVariant(scoringRows, variant)
    );
  }

  if (options.out) writeJson(options.out, report);
  return report;
}

function main() {
  const options = parseArgs(process.argv);
  const report = evaluateArchivedRawLogRescueLabels(options);
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();

module.exports = {
  evaluateArchivedRawLogRescueLabels,
};

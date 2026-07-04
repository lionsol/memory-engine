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
      predicted_keep_active: scoring.predicted_keep_active,
      rule_id: scoring.scoring_version,
      reasons: scoring.parts.map(p => `${p.name}:${p.value}`),
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

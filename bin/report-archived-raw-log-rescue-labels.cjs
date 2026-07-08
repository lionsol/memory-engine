#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
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

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeStdout(content) {
  fs.writeFileSync(process.stdout.fd, `${content}\n`, 'utf8');
}

function writeStderr(content) {
  fs.writeFileSync(process.stderr.fd, `${content}\n`, 'utf8');
}

function parseNumber(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function splitPairs(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const nameSplit = item.indexOf('=');
      const name = nameSplit > 0 ? item.slice(0, nameSplit) : undefined;
      const pairValue = nameSplit > 0 ? item.slice(nameSplit + 1) : item;
      const [labelPath, candidatePath] = pairValue.split(':');
      if (!labelPath || !candidatePath) throw new Error(`invalid --pair value: ${item}`);
      return { name, labelPath, candidatePath };
    });
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

  const pairs = splitPairs(valueFor('--pair'));
  return {
    pairs,
    outJson: valueFor('--out-json'),
    outMd: valueFor('--out-md'),
    threshold: parseNumber(valueFor('--threshold'), DEFAULT_RESCUE_SCORING_THRESHOLD),
    unsureThreshold: parseNumber(valueFor('--unsure-threshold'), DEFAULT_RESCUE_UNSURE_THRESHOLD),
  };
}

function bySampleId(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row && row.sample_id) map.set(row.sample_id, row);
  }
  return map;
}

function increment(obj, key) {
  const k = key == null || key === '' ? '(empty)' : String(key);
  obj[k] = (obj[k] || 0) + 1;
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
    predicted_distribution: {},
    actual_distribution: {},
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

function updateMetrics(metrics, actual, predicted) {
  metrics.total += 1;
  if (actual === predicted) metrics.exact_match += 1;
  increment(metrics.actual_distribution, actual);
  increment(metrics.predicted_distribution, predicted);

  if (actual === 'yes' && predicted === 'yes') metrics.yes_true_positive += 1;
  else if (actual !== 'yes' && predicted === 'yes') metrics.yes_false_positive += 1;
  else if (actual === 'yes' && predicted !== 'yes') metrics.yes_false_negative += 1;
  else metrics.yes_true_negative += 1;
}

function compactRow(row) {
  return {
    round: row.round,
    sample_id: row.sample_id,
    primary_bucket: row.primary_bucket,
    actual_keep_active: row.actual_keep_active,
    predicted_keep_active: row.predicted_keep_active,
    raw_predicted_keep_active: row.raw_predicted_keep_active,
    score: row.score,
    target_category: row.target_category,
    rescue_confidence: row.rescue_confidence,
    selection_reason: row.selection_reason,
    manual_review_flags: row.manual_review_flags,
    reasons: row.reasons,
  };
}

function collectRows(pairs, options = {}) {
  const invalid = [];
  const rows = [];
  const seen = new Set();

  for (const [index, pair] of pairs.entries()) {
    const round = pair.name || `round_${index + 1}`;
    const labels = readJsonl(pair.labelPath);
    const candidates = fs.existsSync(pair.candidatePath) ? readJsonl(pair.candidatePath) : [];
    const candidateById = bySampleId(candidates);

    for (const label of labels) {
      const annotation = normalizeAnnotation(label.annotation || {});
      const actual = annotation.keep_active;
      const candidate = candidateById.get(label.sample_id);
      const key = label.sample_id;

      if (seen.has(key)) {
        invalid.push({ round, sample_id: label.sample_id, reason: 'duplicate_sample_id' });
        continue;
      }
      seen.add(key);

      if (!candidate) {
        invalid.push({ round, sample_id: label.sample_id, reason: 'candidate_not_found' });
        continue;
      }
      if (!VALID_KEEP_ACTIVE.has(actual)) {
        invalid.push({
          round,
          sample_id: label.sample_id,
          reason: actual ? 'invalid_keep_active' : 'missing_keep_active',
          keep_active: actual,
        });
        continue;
      }

      const merged = {
        ...candidate,
        ...label,
        risk_signals: Array.isArray(label.risk_signals) ? label.risk_signals : (candidate.risk_signals || []),
        quality_flags: Array.isArray(label.quality_flags) ? label.quality_flags : (candidate.quality_flags || []),
        annotation: label.annotation || {},
      };
      const scoring = computeArchivedRawLogRescueScore(merged, {
        threshold: options.threshold ?? DEFAULT_RESCUE_SCORING_THRESHOLD,
        unsureThreshold: options.unsureThreshold ?? DEFAULT_RESCUE_UNSURE_THRESHOLD,
      });
      const sampling = candidate.sampling || {};
      const row = {
        round,
        sample_id: label.sample_id,
        primary_bucket: merged.primary_bucket,
        actual_keep_active: actual,
        predicted_keep_active: scoring.predicted_keep_active,
        raw_predicted_keep_active: scoring.raw_predicted_keep_active,
        score: scoring.score,
        target_category: annotation.target_category,
        rescue_confidence: annotation.rescue_confidence,
        selection_reason: sampling.selection_reason || '(none)',
        manual_review_flags: scoring.manual_review_flags || [],
        reasons: scoring.parts.map(part => `${part.name}:${part.value}`),
      };
      rows.push(row);
    }
  }

  return { rows, invalid };
}

function summarizeRows(rows, invalid, options = {}) {
  const metrics = emptyMetrics();
  const manualReviewMetrics = emptyMetrics();
  const nonManualMetrics = emptyMetrics();
  const manualReview = {
    total: 0,
    actual_distribution: {},
    predicted_distribution: {},
    raw_predicted_distribution: {},
    flag_distribution: {},
    selection_reason_distribution: {},
    target_category_distribution: {},
    rescue_confidence_distribution: {},
  };
  const nonManual = {
    total: 0,
    actual_distribution: {},
    predicted_distribution: {},
    selection_reason_distribution: {},
  };
  const byRound = {};
  const byBucket = {};
  const bySelectionReason = {};
  const falsePositives = [];
  const falseNegatives = [];

  for (const row of rows) {
    const isManual = row.manual_review_flags.length > 0 || row.predicted_keep_active === 'unsure';
    updateMetrics(metrics, row.actual_keep_active, row.predicted_keep_active);
    updateMetrics(isManual ? manualReviewMetrics : nonManualMetrics, row.actual_keep_active, row.predicted_keep_active);

    const roundSummary = byRound[row.round] ||= emptyMetrics();
    updateMetrics(roundSummary, row.actual_keep_active, row.predicted_keep_active);

    const bucketSummary = byBucket[row.primary_bucket || '(empty)'] ||= emptyMetrics();
    updateMetrics(bucketSummary, row.actual_keep_active, row.predicted_keep_active);

    const selectionSummary = bySelectionReason[row.selection_reason || '(none)'] ||= emptyMetrics();
    updateMetrics(selectionSummary, row.actual_keep_active, row.predicted_keep_active);

    if (row.predicted_keep_active === 'yes' && row.actual_keep_active !== 'yes') falsePositives.push(compactRow(row));
    if (row.actual_keep_active === 'yes' && row.predicted_keep_active !== 'yes') falseNegatives.push(compactRow(row));

    if (isManual) {
      manualReview.total += 1;
      increment(manualReview.actual_distribution, row.actual_keep_active);
      increment(manualReview.predicted_distribution, row.predicted_keep_active);
      increment(manualReview.raw_predicted_distribution, row.raw_predicted_keep_active);
      increment(manualReview.selection_reason_distribution, row.selection_reason);
      increment(manualReview.target_category_distribution, row.target_category);
      increment(manualReview.rescue_confidence_distribution, row.rescue_confidence);
      for (const flag of row.manual_review_flags) increment(manualReview.flag_distribution, flag);
    } else {
      nonManual.total += 1;
      increment(nonManual.actual_distribution, row.actual_keep_active);
      increment(nonManual.predicted_distribution, row.predicted_keep_active);
      increment(nonManual.selection_reason_distribution, row.selection_reason);
    }
  }

  finalizeMetrics(metrics);
  finalizeMetrics(manualReviewMetrics);
  finalizeMetrics(nonManualMetrics);
  for (const value of Object.values(byRound)) finalizeMetrics(value);
  for (const value of Object.values(byBucket)) finalizeMetrics(value);
  for (const value of Object.values(bySelectionReason)) finalizeMetrics(value);

  return {
    mode: 'archived_raw_log_rescue_combined_label_report',
    write_db: false,
    memory_side_effects: false,
    reinforcement_side_effects: false,
    threshold: options.threshold ?? DEFAULT_RESCUE_SCORING_THRESHOLD,
    unsure_threshold: options.unsureThreshold ?? DEFAULT_RESCUE_UNSURE_THRESHOLD,
    weights: DEFAULT_RESCUE_SCORING_WEIGHTS,
    summary: {
      labels_valid: rows.length,
      labels_invalid: invalid.length,
      invalid_reasons: invalid.reduce((acc, row) => {
        increment(acc, row.reason);
        return acc;
      }, {}),
    },
    scoring: {
      ...metrics,
      false_positives: falsePositives,
      false_negatives: falseNegatives,
    },
    manual_review: {
      ...manualReview,
      metrics: manualReviewMetrics,
    },
    non_manual: {
      ...nonManual,
      metrics: nonManualMetrics,
    },
    by_round: byRound,
    by_bucket: byBucket,
    by_selection_reason: bySelectionReason,
    invalid_labels: invalid,
  };
}

function fmt(value) {
  if (value == null) return 'n/a';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
  return String(value);
}

function renderDist(dist = {}) {
  const entries = Object.entries(dist);
  if (!entries.length) return '(empty)';
  return entries.map(([key, value]) => `${key}: ${value}`).join(', ');
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Archived raw-log rescue combined label report');
  lines.push('');
  lines.push('## Safety');
  lines.push('');
  lines.push('- DB writes: false');
  lines.push('- Memory side effects: false');
  lines.push('- Reinforcement side effects: false');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Valid labels: ${report.summary.labels_valid}`);
  lines.push(`- Invalid labels: ${report.summary.labels_invalid}`);
  lines.push(`- Invalid reasons: ${renderDist(report.summary.invalid_reasons)}`);
  lines.push('');
  lines.push('## Scoring');
  lines.push('');
  lines.push(`- Exact accuracy: ${fmt(report.scoring.exact_accuracy)}`);
  lines.push(`- Yes precision: ${fmt(report.scoring.yes_precision)}`);
  lines.push(`- Yes recall: ${fmt(report.scoring.yes_recall)}`);
  lines.push(`- Yes false positives: ${report.scoring.yes_false_positive}`);
  lines.push(`- Yes false negatives: ${report.scoring.yes_false_negative}`);
  lines.push(`- Actual distribution: ${renderDist(report.scoring.actual_distribution)}`);
  lines.push(`- Predicted distribution: ${renderDist(report.scoring.predicted_distribution)}`);
  lines.push('');
  lines.push('## Manual review bucket');
  lines.push('');
  lines.push(`- Total: ${report.manual_review.total}`);
  lines.push(`- Actual distribution: ${renderDist(report.manual_review.actual_distribution)}`);
  lines.push(`- Predicted distribution: ${renderDist(report.manual_review.predicted_distribution)}`);
  lines.push(`- Raw predicted distribution: ${renderDist(report.manual_review.raw_predicted_distribution)}`);
  lines.push(`- Flags: ${renderDist(report.manual_review.flag_distribution)}`);
  lines.push(`- Selection reasons: ${renderDist(report.manual_review.selection_reason_distribution)}`);
  lines.push(`- Target categories: ${renderDist(report.manual_review.target_category_distribution)}`);
  lines.push(`- Rescue confidence: ${renderDist(report.manual_review.rescue_confidence_distribution)}`);
  lines.push('');
  lines.push('## By round');
  lines.push('');
  lines.push('| Round | Total | Exact | Yes FP | Yes FN | Precision | Recall | Actual | Predicted |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---|---|');
  for (const [round, metrics] of Object.entries(report.by_round)) {
    lines.push(`| ${round} | ${metrics.total} | ${fmt(metrics.exact_accuracy)} | ${metrics.yes_false_positive} | ${metrics.yes_false_negative} | ${fmt(metrics.yes_precision)} | ${fmt(metrics.yes_recall)} | ${renderDist(metrics.actual_distribution)} | ${renderDist(metrics.predicted_distribution)} |`);
  }
  lines.push('');
  lines.push('## By selection reason');
  lines.push('');
  lines.push('| Selection reason | Total | Yes FP | Yes FN | Actual | Predicted |');
  lines.push('|---|---:|---:|---:|---|---|');
  for (const [reason, metrics] of Object.entries(report.by_selection_reason)) {
    lines.push(`| ${reason} | ${metrics.total} | ${metrics.yes_false_positive} | ${metrics.yes_false_negative} | ${renderDist(metrics.actual_distribution)} | ${renderDist(metrics.predicted_distribution)} |`);
  }
  lines.push('');
  lines.push('## False positives');
  lines.push('');
  if (!report.scoring.false_positives.length) lines.push('- None');
  else for (const row of report.scoring.false_positives) lines.push(`- ${row.sample_id} (${row.round}) bucket=${row.primary_bucket} score=${row.score} actual=${row.actual_keep_active} predicted=${row.predicted_keep_active}`);
  lines.push('');
  lines.push('## False negatives');
  lines.push('');
  if (!report.scoring.false_negatives.length) lines.push('- None');
  else for (const row of report.scoring.false_negatives) lines.push(`- ${row.sample_id} (${row.round}) bucket=${row.primary_bucket} score=${row.score} actual=${row.actual_keep_active} predicted=${row.predicted_keep_active} flags=${row.manual_review_flags.join(',') || 'none'}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildCombinedReport(options = {}) {
  const { rows, invalid } = collectRows(options.pairs || [], options);
  return summarizeRows(rows, invalid, options);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv);
  } catch (error) {
    writeStderr(`[combined-report] ${error.message}`);
    process.exit(1);
  }
  if (!options.pairs.length) {
    writeStderr('[combined-report] at least one --pair labels:candidates is required');
    process.exit(1);
  }
  const report = buildCombinedReport(options);
  if (options.outJson) writeFile(options.outJson, `${JSON.stringify(report, null, 2)}\n`);
  if (options.outMd) writeFile(options.outMd, renderMarkdown(report));
  writeStdout(JSON.stringify(report, null, 2));
}

if (require.main === module) main();

module.exports = {
  buildCombinedReport,
  collectRows,
  renderMarkdown,
  summarizeRows,
};

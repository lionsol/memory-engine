#!/usr/bin/env node
'use strict';

/**
 * Build a stable manual-review queue for archived raw-log rescue samples.
 *
 * Read-only by design:
 * - reads candidate/sample JSONL and optional label JSONL files
 * - writes only requested queue artifacts
 * - performs no DB apply, unarchive, category update, delete, quarantine, or reinforce
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_RESCUE_SCORING_THRESHOLD,
  DEFAULT_RESCUE_UNSURE_THRESHOLD,
} = require('../lib/annotation/archived-raw-log-rescue-scoring.cjs');
const {
  scoreCandidate,
  bucketDistribution,
} = require('../lib/annotation/archived-raw-log-rescue-sampler.cjs');

const DEFAULT_LIMIT = 50;
const DEFAULT_NEAR_BOUNDARY = 5;

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line, index) => ({
    row: JSON.parse(line),
    line: index + 1,
  }));
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

function parsePositiveInteger(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
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
    help: args.includes('--help') || args.includes('-h'),
    inputPaths: splitCsv(valueFor('--input')),
    excludeLabelPaths: splitCsv(valueFor('--exclude-labels')),
    outJsonl: valueFor('--out-jsonl'),
    outMd: valueFor('--out-md'),
    limit: parsePositiveInteger(valueFor('--limit'), DEFAULT_LIMIT),
    threshold: parseNumber(valueFor('--threshold'), DEFAULT_RESCUE_SCORING_THRESHOLD),
    unsureThreshold: parseNumber(valueFor('--unsure-threshold'), DEFAULT_RESCUE_UNSURE_THRESHOLD),
    nearBoundary: Math.max(0, parseNumber(valueFor('--near-boundary'), DEFAULT_NEAR_BOUNDARY)),
  };
}

function loadSamples(inputPaths) {
  const samples = [];
  for (const inputPath of inputPaths) {
    for (const { row, line } of readJsonl(inputPath)) {
      samples.push({
        ...row,
        _queue_source_input: inputPath,
        _queue_source_line: line,
      });
    }
  }
  return samples;
}

function loadExcludedSampleIds(labelPaths) {
  const excluded = new Set();
  for (const labelPath of labelPaths) {
    if (!fs.existsSync(labelPath)) continue;
    for (const { row } of readJsonl(labelPath)) {
      if (row && row.sample_id) excluded.add(row.sample_id);
    }
  }
  return excluded;
}

function increment(obj, key) {
  const k = key == null || key === '' ? '(empty)' : String(key);
  obj[k] = (obj[k] || 0) + 1;
}

function distribution(rows, getter) {
  const out = {};
  for (const row of rows) increment(out, getter(row));
  return out;
}

function hasReason(row, reason) {
  return Array.isArray(row.review_reasons) && row.review_reasons.includes(reason);
}

function reviewReasons(scored, nearBoundary) {
  const reasons = [];
  const flags = scored._score_manual_review_flags || [];
  if (flags.includes('positive_negative_conflict') || scored._sampler?.is_conflict) {
    reasons.push('positive_negative_conflict');
  }
  if (scored._raw_predicted_keep_active === 'yes' && scored._predicted_keep_active === 'unsure') {
    reasons.push('raw_yes_capped_to_unsure');
  }
  if (Number(scored._boundary) <= nearBoundary) {
    reasons.push('near_boundary');
  }
  if (!reasons.length && scored._predicted_keep_active === 'unsure') {
    reasons.push('predicted_unsure');
  }
  return Array.from(new Set(reasons));
}

function reasonPriority(reasons) {
  if (reasons.includes('positive_negative_conflict')) return 10;
  if (reasons.includes('raw_yes_capped_to_unsure')) return 20;
  if (reasons.includes('near_boundary')) return 30;
  if (reasons.includes('predicted_unsure')) return 40;
  return 100;
}

function compareQueueRows(a, b) {
  const pa = reasonPriority(a.review_reasons);
  const pb = reasonPriority(b.review_reasons);
  if (pa !== pb) return pa - pb;

  const rawCapA = hasReason(a, 'raw_yes_capped_to_unsure') ? 1 : 0;
  const rawCapB = hasReason(b, 'raw_yes_capped_to_unsure') ? 1 : 0;
  if (rawCapA !== rawCapB) return rawCapB - rawCapA;

  if (a.boundary_distance !== b.boundary_distance) return a.boundary_distance - b.boundary_distance;
  if ((b.risk_score || 0) !== (a.risk_score || 0)) return (b.risk_score || 0) - (a.risk_score || 0);
  if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
  return String(a.sample_id || '').localeCompare(String(b.sample_id || ''));
}

function normalizeAnnotation(annotation = {}) {
  return {
    quality: annotation.quality ?? null,
    currency: annotation.currency ?? null,
    auto_recall_eligible: annotation.auto_recall_eligible ?? null,
    preferred_action: annotation.preferred_action ?? null,
    keep_active: annotation.keep_active ?? null,
    target_category: annotation.target_category ?? null,
    rescue_confidence: annotation.rescue_confidence ?? null,
    reason: annotation.reason ?? null,
    notes: annotation.notes ?? null,
  };
}

function compactQueueRow(sample, scored, reasons) {
  return {
    schema_version: 1,
    queue_type: 'archived_raw_log_rescue_manual_review',
    queue_priority: null,
    review_reasons: reasons,
    sample_id: sample.sample_id,
    memory_id: sample.memory_id,
    chunk_id: sample.chunk_id,
    path: sample.path,
    source_path: sample.source_path,
    path_family: sample.path_family,
    source_file_date: sample.source_file_date,
    category: sample.category,
    is_archived: sample.is_archived,
    primary_bucket: sample.primary_bucket,
    sample_buckets: sample.sample_buckets || [],
    confidence: sample.confidence,
    hit_count: sample.hit_count,
    conflict_flag: sample.conflict_flag,
    text_length: sample.text_length,
    risk_score: sample.risk_score,
    risk_signals: sample.risk_signals || [],
    signal_polarity: sample.signal_polarity || { positive_evidence: [], negative_evidence: [] },
    quality_flags: sample.quality_flags || [],
    score: scored._score,
    threshold: scored._threshold ?? DEFAULT_RESCUE_SCORING_THRESHOLD,
    unsure_threshold: scored._unsure_threshold ?? DEFAULT_RESCUE_UNSURE_THRESHOLD,
    boundary_distance: scored._boundary,
    raw_predicted_keep_active: scored._raw_predicted_keep_active,
    predicted_keep_active: scored._predicted_keep_active,
    manual_review_flags: scored._score_manual_review_flags || [],
    scoring_parts: (scored._score_parts || []).map(part => `${part.name}:${part.value}`),
    prior_sampling_reason: sample.sampling?.selection_reason || sample._selection_reason || null,
    content_preview: sample.content_preview || '',
    content_missing_reason: sample.content_missing_reason ?? null,
    annotation: normalizeAnnotation(sample.annotation || {}),
    safety: {
      db_writes: false,
      unarchive: false,
      category_update: false,
      delete: false,
      quarantine: false,
      reinforce: false,
    },
    source: {
      input: sample._queue_source_input || null,
      line: sample._queue_source_line || null,
    },
  };
}

function buildManualReviewQueue(options = {}) {
  const inputPaths = options.inputPaths || [];
  const excludeLabelPaths = options.excludeLabelPaths || [];
  const limit = parsePositiveInteger(options.limit, DEFAULT_LIMIT);
  const threshold = options.threshold ?? DEFAULT_RESCUE_SCORING_THRESHOLD;
  const unsureThreshold = options.unsureThreshold ?? DEFAULT_RESCUE_UNSURE_THRESHOLD;
  const nearBoundary = options.nearBoundary ?? DEFAULT_NEAR_BOUNDARY;
  const samples = options.samples || loadSamples(inputPaths);
  const excludedIds = options.excludedSampleIds || loadExcludedSampleIds(excludeLabelPaths);
  const seen = new Set();
  const duplicateIds = new Set();
  const candidates = [];

  for (const sample of samples) {
    if (!sample || !sample.sample_id) continue;
    if (excludedIds.has(sample.sample_id)) continue;
    if (seen.has(sample.sample_id)) {
      duplicateIds.add(sample.sample_id);
      continue;
    }
    seen.add(sample.sample_id);

    const scored = scoreCandidate(sample, { threshold, unsureThreshold });
    const reasons = reviewReasons(scored, nearBoundary);
    if (!reasons.length) continue;
    candidates.push(compactQueueRow(sample, scored, reasons));
  }

  const selected = candidates
    .slice()
    .sort(compareQueueRows)
    .slice(0, limit)
    .map((row, index) => ({ ...row, queue_priority: index + 1 }));

  const report = {
    mode: 'archived_raw_log_rescue_manual_review_queue',
    write_db: false,
    memory_side_effects: false,
    reinforcement_side_effects: false,
    safety: {
      db_writes: false,
      unarchive: false,
      category_update: false,
      delete: false,
      quarantine: false,
      reinforce: false,
    },
    inputs: {
      samples: inputPaths,
      exclude_labels: excludeLabelPaths,
    },
    threshold,
    unsure_threshold: unsureThreshold,
    near_boundary: nearBoundary,
    limit,
    summary: {
      input_count: samples.length,
      excluded_count: excludedIds.size,
      duplicate_sample_ids: duplicateIds.size,
      eligible_count: candidates.length,
      selected_count: selected.length,
      reason_distribution: distribution(selected, row => row.review_reasons[0]),
      all_reason_distribution: selected.reduce((acc, row) => {
        for (const reason of row.review_reasons) increment(acc, reason);
        return acc;
      }, {}),
      selected_bucket_distribution: bucketDistribution(selected),
      predicted_distribution: distribution(selected, row => row.predicted_keep_active),
      raw_predicted_distribution: distribution(selected, row => row.raw_predicted_keep_active),
      prior_sampling_reason_distribution: distribution(selected, row => row.prior_sampling_reason),
    },
    queue: selected,
  };

  return report;
}

function renderJsonl(rows) {
  if (!rows.length) return '';
  return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`;
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function renderDist(dist = {}) {
  const entries = Object.entries(dist);
  if (!entries.length) return '(empty)';
  return entries.map(([key, value]) => `${key}: ${value}`).join(', ');
}

function renderPreview(preview) {
  const text = String(preview || '(empty)').trim() || '(empty)';
  return text.split('\n').map(line => `> ${line}`).join('\n');
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Archived raw-log rescue manual-review queue');
  lines.push('');
  lines.push('## Safety');
  lines.push('');
  lines.push('- DB writes: false');
  lines.push('- Unarchive: false');
  lines.push('- Category update: false');
  lines.push('- Delete/quarantine/reinforce: false');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Input samples: ${report.summary.input_count}`);
  lines.push(`- Excluded labeled sample IDs: ${report.summary.excluded_count}`);
  lines.push(`- Duplicate sample IDs skipped: ${report.summary.duplicate_sample_ids}`);
  lines.push(`- Eligible queue candidates: ${report.summary.eligible_count}`);
  lines.push(`- Selected queue rows: ${report.summary.selected_count}`);
  lines.push(`- Threshold: ${report.threshold}`);
  lines.push(`- Near-boundary distance: ${report.near_boundary}`);
  lines.push(`- Primary reasons: ${renderDist(report.summary.reason_distribution)}`);
  lines.push(`- All reasons: ${renderDist(report.summary.all_reason_distribution)}`);
  lines.push(`- Buckets: ${renderDist(report.summary.selected_bucket_distribution)}`);
  lines.push(`- Predicted: ${renderDist(report.summary.predicted_distribution)}`);
  lines.push(`- Raw predicted: ${renderDist(report.summary.raw_predicted_distribution)}`);
  lines.push('');
  lines.push('## Queue index');
  lines.push('');
  lines.push('| # | Sample | Reasons | Bucket | Score | Boundary | Raw→Final | Prior sampling |');
  lines.push('|---:|---|---|---|---:|---:|---|---|');
  for (const row of report.queue) {
    lines.push(`| ${row.queue_priority} | ${mdCell(row.sample_id)} | ${mdCell(row.review_reasons.join(', '))} | ${mdCell(row.primary_bucket)} | ${row.score} | ${row.boundary_distance} | ${mdCell(`${row.raw_predicted_keep_active}→${row.predicted_keep_active}`)} | ${mdCell(row.prior_sampling_reason || '(none)')} |`);
  }
  lines.push('');
  lines.push('## Review rows');
  lines.push('');
  for (const row of report.queue) {
    lines.push(`### ${row.queue_priority}. ${row.sample_id}`);
    lines.push('');
    lines.push(`- path: ${row.path || row.source_path || '(empty)'}`);
    lines.push(`- chunk_id: ${row.chunk_id || '(empty)'}`);
    lines.push(`- primary_bucket: ${row.primary_bucket || '(empty)'}`);
    lines.push(`- review_reasons: ${row.review_reasons.join(', ')}`);
    lines.push(`- score: ${row.score}; boundary_distance: ${row.boundary_distance}; predicted: ${row.raw_predicted_keep_active} -> ${row.predicted_keep_active}`);
    lines.push(`- manual_review_flags: ${row.manual_review_flags.join(', ') || 'none'}`);
    lines.push(`- risk_signals: ${row.risk_signals.join(', ') || 'none'}`);
    lines.push('');
    lines.push(renderPreview(row.content_preview));
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function usage() {
  return `Usage:\n  node bin/build-archived-raw-log-rescue-review-queue.cjs --input <samples.jsonl[,more.jsonl]> [options]\n\nOptions:\n  --exclude-labels <labels.jsonl[,more.jsonl]>  Exclude already-labeled sample IDs\n  --limit <n>                                  Queue size (default: ${DEFAULT_LIMIT})\n  --near-boundary <n>                          Include samples within n points of keep threshold (default: ${DEFAULT_NEAR_BOUNDARY})\n  --threshold <n>                              Keep-active threshold (default: ${DEFAULT_RESCUE_SCORING_THRESHOLD})\n  --out-jsonl <path>                           Write annotation-ready queue JSONL\n  --out-md <path>                              Write readable queue Markdown\n\nSafety:\n  Read-only. Does not write DB, unarchive, update category, delete, quarantine, or reinforce.`;
}

function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    writeStdout(usage());
    return;
  }
  if (!options.inputPaths.length) {
    writeStderr('[manual-review-queue] --input is required');
    process.exit(1);
  }

  const report = buildManualReviewQueue(options);
  if (options.outJsonl) writeFile(options.outJsonl, renderJsonl(report.queue));
  if (options.outMd) writeFile(options.outMd, renderMarkdown(report));
  writeStdout(JSON.stringify({
    mode: report.mode,
    write_db: report.write_db,
    memory_side_effects: report.memory_side_effects,
    reinforcement_side_effects: report.reinforcement_side_effects,
    inputs: report.inputs,
    threshold: report.threshold,
    unsure_threshold: report.unsure_threshold,
    near_boundary: report.near_boundary,
    limit: report.limit,
    summary: report.summary,
    outputs: {
      jsonl: options.outJsonl || null,
      markdown: options.outMd || null,
    },
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  buildManualReviewQueue,
  compareQueueRows,
  renderJsonl,
  renderMarkdown,
  reviewReasons,
};

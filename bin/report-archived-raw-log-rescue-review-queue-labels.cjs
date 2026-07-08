#!/usr/bin/env node
'use strict';

/**
 * Report and validate labels for archived raw-log rescue manual-review queues.
 *
 * Read-only by design:
 * - reads a queue JSONL and optional label JSONL files
 * - writes only requested report artifacts
 * - performs no DB apply, unarchive, category update, delete, quarantine, or reinforce
 */

const fs = require('node:fs');
const path = require('node:path');

const QUEUE_TYPE = 'archived_raw_log_rescue_manual_review';
const VALID_KEEP_ACTIVE = new Set(['yes', 'no', 'unsure']);
const VALID_QUALITY = new Set(['good', 'usable', 'low_quality', 'polluted']);
const VALID_CURRENCY = new Set(['current', 'superseded', 'unknown']);
const VALID_AUTO_RECALL = new Set(['yes', 'no', 'unsure']);
const VALID_ACTION = new Set(['keep', 'demote', 'quarantine', 'archive', 'delete']);
const VALID_TARGET_CATEGORY = new Set(['project', 'preference', 'episodic', 'raw_log', 'other', '']);
const VALID_RESCUE_CONFIDENCE = new Set(['high', 'medium', 'low', '']);
const DEFAULT_SAMPLE_LIMIT = 25;

function readJsonl(filePath) {
  if (!filePath) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return { row: JSON.parse(line), line_number: index + 1 };
      } catch (error) {
        return {
          row: null,
          line_number: index + 1,
          parse_error: String(error?.message || error),
        };
      }
    });
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

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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
    queuePath: valueFor('--queue'),
    labelPaths: splitCsv(valueFor('--labels')),
    outJson: valueFor('--out-json'),
    outMd: valueFor('--out-md'),
    sampleLimit: parsePositiveInteger(valueFor('--sample-limit'), DEFAULT_SAMPLE_LIMIT),
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeAnnotation(annotation = {}) {
  if (!annotation || typeof annotation !== 'object') return {};
  const reason = isNonEmptyString(annotation.reason)
    ? annotation.reason.trim()
    : (isNonEmptyString(annotation.notes) ? annotation.notes.trim() : annotation.reason);
  return {
    ...annotation,
    keep_active: typeof annotation.keep_active === 'string' ? annotation.keep_active.trim() : '',
    target_category: typeof annotation.target_category === 'string' ? annotation.target_category.trim() : '',
    rescue_confidence: typeof annotation.rescue_confidence === 'string' ? annotation.rescue_confidence.trim() : '',
    reason,
  };
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

function sampleItems(items, limit) {
  return items.slice(0, Math.max(0, limit));
}

function validateQueueRow(wrapper) {
  const errors = [];
  if (wrapper.parse_error) return { valid: false, errors: [`parse_error:${wrapper.parse_error}`] };
  const row = wrapper.row || {};
  if (Number(row.schema_version) !== 1) errors.push('schema_version');
  if (row.queue_type !== QUEUE_TYPE) errors.push('queue_type');
  if (!Number.isInteger(Number(row.queue_priority)) || Number(row.queue_priority) <= 0) errors.push('queue_priority');
  if (!isNonEmptyString(row.sample_id)) errors.push('sample_id');
  if (!isNonEmptyString(row.memory_id)) errors.push('memory_id');
  if (!isNonEmptyString(row.chunk_id)) errors.push('chunk_id');
  if (!isNonEmptyString(row.primary_bucket)) errors.push('primary_bucket');
  if (!isNonEmptyString(row.source_path) && !isNonEmptyString(row.path)) errors.push('source_path');
  if (!Array.isArray(row.review_reasons) || row.review_reasons.length === 0) errors.push('review_reasons');
  if (row.safety?.db_writes !== false) errors.push('safety.db_writes');
  if (row.safety?.unarchive !== false) errors.push('safety.unarchive');
  if (row.safety?.category_update !== false) errors.push('safety.category_update');
  if (row.safety?.delete !== false) errors.push('safety.delete');
  if (row.safety?.quarantine !== false) errors.push('safety.quarantine');
  if (row.safety?.reinforce !== false) errors.push('safety.reinforce');
  return { valid: errors.length === 0, errors };
}

function validateLabelRow(wrapper) {
  const errors = [];
  if (wrapper.parse_error) return { valid: false, errors: [`parse_error:${wrapper.parse_error}`] };
  const row = wrapper.row || {};
  const annotation = normalizeAnnotation(row.annotation);
  if (Number(row.schema_version) !== 1) errors.push('schema_version');
  if (row.sample_type !== 'memory') errors.push('sample_type');
  if (!isNonEmptyString(row.sample_id)) errors.push('sample_id');
  if (!isNonEmptyString(row.memory_id)) errors.push('memory_id');
  if (!isNonEmptyString(row.chunk_id)) errors.push('chunk_id');
  if (!isNonEmptyString(row.primary_bucket)) errors.push('primary_bucket');
  if (!isNonEmptyString(row.source_path)) errors.push('source_path');
  if (!VALID_QUALITY.has(String(annotation.quality || ''))) errors.push('annotation.quality');
  if (!VALID_CURRENCY.has(String(annotation.currency || ''))) errors.push('annotation.currency');
  if (!VALID_AUTO_RECALL.has(String(annotation.auto_recall_eligible || ''))) errors.push('annotation.auto_recall_eligible');
  if (!VALID_ACTION.has(String(annotation.preferred_action || ''))) errors.push('annotation.preferred_action');
  if (!VALID_KEEP_ACTIVE.has(String(annotation.keep_active || ''))) errors.push('annotation.keep_active');
  if (!VALID_TARGET_CATEGORY.has(String(annotation.target_category || ''))) errors.push('annotation.target_category');
  if (!VALID_RESCUE_CONFIDENCE.has(String(annotation.rescue_confidence || ''))) errors.push('annotation.rescue_confidence');
  if (!isNonEmptyString(annotation.reason)) errors.push('annotation.reason');
  return { valid: errors.length === 0, errors, annotation };
}

function buildQueueIndex(queueWrappers) {
  const rows = [];
  const invalid = [];
  const duplicateSampleIds = [];
  const bySampleId = new Map();

  for (const wrapper of queueWrappers) {
    const validation = validateQueueRow(wrapper);
    if (!validation.valid) {
      invalid.push({ line_number: wrapper.line_number, sample_id: wrapper.row?.sample_id || null, errors: validation.errors });
      continue;
    }
    const row = wrapper.row;
    rows.push(row);
    if (bySampleId.has(row.sample_id)) {
      duplicateSampleIds.push(row.sample_id);
    } else {
      bySampleId.set(row.sample_id, row);
    }
  }

  return { rows, invalid, duplicateSampleIds, bySampleId };
}

function identityMismatches(labelRow, queueRow) {
  const mismatches = [];
  if (String(labelRow.memory_id || '') !== String(queueRow.memory_id || '')) mismatches.push('memory_id');
  if (String(labelRow.chunk_id || '') !== String(queueRow.chunk_id || '')) mismatches.push('chunk_id');
  if (String(labelRow.primary_bucket || '') !== String(queueRow.primary_bucket || '')) mismatches.push('primary_bucket');
  const queueSourcePath = queueRow.source_path || queueRow.path || '';
  if (String(labelRow.source_path || '') !== String(queueSourcePath)) mismatches.push('source_path');
  return mismatches;
}

function buildReviewQueueLabelReport(options = {}) {
  const queuePath = options.queuePath || options.queue;
  if (!queuePath) throw new Error('--queue is required');
  const labelPaths = options.labelPaths || options.labels || [];
  const sampleLimit = parsePositiveInteger(options.sampleLimit, DEFAULT_SAMPLE_LIMIT);

  const queueWrappers = options.queueRows
    ? options.queueRows.map((row, index) => ({ row, line_number: index + 1 }))
    : readJsonl(queuePath);
  const labelWrappers = options.labelRows
    ? options.labelRows.map((row, index) => ({ row, line_number: index + 1, input_path: '(memory)' }))
    : labelPaths.flatMap(labelPath => readJsonl(labelPath).map(wrapper => ({ ...wrapper, input_path: labelPath })));

  const queueIndex = buildQueueIndex(queueWrappers);
  const validLabels = [];
  const invalidLabels = [];
  const labelsNotInQueue = [];
  const identityMismatchLabels = [];
  const duplicateLabelSampleIds = [];
  const seenLabelIds = new Set();

  for (const wrapper of labelWrappers) {
    const validation = validateLabelRow(wrapper);
    const sampleId = wrapper.row?.sample_id || null;
    if (sampleId) {
      if (seenLabelIds.has(sampleId)) {
        duplicateLabelSampleIds.push(sampleId);
        continue;
      }
      seenLabelIds.add(sampleId);
    }
    if (!validation.valid) {
      invalidLabels.push({
        input_path: wrapper.input_path || null,
        line_number: wrapper.line_number,
        sample_id: sampleId,
        errors: validation.errors,
      });
      continue;
    }

    const labelRow = { ...wrapper.row, annotation: validation.annotation };
    const queueRow = queueIndex.bySampleId.get(labelRow.sample_id);
    if (!queueRow) {
      labelsNotInQueue.push({
        input_path: wrapper.input_path || null,
        line_number: wrapper.line_number,
        sample_id: labelRow.sample_id,
      });
      continue;
    }

    const mismatches = identityMismatches(labelRow, queueRow);
    if (mismatches.length) {
      identityMismatchLabels.push({
        input_path: wrapper.input_path || null,
        line_number: wrapper.line_number,
        sample_id: labelRow.sample_id,
        mismatches,
      });
      continue;
    }

    validLabels.push({
      ...labelRow,
      queue_priority: queueRow.queue_priority,
      queue_review_reasons: queueRow.review_reasons,
      queue_raw_predicted_keep_active: queueRow.raw_predicted_keep_active,
      queue_predicted_keep_active: queueRow.predicted_keep_active,
    });
  }

  const validLabeledIds = new Set(validLabels.map(row => row.sample_id));
  const uniqueQueueRows = Array.from(queueIndex.bySampleId.values());
  const unlabeledQueueRows = uniqueQueueRows.filter(row => !validLabeledIds.has(row.sample_id));
  const annotationRows = validLabels.map(row => row.annotation || {});

  const summary = {
    queue_total: queueWrappers.length,
    queue_valid: queueIndex.rows.length,
    queue_unique_sample_ids: uniqueQueueRows.length,
    queue_invalid: queueIndex.invalid.length,
    queue_duplicate_sample_ids: queueIndex.duplicateSampleIds.length,
    labels_total: labelWrappers.length,
    labels_valid_aligned: validLabels.length,
    labels_invalid: invalidLabels.length,
    labels_not_in_queue: labelsNotInQueue.length,
    labels_identity_mismatch: identityMismatchLabels.length,
    labels_duplicate_sample_ids: duplicateLabelSampleIds.length,
    queue_unlabeled: unlabeledQueueRows.length,
    coverage_rate: uniqueQueueRows.length > 0 ? Number((validLabels.length / uniqueQueueRows.length).toFixed(4)) : 0,
    queue_reason_distribution: distribution(queueIndex.rows, row => Array.isArray(row.review_reasons) ? row.review_reasons[0] : '(empty)'),
    queue_bucket_distribution: distribution(queueIndex.rows, row => row.primary_bucket),
    keep_active_distribution: distribution(annotationRows, row => row.keep_active),
    preferred_action_distribution: distribution(annotationRows, row => row.preferred_action),
    target_category_distribution: distribution(annotationRows, row => row.target_category),
    quality_distribution: distribution(annotationRows, row => row.quality),
    rescue_confidence_distribution: distribution(annotationRows, row => row.rescue_confidence),
  };

  return {
    mode: 'archived_raw_log_rescue_review_queue_label_report',
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
      queue: queuePath,
      labels: labelPaths,
    },
    summary,
    queue_errors: queueIndex.invalid,
    invalid_labels: sampleItems(invalidLabels, sampleLimit),
    labels_not_in_queue: sampleItems(labelsNotInQueue, sampleLimit),
    identity_mismatch_labels: sampleItems(identityMismatchLabels, sampleLimit),
    duplicate_queue_sample_ids: sampleItems(queueIndex.duplicateSampleIds, sampleLimit),
    duplicate_label_sample_ids: sampleItems(duplicateLabelSampleIds, sampleLimit),
    unlabeled_queue_samples: sampleItems(unlabeledQueueRows.map(row => ({
      queue_priority: row.queue_priority,
      sample_id: row.sample_id,
      primary_bucket: row.primary_bucket,
      review_reasons: row.review_reasons,
      raw_predicted_keep_active: row.raw_predicted_keep_active,
      predicted_keep_active: row.predicted_keep_active,
    })), sampleLimit),
    valid_labels: sampleItems(validLabels.map(row => ({
      sample_id: row.sample_id,
      queue_priority: row.queue_priority,
      keep_active: row.annotation.keep_active,
      preferred_action: row.annotation.preferred_action,
      target_category: row.annotation.target_category,
      rescue_confidence: row.annotation.rescue_confidence,
      reason: row.annotation.reason,
    })), sampleLimit),
  };
}

function renderDist(dist = {}) {
  const entries = Object.entries(dist);
  if (!entries.length) return '(empty)';
  return entries.map(([key, value]) => `${key}: ${value}`).join(', ');
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Archived raw-log rescue review queue label report');
  lines.push('');
  lines.push('## Safety');
  lines.push('');
  lines.push('- DB writes: false');
  lines.push('- Unarchive/category update/delete/quarantine/reinforce: false');
  lines.push('');
  lines.push('## Inputs');
  lines.push('');
  lines.push(`- Queue: ${report.inputs.queue}`);
  lines.push(`- Labels: ${report.inputs.labels.length ? report.inputs.labels.join(', ') : 'none'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Queue total: ${report.summary.queue_total}`);
  lines.push(`- Queue valid: ${report.summary.queue_valid}`);
  lines.push(`- Queue unique sample IDs: ${report.summary.queue_unique_sample_ids}`);
  lines.push(`- Queue invalid: ${report.summary.queue_invalid}`);
  lines.push(`- Labels total: ${report.summary.labels_total}`);
  lines.push(`- Labels valid and aligned: ${report.summary.labels_valid_aligned}`);
  lines.push(`- Labels invalid: ${report.summary.labels_invalid}`);
  lines.push(`- Labels not in queue: ${report.summary.labels_not_in_queue}`);
  lines.push(`- Identity mismatches: ${report.summary.labels_identity_mismatch}`);
  lines.push(`- Queue unlabeled: ${report.summary.queue_unlabeled}`);
  lines.push(`- Coverage rate: ${report.summary.coverage_rate}`);
  lines.push(`- Queue reasons: ${renderDist(report.summary.queue_reason_distribution)}`);
  lines.push(`- Queue buckets: ${renderDist(report.summary.queue_bucket_distribution)}`);
  lines.push(`- keep_active: ${renderDist(report.summary.keep_active_distribution)}`);
  lines.push(`- preferred_action: ${renderDist(report.summary.preferred_action_distribution)}`);
  lines.push(`- target_category: ${renderDist(report.summary.target_category_distribution)}`);
  lines.push(`- rescue_confidence: ${renderDist(report.summary.rescue_confidence_distribution)}`);
  lines.push('');
  lines.push('## Blocking issues');
  lines.push('');
  lines.push(`- Queue errors: ${report.queue_errors.length}`);
  lines.push(`- Invalid labels shown: ${report.invalid_labels.length}`);
  lines.push(`- Labels not in queue shown: ${report.labels_not_in_queue.length}`);
  lines.push(`- Identity mismatches shown: ${report.identity_mismatch_labels.length}`);
  lines.push(`- Duplicate queue sample IDs shown: ${report.duplicate_queue_sample_ids.length}`);
  lines.push(`- Duplicate label sample IDs shown: ${report.duplicate_label_sample_ids.length}`);
  lines.push('');
  lines.push('## Unlabeled queue samples shown');
  lines.push('');
  if (!report.unlabeled_queue_samples.length) lines.push('- None');
  else for (const row of report.unlabeled_queue_samples) {
    lines.push(`- #${row.queue_priority} ${row.sample_id} bucket=${row.primary_bucket} reasons=${(row.review_reasons || []).join(',')}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function usage() {
  return `Usage:\n  node bin/report-archived-raw-log-rescue-review-queue-labels.cjs --queue <queue.jsonl> [options]\n\nOptions:\n  --labels <labels.jsonl[,more.jsonl]>  Optional labels to validate against the queue\n  --out-json <path>                     Write JSON report\n  --out-md <path>                       Write Markdown report\n  --sample-limit <n>                    Max issue/sample rows embedded in report (default: ${DEFAULT_SAMPLE_LIMIT})\n\nSafety:\n  Read-only. Does not write DB, unarchive, update category, delete, quarantine, or reinforce.`;
}

function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    writeStdout(usage());
    return;
  }
  if (!options.queuePath) {
    writeStderr('[review-queue-label-report] --queue is required');
    process.exit(1);
  }

  const report = buildReviewQueueLabelReport(options);
  if (options.outJson) writeFile(options.outJson, `${JSON.stringify(report, null, 2)}\n`);
  if (options.outMd) writeFile(options.outMd, renderMarkdown(report));
  writeStdout(JSON.stringify(report, null, 2));
}

if (require.main === module) main();

module.exports = {
  buildReviewQueueLabelReport,
  renderMarkdown,
  validateLabelRow,
  validateQueueRow,
};

#!/usr/bin/env node
/**
 * v0.4 Active Sampler (MVP)
 * ------------------------
 * Deterministic diversity sampler for archived raw-log rescue pipeline.
 *
 * This version is intentionally conservative:
 * - NO learning
 * - NO weight updates
 * - NO DB writes
 * - NO restore / unarchive / category update
 * - ONLY writes an annotation output file when --out is explicitly provided
 *
 * It combines boundary, bucket-diversity, positive/negative conflict, and
 * transient sanity-check samples for annotation efficiency.
 */

const fs = require('node:fs');
const { dirname, resolve } = require('node:path');
const {
  DEFAULT_RESCUE_SCORING_THRESHOLD,
  DEFAULT_RESCUE_UNSURE_THRESHOLD,
  DEFAULT_RESCUE_SCORING_WEIGHTS,
} = require('../lib/annotation/archived-raw-log-rescue-scoring.cjs');
const {
  selectActiveSamplerSamples,
} = require('../lib/annotation/archived-raw-log-rescue-sampler.cjs');

const ALLOWED_FORMATS = new Set(['json', 'jsonl']);

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function argValue(args, name, fallback) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
  const prefix = `${name}=`;
  const inline = args.find(arg => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function usage() {
  return `Usage:\n  node bin/v4-active-sampler.cjs [options]\n\nOptions:\n  --input <path>       Candidate JSONL input (default: reports/archived-raw-log-rescue-candidates-latest.jsonl)\n  --limit <n>          Number of samples to select (default: 20)\n  --threshold <n>      Scoring threshold (default: ${DEFAULT_RESCUE_SCORING_THRESHOLD})\n  --format <json|jsonl> Output format (default: json)\n  --out <path>         Optional output path\n\nFormats:\n  json   Summary JSON with compact selected sample metadata.\n  jsonl  Full selected sample rows with a sampling metadata object, suitable for /annotations.\n\nSafety:\n  Lifecycle read-only: no DB writes, unarchive, category update, delete, quarantine, or reinforce.\n  File output is written only when --out is explicitly provided.`;
}

function serializeCompactSample(sample) {
  return {
    selection_reason: sample._selection_reason,
    sampler_tags: sample._sampler,
    sample_id: sample.sample_id,
    chunk_id: sample.chunk_id,
    path: sample.path,
    primary_bucket: sample.primary_bucket,
    risk_score: sample.risk_score,
    computed_score: sample._score,
    predicted_keep_active: sample._predicted_keep_active,
    boundary_distance: sample._boundary,
    score_parts: sample._score_parts,
  };
}

function serializeAnnotationSample(sample, threshold) {
  const {
    _score,
    _score_parts,
    _score_signals,
    _predicted_keep_active,
    _boundary,
    _sampler,
    _selection_reason,
    ...rest
  } = sample;
  return {
    ...rest,
    sampling: {
      sampler_version: 'v0.4_active_sampler_diversity_mvp',
      selection_reason: _selection_reason,
      sampler_tags: _sampler,
      threshold,
      computed_score: _score,
      predicted_keep_active: _predicted_keep_active,
      boundary_distance: _boundary,
      score_parts: _score_parts,
      score_signals: _score_signals,
      manual_review_flags: sample._score_manual_review_flags || [],
    },
  };
}

function buildJsonOutput({ input, limit, threshold, selection }) {
  const selected = selection.selected;
  return {
    mode: selection.mode,
    input,
    threshold,
    unsure_threshold: DEFAULT_RESCUE_UNSURE_THRESHOLD,
    weights: DEFAULT_RESCUE_SCORING_WEIGHTS,
    quotas: selection.quotas,
    limit,
    input_count: selection.input_count,
    selected_count: selected.length,
    summary: selection.summary,
    samples: selected.map(serializeCompactSample),
  };
}

function renderOutput({ input, limit, threshold, selection, format }) {
  if (format === 'jsonl') {
    return `${selection.selected
      .map(sample => JSON.stringify(serializeAnnotationSample(sample, threshold)))
      .join('\n')}\n`;
  }
  return `${JSON.stringify(buildJsonOutput({ input, limit, threshold, selection }), null, 2)}\n`;
}

function writeOrPrint(output, outPath) {
  if (!outPath) {
    process.stdout.write(output);
    return;
  }
  const resolved = resolve(process.cwd(), outPath);
  fs.mkdirSync(dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, output, 'utf8');
  console.log(JSON.stringify({
    mode: 'v0.4_active_sampler_write_output',
    output_path: resolved,
    bytes: Buffer.byteLength(output, 'utf8'),
    safety: {
      output_file_write: true,
      db_writes: false,
      unarchive: false,
      category_update: false,
      delete: false,
      quarantine: false,
      reinforce: false,
    },
  }, null, 2));
}

function main() {
  const args = process.argv.slice(2);
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(usage());
    return;
  }

  const input = argValue(args, '--input', 'reports/archived-raw-log-rescue-candidates-latest.jsonl');
  const limit = parseInt(argValue(args, '--limit', '20'), 10);
  const threshold = parseInt(argValue(args, '--threshold', String(DEFAULT_RESCUE_SCORING_THRESHOLD)), 10);
  const format = String(argValue(args, '--format', 'json')).toLowerCase();
  const out = argValue(args, '--out', null);

  if (!ALLOWED_FORMATS.has(format)) {
    console.error('[v4-sampler] --format must be json or jsonl');
    process.exit(1);
  }

  if (!fs.existsSync(input)) {
    console.error(`[v4-sampler] input not found: ${input}`);
    process.exit(1);
  }

  const samples = readJsonl(input);
  const selection = selectActiveSamplerSamples(samples, { threshold, limit });
  const output = renderOutput({ input, limit, threshold, selection, format });
  writeOrPrint(output, out);
}

if (require.main === module) main();

module.exports = {
  buildJsonOutput,
  renderOutput,
  serializeAnnotationSample,
  serializeCompactSample,
};

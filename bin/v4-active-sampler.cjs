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
 *
 * It combines boundary, bucket-diversity, positive/negative conflict, and
 * transient sanity-check samples for annotation efficiency.
 */

const fs = require('node:fs');
const {
  DEFAULT_RESCUE_SCORING_THRESHOLD,
  DEFAULT_RESCUE_UNSURE_THRESHOLD,
  DEFAULT_RESCUE_SCORING_WEIGHTS,
} = require('../lib/annotation/archived-raw-log-rescue-scoring.cjs');
const {
  selectActiveSamplerSamples,
} = require('../lib/annotation/archived-raw-log-rescue-sampler.cjs');

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(l => JSON.parse(l));
}

function argValue(args, name, fallback) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
  const prefix = `${name}=`;
  const inline = args.find(arg => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

function main() {
  const args = process.argv.slice(2);

  const input = argValue(args, '--input', 'reports/archived-raw-log-rescue-candidates-latest.jsonl');

  const limit = parseInt(argValue(args, '--limit', '20'), 10);

  const threshold = parseInt(
    argValue(args, '--threshold', String(DEFAULT_RESCUE_SCORING_THRESHOLD)), 10
  );

  if (!fs.existsSync(input)) {
    console.error(`[v4-sampler] input not found: ${input}`);
    process.exit(1);
  }

  const samples = readJsonl(input);

  const selection = selectActiveSamplerSamples(samples, { threshold, limit });
  const selected = selection.selected;

  const out = {
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
    samples: selected.map(s => ({
      selection_reason: s._selection_reason,
      sampler_tags: s._sampler,
      sample_id: s.sample_id,
      chunk_id: s.chunk_id,
      path: s.path,
      primary_bucket: s.primary_bucket,
      risk_score: s.risk_score,
      computed_score: s._score,
      predicted_keep_active: s._predicted_keep_active,
      boundary_distance: s._boundary,
      score_parts: s._score_parts
    }))
  };

  console.log(JSON.stringify(out, null, 2));
}

main();

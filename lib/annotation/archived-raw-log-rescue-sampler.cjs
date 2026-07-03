'use strict';

const {
  computeArchivedRawLogRescueScore,
  DEFAULT_RESCUE_SCORING_THRESHOLD,
} = require('./archived-raw-log-rescue-scoring.cjs');

const DEFAULT_BUCKET_ORDER = Object.freeze([
  'archived_raw_log_decision',
  'archived_raw_log_preference',
  'archived_raw_log_todo',
  'archived_raw_log_project',
  'archived_raw_log_transient',
  'archived_raw_log_keyword',
]);

const DEFAULT_SAMPLER_QUOTAS = Object.freeze({
  conflictShare: 0.25,
  transientShare: 0.10,
  bucketDiversityShare: 0.30,
});

function hasAny(items = []) {
  return Array.isArray(items) && items.length > 0;
}

function signalSet(sample = {}) {
  return new Set(Array.isArray(sample.risk_signals) ? sample.risk_signals : []);
}

function polarity(sample = {}) {
  return {
    positive: sample.signal_polarity?.positive_evidence || [],
    negative: sample.signal_polarity?.negative_evidence || [],
  };
}

function scoreCandidate(sample = {}, options = {}) {
  const scoring = computeArchivedRawLogRescueScore(sample, {
    threshold: options.threshold ?? DEFAULT_RESCUE_SCORING_THRESHOLD,
  });
  const signals = signalSet(sample);
  const p = polarity(sample);
  const hasPositiveEvidence = hasAny(p.positive) || signals.has('engineering_evidence_signal');
  const hasNegativeEvidence = hasAny(p.negative) || signals.has('transient_runtime_noise_signal') || signals.has('pure_tool_output_signal');
  const isConflict = hasPositiveEvidence && hasNegativeEvidence;
  const isTransient = sample.primary_bucket === 'archived_raw_log_transient' || signals.has('transient_runtime_noise_signal');

  return {
    ...sample,
    _score: scoring.score,
    _score_parts: scoring.parts,
    _score_signals: scoring.signals,
    _predicted_keep_active: scoring.predicted_keep_active,
    _boundary: scoring.boundary_distance,
    _sampler: {
      has_positive_evidence: hasPositiveEvidence,
      has_negative_evidence: hasNegativeEvidence,
      is_conflict: isConflict,
      is_transient: isTransient,
    },
  };
}

function compareByBoundary(a, b) {
  if (a._boundary !== b._boundary) return a._boundary - b._boundary;
  if ((b.risk_score || 0) !== (a.risk_score || 0)) return (b.risk_score || 0) - (a.risk_score || 0);
  return String(a.sample_id || '').localeCompare(String(b.sample_id || ''));
}

function compareByRiskThenBoundary(a, b) {
  if ((b.risk_score || 0) !== (a.risk_score || 0)) return (b.risk_score || 0) - (a.risk_score || 0);
  return compareByBoundary(a, b);
}

function bucketDistribution(samples = []) {
  const out = {};
  for (const sample of samples) {
    const bucket = sample.primary_bucket || 'unknown';
    out[bucket] = (out[bucket] || 0) + 1;
  }
  return out;
}

function reasonDistribution(samples = []) {
  const out = {};
  for (const sample of samples) {
    const reason = sample._selection_reason || 'unknown';
    out[reason] = (out[reason] || 0) + 1;
  }
  return out;
}

function addSelected({ selected, selectedIds, sample, reason }) {
  if (!sample || selectedIds.has(sample.sample_id)) return false;
  selected.push({
    ...sample,
    _selection_reason: reason,
  });
  selectedIds.add(sample.sample_id);
  return true;
}

function quotaCount(limit, share, maxAvailable) {
  if (limit <= 0 || maxAvailable <= 0 || share <= 0) return 0;
  return Math.min(maxAvailable, Math.max(1, Math.floor(limit * share)));
}

function selectFromList({ selected, selectedIds, candidates, count, reason }) {
  let added = 0;
  for (const candidate of candidates) {
    if (added >= count) break;
    if (addSelected({ selected, selectedIds, sample: candidate, reason })) added += 1;
  }
  return added;
}

function selectBucketDiversity({ selected, selectedIds, scored, count, bucketOrder = DEFAULT_BUCKET_ORDER }) {
  let added = 0;
  for (const bucket of bucketOrder) {
    if (added >= count) break;
    const candidate = scored
      .filter(sample => sample.primary_bucket === bucket && !selectedIds.has(sample.sample_id))
      .sort(compareByBoundary)[0];
    if (candidate && addSelected({ selected, selectedIds, sample: candidate, reason: 'bucket_diversity' })) {
      added += 1;
    }
  }
  return added;
}

function selectActiveSamplerSamples(samples = [], options = {}) {
  const limit = Math.max(0, Number.parseInt(String(options.limit ?? 20), 10) || 0);
  const threshold = options.threshold ?? DEFAULT_RESCUE_SCORING_THRESHOLD;
  const quotas = {
    ...DEFAULT_SAMPLER_QUOTAS,
    ...(options.quotas || {}),
  };
  const bucketOrder = options.bucketOrder || DEFAULT_BUCKET_ORDER;

  const scored = samples.map(sample => scoreCandidate(sample, { threshold }));
  const selected = [];
  const selectedIds = new Set();

  const conflicts = scored
    .filter(sample => sample._sampler.is_conflict)
    .sort(compareByBoundary);
  const transients = scored
    .filter(sample => sample._sampler.is_transient)
    .sort(compareByRiskThenBoundary);
  const boundary = scored.slice().sort(compareByBoundary);

  const conflictQuota = quotaCount(limit, quotas.conflictShare, conflicts.length);
  const transientQuota = quotaCount(limit, quotas.transientShare, transients.length);
  const bucketDiversityQuota = Math.min(
    Math.max(0, limit - selected.length),
    quotaCount(limit, quotas.bucketDiversityShare, bucketOrder.length),
  );

  selectFromList({
    selected,
    selectedIds,
    candidates: conflicts,
    count: conflictQuota,
    reason: 'positive_negative_conflict',
  });

  selectFromList({
    selected,
    selectedIds,
    candidates: transients,
    count: transientQuota,
    reason: 'transient_sanity_check',
  });

  selectBucketDiversity({
    selected,
    selectedIds,
    scored,
    count: bucketDiversityQuota,
    bucketOrder,
  });

  selectFromList({
    selected,
    selectedIds,
    candidates: boundary,
    count: Math.max(0, limit - selected.length),
    reason: 'boundary',
  });

  return {
    mode: 'v0.4_active_sampler_diversity_mvp',
    threshold,
    limit,
    quotas,
    input_count: samples.length,
    scored_count: scored.length,
    selected_count: selected.length,
    summary: {
      selected_bucket_distribution: bucketDistribution(selected),
      selection_reason_distribution: reasonDistribution(selected),
      conflict_pool_count: conflicts.length,
      transient_pool_count: transients.length,
      positive_evidence_count: scored.filter(sample => sample._sampler.has_positive_evidence).length,
      negative_evidence_count: scored.filter(sample => sample._sampler.has_negative_evidence).length,
    },
    selected,
  };
}

module.exports = {
  DEFAULT_BUCKET_ORDER,
  DEFAULT_SAMPLER_QUOTAS,
  bucketDistribution,
  reasonDistribution,
  scoreCandidate,
  selectActiveSamplerSamples,
};

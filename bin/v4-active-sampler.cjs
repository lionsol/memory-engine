#!/usr/bin/env node
/**
 * v0.4 Active Sampler (MVP)
 * ------------------------
 * Deterministic boundary sampler for archived raw-log rescue pipeline.
 *
 * This version is intentionally conservative:
 * - NO learning
 * - NO weight updates
 * - NO information gain modeling
 * - NO rarity modeling
 *
 * It only selects samples near decision boundary for annotation efficiency.
 */

const fs = require('node:fs');

const DEFAULT_THRESHOLD = 55;
const DEFAULT_UNSURE_THRESHOLD = 30;

const WEIGHTS_V02_REBALANCED = Object.freeze({
  project: 44,
  projectDecision: 18,
  preference: 46,
  projectTodo: 6,
  nonProjectTodo: -8,
  keywordHardDrop: -55,
  rawLogPenalty: -6,
  toolOutputPenalty: -16,
  positiveCap: 70,
});

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(l => JSON.parse(l));
}

/**
 * v0.2 scoring, rebalanced after the first v0.4 sampler run.
 *
 * Goals:
 * - decision is only positive when project-related
 * - todo is a weak contributor, not a category-level keep signal
 * - keyword is a hard negative bucket
 * - preference/project combinations are capped to avoid score inflation
 * - raw_log/tool-output signals are explicit penalties
 */
function computeScore(sample) {
  const signals = new Set(sample.risk_signals || []);
  const parts = [];
  let positive = 0;
  let penalty = 0;

  const hasProject = signals.has('project:memory-engine') || signals.has('project:openclaw');
  const hasDecision = signals.has('decision_signal');
  const hasPreference = signals.has('preference_signal');
  const hasTodo = signals.has('todo_signal');
  const hasToolOutput = signals.has('tool_output_or_code_signal');
  const isKeyword = sample.primary_bucket === 'archived_raw_log_keyword';
  const isArchivedRawLog = Array.isArray(sample.quality_flags)
    ? sample.quality_flags.includes('archived_raw_log') || sample.quality_flags.includes('raw_log_leak')
    : true;

  function addPositive(name, value) {
    positive += value;
    parts.push({ name, value });
  }

  function addPenalty(name, value) {
    penalty += value;
    parts.push({ name, value });
  }

  if (hasProject) addPositive('project_signal', WEIGHTS_V02_REBALANCED.project);

  // User policy: only project-related decisions are rescue-positive.
  if (hasDecision && hasProject) {
    addPositive('project_decision_signal', WEIGHTS_V02_REBALANCED.projectDecision);
  } else if (hasDecision) {
    parts.push({ name: 'non_project_decision_ignored', value: 0 });
  }

  if (hasPreference) addPositive('preference_signal', WEIGHTS_V02_REBALANCED.preference);

  // Todo is a weak state signal. It cannot independently push a memory into keep.
  if (hasTodo && hasProject) {
    addPositive('project_todo_signal', WEIGHTS_V02_REBALANCED.projectTodo);
  } else if (hasTodo) {
    addPenalty('non_project_todo_penalty', WEIGHTS_V02_REBALANCED.nonProjectTodo);
  }

  const cappedPositive = Math.min(positive, WEIGHTS_V02_REBALANCED.positiveCap);
  if (cappedPositive !== positive) {
    parts.push({ name: 'positive_cap', value: cappedPositive - positive });
  }

  if (isArchivedRawLog) addPenalty('archived_raw_log_penalty', WEIGHTS_V02_REBALANCED.rawLogPenalty);
  if (hasToolOutput) addPenalty('tool_output_penalty', WEIGHTS_V02_REBALANCED.toolOutputPenalty);
  if (isKeyword) addPenalty('keyword_hard_drop', WEIGHTS_V02_REBALANCED.keywordHardDrop);

  const score = cappedPositive + penalty;
  return {
    score,
    parts,
    signals: {
      hasProject,
      hasDecision,
      hasPreference,
      hasTodo,
      hasToolOutput,
      isKeyword,
      isArchivedRawLog,
    },
  };
}

function classifyScore(score, threshold, unsureThreshold = DEFAULT_UNSURE_THRESHOLD) {
  if (score >= threshold) return 'yes';
  if (score >= unsureThreshold) return 'unsure';
  return 'no';
}

function boundaryScore(score, threshold) {
  return Math.abs(score - threshold);
}

function select(samples, threshold, limit) {
  const scored = samples.map(s => {
    const scoring = computeScore(s);
    return {
      ...s,
      _score: scoring.score,
      _score_parts: scoring.parts,
      _score_signals: scoring.signals,
      _predicted_keep_active: classifyScore(scoring.score, threshold),
      _boundary: boundaryScore(scoring.score, threshold)
    };
  });

  // sort by closest to boundary (most informative)
  scored.sort((a, b) => a._boundary - b._boundary);

  return scored.slice(0, limit);
}

function main() {
  const args = process.argv.slice(2);

  const input = args.find(a => a.startsWith('--input='))?.split('=')[1]
    || 'reports/archived-raw-log-rescue-candidates-latest.jsonl';

  const limit = parseInt(
    args.find(a => a.startsWith('--limit='))?.split('=')[1]
    || '20', 10
  );

  const threshold = parseInt(
    args.find(a => a.startsWith('--threshold='))?.split('=')[1]
    || String(DEFAULT_THRESHOLD), 10
  );

  if (!fs.existsSync(input)) {
    console.error(`[v4-sampler] input not found: ${input}`);
    process.exit(1);
  }

  const samples = readJsonl(input);

  const selected = select(samples, threshold, limit);

  const out = {
    mode: 'v0.4_active_sampler_mvp',
    input,
    threshold,
    unsure_threshold: DEFAULT_UNSURE_THRESHOLD,
    weights: WEIGHTS_V02_REBALANCED,
    limit,
    selected_count: selected.length,
    samples: selected.map(s => ({
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

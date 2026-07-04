'use strict';

const {
  hasProjectSignal,
  hasDecisionSignal,
  hasPreferenceSignal,
  hasTodoSignal,
  hasToolOutputSignal,
  hasEngineeringEvidenceSignal,
  hasTransientRuntimeNoiseSignal,
  hasPureToolOutputSignal,
  isKeywordBucket,
  isArchivedRawLogLike,
} = require('./archived-raw-log-rescue-rules.cjs');

const DEFAULT_RESCUE_SCORING_THRESHOLD = 55;
const DEFAULT_RESCUE_UNSURE_THRESHOLD = 30;

const DEFAULT_RESCUE_SCORING_WEIGHTS = Object.freeze({
  project: 44,
  projectDecision: 18,
  preference: 46,
  projectTodo: 6,
  nonProjectTodo: -8,
  keywordHardDrop: -55,
  rawLogPenalty: -6,
  toolOutputPenalty: -16,
  engineeringEvidence: 22,
  transientRuntimeNoisePenalty: -35,
  positiveNegativeConflictPenalty: -5,
  pureToolOutputPenalty: -12,
  positiveCap: 70,
});

function classifyRescueScore(
  score,
  threshold = DEFAULT_RESCUE_SCORING_THRESHOLD,
  unsureThreshold = DEFAULT_RESCUE_UNSURE_THRESHOLD,
) {
  if (score >= threshold) return 'yes';
  if (score >= unsureThreshold) return 'unsure';
  return 'no';
}

function boundaryDistance(score, threshold = DEFAULT_RESCUE_SCORING_THRESHOLD) {
  return Math.abs(score - threshold);
}

function positivePartNames(parts = []) {
  return parts
    .filter(part => Number(part?.value) > 0)
    .map(part => part.name);
}

function hasHighValuePositiveParts(parts = []) {
  const names = positivePartNames(parts);
  const positiveNonProjectParts = names.filter(name => name !== 'project_signal');

  return (
    names.includes('project_decision_signal') ||
    names.includes('preference_signal') ||
    names.includes('project_todo_signal') ||
    positiveNonProjectParts.length >= 2
  );
}

/**
 * v0.2 archived raw-log rescue score.
 *
 * This score is intentionally conservative and explainable. It is a preview
 * and sampling score only; it must not directly apply lifecycle mutations.
 */
function computeArchivedRawLogRescueScore(sample = {}, options = {}) {
  const weights = Object.freeze({
    ...DEFAULT_RESCUE_SCORING_WEIGHTS,
    ...(options.weights || {}),
  });

  const parts = [];
  let positive = 0;
  let penalty = 0;

  const signals = {
    hasProject: hasProjectSignal(sample),
    hasDecision: hasDecisionSignal(sample),
    hasPreference: hasPreferenceSignal(sample),
    hasTodo: hasTodoSignal(sample),
    hasToolOutput: hasToolOutputSignal(sample),
    hasEngineeringEvidence: hasEngineeringEvidenceSignal(sample),
    hasTransientRuntimeNoise: hasTransientRuntimeNoiseSignal(sample),
    hasPureToolOutput: hasPureToolOutputSignal(sample),
    hasPositiveNegativeConflict: hasEngineeringEvidenceSignal(sample) && hasTransientRuntimeNoiseSignal(sample),
    isKeyword: isKeywordBucket(sample),
    isArchivedRawLog: isArchivedRawLogLike(sample),
  };

  function addPositive(name, value) {
    positive += value;
    parts.push({ name, value });
  }

  function addPenalty(name, value) {
    penalty += value;
    parts.push({ name, value });
  }

  if (signals.hasProject) addPositive('project_signal', weights.project);

  // User policy: only project-related decisions are rescue-positive.
  if (signals.hasDecision && signals.hasProject) {
    addPositive('project_decision_signal', weights.projectDecision);
  } else if (signals.hasDecision) {
    parts.push({ name: 'non_project_decision_ignored', value: 0 });
  }

  if (signals.hasPreference) addPositive('preference_signal', weights.preference);

  // Refined evidence signals are for sampling priority, not lifecycle apply.
  if (signals.hasEngineeringEvidence) addPositive('engineering_evidence_signal', weights.engineeringEvidence);

  // Todo is a weak state signal. It cannot independently push a memory into keep.
  if (signals.hasTodo && signals.hasProject) {
    addPositive('project_todo_signal', weights.projectTodo);
  } else if (signals.hasTodo) {
    addPenalty('non_project_todo_penalty', weights.nonProjectTodo);
  }

  const cappedPositive = Math.min(positive, weights.positiveCap);
  if (cappedPositive !== positive) {
    parts.push({ name: 'positive_cap', value: cappedPositive - positive });
  }

  if (signals.isArchivedRawLog) addPenalty('archived_raw_log_penalty', weights.rawLogPenalty);
  if (signals.hasToolOutput && !signals.hasEngineeringEvidence) addPenalty('tool_output_penalty', weights.toolOutputPenalty);
  if (signals.hasPureToolOutput) addPenalty('pure_tool_output_penalty', weights.pureToolOutputPenalty);
  if (signals.hasPositiveNegativeConflict) {
    addPenalty('positive_negative_conflict_penalty', weights.positiveNegativeConflictPenalty);
  } else if (signals.hasTransientRuntimeNoise) {
    addPenalty('transient_runtime_noise_penalty', weights.transientRuntimeNoisePenalty);
  }
  if (signals.isKeyword) addPenalty('keyword_hard_drop', weights.keywordHardDrop);

  const score = cappedPositive + penalty;
  const threshold = options.threshold ?? DEFAULT_RESCUE_SCORING_THRESHOLD;
  const unsureThreshold = options.unsureThreshold ?? DEFAULT_RESCUE_UNSURE_THRESHOLD;
  const rawPredictedKeepActive = classifyRescueScore(score, threshold, unsureThreshold);
  const manualReviewFlags = signals.hasPositiveNegativeConflict ? ['positive_negative_conflict'] : [];
  let predictedKeepActive = rawPredictedKeepActive;
  if (signals.hasPositiveNegativeConflict && rawPredictedKeepActive === 'yes' && !hasHighValuePositiveParts(parts)) {
    predictedKeepActive = 'unsure';
    parts.push({ name: 'positive_negative_conflict_prediction_cap', value: 0 });
  }

  return {
    scoring_version: 'archived_raw_log_rescue_v0.2',
    score,
    threshold,
    unsure_threshold: unsureThreshold,
    raw_predicted_keep_active: rawPredictedKeepActive,
    predicted_keep_active: predictedKeepActive,
    boundary_distance: boundaryDistance(score, threshold),
    parts,
    signals,
    manual_review_flags: manualReviewFlags,
    weights,
    safety: {
      db_writes: false,
      unarchive: false,
      category_update: false,
      delete: false,
      quarantine: false,
      reinforce: false,
    },
  };
}

module.exports = {
  DEFAULT_RESCUE_SCORING_THRESHOLD,
  DEFAULT_RESCUE_UNSURE_THRESHOLD,
  DEFAULT_RESCUE_SCORING_WEIGHTS,
  boundaryDistance,
  classifyRescueScore,
  computeArchivedRawLogRescueScore,
  hasHighValuePositiveParts,
  positivePartNames,
};

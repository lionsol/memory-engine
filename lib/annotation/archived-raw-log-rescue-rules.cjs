'use strict';

const DEFAULT_KEYWORD_BUCKET = 'archived_raw_log_keyword';

function getSignals(sample = {}) {
  return new Set(Array.isArray(sample.risk_signals) ? sample.risk_signals : []);
}

function getQualityFlags(sample = {}) {
  return new Set(Array.isArray(sample.quality_flags) ? sample.quality_flags : []);
}

function hasProjectSignal(sample = {}) {
  const signals = getSignals(sample);
  return signals.has('project:memory-engine') || signals.has('project:openclaw');
}

function hasDecisionSignal(sample = {}) {
  return getSignals(sample).has('decision_signal');
}

function hasPreferenceSignal(sample = {}) {
  return getSignals(sample).has('preference_signal');
}

function hasTodoSignal(sample = {}) {
  return getSignals(sample).has('todo_signal');
}

function hasToolOutputSignal(sample = {}) {
  return getSignals(sample).has('tool_output_or_code_signal');
}

function hasEngineeringEvidenceSignal(sample = {}) {
  return getSignals(sample).has('engineering_evidence_signal');
}

function hasTransientRuntimeNoiseSignal(sample = {}) {
  return getSignals(sample).has('transient_runtime_noise_signal');
}

function hasPureToolOutputSignal(sample = {}) {
  return getSignals(sample).has('pure_tool_output_signal');
}

function isKeywordBucket(sample = {}) {
  return sample.primary_bucket === DEFAULT_KEYWORD_BUCKET;
}

function isArchivedRawLogLike(sample = {}) {
  const flags = getQualityFlags(sample);
  if (flags.size === 0) return true;
  return flags.has('archived_raw_log') || flags.has('raw_log_leak');
}

function normalizeAnnotation(annotation = {}) {
  return {
    keep_active: typeof annotation.keep_active === 'string' ? annotation.keep_active.trim() : '',
    target_category: typeof annotation.target_category === 'string' ? annotation.target_category.trim() : '',
    rescue_confidence: typeof annotation.rescue_confidence === 'string' ? annotation.rescue_confidence.trim() : '',
  };
}

/**
 * Deterministic v0.1 rescue policy.
 *
 * This is a policy preview only. It never applies, restores, unarchives,
 * reclassifies, deletes, quarantines, or reinforces memory rows.
 */
function evaluateArchivedRawLogRescueRules(sample = {}) {
  const annotation = normalizeAnnotation(sample.annotation || {});
  const reasons = [];
  const signals = {
    hasProject: hasProjectSignal(sample),
    hasDecision: hasDecisionSignal(sample),
    hasPreference: hasPreferenceSignal(sample),
    hasTodo: hasTodoSignal(sample),
    hasToolOutput: hasToolOutputSignal(sample),
    hasEngineeringEvidence: hasEngineeringEvidenceSignal(sample),
    hasTransientRuntimeNoise: hasTransientRuntimeNoiseSignal(sample),
    hasPureToolOutput: hasPureToolOutputSignal(sample),
    isKeyword: isKeywordBucket(sample),
    isArchivedRawLog: isArchivedRawLogLike(sample),
  };

  function result({ keep_active, target_category, rule_id, requires_manual_review = false }) {
    return {
      policy_version: 'archived_raw_log_rescue_v0.1',
      keep_active,
      target_category,
      rule_id,
      reasons,
      requires_manual_review,
      signals,
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

  if (annotation.keep_active === 'no') {
    reasons.push('manual_annotation_keep_active_no');
    return result({
      keep_active: 'no',
      target_category: annotation.target_category || 'raw_log',
      rule_id: 'M1_MANUAL_KEEP_ACTIVE_NO',
    });
  }

  if (annotation.keep_active === 'yes') {
    reasons.push('manual_annotation_keep_active_yes');
    return result({
      keep_active: 'yes',
      target_category: annotation.target_category || 'raw_log',
      rule_id: 'M2_MANUAL_KEEP_ACTIVE_YES',
      requires_manual_review: true,
    });
  }

  if (isKeywordBucket(sample)) {
    reasons.push('primary_bucket=archived_raw_log_keyword');
    return result({
      keep_active: 'no',
      target_category: 'raw_log',
      rule_id: 'K1_KEYWORD_HARD_DROP',
    });
  }

  if (annotation.rescue_confidence === 'low') {
    reasons.push('rescue_confidence=low');
    return result({
      keep_active: 'no',
      target_category: annotation.target_category || 'raw_log',
      rule_id: 'S1_LOW_CONFIDENCE_SUPPRESSION',
    });
  }

  if (signals.hasProject) {
    reasons.push('project_signal');
    if (signals.hasDecision) reasons.push('project_related_decision_signal');
    if (signals.hasTodo) reasons.push('project_related_todo_signal');
    return result({
      keep_active: 'yes',
      target_category: annotation.target_category || 'project',
      rule_id: signals.hasDecision ? 'D1_PROJECT_DECISION_KEEP' : 'P1_PROJECT_KEEP',
      requires_manual_review: true,
    });
  }

  if (signals.hasPreference) {
    reasons.push('preference_signal');
    return result({
      keep_active: 'yes',
      target_category: annotation.target_category || 'preference',
      rule_id: 'R1_PREFERENCE_KEEP',
      requires_manual_review: true,
    });
  }

  if (signals.hasDecision) {
    reasons.push('decision_signal_without_project_signal');
    return result({
      keep_active: 'no',
      target_category: annotation.target_category || 'raw_log',
      rule_id: 'D2_NON_PROJECT_DECISION_DROP',
    });
  }

  if (signals.hasTodo) {
    reasons.push('todo_signal_without_project_signal');
    return result({
      keep_active: 'no',
      target_category: annotation.target_category || 'raw_log',
      rule_id: 'T2_EPHEMERAL_TODO_DROP',
    });
  }

  reasons.push('no_positive_rescue_signal');
  return result({
    keep_active: 'no',
    target_category: annotation.target_category || 'raw_log',
    rule_id: 'S2_DEFAULT_DROP',
  });
}

module.exports = {
  DEFAULT_KEYWORD_BUCKET,
  evaluateArchivedRawLogRescueRules,
  getSignals,
  getQualityFlags,
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
  normalizeAnnotation,
};

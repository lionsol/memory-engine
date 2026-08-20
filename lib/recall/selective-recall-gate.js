import { analyzeAutoRecallIntent } from "./auto-recall-intent.js";
import { extractAutoRecallIntentEvidence } from "./auto-recall-intent-evidence.js";

export const SELECTIVE_RECALL_GATE_DECISIONS = Object.freeze({
  SAFE_SKIP: "SAFE_SKIP",
  ABSTAIN: "ABSTAIN",
});

const CURRENT_TEXT_TRANSFORM_INTENTS = new Set([
  "translate_current_text",
  "summarize_current_text",
  "rewrite_current_text",
  "extract_structured_info",
]);

function hasPositiveHistoryLookup(evidence) {
  return Boolean(
    evidence.historical_context_lookup
    || evidence.continuation_lookup
    || evidence.project_state_lookup
    || evidence.prior_decision_lookup
    || evidence.preference_lookup
    || evidence.workflow_lookup
    || evidence.entity_background_lookup
    || evidence.decision_record_lookup
  );
}

/**
 * Offline-only v2-C1 selective recall gate candidate.
 *
 * This gate deliberately does not consume recall_intent. It may override V1 only
 * when current-input scope is explicit enough to support a high-precision skip.
 * All other inputs abstain and preserve V1 behavior.
 */
export function classifySelectiveRecallGate(prompt) {
  const analysis = analyzeAutoRecallIntent(prompt);
  const evidence = extractAutoRecallIntentEvidence(prompt, {
    project_entities: analysis.project_entities,
  });
  const positiveHistoryLookup = hasPositiveHistoryLookup(evidence);
  const suppliedTransformation = evidence.quoted_or_supplied_content_detected
    && CURRENT_TEXT_TRANSFORM_INTENTS.has(analysis.task_intent);

  // C1 is deliberately conservative about mixed request scope. The evidence
  // layer evaluates history_reference on the unmasked request surface, so a
  // surviving reference is enough to deny skip authority even when the
  // structured lookup classifier did not identify the requested relation.
  if (evidence.history_reference) {
    return {
      decision: SELECTIVE_RECALL_GATE_DECISIONS.ABSTAIN,
      reason: "unmasked_history_reference",
      task_intent: analysis.task_intent,
      positive_history_lookup: positiveHistoryLookup,
      history_reference: true,
    };
  }

  if (!positiveHistoryLookup && evidence.current_input_only) {
    return {
      decision: SELECTIVE_RECALL_GATE_DECISIONS.SAFE_SKIP,
      reason: "explicit_current_input_only",
      task_intent: analysis.task_intent,
      positive_history_lookup: false,
      history_reference: false,
    };
  }

  if (!positiveHistoryLookup && suppliedTransformation) {
    return {
      decision: SELECTIVE_RECALL_GATE_DECISIONS.SAFE_SKIP,
      reason: "supplied_current_text_transformation",
      task_intent: analysis.task_intent,
      positive_history_lookup: false,
      history_reference: false,
    };
  }

  return {
    decision: SELECTIVE_RECALL_GATE_DECISIONS.ABSTAIN,
    reason: positiveHistoryLookup
      ? "history_lookup_evidence_present"
      : "insufficient_skip_evidence",
    task_intent: analysis.task_intent,
    positive_history_lookup: positiveHistoryLookup,
    history_reference: false,
  };
}

export function applySelectiveRecallGateToV1(prompt, v1ShouldRecall) {
  const gate = classifySelectiveRecallGate(prompt);
  return {
    ...gate,
    should_recall: gate.decision === SELECTIVE_RECALL_GATE_DECISIONS.SAFE_SKIP
      ? false
      : v1ShouldRecall,
  };
}

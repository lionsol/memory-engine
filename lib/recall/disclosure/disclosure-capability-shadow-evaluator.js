import { createCandidateDisclosureEvaluationEnvelopeV2 } from "./candidate-disclosure-evaluation-envelope-v2.js";
import { selectDisclosureCandidates } from "./disclosure-selector.js";
import { DISCLOSURE_DECISIONS, isRecord } from "./disclosure-types.js";

export const DISCLOSURE_CAPABILITY_STATES = Object.freeze([
  "RETRIEVAL_ONLY",
  "INTERNAL_CONTEXT",
  "CARD_DISCLOSABLE",
  "RAW_DISCLOSABLE",
]);

export const SHADOW_DISCLOSURE_LEVELS = Object.freeze(["NONE", "CARD"]);
export const SHADOW_EVALUATION_EVIDENCE_ROLE = "offline_shadow_evaluation";
export const SHADOW_CAPABILITY_REASONS = Object.freeze([
  "card_allowed",
  "unsafe_disclosure",
  "unsafe_artifact",
  "invalid_projection",
  "invalid_risk_context",
  "blocked_lifecycle",
  "scope_denied",
  "safe_disclosure_not_authorized",
]);

const BLOCKING_ARTIFACT_STATES = new Set([
  "raw_log",
  "tool_output",
  "dreaming",
  "diagnostic",
  "unsafe",
]);
const BLOCKING_RISK_FLAGS = new Set([
  "raw_log_like",
  "unsafe_artifact",
  "cross_agent_scope",
  "untrusted",
]);
const SENSITIVE_RISK_FLAGS = new Set([
  "sensitive",
  "private",
  "personal",
  "personal_data",
  "confidential",
  "secret",
]);
const BLOCKING_LIFECYCLE_FLAGS = ["archived", "quarantined", "deleted_shadow", "stale_index_candidate"];
const SENSITIVE_SCOPE_VALUES = new Set(["private", "personal", "confidential"]);
const SAFE_SCOPE_VALUES = new Set(["shared", "project", "task", "user"]);

function normalizedSet(values) {
  return new Set((Array.isArray(values) ? values : []).map(value => String(value || "").trim().toLowerCase()).filter(Boolean));
}

function contextFor(value) {
  if (isRecord(value?.canonical_context)) return value.canonical_context;
  return isRecord(value) ? value : {};
}

function hasBlockingLifecycle(context) {
  const lifecycle = context.lifecycle;
  if (!isRecord(lifecycle) || lifecycle.state !== "active") return true;
  return BLOCKING_LIFECYCLE_FLAGS.some(flag => lifecycle[flag] === true || Number(lifecycle[flag] || 0) === 1);
}

function hasBlockingScope(context) {
  const scope = context.scope;
  if (!isRecord(scope)) return true;
  const scopeValue = String(scope.scope || "").trim().toLowerCase();
  const agentScope = String(scope.agent_scope || "").trim().toLowerCase();
  if (!SAFE_SCOPE_VALUES.has(scopeValue)) return !SENSITIVE_SCOPE_VALUES.has(scopeValue);
  return agentScope.length === 0 || ["unknown", "cross_agent", "untrusted"].includes(agentScope);
}

function hasSensitiveScope(context) {
  const scopeValue = String(context.scope?.scope || "").trim().toLowerCase();
  return SENSITIVE_SCOPE_VALUES.has(scopeValue);
}

function hasBlockingRisk(context) {
  const riskFlags = normalizedSet(context.risk_flags);
  return [...riskFlags].some(flag => BLOCKING_RISK_FLAGS.has(flag));
}

function hasSensitiveRisk(context) {
  const riskFlags = normalizedSet(context.risk_flags);
  return [...riskFlags].some(flag => SENSITIVE_RISK_FLAGS.has(flag));
}

function capabilityResult(capability, reason) {
  return { capability, reason };
}

/**
 * Explains the future DisclosureCapability v1.1 state from bounded canonical
 * context. This is an offline shadow rule only; it never returns
 * RAW_DISCLOSABLE and never mutates its input.
 */
export function explainShadowCapability(canonicalContext = {}) {
  const context = contextFor(canonicalContext);
  if (!Array.isArray(context.risk_flags)) return capabilityResult("RETRIEVAL_ONLY", "invalid_risk_context");
  if (context.projection_valid !== true) return capabilityResult("RETRIEVAL_ONLY", "invalid_projection");
  if (hasBlockingLifecycle(context)) return capabilityResult("RETRIEVAL_ONLY", "blocked_lifecycle");
  if (hasBlockingScope(context)) return capabilityResult("RETRIEVAL_ONLY", "scope_denied");
  if (BLOCKING_ARTIFACT_STATES.has(String(context.artifact_state || "").trim().toLowerCase())) {
    return capabilityResult("RETRIEVAL_ONLY", "unsafe_artifact");
  }
  if (hasBlockingRisk(context)) return capabilityResult("RETRIEVAL_ONLY", "unsafe_disclosure");
  if (String(context.artifact_state || "").trim().toLowerCase() !== "safe") {
    return capabilityResult("RETRIEVAL_ONLY", "unsafe_artifact");
  }
  if (context.safe_to_disclose === false) return capabilityResult("INTERNAL_CONTEXT", "unsafe_disclosure");
  if (context.safe_to_disclose !== true) {
    return capabilityResult("RETRIEVAL_ONLY", "safe_disclosure_not_authorized");
  }
  if (hasSensitiveRisk(context) || hasSensitiveScope(context)) {
    return capabilityResult("INTERNAL_CONTEXT", "unsafe_disclosure");
  }
  return capabilityResult("CARD_DISCLOSABLE", "card_allowed");
}

/**
 * Calculates the future DisclosureCapability v1.1 state while preserving the
 * original string-returning helper contract.
 */
export function calculateShadowCapability(canonicalContext = {}) {
  return explainShadowCapability(canonicalContext).capability;
}

function disclosureFromSelection(selection) {
  return selection?.decision === DISCLOSURE_DECISIONS.DISCLOSE_CARD ? "CARD" : "NONE";
}

function expectedCapabilityFor(candidate) {
  const explicit = candidate?.label?.expected_capability;
  if (DISCLOSURE_CAPABILITY_STATES.includes(explicit)) return explicit;
  // The existing v2 fixture has no expected_capability field. A CARD label
  // proves the minimum expected capability; NONE intentionally remains
  // unspecified rather than being relabeled as RETRIEVAL_ONLY.
  if (candidate?.label?.safe_to_disclose === true) return "CARD_DISCLOSABLE";
  return null;
}

function expectedDisclosureFor(candidate) {
  return SHADOW_DISCLOSURE_LEVELS.includes(candidate?.label?.expected_disclosure)
    ? candidate.label.expected_disclosure
    : null;
}

/**
 * Evaluates one synthetic/offline candidate against current and capability
 * constrained disclosure paths. It does not evaluate a fixture or persist a
 * report.
 */
export function evaluateShadowDisclosure(candidate) {
  if (!isRecord(candidate) || typeof candidate.candidate_id !== "string" || !isRecord(candidate.canonical_context)) {
    throw new TypeError("candidate_id and canonical_context are required");
  }

  const adapted = createCandidateDisclosureEvaluationEnvelopeV2(candidate);
  const currentSelection = selectDisclosureCandidates([adapted.envelope])[0];
  // The existing evaluation envelope carries safe_to_disclose in its label.
  // Feed that bounded predicate into the shadow-only capability calculation;
  // this does not change the production envelope or selector.
  const capabilityContext = {
    ...candidate.canonical_context,
    safe_to_disclose: candidate.label?.safe_to_disclose,
  };
  const capability = explainShadowCapability(capabilityContext);
  const predictedCapability = capability.capability;
  const shadowSelection = predictedCapability === "CARD_DISCLOSABLE"
    ? selectDisclosureCandidates([adapted.envelope])[0]
    : { decision: DISCLOSURE_DECISIONS.WITHHOLD };

  return {
    candidate_id: candidate.candidate_id,
    predicted_capability: predictedCapability,
    capability_reason: capability.reason,
    current_disclosure: disclosureFromSelection(currentSelection),
    shadow_disclosure: disclosureFromSelection(shadowSelection),
    expected_disclosure: expectedDisclosureFor(candidate),
    expected_capability: expectedCapabilityFor(candidate),
  };
}

function ratio(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(4));
}

function pathMetrics(candidates, results, path) {
  const metrics = {
    selected_cards: 0,
    withheld_cards: 0,
    irrelevant_disclosures: 0,
    unsafe_card_disclosure_count: 0,
    answer_bearing_total: 0,
    answer_bearing_disclosed: 0,
    answer_bearing_disclosure_recall: null,
    reduction_rate: null,
  };

  candidates.forEach((candidate, index) => {
    const disclosure = results[index][path];
    if (candidate.label?.answer_bearing === true) metrics.answer_bearing_total += 1;
    if (disclosure === "CARD") {
      metrics.selected_cards += 1;
      if (candidate.label?.answer_bearing === true) metrics.answer_bearing_disclosed += 1;
      if (candidate.label?.answer_bearing !== true) metrics.irrelevant_disclosures += 1;
      if (candidate.label?.safe_to_disclose === false) metrics.unsafe_card_disclosure_count += 1;
    } else {
      metrics.withheld_cards += 1;
    }
  });

  metrics.answer_bearing_disclosure_recall = ratio(metrics.answer_bearing_disclosed, metrics.answer_bearing_total);
  metrics.reduction_rate = ratio(metrics.withheld_cards, candidates.length);
  return metrics;
}

function capabilityAccuracy(results) {
  const comparable = results.filter(result => result.expected_capability !== null);
  if (comparable.length === 0) return null;
  const correct = comparable.filter(result => result.predicted_capability === result.expected_capability).length;
  return ratio(correct, comparable.length);
}

function capabilityDenialBreakdown(results) {
  const breakdown = {};
  results.forEach(result => {
    if (result.predicted_capability === "CARD_DISCLOSABLE") return;
    const reason = SHADOW_CAPABILITY_REASONS.includes(result.capability_reason)
      ? result.capability_reason
      : "safe_disclosure_not_authorized";
    breakdown[reason] = (breakdown[reason] || 0) + 1;
  });
  return breakdown;
}

function recallDelta(current, shadow) {
  if (current === null || shadow === null) return null;
  return Number((shadow - current).toFixed(4));
}

/**
 * Evaluates a supplied in-memory candidate list. This is the only metrics
 * entry point; callers must provide candidates and no retrieval is executed.
 */
export function evaluateShadowDisclosureCandidates(candidates = []) {
  if (!Array.isArray(candidates)) throw new TypeError("candidates must be an array");
  const results = candidates.map(evaluateShadowDisclosure);
  const current = pathMetrics(candidates, results, "current_disclosure");
  const shadow = pathMetrics(candidates, results, "shadow_disclosure");
  const capabilityDenials = capabilityDenialBreakdown(results);

  return {
    mode: "offline_disclosure_capability_shadow_evaluation_v1_1",
    evidence_role: SHADOW_EVALUATION_EVIDENCE_ROLE,
    runtime_authorized: false,
    independent_readiness_evidence: false,
    results,
    metrics: {
      current,
      shadow,
      capability_accuracy: capabilityAccuracy(results),
      capability_denial_breakdown: capabilityDenials,
      unsafe_card_disclosure_reduction: current.unsafe_card_disclosure_count - shadow.unsafe_card_disclosure_count,
      recall_delta: recallDelta(current.answer_bearing_disclosure_recall, shadow.answer_bearing_disclosure_recall),
    },
    // Top-level aliases keep the shadow safety/utility contract easy to read.
    unsafe_card_disclosure_count: shadow.unsafe_card_disclosure_count,
    answer_bearing_disclosure_recall: shadow.answer_bearing_disclosure_recall,
    selected_cards: shadow.selected_cards,
    withheld_cards: shadow.withheld_cards,
    irrelevant_disclosures: shadow.irrelevant_disclosures,
    reduction_rate: shadow.reduction_rate,
    capability_denial_breakdown: capabilityDenials,
    side_effects: {
      db_writes: false,
      data_mutation: false,
      retrieval: false,
      network: false,
      llm: false,
    },
  };
}

export const evaluateShadowDisclosureFixture = evaluateShadowDisclosureCandidates;

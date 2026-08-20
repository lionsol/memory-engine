import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateShadowCapability,
  evaluateShadowDisclosure,
  evaluateShadowDisclosureCandidates,
} from "../../lib/recall/disclosure/disclosure-capability-shadow-evaluator.js";

function context(overrides = {}) {
  return {
    lifecycle: {
      state: "active",
      archived: false,
      quarantined: false,
      deleted_shadow: false,
      stale_index_candidate: false,
      ...(overrides.lifecycle || {}),
    },
    scope: {
      scope: "shared",
      agent_scope: "shared",
      ...(overrides.scope || {}),
    },
    risk_flags: overrides.risk_flags || [],
    artifact_state: overrides.artifact_state || "safe",
    projection_valid: overrides.projection_valid ?? true,
    safe_to_disclose: overrides.safe_to_disclose ?? true,
  };
}

function candidate({
  candidate_id = "candidate-1",
  canonical_context = context(),
  answer_bearing = true,
  safe_to_disclose = true,
  expected_disclosure = safe_to_disclose ? "CARD" : "NONE",
  expected_capability = safe_to_disclose ? "CARD_DISCLOSABLE" : "RETRIEVAL_ONLY",
} = {}) {
  return {
    candidate_id,
    canonical_context,
    retrieval: { rank: 1, sources: ["vector"], final_score: 0.91 },
    label: {
      answer_bearing,
      safe_to_disclose,
      expected_disclosure,
      expected_capability,
    },
  };
}

test("safe active candidate is CARD_DISCLOSABLE", () => {
  const value = context();
  const snapshot = structuredClone(value);

  assert.equal(calculateShadowCapability(value), "CARD_DISCLOSABLE");
  assert.deepEqual(value, snapshot);
  assert.deepEqual(evaluateShadowDisclosure(candidate()), {
    candidate_id: "candidate-1",
    predicted_capability: "CARD_DISCLOSABLE",
    capability_reason: "card_allowed",
    current_disclosure: "CARD",
    shadow_disclosure: "CARD",
    expected_disclosure: "CARD",
    expected_capability: "CARD_DISCLOSABLE",
  });
});

test("unsafe artifact is RETRIEVAL_ONLY", () => {
  const result = evaluateShadowDisclosure(candidate({
    canonical_context: context({ artifact_state: "raw_log", risk_flags: ["raw_log_like"] }),
    safe_to_disclose: false,
    expected_capability: "RETRIEVAL_ONLY",
  }));

  assert.equal(result.predicted_capability, "RETRIEVAL_ONLY");
  assert.equal(result.capability_reason, "unsafe_artifact");
  assert.equal(result.current_disclosure, "NONE");
  assert.equal(result.shadow_disclosure, "NONE");
});

test("safe_to_disclose=false preserves internal context without card authority", () => {
  const result = evaluateShadowDisclosure(candidate({
    candidate_id: "unsafe-but-internal",
    canonical_context: context({ safe_to_disclose: false }),
    safe_to_disclose: false,
    expected_disclosure: "NONE",
    expected_capability: "INTERNAL_CONTEXT",
  }));

  assert.equal(result.predicted_capability, "INTERNAL_CONTEXT");
  assert.equal(result.capability_reason, "unsafe_disclosure");
  assert.equal(result.current_disclosure, "CARD");
  assert.equal(result.shadow_disclosure, "NONE");
});

test("invalid projection, blocked lifecycle, and denied scope have bounded reasons", () => {
  const cases = [
    ["invalid_projection", context({ projection_valid: false })],
    ["blocked_lifecycle", context({ lifecycle: { state: "archived" } })],
    ["scope_denied", context({ scope: { scope: "unknown", agent_scope: "unknown" } })],
  ];

  for (const [reason, canonical_context] of cases) {
    const result = evaluateShadowDisclosure(candidate({ canonical_context }));
    assert.equal(result.predicted_capability, "RETRIEVAL_ONLY");
    assert.equal(result.capability_reason, reason);
    assert.equal(result.shadow_disclosure, "NONE");
  }
});

test("RAW_DISCLOSABLE is never emitted", () => {
  const rows = [
    candidate(),
    candidate({ safe_to_disclose: false, canonical_context: context({ safe_to_disclose: false }) }),
    candidate({ canonical_context: context({ artifact_state: "raw_log" }), safe_to_disclose: false }),
  ];

  for (const row of rows) {
    assert.notEqual(calculateShadowCapability(row.canonical_context), "RAW_DISCLOSABLE");
    assert.notEqual(evaluateShadowDisclosure(row).predicted_capability, "RAW_DISCLOSABLE");
  }
});

test("sensitive candidate is INTERNAL_CONTEXT and selector cannot upgrade it", () => {
  const result = evaluateShadowDisclosure(candidate({
    candidate_id: "sensitive-1",
    canonical_context: context({ risk_flags: ["sensitive"] }),
    answer_bearing: false,
    safe_to_disclose: false,
    expected_capability: "INTERNAL_CONTEXT",
  }));

  assert.equal(result.predicted_capability, "INTERNAL_CONTEXT");
  // Existing selector sees a valid card, while the shadow path withholds it.
  assert.equal(result.current_disclosure, "CARD");
  assert.equal(result.shadow_disclosure, "NONE");
});

test("shadow metrics report safety, preservation, capability, utility, and deltas", () => {
  const rows = [
    candidate({ candidate_id: "safe-answer" }),
    candidate({
      candidate_id: "sensitive-noise",
      canonical_context: context({ risk_flags: ["sensitive"] }),
      answer_bearing: false,
      safe_to_disclose: false,
      expected_disclosure: "NONE",
      expected_capability: "INTERNAL_CONTEXT",
    }),
    candidate({
      candidate_id: "unsafe-noise",
      canonical_context: context({ artifact_state: "raw_log", risk_flags: ["raw_log_like"] }),
      answer_bearing: false,
      safe_to_disclose: false,
      expected_disclosure: "NONE",
      expected_capability: "RETRIEVAL_ONLY",
    }),
  ];
  const result = evaluateShadowDisclosureCandidates(rows);

  assert.equal(result.evidence_role, "offline_shadow_evaluation");
  assert.equal(result.runtime_authorized, false);
  assert.equal(result.independent_readiness_evidence, false);
  assert.equal(result.metrics.capability_accuracy, 1);
  assert.equal(result.metrics.current.unsafe_card_disclosure_count, 1);
  assert.equal(result.metrics.shadow.unsafe_card_disclosure_count, 0);
  assert.equal(result.metrics.unsafe_card_disclosure_reduction, 1);
  assert.deepEqual(result.metrics.capability_denial_breakdown, {
    unsafe_disclosure: 1,
    unsafe_artifact: 1,
  });
  assert.equal(result.metrics.current.answer_bearing_disclosure_recall, 1);
  assert.equal(result.metrics.shadow.answer_bearing_disclosure_recall, 1);
  assert.equal(result.metrics.recall_delta, 0);
  assert.equal(result.metrics.current.selected_cards, 2);
  assert.equal(result.metrics.shadow.selected_cards, 1);
  assert.equal(result.metrics.current.withheld_cards, 1);
  assert.equal(result.metrics.shadow.withheld_cards, 2);
  assert.equal(result.metrics.current.irrelevant_disclosures, 1);
  assert.equal(result.metrics.shadow.irrelevant_disclosures, 0);
  assert.equal(result.selected_cards, 1);
  assert.equal(result.withheld_cards, 2);
  assert.equal(result.unsafe_card_disclosure_count, 0);
  assert.deepEqual(result.capability_denial_breakdown, {
    unsafe_disclosure: 1,
    unsafe_artifact: 1,
  });
  assert.deepEqual(result.side_effects, {
    db_writes: false,
    data_mutation: false,
    retrieval: false,
    network: false,
    llm: false,
  });
});

test("existing v2 labels without expected capability remain explicit unknown", () => {
  const result = evaluateShadowDisclosure(candidate({
    safe_to_disclose: false,
    expected_capability: null,
  }));

  assert.equal(result.expected_capability, null);
});

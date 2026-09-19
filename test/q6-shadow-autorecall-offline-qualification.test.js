import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  Q6_OFFLINE_QUALIFICATION_SCHEMA_V1,
  evaluateQ6ShadowAutoRecallOfflineQualificationV1,
} from "../lib/recall/q6-shadow-autorecall-offline-qualification.js";

const AUTO_RECALL_PATH = new URL(
  "./fixtures/auto-recall-policy-holdout.v2b5.jsonl",
  import.meta.url,
);
const SELECTIVE_PATH = new URL(
  "./fixtures/selective-recall-gate-holdout.v2c2.jsonl",
  import.meta.url,
);
const DISCLOSURE_PATH = new URL(
  "./fixtures/retrieval-disclosure-holdout.v2.jsonl",
  import.meta.url,
);

function readJsonl(url) {
  return readFileSync(url, "utf8")
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line));
}

function report() {
  return evaluateQ6ShadowAutoRecallOfflineQualificationV1({
    autoRecallPolicyRows: readJsonl(AUTO_RECALL_PATH),
    selectiveRecallRows: readJsonl(SELECTIVE_PATH),
    disclosureRows: readJsonl(DISCLOSURE_PATH),
  });
}

test("Q6-C offline qualification keeps evidence roles separate and side effects zero", () => {
  const result = report();

  assert.equal(result.schema, Q6_OFFLINE_QUALIFICATION_SCHEMA_V1);
  assert.equal(result.mode, "offline_only");
  assert.equal(result.runtime_authorized, false);
  assert.deepEqual(result.evidence_roles, {
    auto_recall_policy: "historical_turn_label_component_diagnostic",
    selective_recall: "historical_turn_label_component_diagnostic",
    disclosure: "synthetic_candidate_component_diagnostic",
  });
  assert.deepEqual(result.side_effects, {
    provider_calls: 0,
    network: false,
    db_reads: false,
    db_writes: false,
    lancedb_reads: false,
    lancedb_writes: false,
    runtime_mutation: false,
    config_mutation: false,
    injection: false,
    reinforcement: false,
  });
  assert.equal(result.conclusions.live_end_to_end_quality_established, false);
  assert.equal(result.conclusions.production_prevalence_established, false);
  assert.equal(result.conclusions.fresh_fixture_required, false);
});

test("candidate-first structural skips preserve every expected-recall row but suppress none of the expected-no rows", () => {
  const result = report();

  for (const metrics of [
    result.structural.auto_recall_policy,
    result.structural.selective_recall,
  ]) {
    assert.equal(metrics.row_count, 48);
    assert.equal(metrics.invalid_rows.length, 0);
    assert.equal(metrics.expected_yes_count, 24);
    assert.equal(metrics.expected_no_count, 24);
    assert.equal(metrics.expected_yes_structural_skip_count, 0);
    assert.equal(metrics.expected_no_structural_skip_count, 0);
    assert.equal(metrics.expected_yes_search_eligible_count, 24);
    assert.equal(metrics.expected_no_search_eligible_count, 24);
    assert.equal(metrics.expected_yes_search_eligibility_recall, 1);
    assert.equal(metrics.expected_no_structural_suppression_rate, 0);
  }

  assert.equal(result.conclusions.structural_expected_yes_false_negative_zero, true);
  assert.equal(result.conclusions.structural_no_recall_suppression_observed, false);
});

test("selector-only disclosure component is not safe enough to stand alone", () => {
  const result = report();
  const disclosure = result.disclosure;

  assert.equal(disclosure.valid, true);
  assert.equal(disclosure.row_count, 48);
  assert.equal(disclosure.candidate_count, 48);
  assert.equal(disclosure.expected_card_count, 18);
  assert.equal(disclosure.expected_none_count, 30);

  assert.deepEqual(disclosure.selector_only, {
    true_positive: 18,
    false_positive: 23,
    true_negative: 7,
    false_negative: 0,
    selected_count: 41,
    precision: 0.439,
    recall: 1,
    specificity: 0.2333,
    unsafe_selected_count: 23,
    irrelevant_selected_count: 23,
  });
  assert.equal(result.conclusions.selector_only_safe_enough, false);

  assert.deepEqual(disclosure.by_family.decision_rationale.selector_only, {
    true_positive: 2,
    false_positive: 2,
    true_negative: 0,
    false_negative: 0,
    selected_count: 4,
    precision: 0.5,
    recall: 1,
    specificity: 0,
    unsafe_selected_count: 2,
    irrelevant_selected_count: 2,
  });
  assert.deepEqual(disclosure.by_family.conflict_boundary.selector_only, {
    true_positive: 0,
    false_positive: 2,
    true_negative: 2,
    false_negative: 0,
    selected_count: 2,
    precision: 0,
    recall: null,
    specificity: 0.5,
    unsafe_selected_count: 2,
    irrelevant_selected_count: 2,
  });
});

test("capability-constrained disclosure component matches all expected CARD/NONE labels", () => {
  const result = report();

  assert.deepEqual(result.disclosure.capability_constrained_component, {
    true_positive: 18,
    false_positive: 0,
    true_negative: 30,
    false_negative: 0,
    selected_count: 18,
    precision: 1,
    recall: 1,
    specificity: 1,
    unsafe_selected_count: 0,
    irrelevant_selected_count: 0,
  });
  assert.equal(
    result.conclusions.capability_component_matches_expected_disclosure,
    true,
  );
  assert.deepEqual(
    result.disclosure.by_family.conflict_boundary.capability_constrained_component,
    {
      true_positive: 0,
      false_positive: 0,
      true_negative: 4,
      false_negative: 0,
      selected_count: 0,
      precision: null,
      recall: null,
      specificity: 1,
      unsafe_selected_count: 0,
      irrelevant_selected_count: 0,
    },
  );
});

test("Q6-C refuses to turn component diagnostics into live end-to-end claims", () => {
  const result = report();
  assert.equal(result.limitations.length, 4);
  assert.match(result.limitations[0], /cannot measure would_inject precision/);
  assert.match(result.limitations[1], /omit production DIRECT_CARD/);
  assert.match(result.limitations[2], /not a replay of the current production boundary/);
  assert.match(result.limitations[3], /not production prevalence estimates/);
});

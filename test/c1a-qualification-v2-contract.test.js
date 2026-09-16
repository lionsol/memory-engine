import assert from "node:assert/strict";
import test from "node:test";

import { buildC1AQualificationManifest } from "../lib/benchmark/c1a-qualification-manifest.js";
import {
  C1A_V2_SENTINEL_COUNT,
  buildC1AV2QualificationManifest,
  scoreC1AV2Qualification,
} from "../lib/benchmark/c1a-qualification-v2-contract.js";

function syntheticCase(index, overrides = {}) {
  const control = index % 5 === 0 ? 1 : 0;
  const evidenceCount = index % 17 === 0 ? 4 : 1;
  return {
    case_id: `case-${String(index).padStart(4, "0")}`,
    query_sha256: `q-${index}`,
    ordered_candidate_ids_sha256: `i-${index}`,
    canonical_texts_sha256: `t-${index}`,
    control_top3_sha256: `c-${index}`,
    control_recall_all_at_3: control,
    gold_evidence_count: evidenceCount,
    gold_complete_in_top20: index % 7 !== 0,
    ...overrides,
  };
}

function population() {
  return Array.from({ length: 1970 }, (_, index) => syntheticCase(index));
}

function priorManifest(cases) {
  const eligibility = Object.fromEntries(cases.map(item => [item.case_id, true]));
  return buildC1AQualificationManifest({
    cases,
    eligibilityByCase: eligibility,
    profile: { id: "prior" },
    sourceIdentity: { id: "prior" },
  });
}

function metric(value) {
  return {
    "recall_all@3": value,
    "recall_any@3": value,
    "evidence_coverage@3": value,
  };
}

function primaryRow(index, {
  category = 4,
  control = index < 64 ? 1 : 0,
  final = 1,
  elapsed = 500,
} = {}) {
  return {
    case_id: `p-${index}`,
    qualification_population: "primary",
    stratum: control === 1 ? "protect" : "recoverable_rank_miss",
    eligible: true,
    rerank_eligible: true,
    attempted: true,
    provider_status: "applied",
    structurally_invalid_response: false,
    adapter_elapsed_ms: elapsed,
    control: { category, metrics: metric(control) },
    final: { category, metrics: metric(final) },
  };
}

function cleanExecution() {
  return {
    unauthorized_transmission_count: 0,
    automatic_retry_count: 0,
    request_budget_exceeded: false,
    token_budget_exceeded: false,
    cost_cap_exceeded: false,
    evidence_integrity_ok: true,
  };
}

function sentinelRows({ membershipDrift = false } = {}) {
  return Array.from({ length: C1A_V2_SENTINEL_COUNT }, (_, index) => {
    const first = [`a-${index}`, `b-${index}`, `c-${index}`];
    let second = [...first];
    if (index === 0) second = [`a-${index}`, `c-${index}`, `b-${index}`];
    if (membershipDrift && index === 1) second = [`a-${index}`, `b-${index}`, `x-${index}`];
    return {
      case_id: `s-${index}`,
      first_top3: first,
      second_top3: second,
      first_status: "applied",
      second_status: "applied",
    };
  });
}

test("C1-A v2 manifest draws a deterministic holdout disjoint from the observed P256/D64", () => {
  const cases = population();
  const prior = priorManifest(cases);
  const eligibility = Object.fromEntries(cases.map(item => [item.case_id, true]));
  const first = buildC1AV2QualificationManifest({
    cases,
    eligibilityByCase: eligibility,
    observedManifest: prior,
    profile: { id: "v2" },
    sourceIdentity: { id: "v2" },
  });
  const second = buildC1AV2QualificationManifest({
    cases,
    eligibilityByCase: eligibility,
    observedManifest: prior,
    profile: { id: "v2" },
    sourceIdentity: { id: "v2" },
  });
  assert.equal(first.manifest_sha256, second.manifest_sha256);
  assert.equal(first.population.excluded_prior_observed_unique_count, 320);
  assert.equal(first.population.holdout_case_count, 1650);
  assert.equal(first.population.primary_count, 256);
  assert.equal(first.population.diagnostic_count, 64);
  assert.equal(first.population.sentinel_count, 16);

  const observed = new Set([
    ...prior.primary.map(item => item.case_id),
    ...Object.values(prior.diagnostics).flat().map(item => item.case_id),
  ]);
  const selected = [
    ...first.primary,
    ...Object.values(first.diagnostics).flat(),
  ].map(item => item.case_id);
  assert.equal(selected.some(id => observed.has(id)), false);
  const primary = new Set(first.primary.map(item => item.case_id));
  assert.equal(first.sentinels.every(item => primary.has(item.case_id)), true);
});

test("C1-A v2 manifest fails closed on malformed observed-manifest identity", () => {
  const cases = population();
  const prior = priorManifest(cases);
  const eligibility = Object.fromEntries(cases.map(item => [item.case_id, true]));
  assert.throws(() => buildC1AV2QualificationManifest({
    cases,
    eligibilityByCase: eligibility,
    observedManifest: { ...prior, manifest_sha256: "bad" },
  }), /c1a_v2_observed_manifest_hash_invalid/);
  assert.throws(() => buildC1AV2QualificationManifest({
    cases,
    eligibilityByCase: eligibility,
    observedManifest: { ...prior, manifest_sha256: "f".repeat(64) },
  }), /c1a_v2_observed_manifest_hash_mismatch/);
});

test("C1-A v2 scorer separates adversarial protect and uses serving-relevant sentinel stability", () => {
  const rows = Array.from({ length: 256 }, (_, index) => primaryRow(index));
  // One category-5 protected regression is diagnostic-only in v2.
  rows[0] = primaryRow(0, { category: 5, control: 1, final: 0 });
  const score = scoreC1AV2Qualification({
    primaryRows: rows,
    sentinelRows: sentinelRows(),
    executionSummary: cleanExecution(),
  });
  assert.equal(score.protect.adversarial_diagnostic.regression_count, 1);
  assert.equal(score.protect.non_adversarial.regression_count, 0);
  assert.equal(score.sentinels.applied_pair_count, 16);
  assert.equal(score.sentinels.top1_exact_count, 16);
  assert.equal(score.sentinels.top3_set_exact_count, 16);
  assert.equal(score.sentinels.ordered_top3_exact_count, 15);
  assert.equal(score.gates.sentinel_top1_stability, true);
  assert.equal(score.gates.sentinel_top3_set_stability, true);
  assert.equal(score.pass, true);
});

test("C1-A v2 scorer still blocks non-adversarial protect regression and top3 membership drift", () => {
  const rows = Array.from({ length: 256 }, (_, index) => primaryRow(index));
  // Three regressions among 63 non-adversarial protected rows exceed 3%.
  for (const index of [1, 2, 3]) rows[index] = primaryRow(index, { category: 4, control: 1, final: 0 });
  const score = scoreC1AV2Qualification({
    primaryRows: rows,
    sentinelRows: sentinelRows({ membershipDrift: true }),
    executionSummary: cleanExecution(),
  });
  assert.equal(score.gates.non_adversarial_protect_regression, false);
  assert.equal(score.gates.sentinel_top3_set_stability, false);
  assert.equal(score.pass, false);
});

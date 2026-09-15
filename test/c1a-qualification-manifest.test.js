import assert from "node:assert/strict";
import test from "node:test";

import {
  buildC1AQualificationManifest,
  classifyC1ADiagnosticCase,
} from "../lib/benchmark/c1a-qualification-manifest.js";

function makeCases() {
  const rows = [];
  const strata = [
    ["protect", 1, 2, true],
    ["recoverable", 0, 2, true],
    ["candidate-miss", 0, 2, false],
    ["budget", 0, 4, true],
  ];
  for (const [name, control, evidenceCount, complete] of strata) {
    for (let index = 0; index < 180; index += 1) {
      const caseId = `${name}-${String(index).padStart(3, "0")}`;
      rows.push({
        case_id: caseId,
        control_recall_all_at_3: control,
        gold_evidence_count: evidenceCount,
        gold_complete_in_top20: complete,
        query_sha256: `q-${caseId}`,
        ordered_candidate_ids_sha256: `ids-${caseId}`,
        canonical_texts_sha256: `txt-${caseId}`,
        control_top3_sha256: `top3-${caseId}`,
      });
    }
  }
  return rows;
}

test("C1-A manifest deterministically freezes P256, D64 and S8 without overlap", () => {
  const cases = makeCases();
  const eligibility = Object.fromEntries(cases.map(item => [item.case_id, true]));
  const first = buildC1AQualificationManifest({ cases, eligibilityByCase: eligibility, expectedSourceCaseCount: cases.length, profile: { topK: 3 } });
  const second = buildC1AQualificationManifest({ cases, eligibilityByCase: eligibility, expectedSourceCaseCount: cases.length, profile: { topK: 3 } });

  assert.deepEqual(second, first);
  assert.equal(first.population.primary_count, 256);
  assert.equal(first.population.diagnostic_count, 64);
  assert.equal(first.population.sentinel_count, 8);
  assert.equal(first.population.primary_provider_eligible_ratio, 1);
  assert.equal(first.diagnostics.protect.length, 20);
  assert.equal(first.diagnostics.recoverable_rank_miss.length, 20);
  assert.equal(first.diagnostics.candidate_miss.length, 12);
  assert.equal(first.diagnostics.top3_budget_infeasible.length, 12);

  const primaryIds = new Set(first.primary.map(item => item.case_id));
  const diagnosticIds = new Set(Object.values(first.diagnostics).flat().map(item => item.case_id));
  assert.equal([...diagnosticIds].some(id => primaryIds.has(id)), false);
  assert.equal(first.sentinels.every(item => primaryIds.has(item.case_id)), true);
});

test("manifest defaults to the frozen 1970-case source population", () => {
  const cases = makeCases();
  assert.throws(
    () => buildC1AQualificationManifest({ cases, eligibilityByCase: {} }),
    /c1a_source_population_count_mismatch/,
  );
});

test("diagnostic classification follows the frozen strata", () => {
  assert.equal(classifyC1ADiagnosticCase({
    case_id: "p", control_recall_all_at_3: 1, gold_evidence_count: 2, gold_complete_in_top20: true,
  }), "protect");
  assert.equal(classifyC1ADiagnosticCase({
    case_id: "r", control_recall_all_at_3: 0, gold_evidence_count: 2, gold_complete_in_top20: true,
  }), "recoverable_rank_miss");
  assert.equal(classifyC1ADiagnosticCase({
    case_id: "m", control_recall_all_at_3: 0, gold_evidence_count: 2, gold_complete_in_top20: false,
  }), "candidate_miss");
  assert.equal(classifyC1ADiagnosticCase({
    case_id: "b", control_recall_all_at_3: 0, gold_evidence_count: 4, gold_complete_in_top20: true,
  }), "top3_budget_infeasible");
});

test("manifest fails closed when primary eligibility is below 95%", () => {
  const cases = makeCases();
  const eligibility = Object.fromEntries(cases.map(item => [item.case_id, true]));
  const baseline = buildC1AQualificationManifest({ cases, eligibilityByCase: eligibility, expectedSourceCaseCount: cases.length });
  for (const item of baseline.primary.slice(0, 20)) eligibility[item.case_id] = false;
  assert.throws(
    () => buildC1AQualificationManifest({ cases, eligibilityByCase: eligibility, expectedSourceCaseCount: cases.length }),
    /c1a_primary_provider_eligibility_below_threshold/,
  );
});

test("manifest fails closed when the eligible primary cannot supply S8", () => {
  const cases = makeCases();
  assert.throws(
    () => buildC1AQualificationManifest({ cases, eligibilityByCase: {}, expectedSourceCaseCount: cases.length }),
    /c1a_sentinel_population_insufficient/,
  );
});

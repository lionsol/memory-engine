import assert from "node:assert/strict";
import test from "node:test";

import { scoreC1AQualification } from "../lib/benchmark/c1a-qualification-scorer.js";

function row(index, { improved = false, protectedCase = false, latency = 1000 } = {}) {
  const controlAll = protectedCase ? 1 : 0;
  const finalAll = improved ? 1 : controlAll;
  return {
    case_id: `case-${index}`,
    eligible: true,
    rerank_eligible: true,
    attempted: true,
    provider_status: "applied",
    adapter_elapsed_ms: latency,
    control: {
      metrics: {
        "recall_all@3": controlAll,
        "recall_any@3": protectedCase ? 1 : 0.5,
        "evidence_coverage@3": protectedCase ? 1 : 0.5,
      },
    },
    final: {
      metrics: {
        "recall_all@3": finalAll,
        "recall_any@3": protectedCase ? 1 : 0.5,
        "evidence_coverage@3": improved ? 1 : (protectedCase ? 1 : 0.5),
      },
    },
  };
}

const executionSummary = {
  unauthorized_transmission_count: 0,
  automatic_retry_count: 0,
  request_budget_exceeded: false,
  token_budget_exceeded: false,
  cost_cap_exceeded: false,
  evidence_integrity_ok: true,
};

function stableSentinels() {
  return Array.from({ length: 8 }, (_, index) => ({
    case_id: `s-${index}`,
    first_top3: ["a", "b", "c"],
    second_top3: ["a", "b", "c"],
    first_status: "applied",
    second_status: "applied",
  }));
}

test("C1-A scorer evaluates full-population quality, reliability, latency, and sentinels", () => {
  const primaryRows = [];
  for (let index = 0; index < 256; index += 1) {
    if (index < 40) primaryRows.push(row(index, { protectedCase: true }));
    else primaryRows.push(row(index, { improved: index < 80 }));
  }
  const score = scoreC1AQualification({ primaryRows, sentinelRows: stableSentinels(), executionSummary });
  assert.equal(score.primary.case_count, 256);
  assert.equal(score.primary.paired_recall_all.improved, 40);
  assert.ok(score.primary.metrics["recall_all@3"].delta_pp > 8);
  assert.equal(score.primary.protect_regression.regression_count, 0);
  assert.equal(score.primary.reliability.applied_rate, 1);
  assert.equal(score.sentinels.applied_pair_count, 8);
  assert.equal(score.sentinels.exact_top3_order_count, 8);
  assert.equal(score.pass, true);
});

test("C1-A scorer fails when protected control wins regress", () => {
  const primaryRows = Array.from({ length: 256 }, (_, index) => row(index, { improved: index < 64 }));
  for (let index = 0; index < 20; index += 1) {
    primaryRows[index] = row(index, { protectedCase: true });
    primaryRows[index].final.metrics["recall_all@3"] = 0;
  }
  const score = scoreC1AQualification({ primaryRows, sentinelRows: stableSentinels(), executionSummary });
  assert.equal(score.gates.protect_regression, false);
  assert.equal(score.pass, false);
});

test("C1-A sentinel fallback cannot masquerade as provider stability", () => {
  const primaryRows = Array.from({ length: 256 }, (_, index) => row(index, { improved: index < 40 }));
  const sentinelRows = stableSentinels();
  sentinelRows[0] = {
    ...sentinelRows[0],
    first_status: "fallback",
    second_status: "fallback",
  };
  const score = scoreC1AQualification({ primaryRows, sentinelRows, executionSummary });
  assert.equal(score.sentinels.exact_top3_order_count, 7);
  assert.equal(score.gates.sentinel_top3_stability, false);
  assert.equal(score.pass, false);
});

test("C1-A scorer blocks PASS on execution-boundary violations", () => {
  const primaryRows = Array.from({ length: 256 }, (_, index) => row(index, { improved: index < 40 }));
  const score = scoreC1AQualification({
    primaryRows,
    sentinelRows: stableSentinels(),
    executionSummary: { ...executionSummary, unauthorized_transmission_count: 1 },
  });
  assert.equal(score.gates.unauthorized_transmission, false);
  assert.equal(score.pass, false);
});

test("C1-A scorer keeps diagnostic rows separate from primary scoring", () => {
  const primaryRows = Array.from({ length: 256 }, (_, index) => row(index, { improved: index < 40 }));
  const diagnosticRows = [
    { stratum: "protect" },
    { stratum: "candidate_miss" },
    { stratum: "candidate_miss" },
  ];

  const score = scoreC1AQualification({
    primaryRows,
    diagnosticRows,
    sentinelRows: stableSentinels(),
    executionSummary,
  });
  assert.equal(score.primary.case_count, 256);
  assert.deepEqual(score.diagnostics.by_stratum, { protect: 1, candidate_miss: 2 });
});

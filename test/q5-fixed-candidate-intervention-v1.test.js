import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  Q5_INTERVENTION_IDS,
  evaluateQ5FixedCandidateInterventionsV1,
} from "../lib/benchmark/q5-fixed-candidate-intervention-v1.js";

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/q5-fixed-candidate-q4-derived-v1.json", import.meta.url),
  "utf8",
));

function summary(result, source, arm, intervention) {
  return result.summaries[source][arm].interventions[intervention];
}

test("Q5-A2 diagnostic reranker bypass is mixed and therefore not a product recommendation", () => {
  const result = evaluateQ5FixedCandidateInterventionsV1(fixture);
  const id = Q5_INTERVENTION_IDS.PRE_RERANK_TOP3;

  assert.deepEqual(summary(result, "q4_c1b_development", "baseline", id).paired_recall_all, {
    improved: 0,
    regressed: 1,
    unchanged: 15,
  });
  assert.equal(
    summary(result, "q4_c1b_development", "baseline", id).metrics.recall_all_at_3,
    0.25,
  );

  assert.deepEqual(summary(result, "q4_c1b_development", "hint", id).paired_recall_all, {
    improved: 5,
    regressed: 1,
    unchanged: 10,
  });
  assert.equal(
    summary(result, "q4_c1b_development", "hint", id).metrics.recall_all_at_3,
    0.625,
  );

  assert.deepEqual(summary(result, "q4_c2_holdout", "baseline", id).paired_recall_all, {
    improved: 0,
    regressed: 2,
    unchanged: 22,
  });
  assert.equal(
    summary(result, "q4_c2_holdout", "baseline", id).metrics.recall_all_at_3,
    0.375,
  );

  assert.deepEqual(summary(result, "q4_c2_holdout", "hint", id).paired_recall_all, {
    improved: 5,
    regressed: 3,
    unchanged: 16,
  });
  assert.equal(
    summary(result, "q4_c2_holdout", "hint", id).metrics.recall_all_at_3,
    14 / 24,
  );

  assert.equal(result.interventions[id].role, "DIAGNOSTIC_CONTROL_ONLY");
  assert.equal(result.interventions[id].gold_in_selection, false);
});

test("Q5-A2 bounded anchor complementarity improves completeness but fails the Recall-any safety gate", () => {
  const result = evaluateQ5FixedCandidateInterventionsV1(fixture);
  const id = Q5_INTERVENTION_IDS.ANCHOR_COMPLEMENTARITY;

  const c1Baseline = summary(result, "q4_c1b_development", "baseline", id);
  assert.equal(c1Baseline.metrics.recall_all_at_3, 0.375);
  assert.deepEqual(c1Baseline.paired_recall_all, {
    improved: 1,
    regressed: 0,
    unchanged: 15,
  });
  assert.deepEqual(c1Baseline.paired_recall_any, {
    improved: 0,
    regressed: 0,
    unchanged: 16,
  });

  const c1Hint = summary(result, "q4_c1b_development", "hint", id);
  assert.equal(c1Hint.metrics.recall_all_at_3, 0.5);
  assert.equal(c1Hint.applied_count, 3);
  assert.deepEqual(c1Hint.paired_recall_all, {
    improved: 2,
    regressed: 0,
    unchanged: 14,
  });

  const c2Baseline = summary(result, "q4_c2_holdout", "baseline", id);
  assert.equal(c2Baseline.metrics.recall_all_at_3, 12 / 24);
  assert.equal(c2Baseline.applied_count, 8);
  assert.deepEqual(c2Baseline.paired_recall_all, {
    improved: 1,
    regressed: 0,
    unchanged: 23,
  });
  assert.deepEqual(c2Baseline.paired_recall_any, {
    improved: 0,
    regressed: 3,
    unchanged: 21,
  });

  const c2Hint = summary(result, "q4_c2_holdout", "hint", id);
  assert.equal(c2Hint.metrics.recall_all_at_3, 15 / 24);
  assert.equal(c2Hint.applied_count, 8);
  assert.deepEqual(c2Hint.paired_recall_all, {
    improved: 3,
    regressed: 0,
    unchanged: 21,
  });
  assert.deepEqual(c2Hint.paired_recall_any, {
    improved: 0,
    regressed: 1,
    unchanged: 23,
  });

  assert.equal(result.interventions[id].role, "BOUNDED_SYNTHETIC_MECHANISM_PROBE");
  assert.equal(result.interventions[id].gold_in_selection, false);
});

test("Q5-A2 complementarity repair fixes part of the direct Q4-to-Q5 bridge without touching single-intent cases", () => {
  const result = evaluateQ5FixedCandidateInterventionsV1(fixture);
  const id = Q5_INTERVENTION_IDS.ANCHOR_COMPLEMENTARITY;
  const bridgeRows = result.rows.filter(row => row.recovered_pool_but_top3_incomplete);

  assert.equal(bridgeRows.length, 7);
  assert.equal(
    bridgeRows.filter(row => row.interventions[id].recall_all_transition === "improved").length,
    2,
  );
  assert.equal(
    bridgeRows.filter(row => row.interventions[id].recall_all_transition === "regressed").length,
    0,
  );

  const singleIntentChanged = result.rows.filter(row => {
    const intervention = row.interventions[id];
    const multiCue = /\band\b|，|分别|以及|同时/.test(
      fixture.sources
        .flatMap(source => source.cases)
        .find(item => item.case_id === row.case_id)?.query?.toLowerCase() || "",
    );
    return !multiCue && intervention.applied;
  });
  assert.equal(singleIntentChanged.length, 0);
});

test("Q5-A2 result uses only product-visible selection inputs and freezes topK/provider/training boundaries", () => {
  const result = evaluateQ5FixedCandidateInterventionsV1(fixture);

  assert.equal(result.top_k, 3);
  assert.equal(result.provider_requests, 0);
  assert.equal(result.model_training_runs, 0);
  assert.equal(result.fixture_sha256, fixture.fixture_sha256);
  assert.match(result.result_sha256, /^[0-9a-f]{64}$/);

  for (const intervention of Object.values(result.interventions)) {
    assert.equal(intervention.gold_in_selection, false);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  Q5_B3_SEALED_SPLIT,
  assertQ5B3NoFinalOutcomesV1,
  buildQ5B3AnalysisPlanV1,
} from "../lib/benchmark/q5-b3-fixed-pool-analysis-plan-v1.js";

const b0Manifest = JSON.parse(readFileSync(
  new URL("./fixtures/q5-b0-real-fixed-pool-evidence-entry-v1.json", import.meta.url),
  "utf8",
));
const b1Manifest = JSON.parse(readFileSync(
  new URL("./fixtures/q5-b1-score-capture-manifest-v1.json", import.meta.url),
  "utf8",
));

test("Q5-B3 analysis plan binds the exact B0/B1 fixed-pool population", () => {
  const plan = buildQ5B3AnalysisPlanV1({ b0Manifest, b1Manifest });

  assert.equal(plan.source_b0_manifest_sha256, "f9262cd548c8a145da32da20f46a53872cab0310661d5b3a3055f5925ca9afe0");
  assert.equal(plan.source_b1_manifest_sha256, "a4e3cadb8af68f2ec6a3016e42757a0025f6b1e81edf841aafff099a64d43d77");
  assert.equal(plan.population.case_count, 512);
  assert.deepEqual(plan.population.split_counts, {
    development: 256,
    validation: 128,
    final_evaluation: 128,
  });
  assert.equal(plan.rows.length, 512);
  assert.match(plan.plan_sha256, /^[0-9a-f]{64}$/u);
});

test("Q5-B3 keeps final evaluation sealed by default and requires one-shot authority", () => {
  const plan = buildQ5B3AnalysisPlanV1({ b0Manifest, b1Manifest });

  assert.deepEqual(plan.access_policy.exploration_splits, ["development", "validation"]);
  assert.equal(plan.access_policy.sealed_split, Q5_B3_SEALED_SPLIT);
  assert.equal(plan.access_policy.final_outcomes_visible_by_default, false);
  assert.equal(plan.access_policy.final_consumption_requires_explicit_one_shot_authority, true);
  assert.equal(plan.rows.filter(row => row.split === "final_evaluation").length, 128);
});

test("Q5-B3 evaluator boundary forbids direct candidate-id gold semantics", () => {
  const plan = buildQ5B3AnalysisPlanV1({ b0Manifest, b1Manifest });

  assert.equal(plan.required_b2_packet.contains_gold_fields, false);
  assert.equal(plan.evaluator_boundary.packet_gold_fields_allowed, false);
  assert.equal(plan.evaluator_boundary.evaluator_join_key, "case_id");
  assert.equal(plan.evaluator_boundary.direct_candidate_id_equals_gold_id, false);
  assert.equal(
    plan.evaluator_boundary.scorer,
    "scoreLocomoChunkCase/evaluateLocomoChunkEvidenceCoverage",
  );
});

test("Q5-B3 preserves sample-level split isolation within the selected 512 cases", () => {
  const plan = buildQ5B3AnalysisPlanV1({ b0Manifest, b1Manifest });
  const bySample = new Map();

  for (const row of plan.rows) {
    const prior = bySample.get(row.sample_id);
    if (prior) assert.equal(prior, row.split);
    else bySample.set(row.sample_id, row.split);
  }
  assert.equal(bySample.size, plan.population.unique_sample_count);
});

test("Q5-B3 fails closed on B1/B0 identity drift", () => {
  const b1Drift = structuredClone(b1Manifest);
  b1Drift.cases[0].candidate_count += 1;
  assert.throws(
    () => buildQ5B3AnalysisPlanV1({ b0Manifest, b1Manifest: b1Drift }),
    /Q5_B3_CANDIDATE_COUNT_DRIFT/,
  );

  const b0Drift = structuredClone(b0Manifest);
  b0Drift.cases.find(row => row.case_id === b1Manifest.cases[0].case_id).split = "validation";
  assert.throws(
    () => buildQ5B3AnalysisPlanV1({ b0Manifest: b0Drift, b1Manifest }),
    /Q5_B3_SPLIT_DRIFT/,
  );
});

test("Q5-B3 rejects accidental final outcome fields before explicit final consumption", () => {
  assert.equal(assertQ5B3NoFinalOutcomesV1({
    development_metrics: { count: 1 },
    validation_metrics: { count: 1 },
  }), true);

  assert.throws(
    () => assertQ5B3NoFinalOutcomesV1({
      development_metrics: {},
      final_evaluation_results: { recall_all_at_3: 0.5 },
    }),
    /Q5_B3_FINAL_OUTCOME_LEAK/,
  );
});

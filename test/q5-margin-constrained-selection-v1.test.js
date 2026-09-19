import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  evaluateQ5MarginConstrainedSelectionV1,
} from "../lib/benchmark/q5-margin-constrained-selection-v1.js";

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/q5-fixed-candidate-q4-derived-v1.json", import.meta.url),
  "utf8",
));
const scorePacket = JSON.parse(readFileSync(
  new URL("./fixtures/q5-fixed-pool-rerank-score-capture-v1.json", import.meta.url),
  "utf8",
));

test("Q5-A6 development selects the strictest zero-Recall-any-regression thresholds with maximal Recall-all gain", () => {
  const result = evaluateQ5MarginConstrainedSelectionV1({ fixture, scorePacket });

  const ratio = result.constraints.counterpart_to_displaced_ratio;
  assert.equal(ratio.development_selected.threshold, 0.9789796214932476);
  assert.equal(ratio.development_selected.applied_count, 3);
  assert.deepEqual(ratio.development_selected.paired_recall_any, {
    improved: 0,
    regressed: 0,
    unchanged: 6,
  });
  assert.deepEqual(ratio.development_selected.paired_recall_all, {
    improved: 3,
    regressed: 0,
    unchanged: 3,
  });

  const margin = result.constraints.counterpart_minus_displaced_score;
  assert.equal(margin.development_selected.threshold, -0.020735740661621094);
  assert.equal(margin.development_selected.applied_count, 3);
  assert.deepEqual(margin.development_selected.paired_recall_any, {
    improved: 0,
    regressed: 0,
    unchanged: 6,
  });
  assert.deepEqual(margin.development_selected.paired_recall_all, {
    improved: 3,
    regressed: 0,
    unchanged: 3,
  });
});

test("Q5-A6 development-selected scalar constraints do not transfer any complementarity gain to C2", () => {
  const result = evaluateQ5MarginConstrainedSelectionV1({ fixture, scorePacket });

  for (const constraint of Object.values(result.constraints)) {
    assert.equal(constraint.holdout_at_development_threshold.applied_count, 0);
    assert.deepEqual(constraint.holdout_at_development_threshold.paired_recall_any, {
      improved: 0,
      regressed: 0,
      unchanged: 16,
    });
    assert.deepEqual(constraint.holdout_at_development_threshold.paired_recall_all, {
      improved: 0,
      regressed: 0,
      unchanged: 16,
    });
  }
});

test("Q5-A6 finds no monotonic ratio or additive-margin threshold with C2 Recall-all gain and zero Recall-any regression", () => {
  const result = evaluateQ5MarginConstrainedSelectionV1({ fixture, scorePacket });

  assert.equal(
    result.constraints.counterpart_to_displaced_ratio.holdout_any_safe_gain_threshold_exists,
    false,
  );
  assert.equal(
    result.constraints.counterpart_minus_displaced_score.holdout_any_safe_gain_threshold_exists,
    false,
  );
  assert.equal(result.proposal_snapshot_count, 22);
  assert.equal(result.development_proposal_count, 6);
  assert.equal(result.holdout_proposal_count, 16);
  assert.equal(result.provider_requests, 0);
  assert.equal(result.model_training_runs, 0);
});

test("Q5-A6 binds the exact frozen Q5 fixture and A5 real-score packet", () => {
  const result = evaluateQ5MarginConstrainedSelectionV1({ fixture, scorePacket });

  assert.equal(
    result.fixture_sha256,
    "077b02f16c7bd463eb5f5120930473f653bf5ae37e1a16cdb377e88fd3a6b405",
  );
  assert.equal(
    result.score_packet_sha256,
    "a148f6f2c5d378442714c8ba3ce6a853e4f895e0d37385f9e075a57f523b8257",
  );
  assert.equal(result.top_k, 3);
  assert.equal(
    result.result_sha256,
    "b19b49d961205b937a4d87e8c45b1ad79a3c50e23f83eb5dc765e99b81063ea9",
  );
});

test("Q5-A6 fails closed when score packet belongs to another fixture", () => {
  const drifted = structuredClone(scorePacket);
  drifted.fixture_sha256 = "f".repeat(64);

  assert.throws(
    () => evaluateQ5MarginConstrainedSelectionV1({ fixture, scorePacket: drifted }),
    /Q5_A3_PACKET_HASH_MISMATCH|Q5_A6_PACKET_FIXTURE_MISMATCH/,
  );
});

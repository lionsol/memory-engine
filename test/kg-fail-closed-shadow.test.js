import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateKgFailClosedShadow,
} from "../lib/recall/hybrid/kg-fail-closed-shadow.js";

test("equal isolated and fallback candidates have no shadow loss", () => {
  const result = evaluateKgFailClosedShadow({
    isolatedResult: [{ id: "a" }, { id: "b" }],
    fallbackResult: [{ id: "a" }, { id: "b" }],
  });
  assert.equal(result.decision.mode, "shadow_fail_closed");
  assert.equal(result.evidence.dropped_candidate_count, 0);
  assert.equal(result.evidence.overlap_count, 2);
  assert.equal(result.risk.would_change_result, false);
  assert.equal(result.risk.candidate_loss_ratio, 0);
});

test("fallback-only candidates are measured as potential loss", () => {
  const result = evaluateKgFailClosedShadow({
    isolatedResult: [{ id: "a" }, { id: "b" }],
    fallbackResult: [{ id: "a" }, { id: "b" }, { id: "c" }],
  });
  assert.equal(result.evidence.dropped_candidate_count, 1);
  assert.deepEqual(result.evidence.dropped_ids, ["c"]);
  assert.equal(result.evidence.fallback_only_count, 1);
  assert.equal(result.risk.would_change_result, true);
  assert.equal(result.risk.candidate_loss_ratio, 0.333);
});

test("empty isolated results produce complete potential loss", () => {
  const result = evaluateKgFailClosedShadow({
    isolatedResult: [],
    fallbackResult: [{ id: "a" }],
  });
  assert.equal(result.evidence.dropped_candidate_count, 1);
  assert.equal(result.risk.candidate_loss_ratio, 1);
});

test("candidate IDs are unique before comparison", () => {
  const result = evaluateKgFailClosedShadow({
    isolatedResult: [{ id: "a" }, { id: "a" }],
    fallbackResult: [{ id: "a" }, { id: "b" }, { id: "b" }],
  });
  assert.equal(result.evidence.isolated_candidate_count, 1);
  assert.equal(result.evidence.fallback_candidate_count, 2);
  assert.equal(result.evidence.overlap_count, 1);
  assert.deepEqual(result.evidence.dropped_ids, ["b"]);
});

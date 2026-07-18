import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRecentFailClosedShadow } from "../lib/recall/hybrid/recent-fail-closed-shadow.js";

test("equal Recent candidates have no potential loss", () => {
  const result = evaluateRecentFailClosedShadow({
    isolatedResult: ["a", "b"],
    fallbackResult: ["a", "b"],
  });
  assert.equal(result.evidence.dropped_candidate_count, 0);
  assert.equal(result.evidence.overlap_count, 2);
  assert.equal(result.risk.candidate_loss_ratio, 0);
  assert.equal(result.risk.would_change_result, false);
  assert.equal(result.risk.recent_specific_risk, "low");
});

test("fallback-only Recent candidate is measurable", () => {
  const result = evaluateRecentFailClosedShadow({
    isolatedResult: [{ id: "a" }, { id: "b" }],
    fallbackResult: [{ id: "a" }, { id: "b" }, { id: "c" }],
  });
  assert.deepEqual(result.evidence.dropped_ids, ["c"]);
  assert.equal(result.evidence.fallback_only_count, 1);
  assert.equal(result.risk.would_change_result, true);
  assert.equal(result.risk.candidate_loss_ratio, 0.333);
});

test("empty isolated result reports complete candidate loss", () => {
  const result = evaluateRecentFailClosedShadow({
    isolatedResult: [],
    fallbackResult: ["a"],
  });
  assert.equal(result.evidence.dropped_candidate_count, 1);
  assert.equal(result.risk.candidate_loss_ratio, 1);
});

test("duplicate IDs are counted once", () => {
  const result = evaluateRecentFailClosedShadow({
    isolatedResult: [{ id: "a" }, { id: "a" }],
    fallbackResult: [{ id: "a" }, { id: "b" }, { id: "b" }],
  });
  assert.equal(result.evidence.isolated_candidate_count, 1);
  assert.equal(result.evidence.fallback_candidate_count, 2);
  assert.equal(result.evidence.overlap_count, 1);
  assert.deepEqual(result.evidence.dropped_ids, ["b"]);
});

test("fallback-only archived candidate is high risk", () => {
  const result = evaluateRecentFailClosedShadow({
    isolatedResult: ["a"],
    fallbackResult: ["a", "archived"],
    context: { archived_candidate_ids: ["archived"] },
  });
  assert.equal(result.risk.recent_specific_risk, "high");
});

test("archived candidate retained by isolated result is not high risk", () => {
  const result = evaluateRecentFailClosedShadow({
    isolatedResult: ["archived"],
    fallbackResult: ["archived", "b"],
    context: { archived_candidate_ids: ["archived"] },
  });
  assert.equal(result.risk.recent_specific_risk, "low");
});

test("metadata merge mismatch is medium risk", () => {
  const result = evaluateRecentFailClosedShadow({
    isolatedResult: [],
    fallbackResult: ["metadata"],
    context: { metadata_merge_mismatch: true },
  });
  assert.equal(result.risk.recent_specific_risk, "medium");
});

test("archive risk takes precedence over metadata mismatch", () => {
  const result = evaluateRecentFailClosedShadow({
    isolatedResult: ["a"],
    fallbackResult: ["a", "archived"],
    context: {
      archived_candidate_ids: ["archived"],
      metadata_merge_mismatch: true,
    },
  });
  assert.equal(result.risk.recent_specific_risk, "high");
});

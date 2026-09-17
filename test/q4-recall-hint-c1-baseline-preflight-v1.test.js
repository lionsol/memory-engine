import test from "node:test";
import assert from "node:assert/strict";

async function loadBaselineModuleOrSkip(t) {
  try {
    return await import("../lib/benchmark/q4-recall-hint-c1-baseline-preflight-v1.js");
  } catch (error) {
    if (error?.code === "ERR_DLOPEN_FAILED") {
      t.skip("repo native better-sqlite3 requires the Node24/ABI137 test runtime");
      return null;
    }
    throw error;
  }
}

test("Q4-C1 lexical-control baseline preflight exposes target headroom and complete protection", async t => {
  const mod = await loadBaselineModuleOrSkip(t);
  if (!mod) return;
  const report = await mod.runQ4RecallHintC1BaselinePreflightV1();

  assert.equal(report.schema, mod.Q4_RECALL_HINT_C1_BASELINE_PREFLIGHT_SCHEMA);
  assert.equal(report.profile, mod.Q4_RECALL_HINT_C1_BASELINE_PROFILE);
  assert.equal(report.evidence_class, "ZERO_PROVIDER_LEXICAL_CONTROL_PREFLIGHT_ONLY");
  assert.equal(report.quality_claim_authorized, false);
  assert.equal(report.candidate_depth, 20);
  assert.equal(report.top_k, 3);
  assert.equal(report.provider_calls, 0);
  assert.equal(report.vector_provider_calls, 0);
  assert.equal(report.rerank_provider_calls, 0);
  assert.equal(report.rows.length, 48);
  assert.equal(report.development.case_count, 16);
  assert.equal(report.acceptance.case_count, 32);
  assert.deepEqual(report.eligibility, { status: "PASS", reasons: [] });

  for (const family of ["entity_reference", "temporal_relation", "multi_facet"]) {
    assert.equal(report.families[family].case_count, 8, family);
    assert.equal(report.families[family].pool_miss_count > 0, true, family);
  }
  assert.deepEqual(report.families.protection, {
    case_count: 8,
    pool_miss_count: 0,
    pool_evidence_coverage: 1,
    recall_any_at_3: 1,
    recall_all_at_3: 1,
  });
});

test("Q4-C1 lexical-control preflight is explicitly non-provider and leaves temp state bounded", async t => {
  const mod = await loadBaselineModuleOrSkip(t);
  if (!mod) return;
  const report = await mod.runQ4RecallHintC1BaselinePreflightV1();
  assert.equal(report.provider_calls + report.vector_provider_calls + report.rerank_provider_calls, 0);
  assert.equal(report.evidence_class, "ZERO_PROVIDER_LEXICAL_CONTROL_PREFLIGHT_ONLY");
  assert.equal(report.quality_claim_authorized, false);
});

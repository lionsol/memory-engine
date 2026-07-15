import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_PUBLIC_REPORT_BYTES,
  runRecentPerformanceProbe,
} from "../lib/recall/hybrid/recent-performance-probe.js";

test("recent performance probe returns a privacy-safe aggregated public report", async () => {
  const report = await runRecentPerformanceProbe({
    productionShape: {
      totalRows: 256,
      activeRows: 36,
      episodeRows: 12,
      idLength: 1600,
    },
  });

  assert.equal(report.probe, "isolated_recent_archived_exclusion_performance");
  assert.deepEqual(report.existing_snapshot_inventory.core_fields, ["id", "path", "updated_at"]);
  assert.deepEqual(
    report.existing_snapshot_inventory.engine_fields,
    ["chunk_id", "confidence", "last_confidence_update", "base_tau", "hit_count", "is_protected", "conflict_flag", "category", "is_archived"],
  );
  assert.equal(report.strategy_e_applicable, true);
  assert.deepEqual(report.canonical_field_names.raw.includes("id"), true);
  assert.deepEqual(report.canonical_field_names.normalized.includes("semantic_score"), true);
  assert.equal(report.candidate_level_details_included, false);

  for (const strategy of [
    "strategy_a_current_not_exists",
    "strategy_b_not_in",
    "strategy_c_materialized_cte",
    "strategy_d_paged_core_first",
    "strategy_e_snapshot_reuse",
  ]) {
    const small = report.semantic.small_fixture.strategies[strategy];
    assert.equal(typeof small.scenario_count, "number");
    assert.equal(typeof small.branch_equivalent.like_fallback, "boolean");
    assert.equal(typeof small.branch_equivalent.recent_scored, "boolean");
    assert.equal(typeof small.branch_equivalent.recent_fallback, "boolean");
    assert.equal(typeof small.branch_equivalent.episode_projection, "boolean");
  }

  assert.equal(report.null_payload_case.strategy_b_empty_payload_equivalent, true);
  assert.equal(report.null_payload_case.payload_contains_null, false);

  for (const limit of ["20", "100", "500"]) {
    for (const strategy of [
      "strategy_a_current_not_exists",
      "strategy_b_not_in",
      "strategy_c_materialized_cte",
      "strategy_d_paged_core_first",
      "strategy_e_snapshot_reuse",
    ]) {
      assert.equal(typeof report.semantic.limit_results[limit][strategy], "boolean", `${limit}:${strategy}`);
    }
  }

  for (const batchSize of ["128", "256", "512", "1024"]) {
    assert.equal(typeof report.semantic.batch_size_results[batchSize], "boolean", batchSize);
  }

  for (const key of [
    "strategy_a_current_not_exists",
    "strategy_b_not_in",
    "strategy_c_materialized_cte",
  ]) {
    const plan = report.plans[key];
    assert.equal(Array.isArray(plan.lines), true, key);
    assert.equal(Array.isArray(plan.tokens), true, key);
  }

  for (const strategy of Object.values(report.performance.production_shaped)) {
    for (const branch of Object.values(strategy.branches)) {
      assert.equal(branch.metrics.repetitions, 5);
      assert.equal(branch.metrics.warmup_count, 2);
      assert.equal(Number.isFinite(branch.metrics.median_ms), true);
      assert.equal(Number.isFinite(branch.metrics.p95_ms), true);
      assert.equal(branch.metrics.rows_read_from_core >= 0, true);
      assert.equal(branch.metrics.ids_transferred_to_engine >= 0, true);
      assert.equal(branch.metrics.json_payload_total_bytes >= 0, true);
    }
  }

  assert.equal(report.fixtures.production_shaped_fixture.archived_json_bytes > 300000, true);
  assert.equal(report.fixtures.production_shaped_fixture.archived_ratio > 0.8, true);
  assert.equal(report.privacy_validation.passed, true);
  assert.equal(report.privacy_validation.invalid_hash_count, 0);
  assert.equal(report.privacy_validation.forbidden_key_count, 0);
  assert.equal(report.report_size_bytes < MAX_PUBLIC_REPORT_BYTES, true);

  const serialized = JSON.stringify(report);
  for (const secret of [
    "alpha smart text",
    "memory/smart-add/A.md",
    "row-000001",
    "quote'",
    "slash\\\\",
    "雪",
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }

  for (const forbiddenKey of [
    "\"raw_rows\":",
    "\"rows\":",
    "\"candidates\":",
    "\"legacy_rows\":",
    "\"isolated_rows\":",
    "\"metadata_rows\":",
    "\"core_rows\":",
    "\"engine_rows\":",
  ]) {
    assert.equal(serialized.includes(forbiddenKey), false, forbiddenKey);
  }

  assert.equal(
    [
      "recommended_sql_rewrite",
      "recommended_paged_core_first",
      "recommended_snapshot_reuse",
      "inconclusive",
      "fail",
    ].includes(report.decision.class),
    true,
  );
});

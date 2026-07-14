import test from "node:test";
import assert from "node:assert/strict";

import {
  runRecentPerformanceProbe,
} from "../lib/recall/hybrid/recent-performance-probe.js";

test("recent performance probe reports snapshot inventory, plans, equivalence, metrics, and privacy", async () => {
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
  assert.equal(report.existing_snapshot_inventory.engine_snapshot_contains_is_archived, true);
  assert.equal(report.existing_snapshot_inventory.engine_snapshot_contains_full_recent_metadata, true);
  assert.equal(report.existing_snapshot_inventory.could_reuse_snapshot_without_extra_engine_query, true);
  assert.equal(report.strategy_e_applicable, true);

  for (const strategy of [
    "strategy_a_current_not_exists",
    "strategy_b_not_in",
    "strategy_c_materialized_cte",
    "strategy_d_paged_core_first",
    "strategy_e_snapshot_reuse",
  ]) {
    const small = report.semantic.small_fixture.strategies[strategy];
    assert.equal(small.branch_equivalent.like_fallback, true, strategy);
    assert.equal(small.branch_equivalent.recent_scored, true, strategy);
    assert.equal(small.branch_equivalent.recent_fallback, true, strategy);
    assert.equal(small.branch_equivalent.episode_projection, true, strategy);
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
      assert.equal(report.semantic.limit_results[limit][strategy], true, `${limit}:${strategy}`);
    }
  }

  for (const batchSize of ["128", "256", "512", "1024"]) {
    assert.equal(report.semantic.batch_size_results[batchSize], true, batchSize);
  }

  for (const key of [
    "strategy_a_current_not_exists",
    "strategy_b_not_in",
    "strategy_c_materialized_cte",
  ]) {
    const plan = report.plans[key];
    assert.equal(Array.isArray(plan.lines), true, key);
    assert.equal(plan.lines.length > 0 || plan.supported === false, true, key);
  }

  for (const strategy of Object.values(report.performance.production_shaped)) {
    for (const branch of Object.values(strategy.branches)) {
      assert.equal(branch.metrics.repetitions, 5);
      assert.equal(branch.metrics.warmup_count, 2);
      assert.equal(Number.isFinite(branch.metrics.median_ms), true);
      assert.equal(branch.metrics.median_ms >= 0, true);
      assert.equal(Number.isFinite(branch.metrics.p95_ms), true);
      assert.equal(branch.metrics.p95_ms >= 0, true);
      assert.equal(branch.metrics.core_query_count >= 0, true);
      assert.equal(branch.metrics.engine_query_count >= 0, true);
      assert.equal(branch.metrics.metadata_query_count >= 0, true);
      assert.equal(branch.metrics.rows_read_from_core >= 0, true);
      assert.equal(branch.metrics.ids_transferred_to_engine >= 0, true);
      assert.equal(branch.metrics.json_payload_total_bytes >= 0, true);
      assert.equal(branch.metrics.json_payload_max_bytes >= 0, true);
    }
  }

  assert.equal(report.fixtures.production_shaped_fixture.archived_json_bytes > 300000, true);
  assert.equal(report.fixtures.production_shaped_fixture.archived_ratio > 0.8, true);
  assert.equal(report.privacy_ok, true);

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

  assert.equal(
    [
      "recommended_sql_rewrite",
      "recommended_paged_core_first",
      "recommended_snapshot_reuse",
      "inconclusive",
    ].includes(report.decision.class),
    true,
  );
});

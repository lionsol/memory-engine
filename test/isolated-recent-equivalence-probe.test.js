import test from "node:test";
import assert from "node:assert/strict";

import probeModule from "../bin/probe-isolated-recent-equivalence.js";

const { runIsolatedRecentEquivalenceProbe } = probeModule;

test("isolated Recent probe emits structured JSON evidence from synthetic SQLite fixtures", async () => {
  const result = await runIsolatedRecentEquivalenceProbe();

  assert.equal(result.probe, "isolated_recent_equivalence");
  assert.match(result.sqlite_version, /^\d+\.\d+\.\d+/);
  assert.match(result.better_sqlite3_version, /^\d+\.\d+\.\d+/);

  assert.equal(Array.isArray(result.recent_branch_inventory), true);
  assert.equal(result.recent_branch_inventory.length >= 3, true);
  assert.equal(result.recent_branch_inventory.some((item) => item.branch === "like_fallback"), true);
  assert.equal(result.recent_branch_inventory.some((item) => item.branch === "recent_scored"), true);
  assert.equal(result.recent_branch_inventory.some((item) => item.branch === "recent_fallback"), true);

  assert.deepEqual(result.topology.legacy.database_names, ["main", "core"]);
  assert.deepEqual(result.topology.isolated_engine.database_names, ["main"]);
  assert.deepEqual(result.topology.isolated_core.database_names, ["main"]);

  assert.equal(result.legacy_recent_order_contract.deterministic, true);
  assert.equal(result.legacy_recent_order_contract.reason, "explicit_secondary_tie_breaker_present");
  assert.deepEqual(result.legacy_recent_order_contract.recommended_order, [
    "c.updated_at DESC",
    "c.id ASC",
  ]);

  assert.equal(result.strategies.legacy.raw_count >= 1, true);
  assert.equal(result.strategies.naive_core_limit_then_filter.equivalent, true);
  assert.equal(result.strategies.core_first_archived_json_exclusion.equivalent, true);
  assert.equal(result.strategies.engine_first_ids.equivalent, false);
  assert.equal(result.strategies.per_id_lookup.query_count >= 2, true);
  assert.equal(result.strategies.per_id_lookup.recommended, false);

  assert.deepEqual(result.archived_limit_case.legacy_ids, ["B", "C"]);
  assert.deepEqual(result.archived_limit_case.strategy_a_ids, ["B"]);
  assert.deepEqual(result.archived_limit_case.strategy_b_ids, ["B", "C"]);
  assert.deepEqual(result.archived_limit_case.strategy_c_ids, ["B", "C"]);
  assert.equal(result.archived_limit_case.strategy_a_equivalent, false);
  assert.equal(result.archived_limit_case.strategy_b_equivalent, true);

  assert.equal(result.missing_confidence_case.legacy_returns_row, true);
  assert.equal(result.missing_confidence_case.core_first_returns_row, true);
  assert.equal(result.missing_confidence_case.engine_first_returns_row, false);
  assert.equal(result.missing_confidence_case.metadata_equivalent, true);

  assert.equal(result.storage_class_cases.text_text.equivalent, true);
  assert.equal(result.storage_matrix_fixture.matches_production_declared_affinity, false);
  assert.equal(result.storage_class_cases.blob_blob.legacy_count >= 1, true);
  assert.equal(result.storage_class_cases.blob_blob.equivalent, false);
  assert.equal(result.storage_class_cases.text_blob.transfer_supported, false);
  assert.equal(result.storage_class_cases.blob_text.transfer_supported, false);
  assert.equal(result.storage_class_cases.null_engine.transfer_supported, false);
  assert.equal(result.storage_class_cases.integer_integer.fixture_valid, true);
  assert.equal(result.storage_class_cases.integer_integer.engine_storage_class, "integer");
  assert.equal(result.storage_class_cases.integer_integer.core_storage_class, "integer");
  assert.equal(result.storage_class_cases.real_real.fixture_valid, true);
  assert.equal(result.storage_class_cases.real_real.engine_storage_class, "real");
  assert.equal(result.storage_class_cases.real_real.core_storage_class, "real");
  assert.equal(result.storage_class_cases.integer_text.fixture_valid, true);
  assert.equal(result.storage_class_cases.integer_text.engine_storage_class, "integer");
  assert.equal(result.storage_class_cases.integer_text.core_storage_class, "text");
  assert.equal(result.storage_class_cases.text_integer.fixture_valid, true);
  assert.equal(result.storage_class_cases.text_integer.engine_storage_class, "text");
  assert.equal(result.storage_class_cases.text_integer.core_storage_class, "integer");
  assert.equal(result.storage_class_cases.integer_integer.equivalent, false);
  assert.equal(result.storage_class_cases.real_real.equivalent, false);
  assert.equal(result.storage_class_cases.integer_text.transfer_supported, false);
  assert.equal(result.storage_class_cases.text_integer.transfer_supported, false);
  assert.notDeepEqual(
    [
      result.storage_class_cases.integer_integer.engine_storage_class,
      result.storage_class_cases.integer_integer.core_storage_class,
    ],
    [
      result.storage_class_cases.real_real.engine_storage_class,
      result.storage_class_cases.real_real.core_storage_class,
    ],
  );

  assert.equal(result.buffer_map_key_case.same_content_equal, true);
  assert.equal(result.buffer_map_key_case.strict_reference_equal, false);
  assert.equal(result.buffer_map_key_case.map_get_with_distinct_buffer, null);
  assert.equal(result.numeric_map_key_case.number_integer_real_distinction_preserved, false);
  assert.equal(result.numeric_map_key_case.bigint_number_match, false);
  assert.equal(result.numeric_map_key_case.json_storage_class_preserved, false);

  assert.equal(result.like_semantics.applicable, true);
  assert.equal(result.like_semantics.cases.length >= 6, true);
  assert.equal(result.like_semantics.cases.every((item) => item.strategy_b_equal === true), true);

  assert.equal(result.metadata_equivalence.raw_strategy_b_equal, true);
  assert.equal(result.metadata_equivalence.normalized_strategy_b_equal, true);
  assert.equal(result.metadata_equivalence.raw_strategy_c_equal, false);
  assert.equal(result.metadata_equivalence.normalized_strategy_c_equal, true);

  assert.equal(result.channel_level_case.candidate_counts.recent_raw >= 1, true);
  assert.equal(result.channel_level_case.candidate_counts.recent_fallback_raw >= 1, true);
  assert.equal(result.channel_level_case.candidate_counts.like_raw >= 1, true);
  assert.equal(result.channel_level_case.debug_fallbacks.includes("fts_empty"), true);
  assert.equal(result.channel_level_case.debug_fallbacks.includes("like_search"), true);
  assert.equal(result.channel_level_case.debug_fallbacks.includes("recent_episodic"), true);
  assert.equal(result.channel_level_case.channels_present.includes("recent"), true);
  assert.equal(result.channel_level_case.channels_present.includes("recent_fallback"), true);

  assert.deepEqual(result.raw_field_inventory, [
    "base_tau",
    "category",
    "confidence",
    "conflict_flag",
    "hit_count",
    "id",
    "is_archived",
    "is_protected",
    "last_confidence_update",
    "path",
    "text",
    "updated_at",
  ]);
  assert.equal(result.normalized_field_inventory.includes("confidence_mode"), true);
  assert.equal(result.normalized_field_inventory.includes("source_type"), true);

  assert.equal(result.text_id_foundational_equivalence, true);
  assert.equal(result.sqlite_storage_class_equivalence, false);
  assert.equal(result.foundational_equivalence, false);
  assert.equal(result.recommendation_class, "C");
  assert.equal(result.conditional_recommendation_class, "B");
  assert.equal(result.preferred_strategy, "none");
  assert.equal(result.conditional_preferred_strategy, "core_first_archived_json_exclusion");
  assert.equal(result.migration_prerequisites.includes("deterministic recent tie ordering"), false);
  assert.equal(result.migration_prerequisites.includes("TEXT-only Core/Engine ID invariant"), true);
  assert.deepEqual(result.required_invariant, {
    engine_chunk_id_storage_class: "text",
    core_chunk_id_storage_class: "text",
    verified_on_real_db: false,
  });
});

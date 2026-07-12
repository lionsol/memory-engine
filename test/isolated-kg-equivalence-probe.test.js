import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  classifyCandidateChunkId,
  CORE_KG_JSON_EXISTS_SQL,
  CORE_KG_JSON_JOIN_SQL,
  ENGINE_KG_CANDIDATE_SQL,
  runProbe,
} = require("../bin/probe-isolated-kg-equivalence.js");

const probePath = fileURLToPath(new URL("../bin/probe-isolated-kg-equivalence.js", import.meta.url));

test("candidate chunk id classifier preserves SQLite storage-class boundaries", () => {
  assert.deepEqual(classifyCandidateChunkId(null), {
    accepted: false,
    storage_class: "null",
  });
  assert.deepEqual(classifyCandidateChunkId(Buffer.from("null")), {
    accepted: false,
    storage_class: "blob",
  });
  assert.deepEqual(classifyCandidateChunkId("null"), {
    accepted: true,
    storage_class: "text",
    id: "null",
  });
});

test("isolated KG probe returns machine-readable equivalence evidence", () => {
  const result = JSON.parse(JSON.stringify(runProbe()));
  assert.equal(result.basic_equivalence, true);
  assert.equal(result.exists_equivalence, true);
  assert.equal(result.join_equivalence, true);
  assert.equal(result.missing_core_equivalence, true);
  assert.equal(result.like_equivalence, true);
  assert.equal(result.metadata_equivalence, true);
  assert.equal(result.non_text_id_equivalence, true);
  assert.equal(result.text_id_foundational_equivalence, true);
  assert.equal(result.non_text_id_case.engine_row_count, 4);
  assert.equal(result.non_text_id_case.accepted_text_count, 2);
  assert.equal(result.non_text_id_case.skipped_non_text_count, 2);
  assert.deepEqual(result.non_text_id_case.accepted_source_storage_classes, ["text", "text"]);
  assert.deepEqual(result.non_text_id_case.skipped_source_storage_classes, ["null", "blob"]);
  assert.deepEqual(result.non_text_id_case.candidate_ids, ["null", "valid-text"]);
  assert.equal(result.non_text_id_case.id_decisions[0].accepted, false);
  assert.equal(result.non_text_id_case.id_decisions[0].storage_class, "null");
  assert.equal(result.non_text_id_case.id_decisions[1].accepted, false);
  assert.equal(result.non_text_id_case.id_decisions[1].storage_class, "blob");
  assert.deepEqual(result.non_text_id_case.id_decisions[2], {
    accepted: true,
    storage_class: "text",
    id: "null",
    duplicate: false,
  });
  assert.deepEqual(result.non_text_id_case.id_decisions[3], {
    accepted: true,
    storage_class: "text",
    id: "valid-text",
    duplicate: false,
  });
  assert.equal(result.non_text_id_case.null_key_skipped, true);
  assert.equal(result.non_text_id_case.blob_key_skipped, true);
  assert.equal(result.non_text_id_case.text_null_preserved, true);
  assert.deepEqual(result.non_text_id_case.legacy_ids, result.non_text_id_case.exists_ids);
  assert.deepEqual(result.non_text_id_case.legacy_ids, result.non_text_id_case.join_ids);
  assert.equal(result.blob_blob_case.legacy_match_count, 1);
  assert.equal(result.blob_blob_case.isolated_exists_match_count, 0);
  assert.equal(result.blob_blob_case.isolated_join_match_count, 0);
  assert.equal(result.blob_blob_case.legacy_engine_storage_class, "blob");
  assert.equal(result.blob_blob_case.legacy_core_storage_class, "blob");
  assert.equal(result.blob_blob_case.classifier_storage_class, "blob");
  assert.equal(result.blob_blob_case.classifier_accepted, false);
  assert.equal(result.blob_blob_case.equal, false);
  assert.equal(result.like_cases.length >= 7, true);
  for (const likeCase of result.like_cases) {
    assert.equal(likeCase.equal, true, likeCase.name);
    assert.deepEqual(likeCase.legacy_ids, likeCase.exists_ids, likeCase.name);
    assert.deepEqual(likeCase.legacy_ids, likeCase.join_ids, likeCase.name);
  }
  assert.equal(result.duplicate_id_case.engine_row_count, 3);
  assert.equal(result.duplicate_id_case.accepted_unique_count, 2);
  assert.equal(result.duplicate_id_case.duplicate_skip_count, 1);
  assert.equal(result.duplicate_id_case.non_text_skip_count, 0);
  assert.equal(result.duplicate_id_case.candidate_id_count, result.duplicate_id_case.unique_candidate_id_count);
  assert.equal(result.duplicate_id_case.id_decisions.some(item => (
    item.accepted === false
    && item.duplicate === true
    && item.storage_class === "text"
    && item.id === "dup"
  )), true);
  assert.equal(result.duplicate_id_case.exists_ids.length, result.duplicate_id_case.exists_unique_row_ids);
  assert.equal(result.duplicate_id_case.join_ids.length, result.duplicate_id_case.join_unique_row_ids);
  assert.equal(result.duplicate_id_case.query_rows_unique, true);
  assert.equal(result.core_readonly, true);
  assert.equal(result.engine_readonly, true);
  assert.equal(result.core_sidecars, false);
  assert.equal(result.engine_sidecars, false);
  assert.deepEqual(result.core_database_list, ["main"]);
  assert.deepEqual(result.engine_database_list, ["main"]);
  assert.equal(result.large_candidate_count >= 2000, true);
  assert.equal(result.json_bytes > 0, true);
  assert.equal(result.large_exists_ids_equal, true);
  assert.equal(result.large_join_ids_equal, true);
  assert.equal(Number.isFinite(result.large_legacy_ms_median), true);
  assert.equal(Number.isFinite(result.large_exists_ms_median), true);
  assert.equal(Number.isFinite(result.large_join_ms_median), true);
  assert.equal(result.large_legacy_ms_median >= 0, true);
  assert.equal(result.large_exists_ms_median >= 0, true);
  assert.equal(result.large_join_ms_median >= 0, true);
  assert.equal(Array.isArray(result.core_exists_plan), true);
  assert.equal(Array.isArray(result.core_join_plan), true);
  assert.equal(result.core_exists_plan.length > 0, true);
  assert.equal(result.core_join_plan.length > 0, true);
  assert.equal(result.core_join_plan.some(line => String(line).includes("json_each") || String(line).includes("candidate")), true);
  assert.equal(typeof result.recommendation, "string");
  assert.equal(result.recommendation.length > 0, true);
  assert.equal(result.sqlite_storage_class_equivalence, false);
  assert.equal(result.foundational_equivalence, false);
  assert.equal(result.recommendation_class, "C");
  assert.equal(result.conditional_recommendation_class, "B");
  assert.equal(result.strategy_evidence.exists_equivalent, true);
  assert.equal(result.strategy_evidence.join_equivalent, true);
  assert.equal(result.strategy_evidence.exists_plan_nonempty, true);
  assert.equal(result.strategy_evidence.join_plan_nonempty, true);
  assert.equal(typeof result.strategy_evidence.join_not_slower_in_probe, "boolean");
  assert.equal(typeof result.preferred_core_strategy, "string");
  assert.equal(result.preferred_core_strategy, "none");
  assert.equal(result.conditional_preferred_core_strategy, "json_each_join");
  assert.equal(result.required_invariant.verified_on_real_db, false);
  assert.equal(Object.hasOwn(result, "temp_root_url"), false);
  assert.equal(result.temp_root_exists_after_cleanup, false);
  for (const tieCase of result.tie_cases) {
    assert.deepEqual(tieCase.legacy_exists_equal, JSON.stringify(tieCase.legacy_ids) === JSON.stringify(tieCase.exists_ids));
    assert.deepEqual(tieCase.legacy_join_equal, JSON.stringify(tieCase.legacy_ids) === JSON.stringify(tieCase.join_ids));
    assert.equal(tieCase.explicit_tiebreaker_equal, true);
    assert.equal(Array.isArray(tieCase.legacy_plan), true);
    assert.equal(Array.isArray(tieCase.core_exists_plan), true);
    assert.equal(Array.isArray(tieCase.core_join_plan), true);
    assert.equal(tieCase.core_exists_plan.length > 0, true);
    assert.equal(tieCase.core_join_plan.length > 0, true);
  }
});

test("isolated KG probe uses JSON semi-join without attach, temp, or engine limit", () => {
  assert.equal(ENGINE_KG_CANDIDATE_SQL.includes("LIMIT"), false);
  assert.equal(ENGINE_KG_CANDIDATE_SQL.includes("ATTACH"), false);
  assert.equal(ENGINE_KG_CANDIDATE_SQL.includes("TEMP"), false);
  assert.equal(ENGINE_KG_CANDIDATE_SQL.includes("chunks"), false);

  for (const sql of [CORE_KG_JSON_EXISTS_SQL, CORE_KG_JSON_JOIN_SQL]) {
    assert.equal(sql.includes("json_each(?)"), true);
    assert.equal(sql.includes("ATTACH"), false);
    assert.equal(sql.includes("TEMP"), false);
    assert.equal(sql.includes("memory_confidence"), false);
    assert.equal(sql.includes("LIMIT ?"), true);
  }
  assert.equal(CORE_KG_JSON_JOIN_SQL.includes("JOIN chunks c"), true);
});

test("probe file keeps legacy ATTACH out of isolated candidate helpers", () => {
  const source = readFileSync(probePath, "utf8");
  const isolatedSection = source.slice(
    source.indexOf("function selectIsolated"),
    source.indexOf("function ids"),
  );
  assert.equal(isolatedSection.includes("ATTACH"), false);
  assert.equal(isolatedSection.includes("CREATE TEMP"), false);
  assert.equal(isolatedSection.includes("INSERT INTO"), false);
  assert.equal(isolatedSection.includes("UPDATE "), false);
  assert.equal(isolatedSection.includes("DELETE "), false);
  assert.equal(isolatedSection.includes("DROP "), false);
});

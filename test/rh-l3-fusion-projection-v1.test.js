import test from "node:test";
import assert from "node:assert/strict";

import {
  RH_L3_B_CONTRACT_SHA256,
  RH_L3_B_EXECUTION_BINDING_SHA256,
  RH_L3_B_QUALIFIED_SOURCE,
  RH_L3_B_RESULT_SHA256,
  RH_L3_C_EXPECTED_TOP3_IDS,
  RH_L3_C_RESULT_FIELDS,
  runRhL3FusionProjectionV1,
} from "../lib/benchmark/rh-l3-fusion-projection-v1.js";

const SOURCE = "c".repeat(40);

test("RH-L3-C drives the frozen parallel plan through hybrid fusion, ranking, and canonical projection", async () => {
  const result = await runRhL3FusionProjectionV1({ sourceCommit: SOURCE });
  const execution = result.execution;

  assert.equal(execution.status, "PASS");
  assert.deepEqual(execution.reasons, []);
  assert.equal(execution.vector_execution_mode, "parallel");
  assert.equal(execution.queries_submitted, 3);
  assert.equal(execution.queries_completed, 3);
  assert.equal(execution.max_active_embeddings, 3);
  assert.equal(execution.max_active_searches, 3);
  assert.equal(execution.fusion_pool_count, 4);
  assert.deepEqual(execution.fusion_channels, ["vector"]);
  assert.deepEqual(execution.top3_memory_ids, [...RH_L3_C_EXPECTED_TOP3_IDS]);
  assert.ok(execution.post_rerank_pool_ids.includes("limitations-only"));
  assert.deepEqual(execution.canonical_projection, {
    requested_count: 3,
    resolved_count: 3,
    dropped_count: 0,
  });
});

test("RH-L3-C canonical user projection is exact-field bounded and excludes execution metadata", async () => {
  const result = await runRhL3FusionProjectionV1({ sourceCommit: SOURCE });
  const expectedFields = [...RH_L3_C_RESULT_FIELDS].sort();

  assert.equal(result.execution.projected_field_sets.length, 3);
  for (const fields of result.execution.projected_field_sets) {
    assert.deepEqual(fields, expectedFields);
    assert.equal(fields.some(field => field.startsWith("vector_query_")), false);
    assert.equal(fields.includes("vector_execution_mode"), false);
    assert.equal(fields.includes("query_input_sha256s"), false);
    assert.equal(fields.includes("parallel_execution"), false);
  }
});

test("RH-L3-C binds the consumed RH-L3-B qualification and exact RH-L3-A fixture/plan identities", async () => {
  const result = await runRhL3FusionProjectionV1({ sourceCommit: SOURCE });

  assert.deepEqual(result.upstream_rh_l3_b, {
    source_commit: RH_L3_B_QUALIFIED_SOURCE,
    contract_sha256: RH_L3_B_CONTRACT_SHA256,
    execution_binding_sha256: RH_L3_B_EXECUTION_BINDING_SHA256,
    result_sha256: RH_L3_B_RESULT_SHA256,
  });
  assert.equal(
    result.upstream_fixture_sha256,
    "346efb8983d46d27fe1b9a538b25d2fc2315c275e3bdc2573173de61efe7e0d4",
  );
  assert.equal(
    result.upstream_plan_sha256,
    "49f37a0054636c6dfce26c95929115615038f25e91702621f3e2700d5baa2462",
  );
  assert.equal(result.provider_requests, 0);
  assert.equal(result.retry_policy, "NO_RETRY_NO_REPLAY");
  assert.match(result.contract_sha256, /^[0-9a-f]{64}$/);
  assert.match(result.execution_binding_sha256, /^[0-9a-f]{64}$/);
});

test("RH-L3-C rejects invalid source identity before local execution", async () => {
  await assert.rejects(
    runRhL3FusionProjectionV1({ sourceCommit: "bad" }),
    /RH_L3_C_SOURCE_COMMIT_INVALID/,
  );
});

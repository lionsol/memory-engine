import test from "node:test";
import assert from "node:assert/strict";

import {
  RH_L3_PARALLEL_EXPECTED_FUSED_IDS,
  runRhL3ParallelExecutionV1,
} from "../lib/benchmark/rh-l3-parallel-execution-v1.js";

const SOURCE = "b".repeat(40);

test("RH-L3-B controlled backend proves three-query parallel fan-out and complete fusion input", async () => {
  const result = await runRhL3ParallelExecutionV1({ sourceCommit: SOURCE });
  const execution = result.execution;

  assert.equal(execution.status, "PASS");
  assert.deepEqual(execution.reasons, []);
  assert.equal(execution.vector_execution_mode, "parallel");
  assert.equal(execution.queries_submitted, 3);
  assert.equal(execution.queries_completed, 3);
  assert.equal(execution.parallel_execution, true);
  assert.equal(execution.embedding_submitted, 3);
  assert.equal(execution.embedding_completed, 3);
  assert.equal(execution.search_submitted, 3);
  assert.equal(execution.search_completed, 3);
  assert.equal(execution.max_active_embeddings, 3);
  assert.equal(execution.max_active_searches, 3);
  assert.deepEqual(execution.embedding_query_indexes, [0, 1, 2]);
  assert.deepEqual(execution.search_query_indexes, [0, 1, 2]);
  assert.equal(execution.fusion_input_query_count, 3);
  assert.deepEqual(execution.fusion_input_candidate_counts, [2, 2, 2]);
  assert.equal(execution.raw_row_count, 6);
  assert.equal(execution.unique_candidate_count, 4);
  assert.deepEqual(execution.fused_candidate_ids, [...RH_L3_PARALLEL_EXPECTED_FUSED_IDS]);
  assert.equal(execution.query_input_sha256s.length, 3);
  assert.equal(new Set(execution.query_input_sha256s).size, 3);
  assert.equal(result.provider_requests, 0);
  assert.equal(result.retry_policy, "NO_RETRY_NO_REPLAY");
});

test("RH-L3-B binds the exact RH-L3-A fixture and plan identities", async () => {
  const result = await runRhL3ParallelExecutionV1({ sourceCommit: SOURCE });

  assert.equal(
    result.upstream_fixture_sha256,
    "346efb8983d46d27fe1b9a538b25d2fc2315c275e3bdc2573173de61efe7e0d4",
  );
  assert.equal(
    result.upstream_plan_sha256,
    "49f37a0054636c6dfce26c95929115615038f25e91702621f3e2700d5baa2462",
  );
  assert.match(result.contract_sha256, /^[0-9a-f]{64}$/);
  assert.match(result.execution_binding_sha256, /^[0-9a-f]{64}$/);
});

test("RH-L3-B rejects an invalid source identity before execution", async () => {
  await assert.rejects(
    runRhL3ParallelExecutionV1({ sourceCommit: "not-a-commit" }),
    /RH_L3_B_SOURCE_COMMIT_INVALID/,
  );
});

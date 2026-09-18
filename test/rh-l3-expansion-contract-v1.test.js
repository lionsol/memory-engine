import test from "node:test";
import assert from "node:assert/strict";

import {
  RECALL_HINT_V1_VECTOR_QUERY_MAX_CODE_POINTS,
  buildRecallHintVectorQueryPlan,
} from "../lib/recall/hint/recall-hint-query-plan.js";
import {
  RH_L3_CANONICAL_FIXTURE_V1,
  RH_L3_ORIGINAL_QUERY_MAX_CODE_POINTS,
  buildRhL3ExpansionContractV1,
  validateRhL3ExpansionPlanV1,
} from "../lib/benchmark/rh-l3-expansion-contract-v1.js";

const SOURCE = "a".repeat(40);

test("RH-L3-A canonical fixture produces the frozen two-expansion plan and exact counts", () => {
  const contract = buildRhL3ExpansionContractV1({ sourceCommit: SOURCE });

  assert.equal(contract.evaluation.valid, true);
  assert.deepEqual(contract.evaluation.reasons, []);
  assert.equal(contract.evaluation.original_query_count, 1);
  assert.equal(contract.evaluation.expansion_query_count, 2);
  assert.equal(contract.evaluation.total_query_count, 3);
  assert.deepEqual(contract.plan, {
    mode: "recall_hint_v1",
    queries: [...RH_L3_CANONICAL_FIXTURE_V1.expected_expansions],
  });
  assert.deepEqual(contract.evaluation.logical_queries, [
    RH_L3_CANONICAL_FIXTURE_V1.query,
    ...RH_L3_CANONICAL_FIXTURE_V1.expected_expansions,
  ]);
  assert.match(contract.fixture_sha256, /^[0-9a-f]{64}$/);
  assert.match(contract.plan_sha256, /^[0-9a-f]{64}$/);
  assert.match(contract.contract_sha256, /^[0-9a-f]{64}$/);
  assert.match(contract.execution_binding_sha256, /^[0-9a-f]{64}$/);
  assert.equal(contract.provider_requests, 0);
  assert.equal(contract.retry_policy, "NO_RETRY_NO_REPLAY");
});

test("RH-L3-A rejects expansion identity drift from the production planner", () => {
  assert.throws(
    () => buildRhL3ExpansionContractV1({
      sourceCommit: SOURCE,
      fixture: {
        ...RH_L3_CANONICAL_FIXTURE_V1,
        expected_expansions: ["wrong one", "wrong two"],
      },
    }),
    /RH_L3_A_PLAN_INVALID:expansion_identity_mismatch/,
  );
});

test("RH-L3-A plan validator rejects empty, duplicate, and out-of-bound logical queries", () => {
  assert.deepEqual(
    validateRhL3ExpansionPlanV1({
      originalQuery: "query",
      plan: { mode: "recall_hint_v1", queries: ["", "other"] },
    }).reasons,
    ["empty_expansion"],
  );

  assert.deepEqual(
    validateRhL3ExpansionPlanV1({
      originalQuery: "query",
      plan: { mode: "recall_hint_v1", queries: ["query", "other"] },
    }).reasons,
    ["duplicate_logical_query"],
  );

  const overlongExpansion = "x".repeat(RECALL_HINT_V1_VECTOR_QUERY_MAX_CODE_POINTS + 1);
  assert.deepEqual(
    validateRhL3ExpansionPlanV1({
      originalQuery: "query",
      plan: { mode: "recall_hint_v1", queries: [overlongExpansion] },
    }).reasons,
    ["expansion_too_long"],
  );

  const overlongOriginal = "q".repeat(RH_L3_ORIGINAL_QUERY_MAX_CODE_POINTS + 1);
  assert.deepEqual(
    validateRhL3ExpansionPlanV1({
      originalQuery: overlongOriginal,
      plan: { mode: "recall_hint_v1", queries: ["expansion"] },
    }).reasons,
    ["original_query_too_long"],
  );
});

test("RH-L3-A canonical planner enforces deterministic deduplication and max two expansions", () => {
  const duplicatePlan = buildRecallHintVectorQueryPlan("query", {
    version: "recall_hint_v1",
    query_facets: ["reason", "reason"],
  });
  assert.deepEqual(duplicatePlan, {
    mode: "recall_hint_v1",
    queries: ["query reason"],
  });

  const boundedPlan = buildRecallHintVectorQueryPlan("query", {
    version: "recall_hint_v1",
    query_facets: ["one", "two"],
    entities: ["entity-a"],
    project: "project-a",
  });
  assert.equal(boundedPlan.queries.length, 2);
  assert.equal(new Set(boundedPlan.queries).size, 2);
});

test("RH-L3-A production planner bounds every generated expansion to 512 code points", () => {
  const plan = buildRecallHintVectorQueryPlan("q".repeat(RH_L3_ORIGINAL_QUERY_MAX_CODE_POINTS), {
    version: "recall_hint_v1",
    query_facets: ["f".repeat(120)],
    project: "p".repeat(96),
    entities: [
      "a".repeat(96),
      "b".repeat(96),
      "c".repeat(96),
      "d".repeat(96),
    ],
  });

  assert.equal(plan.queries.length, 1);
  assert.equal(
    Array.from(plan.queries[0]).length,
    RECALL_HINT_V1_VECTOR_QUERY_MAX_CODE_POINTS,
  );
});

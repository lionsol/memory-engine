import { createHash } from "node:crypto";

import {
  RECALL_HINT_V1_VECTOR_QUERY_MAX_CODE_POINTS,
  buildRecallHintVectorQueryPlan,
} from "../recall/hint/recall-hint-query-plan.js";
import { validateRecallHintV1 } from "../recall/hint/recall-hint-v1.js";

export const RH_L3_EXPANSION_CONTRACT_SCHEMA = "memory_engine_rh_l3_expansion_contract_v1";
export const RH_L3_EXPANSION_PROFILE = "rh_l3_a_deterministic_expansion_contract_v1";
export const RH_L3_ORIGINAL_QUERY_MAX_CODE_POINTS = 240;

export const RH_L3_CANONICAL_FIXTURE_V1 = Object.freeze({
  fixture_id: "rh-l3-a-cedarindex-v1",
  query: "CedarIndex design decision",
  hint: Object.freeze({
    version: "recall_hint_v1",
    project: "CedarIndex",
    entities: Object.freeze(["CedarIndex"]),
    query_facets: Object.freeze(["rationale", "limitations"]),
  }),
  expected_expansions: Object.freeze([
    "CedarIndex design decision rationale project:CedarIndex entities:CedarIndex",
    "CedarIndex design decision limitations project:CedarIndex entities:CedarIndex",
  ]),
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function codePointLength(value) {
  return Array.from(String(value)).length;
}

function stableFixtureIdentity(fixture) {
  return {
    fixture_id: fixture.fixture_id,
    query: fixture.query,
    hint: fixture.hint,
    expected_expansions: [...fixture.expected_expansions],
  };
}

export function validateRhL3ExpansionPlanV1({
  originalQuery,
  plan,
  expectedExpansions = null,
} = {}) {
  const reasons = [];
  const query = typeof originalQuery === "string" ? originalQuery.trim() : "";
  if (!query) reasons.push("original_query_missing");
  if (query && codePointLength(query) > RH_L3_ORIGINAL_QUERY_MAX_CODE_POINTS) {
    reasons.push("original_query_too_long");
  }

  if (!plan || plan.mode !== "recall_hint_v1" || !Array.isArray(plan.queries)) {
    reasons.push("plan_invalid");
  }

  const expansions = Array.isArray(plan?.queries)
    ? plan.queries.map(value => typeof value === "string" ? value.trim() : "")
    : [];

  if (expansions.length < 1 || expansions.length > 2) {
    reasons.push("expansion_count_out_of_bounds");
  }
  if (expansions.some(value => !value)) reasons.push("empty_expansion");
  if (expansions.some(value => codePointLength(value) > RECALL_HINT_V1_VECTOR_QUERY_MAX_CODE_POINTS)) {
    reasons.push("expansion_too_long");
  }

  const logicalQueries = query ? [query, ...expansions] : [...expansions];
  if (new Set(logicalQueries).size !== logicalQueries.length) {
    reasons.push("duplicate_logical_query");
  }

  if (Array.isArray(expectedExpansions)
      && JSON.stringify(expansions) !== JSON.stringify(expectedExpansions)) {
    reasons.push("expansion_identity_mismatch");
  }

  return Object.freeze({
    valid: reasons.length === 0,
    reasons: Object.freeze(reasons),
    original_query_count: query ? 1 : 0,
    expansion_query_count: expansions.length,
    total_query_count: logicalQueries.length,
    original_query_code_points: codePointLength(query),
    expansion_code_points: Object.freeze(expansions.map(codePointLength)),
    logical_queries: Object.freeze(logicalQueries),
  });
}

export function buildRhL3ExpansionContractV1({
  sourceCommit,
  fixture = RH_L3_CANONICAL_FIXTURE_V1,
} = {}) {
  if (typeof sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw fail("RH_L3_A_SOURCE_COMMIT_INVALID");
  }
  if (!fixture || typeof fixture !== "object") throw fail("RH_L3_A_FIXTURE_REQUIRED");
  if (typeof fixture.fixture_id !== "string" || !fixture.fixture_id.trim()) {
    throw fail("RH_L3_A_FIXTURE_ID_REQUIRED");
  }
  if (typeof fixture.query !== "string" || !fixture.query.trim()) {
    throw fail("RH_L3_A_QUERY_REQUIRED");
  }
  if (!Array.isArray(fixture.expected_expansions)) {
    throw fail("RH_L3_A_EXPECTED_EXPANSIONS_REQUIRED");
  }

  const hintValidation = validateRecallHintV1(fixture.hint);
  if (!hintValidation.valid) throw fail("RH_L3_A_HINT_INVALID");

  const plan = buildRecallHintVectorQueryPlan(fixture.query, hintValidation.normalized);
  const evaluation = validateRhL3ExpansionPlanV1({
    originalQuery: fixture.query,
    plan,
    expectedExpansions: fixture.expected_expansions,
  });
  if (!evaluation.valid) {
    throw fail(`RH_L3_A_PLAN_INVALID:${evaluation.reasons.join(",")}`);
  }
  if (evaluation.original_query_count !== 1
      || evaluation.expansion_query_count !== 2
      || evaluation.total_query_count !== 3) {
    throw fail("RH_L3_A_CANONICAL_COUNTS_MISMATCH");
  }

  const fixtureIdentity = stableFixtureIdentity(fixture);
  const fixtureSha256 = sha256(JSON.stringify(fixtureIdentity));
  const planIdentity = {
    mode: plan.mode,
    queries: [...plan.queries],
  };
  const planSha256 = sha256(JSON.stringify(planIdentity));

  const body = {
    schema: RH_L3_EXPANSION_CONTRACT_SCHEMA,
    profile: RH_L3_EXPANSION_PROFILE,
    source_commit: sourceCommit,
    scope: "source_only_deterministic_expansion_contract",
    quality_claim_scope: "NONE",
    provider_requests: 0,
    fixture_sha256: fixtureSha256,
    plan_sha256: planSha256,
    bounds: Object.freeze({
      original_query_max_code_points: RH_L3_ORIGINAL_QUERY_MAX_CODE_POINTS,
      expansion_query_max_code_points: RECALL_HINT_V1_VECTOR_QUERY_MAX_CODE_POINTS,
      expansion_count_min: 1,
      expansion_count_max: 2,
      canonical_expansion_count: 2,
      canonical_total_query_count: 3,
    }),
    mutation: Object.freeze({
      runtime_config: "DENY",
      deployment: "DENY",
      live_core: "DENY",
      live_engine: "DENY",
      live_lancedb: "DENY",
    }),
    retry_policy: "NO_RETRY_NO_REPLAY",
  };
  const contractSha256 = sha256(JSON.stringify(body));
  const executionBindingSha256 = sha256(JSON.stringify({
    source_commit: sourceCommit,
    contract_sha256: contractSha256,
    fixture_sha256: fixtureSha256,
    plan_sha256: planSha256,
  }));

  return Object.freeze({
    ...body,
    fixture: Object.freeze(fixtureIdentity),
    plan: Object.freeze(planIdentity),
    evaluation,
    contract_sha256: contractSha256,
    execution_binding_sha256: executionBindingSha256,
  });
}

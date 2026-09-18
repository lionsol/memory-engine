import { createHash } from "node:crypto";

import { collectVectorCandidates } from "../recall/hybrid/channels/vector.js";
import {
  RH_L3_CANONICAL_FIXTURE_V1,
  buildRhL3ExpansionContractV1,
} from "./rh-l3-expansion-contract-v1.js";

export const RH_L3_PARALLEL_EXECUTION_SCHEMA = "memory_engine_rh_l3_parallel_execution_v1";
export const RH_L3_PARALLEL_EXECUTION_PROFILE = "rh_l3_b_controlled_parallel_vector_v1";
export const RH_L3_PARALLEL_QUERY_COUNT = 3;
export const RH_L3_PARALLEL_EXPECTED_RAW_ROWS = 6;
export const RH_L3_PARALLEL_EXPECTED_UNIQUE_CANDIDATES = 4;
export const RH_L3_PARALLEL_EXPECTED_FUSED_IDS = Object.freeze([
  "shared",
  "original-only",
  "rationale-only",
  "limitations-only",
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function createBarrier(required, label, timeoutMs = 500) {
  let arrivals = 0;
  let released = false;
  const waiters = [];
  return {
    async arrive() {
      if (released) return;
      arrivals += 1;
      if (arrivals === required) {
        released = true;
        while (waiters.length > 0) waiters.shift().resolve();
        return;
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(fail(`RH_L3_B_${label.toUpperCase()}_BARRIER_TIMEOUT`));
        }, timeoutMs);
        timer.unref?.();
        waiters.push({
          resolve() {
            clearTimeout(timer);
            resolve();
          },
        });
      });
    },
    count() {
      return arrivals;
    },
  };
}

function row(id, similarity) {
  return Object.freeze({
    id,
    text: id,
    _distance: 1 - similarity,
  });
}

function controlledRows() {
  return Object.freeze([
    Object.freeze([row("shared", 0.98), row("original-only", 0.92)]),
    Object.freeze([row("shared", 0.96), row("rationale-only", 0.88)]),
    Object.freeze([row("shared", 0.94), row("limitations-only", 0.84)]),
  ]);
}

function makeControlledContext({ query, plan, metrics }) {
  const queries = [query, ...plan.queries];
  const queryIndex = new Map(queries.map((value, index) => [value, index]));
  const rowsByIndex = controlledRows();
  const embeddingBarrier = createBarrier(RH_L3_PARALLEL_QUERY_COUNT, "embedding");
  const searchBarrier = createBarrier(RH_L3_PARALLEL_QUERY_COUNT, "search");

  return {
    channels: { vector: [] },
    debug: {},
    candidateCounts: {
      vector_raw: 0,
      vector_after_conf_filter: 0,
    },
    shouldSkipVector: false,
    getLancedbRuntimeRuntime: null,
    getLancedbTableRuntime: () => ({
      search(vector) {
        const index = Number(vector?.[0]);
        return {
          limit() {
            return this;
          },
          async execute() {
            metrics.search_submitted += 1;
            metrics.active_searches += 1;
            metrics.max_active_searches = Math.max(
              metrics.max_active_searches,
              metrics.active_searches,
            );
            metrics.search_query_indexes.push(index);
            await searchBarrier.arrive();
            metrics.active_searches -= 1;
            metrics.search_completed += 1;
            return rowsByIndex[index] || [];
          },
        };
      },
    }),
    vectorReadyTimeoutMs: 0,
    generateEmbeddingRuntime: async input => {
      const index = queryIndex.get(input);
      if (!Number.isInteger(index)) throw fail("RH_L3_B_UNEXPECTED_QUERY_INPUT");
      metrics.embedding_submitted += 1;
      metrics.active_embeddings += 1;
      metrics.max_active_embeddings = Math.max(
        metrics.max_active_embeddings,
        metrics.active_embeddings,
      );
      metrics.embedding_query_indexes.push(index);
      await embeddingBarrier.arrive();
      metrics.active_embeddings -= 1;
      metrics.embedding_completed += 1;
      return [index];
    },
    strippedQuery: query,
    vectorTopK: RH_L3_PARALLEL_EXPECTED_UNIQUE_CANDIDATES,
    confidenceMap: new Map(),
    chunkMetaMap: new Map(),
    normalizeCandidate: value => Object.freeze({
      ...value,
      semantic_score: Number(value.similarity),
    }),
    filterForRerank: () => true,
    toDebugErrorMessage: error => String(error?.message || error),
    warnVectorChannelOnce: () => {},
    cfg: null,
    getMemorySearchManagerFn: async () => ({ manager: null }),
    vectorQueryPlan: plan,
    recallHintVectorExecutionMode: "parallel",
  };
}

function evaluateExecution({ ctx, metrics, expectedQueryHashes }) {
  const reasons = [];
  const debug = ctx.debug;
  const fusedIds = ctx.channels.vector.map(item => item.id);

  if (debug.vector_query_mode !== "recall_hint_v1") reasons.push("query_mode_not_recall_hint_v1");
  if (debug.vector_query_execution !== "parallel") reasons.push("execution_mode_not_parallel");
  if (debug.vector_query_count !== RH_L3_PARALLEL_QUERY_COUNT) reasons.push("query_count_mismatch");
  if (debug.vector_search_count !== RH_L3_PARALLEL_QUERY_COUNT) reasons.push("vector_search_count_mismatch");
  if (metrics.embedding_submitted !== RH_L3_PARALLEL_QUERY_COUNT) reasons.push("embedding_submit_count_mismatch");
  if (metrics.embedding_completed !== RH_L3_PARALLEL_QUERY_COUNT) reasons.push("embedding_complete_count_mismatch");
  if (metrics.search_submitted !== RH_L3_PARALLEL_QUERY_COUNT) reasons.push("search_submit_count_mismatch");
  if (metrics.search_completed !== RH_L3_PARALLEL_QUERY_COUNT) reasons.push("search_complete_count_mismatch");
  if (metrics.max_active_embeddings < 2) reasons.push("embedding_overlap_not_observed");
  if (metrics.max_active_searches < 2) reasons.push("search_overlap_not_observed");
  if (ctx.candidateCounts.vector_raw !== RH_L3_PARALLEL_EXPECTED_RAW_ROWS) reasons.push("raw_row_count_mismatch");
  if (debug.vector_raw_total !== RH_L3_PARALLEL_EXPECTED_RAW_ROWS) reasons.push("debug_raw_row_count_mismatch");
  if (debug.vector_unique_count !== RH_L3_PARALLEL_EXPECTED_UNIQUE_CANDIDATES) reasons.push("unique_candidate_count_mismatch");
  if (debug.vector_query_candidate_counts?.length !== RH_L3_PARALLEL_QUERY_COUNT
      || debug.vector_query_candidate_counts.some(count => count !== 2)) {
    reasons.push("fusion_input_query_count_mismatch");
  }
  if (JSON.stringify(debug.vector_query_input_sha256s) !== JSON.stringify(expectedQueryHashes)) {
    reasons.push("query_identity_mismatch");
  }
  if (JSON.stringify(fusedIds) !== JSON.stringify(RH_L3_PARALLEL_EXPECTED_FUSED_IDS)) {
    reasons.push("fused_candidate_identity_mismatch");
  }
  if (debug.vector_multi_query_failed === true) reasons.push("multi_query_failed");
  if (debug.vector_hint_fallback_original === true) reasons.push("unexpected_original_fallback");

  return Object.freeze({
    status: reasons.length === 0 ? "PASS" : "FAIL",
    reasons: Object.freeze(reasons),
    vector_execution_mode: debug.vector_query_execution || null,
    queries_submitted: metrics.embedding_submitted,
    queries_completed: metrics.search_completed,
    parallel_execution: metrics.max_active_embeddings >= 2 && metrics.max_active_searches >= 2,
    embedding_submitted: metrics.embedding_submitted,
    embedding_completed: metrics.embedding_completed,
    search_submitted: metrics.search_submitted,
    search_completed: metrics.search_completed,
    max_active_embeddings: metrics.max_active_embeddings,
    max_active_searches: metrics.max_active_searches,
    embedding_query_indexes: Object.freeze([...metrics.embedding_query_indexes].sort((a, b) => a - b)),
    search_query_indexes: Object.freeze([...metrics.search_query_indexes].sort((a, b) => a - b)),
    fusion_input_query_count: debug.vector_query_candidate_counts?.length || 0,
    fusion_input_candidate_counts: Object.freeze([...(debug.vector_query_candidate_counts || [])]),
    raw_row_count: ctx.candidateCounts.vector_raw,
    unique_candidate_count: debug.vector_unique_count || 0,
    fused_candidate_ids: Object.freeze(fusedIds),
    query_input_sha256s: Object.freeze([...(debug.vector_query_input_sha256s || [])]),
  });
}

export async function runRhL3ParallelExecutionV1({ sourceCommit } = {}) {
  if (typeof sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw fail("RH_L3_B_SOURCE_COMMIT_INVALID");
  }

  const expansionContract = buildRhL3ExpansionContractV1({
    sourceCommit,
    fixture: RH_L3_CANONICAL_FIXTURE_V1,
  });
  if (!expansionContract.evaluation.valid) throw fail("RH_L3_B_UPSTREAM_PLAN_INVALID");

  const query = expansionContract.fixture.query;
  const plan = expansionContract.plan;
  const logicalQueries = [query, ...plan.queries];
  const expectedQueryHashes = logicalQueries.map(sha256);
  const metrics = {
    embedding_submitted: 0,
    embedding_completed: 0,
    search_submitted: 0,
    search_completed: 0,
    active_embeddings: 0,
    max_active_embeddings: 0,
    active_searches: 0,
    max_active_searches: 0,
    embedding_query_indexes: [],
    search_query_indexes: [],
  };
  const ctx = makeControlledContext({ query, plan, metrics });
  await collectVectorCandidates(ctx);
  const evaluation = evaluateExecution({ ctx, metrics, expectedQueryHashes });

  const body = {
    schema: RH_L3_PARALLEL_EXECUTION_SCHEMA,
    profile: RH_L3_PARALLEL_EXECUTION_PROFILE,
    source_commit: sourceCommit,
    scope: "local_controlled_parallel_vector_execution",
    quality_claim_scope: "NONE",
    provider_requests: 0,
    upstream_fixture_sha256: expansionContract.fixture_sha256,
    upstream_plan_sha256: expansionContract.plan_sha256,
    execution: evaluation,
    mutation: Object.freeze({
      runtime_config: "DENY",
      deployment: "DENY",
      live_core: "DENY",
      live_engine: "DENY",
      live_lancedb: "DENY",
      temporary_controlled_backend_only: "ALLOW",
    }),
    retry_policy: "NO_RETRY_NO_REPLAY",
  };
  const contractSha256 = sha256(JSON.stringify({
    schema: body.schema,
    profile: body.profile,
    source_commit: body.source_commit,
    scope: body.scope,
    quality_claim_scope: body.quality_claim_scope,
    provider_requests: body.provider_requests,
    upstream_fixture_sha256: body.upstream_fixture_sha256,
    upstream_plan_sha256: body.upstream_plan_sha256,
    gates: {
      queries_submitted: 3,
      queries_completed: 3,
      min_embedding_concurrency: 2,
      min_search_concurrency: 2,
      fusion_input_query_count: 3,
      raw_row_count: 6,
      unique_candidate_count: 4,
      fused_candidate_ids: RH_L3_PARALLEL_EXPECTED_FUSED_IDS,
    },
    mutation: body.mutation,
    retry_policy: body.retry_policy,
  }));
  const executionBindingSha256 = sha256(JSON.stringify({
    source_commit: sourceCommit,
    contract_sha256: contractSha256,
    upstream_fixture_sha256: expansionContract.fixture_sha256,
    upstream_plan_sha256: expansionContract.plan_sha256,
  }));

  return Object.freeze({
    ...body,
    contract_sha256: contractSha256,
    execution_binding_sha256: executionBindingSha256,
  });
}

import { createHash } from "node:crypto";

import { hybridSearch } from "../recall/hybrid-search.js";
import {
  RH_L3_CANONICAL_FIXTURE_V1,
  buildRhL3ExpansionContractV1,
} from "./rh-l3-expansion-contract-v1.js";

export const RH_L3_FUSION_PROJECTION_SCHEMA = "memory_engine_rh_l3_fusion_projection_v1";
export const RH_L3_FUSION_PROJECTION_PROFILE = "rh_l3_c_local_hybrid_fusion_projection_v1";

export const RH_L3_B_QUALIFIED_SOURCE = "e4400ade955960d006367b5108f6b0da1377819e";
export const RH_L3_B_CONTRACT_SHA256 = "dcb9f45fce0761a49c2e62bcf2fb83ea030a6982ec54c5f5179868b082c7b22b";
export const RH_L3_B_EXECUTION_BINDING_SHA256 = "4ec698a554608d3951c615165a8a372ba82576b33f8ada709a32b083a914ea3f";
export const RH_L3_B_RESULT_SHA256 = "c8666d9bb2e455f37376f2a904a60923d6f02423624808eb51d011d78cc15ff5";

export const RH_L3_C_POOL_IDS = Object.freeze([
  "shared",
  "original-only",
  "rationale-only",
  "limitations-only",
]);

export const RH_L3_C_EXPECTED_TOP3_IDS = Object.freeze([
  "shared",
  "original-only",
  "rationale-only",
]);

export const RH_L3_C_RESULT_FIELDS = Object.freeze([
  "archive_eligible",
  "canonical_id",
  "category",
  "category_authority",
  "category_boost",
  "confidence",
  "confidence_boost",
  "confidence_mode",
  "created_at",
  "decay_eligible",
  "external_badge",
  "external_boost",
  "final_score",
  "hits",
  "id",
  "kind",
  "memory_id",
  "path",
  "recency_boost",
  "rrf_score",
  "semantic_score",
  "similarity",
  "source_type",
  "sources",
  "text",
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
          reject(fail(`RH_L3_C_${label.toUpperCase()}_BARRIER_TIMEOUT`));
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
  };
}

function coreRow(id, index) {
  return Object.freeze({
    id,
    path: `memory/projects/rh-l3/${id}.md`,
    source: "openclaw_core",
    start_line: 1,
    end_line: 1,
    hash: null,
    text: `RH-L3 canonical content for ${id}`,
    updated_at: 1710000000 + index,
  });
}

function engineRow(id) {
  return Object.freeze({
    chunk_id: id,
    initial_confidence: 0.8,
    confidence: 0.8,
    last_confidence_update: 1710000000,
    base_tau: 7,
    hit_count: 2,
    is_archived: 0,
    is_protected: 0,
    conflict_flag: 0,
    category: "project",
  });
}

function createFixtureRows() {
  const coreRows = RH_L3_C_POOL_IDS.map(coreRow);
  const engineRows = RH_L3_C_POOL_IDS.map(engineRow);
  return { coreRows, engineRows };
}

function selectByIds(rows, key, args) {
  if (!Array.isArray(args) || args.length === 0) return rows;
  const ids = new Set(args.map(String));
  return rows.filter(row => ids.has(String(row[key])));
}

function createCoreDb(coreRows) {
  return {
    readonly: true,
    prepare(sql) {
      const q = String(sql);
      return {
        all(...args) {
          if (q.includes("PRAGMA database_list")) return [{ name: "main" }];
          if (q.includes("FROM chunks_fts")) return [];
          if (q.includes("FROM json_each")) return [];
          if (q.includes("FROM chunks c")) return [];
          if (q.includes("SELECT id, path, updated_at FROM chunks")) {
            return coreRows.map(({ id, path, updated_at }) => ({ id, path, updated_at }));
          }
          if (q.includes("FROM chunks") && q.includes("WHERE id IN")) {
            return selectByIds(coreRows, "id", args);
          }
          if (q.includes("FROM chunks") && q.includes("WHERE id =")) {
            return selectByIds(coreRows, "id", args);
          }
          if (q.includes("FROM chunks")) return coreRows;
          return [];
        },
        get(name) {
          return ["chunks", "chunks_fts"].includes(String(name)) ? { 1: 1 } : undefined;
        },
      };
    },
  };
}

function createEngineDb(engineRows) {
  return {
    readonly: true,
    prepare(sql) {
      const q = String(sql);
      return {
        all(...args) {
          if (q.includes("PRAGMA database_list")) return [{ name: "main" }];
          if (q.includes("kg_data")) return [];
          if (q.includes("COALESCE(is_archived, 0) != 0")) return [];
          if (q.includes("WITH selected")) return [];
          if (q.includes("FROM memory_confidence") && q.includes("WHERE chunk_id IN")) {
            return selectByIds(engineRows, "chunk_id", args);
          }
          if (q.includes("FROM memory_confidence") && q.includes("WHERE chunk_id =")) {
            return selectByIds(engineRows, "chunk_id", args);
          }
          if (q.includes("FROM memory_confidence")) return engineRows;
          return [];
        },
        get(name) {
          return String(name) === "memory_confidence" ? { 1: 1 } : undefined;
        },
      };
    },
  };
}

function vectorRowsByQueryIndex(coreRows) {
  const byId = new Map(coreRows.map(row => [row.id, row]));
  const make = (id, similarity) => {
    const core = byId.get(id);
    return Object.freeze({
      id,
      text: core.text,
      timestamp: core.updated_at,
      _distance: 1 - similarity,
    });
  };
  return Object.freeze([
    Object.freeze([make("shared", 0.98), make("original-only", 0.92)]),
    Object.freeze([make("shared", 0.96), make("rationale-only", 0.88)]),
    Object.freeze([make("shared", 0.94), make("limitations-only", 0.84)]),
  ]);
}

function createVectorRuntime({ logicalQueries, coreRows, metrics }) {
  const queryIndex = new Map(logicalQueries.map((value, index) => [value, index]));
  const rowsByIndex = vectorRowsByQueryIndex(coreRows);
  const embeddingBarrier = createBarrier(3, "embedding");
  const searchBarrier = createBarrier(3, "search");

  return {
    generateEmbedding: async query => {
      const index = queryIndex.get(query);
      if (!Number.isInteger(index)) throw fail("RH_L3_C_UNEXPECTED_QUERY_INPUT");
      metrics.embedding_submitted += 1;
      metrics.active_embeddings += 1;
      metrics.max_active_embeddings = Math.max(metrics.max_active_embeddings, metrics.active_embeddings);
      await embeddingBarrier.arrive();
      metrics.active_embeddings -= 1;
      metrics.embedding_completed += 1;
      return [index];
    },
    getLancedbTable: () => ({
      search(vector) {
        const index = Number(vector?.[0]);
        return {
          limit() {
            return this;
          },
          async execute() {
            metrics.search_submitted += 1;
            metrics.active_searches += 1;
            metrics.max_active_searches = Math.max(metrics.max_active_searches, metrics.active_searches);
            await searchBarrier.arrive();
            metrics.active_searches -= 1;
            metrics.search_completed += 1;
            return rowsByIndex[index] || [];
          },
        };
      },
    }),
  };
}

function sortedKeys(value) {
  return Object.keys(value || {}).sort();
}

function evaluateProjection({ result, metrics, expectedQueryHashes }) {
  const reasons = [];
  const top3Ids = result.results.map(item => item.memory_id);
  const poolIds = result.debug?.post_rerank_top?.map(item => item.id) || [];
  const projectedFieldSets = result.results.map(sortedKeys);
  const expectedFields = [...RH_L3_C_RESULT_FIELDS].sort();

  if (result.debug?.vector_query_execution !== "parallel") reasons.push("vector_execution_not_parallel");
  if (result.debug?.vector_query_count !== 3) reasons.push("vector_query_count_mismatch");
  if (result.debug?.vector_search_count !== 3) reasons.push("vector_search_count_mismatch");
  if (metrics.embedding_submitted !== 3 || metrics.embedding_completed !== 3) reasons.push("embedding_count_mismatch");
  if (metrics.search_submitted !== 3 || metrics.search_completed !== 3) reasons.push("search_count_mismatch");
  if (metrics.max_active_embeddings < 2) reasons.push("embedding_overlap_not_observed");
  if (metrics.max_active_searches < 2) reasons.push("search_overlap_not_observed");
  if (result.pool !== 4) reasons.push("hybrid_pool_count_mismatch");
  if (JSON.stringify(top3Ids) !== JSON.stringify(RH_L3_C_EXPECTED_TOP3_IDS)) reasons.push("top3_identity_mismatch");
  if (!poolIds.includes("limitations-only")) reasons.push("fourth_candidate_dropped_before_topk");
  if (result.debug?.canonical_result_projection?.requested_count !== 3) reasons.push("canonical_requested_count_mismatch");
  if (result.debug?.canonical_result_projection?.resolved_count !== 3) reasons.push("canonical_resolved_count_mismatch");
  if (result.debug?.canonical_result_projection?.dropped_count !== 0) reasons.push("canonical_projection_drop");
  if (JSON.stringify(result.debug?.vector_query_input_sha256s || []) !== JSON.stringify(expectedQueryHashes)) {
    reasons.push("query_identity_mismatch");
  }
  if (projectedFieldSets.some(fields => JSON.stringify(fields) !== JSON.stringify(expectedFields))) {
    reasons.push("projection_field_whitelist_mismatch");
  }
  if (result.results.some(item => item.canonical_id !== `cmem:core:${item.memory_id}`)) {
    reasons.push("canonical_identity_mismatch");
  }
  if (result.results.some(item => item.source_type !== "memory-engine-managed"
      || item.confidence_mode !== "managed"
      || item.category !== "project")) {
    reasons.push("canonical_authority_projection_mismatch");
  }

  return Object.freeze({
    status: reasons.length === 0 ? "PASS" : "FAIL",
    reasons: Object.freeze(reasons),
    vector_execution_mode: result.debug?.vector_query_execution || null,
    queries_submitted: metrics.embedding_submitted,
    queries_completed: metrics.search_completed,
    max_active_embeddings: metrics.max_active_embeddings,
    max_active_searches: metrics.max_active_searches,
    fusion_pool_count: result.pool,
    fusion_channels: Object.freeze([...(result.channels || [])]),
    post_rerank_pool_ids: Object.freeze(poolIds),
    top3_memory_ids: Object.freeze(top3Ids),
    canonical_projection: Object.freeze({
      requested_count: result.debug?.canonical_result_projection?.requested_count ?? null,
      resolved_count: result.debug?.canonical_result_projection?.resolved_count ?? null,
      dropped_count: result.debug?.canonical_result_projection?.dropped_count ?? null,
    }),
    projected_field_sets: Object.freeze(projectedFieldSets.map(fields => Object.freeze(fields))),
    query_input_sha256s: Object.freeze([...(result.debug?.vector_query_input_sha256s || [])]),
  });
}

export async function runRhL3FusionProjectionV1({ sourceCommit } = {}) {
  if (typeof sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw fail("RH_L3_C_SOURCE_COMMIT_INVALID");
  }

  const expansion = buildRhL3ExpansionContractV1({
    sourceCommit,
    fixture: RH_L3_CANONICAL_FIXTURE_V1,
  });
  const logicalQueries = [expansion.fixture.query, ...expansion.plan.queries];
  const expectedQueryHashes = logicalQueries.map(sha256);
  const { coreRows, engineRows } = createFixtureRows();
  const coreDb = createCoreDb(coreRows);
  const engineDb = createEngineDb(engineRows);
  const metrics = {
    embedding_submitted: 0,
    embedding_completed: 0,
    search_submitted: 0,
    search_completed: 0,
    active_embeddings: 0,
    max_active_embeddings: 0,
    active_searches: 0,
    max_active_searches: 0,
  };
  const vectorRuntime = createVectorRuntime({ logicalQueries, coreRows, metrics });

  const result = await hybridSearch(expansion.fixture.query, { topK: 3 }, {
    withHybridDbAccessScope: async run => run({
      withCoreDb: fn => fn(coreDb),
      withEngineDb: fn => fn(engineDb),
      capabilities: {
        isolatedFts: true,
        isolatedKg: true,
        isolatedRecent: true,
      },
    }),
    calcRealtimeConf: row => Number(row.confidence),
    getLancedbTable: vectorRuntime.getLancedbTable,
    generateEmbedding: vectorRuntime.generateEmbedding,
    vectorQueryPlan: expansion.plan,
    recallHintVectorExecutionMode: "parallel",
    getMemorySearchManager: async () => ({ manager: null }),
    searchNowSec: 1711000000,
  });

  const evaluation = evaluateProjection({ result, metrics, expectedQueryHashes });
  const body = {
    schema: RH_L3_FUSION_PROJECTION_SCHEMA,
    profile: RH_L3_FUSION_PROJECTION_PROFILE,
    source_commit: sourceCommit,
    scope: "local_hybrid_fusion_ranking_canonical_projection",
    quality_claim_scope: "NONE",
    provider_requests: 0,
    upstream_rh_l3_b: Object.freeze({
      source_commit: RH_L3_B_QUALIFIED_SOURCE,
      contract_sha256: RH_L3_B_CONTRACT_SHA256,
      execution_binding_sha256: RH_L3_B_EXECUTION_BINDING_SHA256,
      result_sha256: RH_L3_B_RESULT_SHA256,
    }),
    upstream_fixture_sha256: expansion.fixture_sha256,
    upstream_plan_sha256: expansion.plan_sha256,
    execution: evaluation,
    mutation: Object.freeze({
      runtime_config: "DENY",
      deployment: "DENY",
      live_core: "DENY",
      live_engine: "DENY",
      live_lancedb: "DENY",
      local_readonly_fixture_only: "ALLOW",
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
    upstream_rh_l3_b: body.upstream_rh_l3_b,
    upstream_fixture_sha256: body.upstream_fixture_sha256,
    upstream_plan_sha256: body.upstream_plan_sha256,
    gates: {
      vector_execution_mode: "parallel",
      queries_submitted: 3,
      queries_completed: 3,
      min_embedding_concurrency: 2,
      min_search_concurrency: 2,
      fusion_pool_count: 4,
      expected_top3_ids: RH_L3_C_EXPECTED_TOP3_IDS,
      canonical_resolved_count: 3,
      canonical_dropped_count: 0,
      projection_fields: RH_L3_C_RESULT_FIELDS,
    },
    mutation: body.mutation,
    retry_policy: body.retry_policy,
  }));
  const executionBindingSha256 = sha256(JSON.stringify({
    source_commit: sourceCommit,
    contract_sha256: contractSha256,
    upstream_rh_l3_b_execution_binding_sha256: RH_L3_B_EXECUTION_BINDING_SHA256,
    upstream_fixture_sha256: expansion.fixture_sha256,
    upstream_plan_sha256: expansion.plan_sha256,
  }));

  return Object.freeze({
    ...body,
    contract_sha256: contractSha256,
    execution_binding_sha256: executionBindingSha256,
  });
}

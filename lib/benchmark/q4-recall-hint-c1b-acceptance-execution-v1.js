import { createHash } from "node:crypto";

import { buildRecallHintVectorQueryPlan } from "../recall/hint/recall-hint-query-plan.js";
import { scoreQ1EvidenceRankingAt3 } from "./q1-product-metric-contract-v1.js";
import {
  buildQ4RecallHintC1ManifestV1,
  buildQ4RecallHintC1ProducerInputV1,
} from "./q4-recall-hint-c1-manifest-v1.js";
import { executeQ4RecallHintC1BProducerV1 } from "./q4-recall-hint-c1b-producer-v1.js";
import {
  Q4_C1B_ACCEPTANCE_CASE_COUNT,
  Q4_C1B_ACCEPTANCE_CASES_PER_FAMILY,
  Q4_C1B_ACCEPTANCE_MAX_EXPANSION_QUERIES,
  buildQ4RecallHintC1BAcceptanceContractV1,
} from "./q4-recall-hint-c1b-acceptance-contract-v1.js";
import { createQ4RecallHintC1BSemanticSessionV1 } from "./q4-recall-hint-c1b-semantic-session-v1.js";
import { evaluateQ4RecallHintCases } from "./q4-recall-hint-evaluation-v1.js";

export const Q4_C1B_ACCEPTANCE_EXECUTION_SCHEMA = "memory_engine_q4_recall_hint_c1b_acceptance_execution_v1";

const TARGET_FAMILIES = Object.freeze(["entity_reference", "temporal_relation", "multi_facet"]);
const ALL_FAMILIES = Object.freeze([...TARGET_FAMILIES, "protection"]);

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function poolScore(goldEvidenceIds, poolIds) {
  const gold = new Set(goldEvidenceIds);
  const observed = new Set((Array.isArray(poolIds) ? poolIds : []).filter(id => gold.has(id)));
  return {
    evidence_coverage: observed.size / gold.size,
    pool_miss: observed.size !== gold.size,
    observed_gold_count: observed.size,
    gold_count: gold.size,
  };
}

export function evaluateQ4RecallHintC1BAcceptanceBaselineEligibilityV1(rows) {
  if (!Array.isArray(rows) || rows.length !== Q4_C1B_ACCEPTANCE_CASE_COUNT) {
    throw fail("Q4_C1B_ACCEPTANCE_BASELINE_CASE_COUNT_INVALID");
  }
  const seen = new Set();
  const normalized = rows.map(row => {
    if (!row || typeof row.case_id !== "string" || seen.has(row.case_id)) {
      throw fail("Q4_C1B_ACCEPTANCE_BASELINE_CASE_ID_INVALID");
    }
    seen.add(row.case_id);
    if (!ALL_FAMILIES.includes(row.family)) throw fail("Q4_C1B_ACCEPTANCE_BASELINE_FAMILY_INVALID");
    if (!Array.isArray(row.gold_evidence_ids) || row.gold_evidence_ids.length === 0) {
      throw fail("Q4_C1B_ACCEPTANCE_BASELINE_GOLD_INVALID");
    }
    const pool = poolScore(row.gold_evidence_ids, row.baseline?.candidate_pool_ids);
    const final = scoreQ1EvidenceRankingAt3({
      gold_evidence_ids: row.gold_evidence_ids,
      ranked_retrieved_ids: row.baseline?.ranked_top3_ids || [],
    });
    return { ...row, pool, final };
  });

  const reasons = [];
  const families = {};
  for (const family of ALL_FAMILIES) {
    const selected = normalized.filter(row => row.family === family);
    if (selected.length !== Q4_C1B_ACCEPTANCE_CASES_PER_FAMILY) {
      throw fail("Q4_C1B_ACCEPTANCE_BASELINE_FAMILY_COUNT_INVALID", { family, count: selected.length });
    }
    const poolMissCount = selected.reduce((sum, row) => sum + Number(row.pool.pool_miss), 0);
    const poolEvidenceCoverage = selected.reduce((sum, row) => sum + row.pool.evidence_coverage, 0) / selected.length;
    const recallAllAt3 = selected.reduce((sum, row) => sum + Number(row.final["recall_all@3"]), 0) / selected.length;
    families[family] = {
      case_count: selected.length,
      pool_miss_count: poolMissCount,
      pool_evidence_coverage: poolEvidenceCoverage,
      recall_all_at_3: recallAllAt3,
    };
  }

  const protection = families.protection;
  if (protection.pool_miss_count !== 0 || Math.abs(protection.pool_evidence_coverage - 1) > 1e-12) {
    reasons.push("protection_baseline_pool_incomplete");
  }
  if (Math.abs(protection.recall_all_at_3 - 1) > 1e-12) {
    reasons.push("protection_baseline_recall_all_not_one");
  }
  for (const family of TARGET_FAMILIES) {
    if (families[family].pool_miss_count < 1) reasons.push(`${family}_baseline_pool_miss_headroom_absent`);
  }

  return Object.freeze({
    status: reasons.length === 0 ? "PASS" : "STOP",
    reasons: Object.freeze(reasons),
    families: Object.freeze(families),
  });
}

function producerWorstCaseNextCost(packet, contract) {
  return (
    contract.producer.max_output_tokens_per_request * packet.output_price_per_million
    + contract.producer.max_input_tokens_per_request * packet.input_price_per_million
  ) / 1_000_000;
}

function validateProducerUsage({ requests, inputTokens, outputTokens, cost, contract }) {
  if (!Number.isSafeInteger(requests) || requests < 0
      || !Number.isSafeInteger(inputTokens) || inputTokens < 0
      || !Number.isSafeInteger(outputTokens) || outputTokens < 0
      || !Number.isFinite(cost) || cost < 0) {
    throw fail("Q4_C1B_ACCEPTANCE_PRODUCER_USAGE_INVALID");
  }
  if (requests > contract.producer.max_provider_requests
      || inputTokens > contract.producer.max_total_input_tokens
      || outputTokens > contract.producer.max_total_output_tokens
      || cost > contract.producer.cost_binding.max_cost + 1e-12) {
    throw fail("Q4_C1B_ACCEPTANCE_PRODUCER_BUDGET_EXCEEDED");
  }
  return Object.freeze({
    provider_requests: requests,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost,
    billing_currency: contract.producer.cost_binding.billing_currency,
  });
}

async function runAcceptanceProducer({ acceptanceRows, contract, transport }) {
  if (typeof transport !== "function") throw fail("Q4_C1B_ACCEPTANCE_PRODUCER_TRANSPORT_REQUIRED");
  const packet = contract.producer_packet;
  let usage = validateProducerUsage({ requests: 0, inputTokens: 0, outputTokens: 0, cost: 0, contract });
  const output = [];

  for (const row of acceptanceRows) {
    validateProducerUsage({
      requests: usage.provider_requests + 1,
      inputTokens: usage.input_tokens + contract.producer.max_input_tokens_per_request,
      outputTokens: usage.output_tokens + contract.producer.max_output_tokens_per_request,
      cost: usage.cost + producerWorstCaseNextCost(packet, contract),
      contract,
    });

    const producerInput = buildQ4RecallHintC1ProducerInputV1(row);
    const result = await executeQ4RecallHintC1BProducerV1({ producerInput, packet, transport });
    usage = validateProducerUsage({
      requests: usage.provider_requests + 1,
      inputTokens: usage.input_tokens + result.usage.input_tokens,
      outputTokens: usage.output_tokens + result.usage.output_tokens,
      cost: usage.cost + result.usage.cost,
      contract,
    });
    const queryPlan = buildRecallHintVectorQueryPlan(row.query, result.hint);
    output.push({
      case_id: row.case_id,
      hint: result.hint,
      query_plan: queryPlan,
      latency_ms: result.latency_ms,
      usage: result.usage,
    });
  }

  if (output.length !== Q4_C1B_ACCEPTANCE_CASE_COUNT
      || usage.provider_requests !== Q4_C1B_ACCEPTANCE_CASE_COUNT) {
    throw fail("Q4_C1B_ACCEPTANCE_PRODUCER_INCOMPLETE");
  }
  const expansionQueryCount = output.reduce((sum, row) => sum + (row.query_plan?.queries?.length || 0), 0);
  if (expansionQueryCount > Q4_C1B_ACCEPTANCE_MAX_EXPANSION_QUERIES) {
    throw fail("Q4_C1B_ACCEPTANCE_EXPANSION_BUDGET_EXCEEDED");
  }

  return Object.freeze({
    rows: Object.freeze(output),
    usage,
    summary: Object.freeze({
      case_count: output.length,
      expansion_query_count: expansionQueryCount,
      empty_hint_count: output.reduce((sum, row) => sum + Number(Object.keys(row.hint).length === 1), 0),
    }),
  });
}

export async function runQ4RecallHintC1BAcceptanceV1({
  corpus,
  sourceCommit,
  executionBindingSha256,
  producerTransport,
  embeddingProvider,
  rerankAdapter,
  vectorStoreFactory,
  semanticSessionFactory = createQ4RecallHintC1BSemanticSessionV1,
  keepTemp = false,
} = {}) {
  const contract = buildQ4RecallHintC1BAcceptanceContractV1({ corpus, sourceCommit });
  if (executionBindingSha256 !== contract.execution_binding_sha256) {
    throw fail("Q4_C1B_ACCEPTANCE_EXECUTION_BINDING_MISMATCH");
  }
  if (typeof semanticSessionFactory !== "function") throw fail("Q4_C1B_ACCEPTANCE_SESSION_FACTORY_REQUIRED");

  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  const caseById = new Map(corpus.cases.map(row => [row.case_id, row]));
  const acceptanceRows = manifest.acceptance.map(item => caseById.get(item.case_id));
  if (acceptanceRows.some(row => !row)) throw fail("Q4_C1B_ACCEPTANCE_CASE_MISSING");

  let session = null;
  let producerUsage = validateProducerUsage({ requests: 0, inputTokens: 0, outputTokens: 0, cost: 0, contract });
  let phase = "SEMANTIC_BASELINE";
  try {
    session = await semanticSessionFactory({
      corpus,
      contract,
      embeddingProvider,
      rerankAdapter,
      ...(vectorStoreFactory ? { vectorStoreFactory } : {}),
      keepTemp,
    });
    if (!session || typeof session.runArm !== "function" || typeof session.usage !== "function") {
      throw fail("Q4_C1B_ACCEPTANCE_SESSION_INVALID");
    }

    const baselineRows = [];
    for (const row of acceptanceRows) {
      baselineRows.push({
        case_id: row.case_id,
        family: row.family,
        gold_evidence_ids: row.gold_evidence_ids,
        baseline: await session.runArm({ row, plan: null }),
      });
    }
    const baselineEligibility = evaluateQ4RecallHintC1BAcceptanceBaselineEligibilityV1(baselineRows);
    if (baselineEligibility.status !== "PASS") {
      return Object.freeze({
        schema: Q4_C1B_ACCEPTANCE_EXECUTION_SCHEMA,
        status: "STOPPED",
        stop_phase: "BASELINE_ELIGIBILITY",
        contract,
        baseline_eligibility: baselineEligibility,
        producer_usage: producerUsage,
        semantic_usage: session.usage(),
        evaluation: null,
      });
    }

    phase = "PRODUCER";
    const produced = await runAcceptanceProducer({ acceptanceRows, contract, transport: producerTransport });
    producerUsage = produced.usage;
    const producedById = new Map(produced.rows.map(row => [row.case_id, row]));

    phase = "SEMANTIC_HINT";
    const evaluationRows = [];
    for (const baselineRow of baselineRows) {
      const row = caseById.get(baselineRow.case_id);
      const producedRow = producedById.get(row.case_id);
      if (!producedRow) throw fail("Q4_C1B_ACCEPTANCE_HINT_MISSING");
      const hintRun = await session.runArm({ row, plan: producedRow.query_plan });
      evaluationRows.push({
        case_id: row.case_id,
        split: "acceptance",
        family: row.family,
        gold_evidence_ids: row.gold_evidence_ids,
        baseline: baselineRow.baseline,
        hint: {
          ...hintRun,
          provider_calls: 1,
          extra_embedding_calls: producedRow.query_plan?.queries?.length || 0,
          extra_vector_search_calls: producedRow.query_plan?.queries?.length || 0,
          provider_input_tokens: producedRow.usage.input_tokens,
          provider_output_tokens: producedRow.usage.output_tokens,
          hint_status: producedRow.query_plan?.queries?.length ? "expanded" : "empty",
          fallback: false,
        },
      });
    }

    const semanticUsage = session.usage();
    if (semanticUsage.rerank_requests !== contract.rerank.max_provider_requests) {
      throw fail("Q4_C1B_ACCEPTANCE_RERANK_REQUEST_COUNT_MISMATCH");
    }
    if (semanticUsage.embedding_requests > contract.embedding.max_provider_requests
        || semanticUsage.cost_upper_bound_usd > contract.cost_binding.max_cost_usd + 1e-12) {
      throw fail("Q4_C1B_ACCEPTANCE_SEMANTIC_BUDGET_EXCEEDED");
    }

    phase = "EVALUATION";
    const evaluation = evaluateQ4RecallHintCases(evaluationRows);
    const status = evaluation.technical_stop_conditions.status === "PASS" ? "PASS" : "STOPPED";
    const resultIdentity = sha256(JSON.stringify({
      execution_binding_sha256: contract.execution_binding_sha256,
      baseline_eligibility: baselineEligibility,
      producer_usage: producerUsage,
      producer_summary: produced.summary,
      semantic_usage: semanticUsage,
      evaluation,
    }));
    return Object.freeze({
      schema: Q4_C1B_ACCEPTANCE_EXECUTION_SCHEMA,
      status,
      stop_phase: status === "PASS" ? null : "ACCEPTANCE_GATES",
      contract,
      baseline_eligibility: baselineEligibility,
      producer_usage: producerUsage,
      producer_summary: produced.summary,
      semantic_usage: semanticUsage,
      evaluation,
      result_sha256: resultIdentity,
    });
  } catch (error) {
    if (error && typeof error === "object") {
      error.q4_acceptance_phase = phase;
      error.q4_acceptance_usage = Object.freeze({
        producer: producerUsage,
        semantic: session?.usage?.() || null,
      });
    }
    throw error;
  } finally {
    await session?.close?.();
  }
}

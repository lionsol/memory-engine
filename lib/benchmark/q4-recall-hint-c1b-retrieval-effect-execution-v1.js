import { buildQ4RecallHintC1ManifestV1 } from "./q4-recall-hint-c1-manifest-v1.js";
import { buildQ4RecallHintC1BDevelopmentHintsV1 } from "./q4-recall-hint-c1b-development-hints-v1.js";
import { buildQ4RecallHintC1BRetrievalEffectContractV1 } from "./q4-recall-hint-c1b-retrieval-effect-contract-v1.js";
import { createQ4RecallHintC1BSemanticSessionV1 } from "./q4-recall-hint-c1b-semantic-session-v1.js";
import { evaluateQ4RecallHintCases } from "./q4-recall-hint-evaluation-v1.js";

export const Q4_C1B_RETRIEVAL_EFFECT_EXECUTION_SCHEMA = "memory_engine_q4_recall_hint_c1b_retrieval_effect_execution_v1";

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

export async function runQ4RecallHintC1BRetrievalEffectV1({
  corpus,
  hintSnapshot = null,
  embeddingProvider,
  rerankAdapter,
  vectorStoreFactory,
  keepTemp = false,
  semanticSessionFactory = createQ4RecallHintC1BSemanticSessionV1,
} = {}) {
  if (typeof semanticSessionFactory !== "function") throw fail("Q4_C1B_RETRIEVAL_SESSION_FACTORY_REQUIRED");

  const hints = hintSnapshot || buildQ4RecallHintC1BDevelopmentHintsV1(corpus);
  const contract = buildQ4RecallHintC1BRetrievalEffectContractV1({ corpus, hintSnapshot: hints });
  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  const developmentIds = new Set(manifest.development.map(row => row.case_id));
  const caseById = new Map(corpus.cases.map(row => [row.case_id, row]));
  const hintById = new Map(hints.rows.map(row => [row.case_id, row]));
  let session = null;

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
      throw fail("Q4_C1B_RETRIEVAL_SESSION_INVALID");
    }

    const rows = [];
    for (const caseId of manifest.development.map(row => row.case_id)) {
      if (!developmentIds.has(caseId)) throw fail("Q4_C1B_RETRIEVAL_CASE_SCOPE_INVALID");
      const row = caseById.get(caseId);
      const hint = hintById.get(caseId);
      if (!row || !hint) throw fail("Q4_C1B_RETRIEVAL_CASE_OR_HINT_MISSING");

      const baseline = await session.runArm({ row, plan: null });
      const hintRun = await session.runArm({ row, plan: hint.query_plan });
      rows.push({
        case_id: row.case_id,
        split: "development",
        family: row.family,
        gold_evidence_ids: row.gold_evidence_ids,
        baseline,
        hint: {
          ...hintRun,
          provider_calls: 0,
          extra_embedding_calls: hint.query_plan?.queries?.length || 0,
          extra_vector_search_calls: hint.query_plan?.queries?.length || 0,
          provider_input_tokens: 0,
          provider_output_tokens: 0,
          hint_status: hint.query_plan ? "expanded" : "empty",
          fallback: false,
        },
      });
    }

    const providerUsage = session.usage();
    if (providerUsage.rerank_requests !== contract.rerank.max_provider_requests) {
      throw fail("Q4_C1B_RETRIEVAL_RERANK_REQUEST_COUNT_MISMATCH", {
        rerankRequests: providerUsage.rerank_requests,
      });
    }
    if (providerUsage.embedding_requests > contract.embedding.max_provider_requests) {
      throw fail("Q4_C1B_RETRIEVAL_EMBEDDING_REQUEST_COUNT_MISMATCH", {
        embeddingRequests: providerUsage.embedding_requests,
      });
    }
    if (providerUsage.cost_upper_bound_usd > contract.cost_binding.max_cost_usd + 1e-12) {
      throw fail("Q4_C1B_RETRIEVAL_COST_CAP_EXCEEDED");
    }

    return Object.freeze({
      schema: Q4_C1B_RETRIEVAL_EFFECT_EXECUTION_SCHEMA,
      contract,
      provider_usage: providerUsage,
      evaluation: evaluateQ4RecallHintCases(rows),
    });
  } catch (error) {
    if (error && typeof error === "object" && session && !error.q4_provider_usage) {
      error.q4_provider_usage = session.usage();
    }
    throw error;
  } finally {
    await session?.close?.();
  }
}

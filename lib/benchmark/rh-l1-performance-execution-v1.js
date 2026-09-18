function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function percentile(values, p) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0 ? null : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function summarizeLatencies(rows, field) {
  const values = rows.map(row => Number(row[field])).filter(Number.isFinite);
  return Object.freeze({
    count: values.length,
    mean_ms: mean(values),
    p50_ms: percentile(values, 0.50),
    p95_ms: percentile(values, 0.95),
    max_ms: values.length > 0 ? Math.max(...values) : null,
  });
}

function speedupFraction(sequential, parallel) {
  if (!Number.isFinite(sequential) || sequential <= 0 || !Number.isFinite(parallel)) return null;
  return (sequential - parallel) / sequential;
}

export function createRhL1CountedProviderV1(provider, { label } = {}) {
  if (typeof provider !== "function") throw fail("RH_L1_PROVIDER_REQUIRED");
  let requests = 0;
  let completed = 0;
  let errors = 0;
  let active = 0;
  let maxActive = 0;

  const wrapped = async (...args) => {
    requests += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      const result = await provider(...args);
      completed += 1;
      return result;
    } catch (error) {
      errors += 1;
      throw error;
    } finally {
      active -= 1;
    }
  };

  const stats = () => Object.freeze({
    label: label || null,
    requests,
    completed,
    errors,
    active,
    max_active: maxActive,
  });

  return Object.freeze({ wrapped, stats });
}

function exactArrayEqual(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function evaluateGates({ contract, rows, sequentialUsage, parallelUsage, sequentialProviders, parallelProviders }) {
  const reasons = [];
  const equivalentPool = rows.every(row => exactArrayEqual(
    row.sequential.candidate_pool_ids,
    row.parallel.candidate_pool_ids,
  ));
  const equivalentTop3 = rows.every(row => exactArrayEqual(
    row.sequential.ranked_top3_ids,
    row.parallel.ranked_top3_ids,
  ));
  if (!equivalentPool) reasons.push("candidate_pool_not_exactly_equivalent");
  if (!equivalentTop3) reasons.push("ranked_top3_not_exactly_equivalent");

  if (sequentialUsage.embedding_requests !== parallelUsage.embedding_requests) {
    reasons.push("embedding_request_counts_differ");
  }
  if (sequentialUsage.rerank_requests !== parallelUsage.rerank_requests) {
    reasons.push("rerank_request_counts_differ");
  }
  if (sequentialUsage.embedding_requests !== contract.session_contract.embedding.max_provider_requests
      || parallelUsage.embedding_requests !== contract.session_contract.embedding.max_provider_requests) {
    reasons.push("embedding_request_count_not_frozen");
  }
  if (sequentialUsage.rerank_requests !== contract.session_contract.rerank.max_provider_requests
      || parallelUsage.rerank_requests !== contract.session_contract.rerank.max_provider_requests) {
    reasons.push("rerank_request_count_not_frozen");
  }

  const seqEmbedStats = sequentialProviders.embedding;
  const parEmbedStats = parallelProviders.embedding;
  if (seqEmbedStats.max_active > contract.gates.sequential_max_embedding_concurrency_lte) {
    reasons.push("sequential_embedding_concurrency_exceeded");
  }
  if (parEmbedStats.max_active < contract.gates.parallel_min_embedding_concurrency_gte) {
    reasons.push("parallel_embedding_concurrency_not_observed");
  }
  const providerErrors = [
    sequentialProviders.embedding.errors,
    sequentialProviders.rerank.errors,
    parallelProviders.embedding.errors,
    parallelProviders.rerank.errors,
  ].reduce((sum, value) => sum + value, 0);
  if (providerErrors > contract.gates.provider_error_count_max) reasons.push("provider_error_observed");

  const seqLatency = summarizeLatencies(rows.map(row => row.sequential), "latency_ms");
  const parLatency = summarizeLatencies(rows.map(row => row.parallel), "latency_ms");
  const seqPoolVector = summarizeLatencies(rows.map(row => row.sequential), "pool_vector_ms");
  const parPoolVector = summarizeLatencies(rows.map(row => row.parallel), "pool_vector_ms");
  const seqRankedVector = summarizeLatencies(rows.map(row => row.sequential), "ranked_vector_ms");
  const parRankedVector = summarizeLatencies(rows.map(row => row.parallel), "ranked_vector_ms");

  const poolVectorP50Speedup = speedupFraction(seqPoolVector.p50_ms, parPoolVector.p50_ms);
  const fullP50Speedup = speedupFraction(seqLatency.p50_ms, parLatency.p50_ms);
  const fullP95Regression = Number.isFinite(seqLatency.p95_ms) && seqLatency.p95_ms > 0
    ? (parLatency.p95_ms - seqLatency.p95_ms) / seqLatency.p95_ms
    : null;
  if (!Number.isFinite(poolVectorP50Speedup)
      || poolVectorP50Speedup < contract.gates.pool_vector_p50_speedup_min_fraction) {
    reasons.push("pool_vector_p50_speedup_below_gate");
  }
  if (!Number.isFinite(fullP50Speedup)
      || fullP50Speedup < contract.gates.full_semantic_p50_speedup_min_fraction) {
    reasons.push("full_semantic_p50_speedup_below_gate");
  }
  if (!Number.isFinite(fullP95Regression)
      || fullP95Regression > contract.gates.full_semantic_p95_regression_max_fraction) {
    reasons.push("full_semantic_p95_regression_above_gate");
  }

  return Object.freeze({
    status: reasons.length === 0 ? "PASS" : "STOP",
    reasons: Object.freeze(reasons),
    exact_equivalence: Object.freeze({
      candidate_pool: equivalentPool,
      ranked_top3: equivalentTop3,
    }),
    latency: Object.freeze({
      sequential: Object.freeze({
        full_semantic: seqLatency,
        pool_vector: seqPoolVector,
        ranked_vector: seqRankedVector,
      }),
      parallel: Object.freeze({
        full_semantic: parLatency,
        pool_vector: parPoolVector,
        ranked_vector: parRankedVector,
      }),
      deltas: Object.freeze({
        pool_vector_p50_speedup_fraction: poolVectorP50Speedup,
        full_semantic_p50_speedup_fraction: fullP50Speedup,
        full_semantic_p95_regression_fraction: fullP95Regression,
      }),
    }),
    provider_errors: providerErrors,
  });
}

export async function runRhL1PerformanceQualificationV1({
  corpus,
  contract,
  sessionFactory,
  sequentialEmbeddingProvider,
  sequentialRerankAdapter,
  parallelEmbeddingProvider,
  parallelRerankAdapter,
  vectorStoreFactory,
} = {}) {
  if (!corpus || !Array.isArray(corpus.cases)) throw fail("RH_L1_EXEC_CORPUS_REQUIRED");
  if (!contract || typeof contract !== "object") throw fail("RH_L1_EXEC_CONTRACT_REQUIRED");
  if (typeof sessionFactory !== "function") throw fail("RH_L1_EXEC_SESSION_FACTORY_REQUIRED");

  const seqEmbedding = createRhL1CountedProviderV1(sequentialEmbeddingProvider, { label: "sequential_embedding" });
  const seqRerank = createRhL1CountedProviderV1(sequentialRerankAdapter, { label: "sequential_rerank" });
  const parEmbedding = createRhL1CountedProviderV1(parallelEmbeddingProvider, { label: "parallel_embedding" });
  const parRerank = createRhL1CountedProviderV1(parallelRerankAdapter, { label: "parallel_rerank" });

  let sequentialSession = null;
  let parallelSession = null;
  try {
    sequentialSession = await sessionFactory({
      corpus,
      contract: contract.session_contract,
      embeddingProvider: seqEmbedding.wrapped,
      rerankAdapter: seqRerank.wrapped,
      ...(vectorStoreFactory ? { vectorStoreFactory } : {}),
    });
    parallelSession = await sessionFactory({
      corpus,
      contract: contract.session_contract,
      embeddingProvider: parEmbedding.wrapped,
      rerankAdapter: parRerank.wrapped,
      ...(vectorStoreFactory ? { vectorStoreFactory } : {}),
    });

    const caseById = new Map(corpus.cases.map(row => [row.case_id, row]));
    const rows = [];
    for (const [index, target] of contract.target_plans.entries()) {
      const row = caseById.get(target.case_id);
      if (!row) throw fail("RH_L1_EXEC_TARGET_CASE_MISSING");
      let sequential;
      let parallel;
      if (index % 2 === 0) {
        sequential = await sequentialSession.runArm({
          row,
          plan: target.query_plan,
          recallHintVectorExecutionMode: "sequential",
        });
        parallel = await parallelSession.runArm({
          row,
          plan: target.query_plan,
          recallHintVectorExecutionMode: "parallel",
        });
      } else {
        parallel = await parallelSession.runArm({
          row,
          plan: target.query_plan,
          recallHintVectorExecutionMode: "parallel",
        });
        sequential = await sequentialSession.runArm({
          row,
          plan: target.query_plan,
          recallHintVectorExecutionMode: "sequential",
        });
      }
      rows.push(Object.freeze({
        case_id: target.case_id,
        family: target.family,
        expansion_count: target.query_plan.queries.length,
        sequential,
        parallel,
      }));
    }

    const sequentialUsage = sequentialSession.usage();
    const parallelUsage = parallelSession.usage();
    const totalCostUpperBoundUsd = sequentialUsage.cost_upper_bound_usd + parallelUsage.cost_upper_bound_usd;
    if (sequentialUsage.embedding_requests + parallelUsage.embedding_requests > contract.total_budget.embedding_requests
        || sequentialUsage.rerank_requests + parallelUsage.rerank_requests > contract.total_budget.rerank_requests
        || totalCostUpperBoundUsd > contract.total_budget.max_cost_usd + 1e-12) {
      throw fail("RH_L1_EXEC_TOTAL_BUDGET_EXCEEDED");
    }

    const sequentialProviders = Object.freeze({
      embedding: seqEmbedding.stats(),
      rerank: seqRerank.stats(),
    });
    const parallelProviders = Object.freeze({
      embedding: parEmbedding.stats(),
      rerank: parRerank.stats(),
    });
    const gates = evaluateGates({
      contract,
      rows,
      sequentialUsage,
      parallelUsage,
      sequentialProviders,
      parallelProviders,
    });

    return Object.freeze({
      schema: "memory_engine_rh_l1_performance_execution_v1",
      status: gates.status === "PASS" ? "PASS" : "STOPPED",
      contract_sha256: contract.contract_sha256,
      execution_binding_sha256: contract.execution_binding_sha256,
      rows: Object.freeze(rows),
      usage: Object.freeze({
        sequential: sequentialUsage,
        parallel: parallelUsage,
        total_cost_upper_bound_usd: totalCostUpperBoundUsd,
      }),
      providers: Object.freeze({
        sequential: sequentialProviders,
        parallel: parallelProviders,
      }),
      gates,
    });
  } catch (error) {
    error.rh_l1_usage = Object.freeze({
      sequential: sequentialSession?.usage?.() || null,
      parallel: parallelSession?.usage?.() || null,
      sequential_providers: Object.freeze({
        embedding: seqEmbedding.stats(),
        rerank: seqRerank.stats(),
      }),
      parallel_providers: Object.freeze({
        embedding: parEmbedding.stats(),
        rerank: parRerank.stats(),
      }),
    });
    throw error;
  } finally {
    await sequentialSession?.close?.();
    await parallelSession?.close?.();
  }
}

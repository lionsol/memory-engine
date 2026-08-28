import { createHash } from "node:crypto";

const BOUNDED_MULTI_QUERY_RRF_K = 60;

function uniqueById(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item || !item.id) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return Array.from(map.values());
}

async function collectLanceRows(rawLance) {
  if (!rawLance) return [];
  if (typeof rawLance[Symbol.asyncIterator] === "function") {
    const rows = [];
    for await (const batch of rawLance) {
      for (const row of batch) rows.push(row);
    }
    return rows;
  }
  if (Array.isArray(rawLance)) return rawLance;
  return [];
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizeLanceCandidates(lanceRows, ctx, { deterministicTieBreak = false } = {}) {
  const {
    confidenceMap,
    chunkMetaMap,
    normalizeCandidate,
    filterForRerank,
    vectorTopK,
  } = ctx;
  const candidates = lanceRows
      .map(row => {
        const id = String(row?.id || "").trim();
        if (!id) return null;
        const meta = confidenceMap.get(id) || {};
        const chunkMeta = chunkMetaMap.get(id) || {};
        return normalizeCandidate({
          id,
          text: String(row?.text || ""),
          path: chunkMeta.path || "",
          created_at: chunkMeta.updated_at || row?.timestamp || 0,
          similarity: row?._distance !== undefined ? (1 - Number(row._distance)) : 0.6,
          ...meta,
        });
      })
      .filter(Boolean)
      .filter(item => Number.isFinite(item.semantic_score))
      .filter(filterForRerank);
  candidates.sort((a, b) => deterministicTieBreak
    ? b.semantic_score - a.semantic_score || a.id.localeCompare(b.id)
    : b.semantic_score - a.semantic_score);
  return uniqueById(candidates.slice(0, vectorTopK));
}

function validateEmbeddingVector(vector) {
  const isArrayLikeVector = Array.isArray(vector) || ArrayBuffer.isView(vector);
  const vectorLength = Number(vector?.length || 0);
  if (!isArrayLikeVector) return "invalid embedding dimension";
  if (vectorLength === 0) return "empty embedding";
  if (!Array.from(vector).every(value => Number.isFinite(value))) return "invalid embedding dimension";
  return null;
}

function resolveBoundedMultiQueryInputs(vectorQueryPlan, strippedQuery) {
  const plannerQueries = vectorQueryPlan && typeof vectorQueryPlan === "object"
    ? vectorQueryPlan.queries
    : null;
  if (!Array.isArray(plannerQueries) || plannerQueries.length !== 2) return null;
  const queries = [strippedQuery, ...plannerQueries];
  if (queries.length !== 3 || queries.some(query => typeof query !== "string" || query.trim().length === 0)) {
    return null;
  }
  const trimmedQueries = queries.map(query => query.trim());
  if (new Set(trimmedQueries).size !== queries.length) return null;
  return queries;
}

function initializeBoundedMultiQueryDebug(debug, queries = []) {
  debug.vector_query_mode = "bounded_multi_query";
  debug.vector_query_count = queries.length;
  debug.vector_search_count = 0;
  debug.vector_query_fusion = "rrf";
  debug.vector_query_rrf_k = BOUNDED_MULTI_QUERY_RRF_K;
  debug.vector_raw_total = 0;
  debug.vector_unique_count = 0;
  debug.vector_query_input_sha256s = queries.map(query => sha256(query));
  debug.vector_query_candidate_counts = [];
}

function markBoundedMultiQueryFailure(debug, stage, error, toDebugErrorMessage) {
  debug.vector_multi_query_failed = true;
  debug.vector_error_stage = stage;
  debug.vector_error = typeof error === "string" ? error : toDebugErrorMessage(error);
  debug.vector_stage = stage === "query_embedding" ? "embedding" : "lancedb_search";
  return false;
}

async function collectBoundedMultiQueryCandidates(ctx, queries, lancedbTable) {
  const {
    channels,
    debug,
    candidateCounts,
    generateEmbeddingRuntime,
    vectorTopK,
    toDebugErrorMessage,
  } = ctx;
  const fusion = new Map();

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex];
    debug.vector_query_candidate_counts.push(0);
    let queryVec;
    try {
      queryVec = await generateEmbeddingRuntime(query);
    } catch (error) {
      return markBoundedMultiQueryFailure(debug, "query_embedding", error, toDebugErrorMessage);
    }
    const vectorError = validateEmbeddingVector(queryVec);
    if (vectorError) return markBoundedMultiQueryFailure(debug, "query_embedding", vectorError, toDebugErrorMessage);

    debug.vector_search_count += 1;
    let rawLance;
    try {
      rawLance = await lancedbTable.search(queryVec).limit(vectorTopK).execute();
    } catch (error) {
      return markBoundedMultiQueryFailure(debug, "vector_search", error, toDebugErrorMessage);
    }
    let lanceRows;
    try {
      lanceRows = await collectLanceRows(rawLance);
    } catch (error) {
      return markBoundedMultiQueryFailure(debug, "vector_search", error, toDebugErrorMessage);
    }
    debug.vector_raw_total += lanceRows.length;
    candidateCounts.vector_raw += lanceRows.length;
    const scored = normalizeLanceCandidates(lanceRows, ctx, { deterministicTieBreak: true });
    debug.vector_query_candidate_counts[queryIndex] = scored.length;

    for (const [rank, item] of scored.entries()) {
      const queryRrfScore = 1 / (BOUNDED_MULTI_QUERY_RRF_K + rank + 1);
      const existing = fusion.get(item.id);
      if (!existing) {
        fusion.set(item.id, {
          ...item,
          vector_query_rrf_score: queryRrfScore,
        });
        continue;
      }
      existing.vector_query_rrf_score += queryRrfScore;
      existing.semantic_score = Math.max(Number(existing.semantic_score), Number(item.semantic_score));
      existing.similarity = Math.max(Number(existing.similarity), Number(item.similarity));
    }
  }

  const candidates = [...fusion.values()]
    .sort((left, right) => right.vector_query_rrf_score - left.vector_query_rrf_score || left.id.localeCompare(right.id))
    .slice(0, vectorTopK);
  candidateCounts.vector_after_conf_filter = candidates.length;
  debug.vector_unique_count = candidates.length;
  debug.vector_backend = "lancedb";
  debug.vector_stage = "lancedb_search";
  if (candidates.length > 0) channels.vector = candidates;
  return true;
}

export async function collectVectorCandidates(ctx) {
  const {
    channels,
    debug,
    candidateCounts,
    shouldSkipVector,
    getLancedbRuntimeRuntime,
    getLancedbTableRuntime,
    vectorReadyTimeoutMs,
    generateEmbeddingRuntime,
    strippedQuery,
    vectorTopK,
    confidenceMap,
    chunkMetaMap,
    normalizeCandidate,
    filterForRerank,
    toDebugErrorMessage,
    warnVectorChannelOnce,
    cfg,
    getMemorySearchManagerFn,
    vectorQueryPlan,
  } = ctx;

  let lancedbTable = null;
  let lancedbReadyState = "disabled";
  let lancedbInitError = null;
  let lancedbTimedOut = false;
  const vectorStartMs = Date.now();
  const boundedMultiQueryEnabled = vectorQueryPlan !== null && vectorQueryPlan !== undefined;
  let boundedMultiQueryInputs = null;
  if (boundedMultiQueryEnabled) {
    boundedMultiQueryInputs = resolveBoundedMultiQueryInputs(vectorQueryPlan, strippedQuery);
    initializeBoundedMultiQueryDebug(debug, boundedMultiQueryInputs || []);
    if (!boundedMultiQueryInputs) {
      markBoundedMultiQueryFailure(
        debug,
        "vector_query_plan",
        "bounded multi-query plan must contain exactly two distinct non-empty planner queries",
        toDebugErrorMessage,
      );
      debug.vector_ms = Date.now() - vectorStartMs;
      return;
    }
  }
  debug.vector_backend_attempted = shouldSkipVector ? null : "lancedb";

  if (shouldSkipVector) {
    debug.vector_skipped = true;
    debug.vector_skip_reason = "lexical_confidence_threshold_met";
    debug.vector_stage = "skipped";
    debug.vector_ready_state = "skipped";
    debug.vector_backend = "skipped";
    debug.vector_ms = Date.now() - vectorStartMs;
    return;
  }

  if (typeof getLancedbRuntimeRuntime === "function") {
    try {
      const runtimeInfo = await getLancedbRuntimeRuntime({ timeoutMs: vectorReadyTimeoutMs });
      if (runtimeInfo && typeof runtimeInfo === "object" && !Array.isArray(runtimeInfo)) {
        lancedbTable = runtimeInfo.table || null;
        lancedbReadyState = String(runtimeInfo.readyState || (lancedbTable ? "ready" : "disabled"));
        if (runtimeInfo.initError !== undefined && runtimeInfo.initError !== null) {
          lancedbInitError = String(runtimeInfo.initError);
        }
        lancedbTimedOut = Boolean(runtimeInfo.timedOut);
      } else {
        lancedbTable = runtimeInfo || null;
        lancedbReadyState = lancedbTable ? "ready" : "disabled";
      }
    } catch (e) {
      lancedbReadyState = "failed";
      lancedbInitError = e?.message ? String(e.message) : String(e);
      warnVectorChannelOnce("lancedb_runtime_error", e);
    }
  } else if (typeof getLancedbTableRuntime === "function") {
    lancedbTable = getLancedbTableRuntime();
    lancedbReadyState = lancedbTable ? "ready" : "disabled";
  }

  debug.vector_ready_state = lancedbReadyState;
  if (lancedbReadyState === "failed" && lancedbInitError) {
    debug.vector_init_error = lancedbInitError;
  }

  let vectorHandled = false;
  if (!lancedbTable) {
    if (lancedbReadyState === "pending" && lancedbTimedOut) {
      warnVectorChannelOnce("lancedb_pending_timeout");
    } else if (lancedbReadyState === "failed") {
      warnVectorChannelOnce("lancedb_init_failed", lancedbInitError ? new Error(lancedbInitError) : null);
    } else {
      warnVectorChannelOnce("lancedb_table_null");
    }
    debug.vector_stage = "fallback";
    if (boundedMultiQueryEnabled) {
      markBoundedMultiQueryFailure(debug, "vector_store", "temporary LanceDB table unavailable", toDebugErrorMessage);
    }
  } else if (typeof generateEmbeddingRuntime !== "function") {
    warnVectorChannelOnce("lancedb_embedding_unavailable");
    debug.vector_stage = "fallback";
    debug.vector_error = "embedding runtime unavailable";
    if (boundedMultiQueryEnabled) {
      markBoundedMultiQueryFailure(debug, "query_embedding", "embedding runtime unavailable", toDebugErrorMessage);
    }
  } else {
    debug.vector_stage = "embedding";
    if (boundedMultiQueryEnabled) {
      vectorHandled = await collectBoundedMultiQueryCandidates(ctx, boundedMultiQueryInputs, lancedbTable);
    } else {
      let queryVec = null;
      let embeddingFailed = false;
      try {
        queryVec = await generateEmbeddingRuntime(strippedQuery);
      } catch (e) {
        embeddingFailed = true;
        debug.vector_error = toDebugErrorMessage(e);
        warnVectorChannelOnce("lancedb_embedding_error", e);
      }
      if (!embeddingFailed && queryVec !== null && queryVec !== undefined) {
        const isArrayLikeVector = Array.isArray(queryVec) || ArrayBuffer.isView(queryVec);
        const queryVecLength = Number(queryVec.length || 0);
        if (!isArrayLikeVector) {
          debug.vector_error = "invalid embedding dimension";
          warnVectorChannelOnce("lancedb_embedding_invalid_dimension");
        } else if (queryVecLength === 0) {
          debug.vector_error = "empty embedding";
          warnVectorChannelOnce("lancedb_embedding_empty");
        } else if (!Array.from(queryVec).every(v => Number.isFinite(v))) {
          debug.vector_error = "invalid embedding dimension";
          warnVectorChannelOnce("lancedb_embedding_invalid_dimension");
        } else {
          debug.vector_stage = "lancedb_search";
          try {
            const rawLance = await lancedbTable.search(queryVec).limit(vectorTopK).execute();
            const lanceRows = await collectLanceRows(rawLance);
            vectorHandled = true;
            debug.vector_backend = "lancedb";
            candidateCounts.vector_raw = lanceRows.length;
            if (lanceRows.length > 0) {
              const scored = normalizeLanceCandidates(lanceRows, ctx);
              candidateCounts.vector_after_conf_filter = scored.length;
              if (scored.length > 0) channels.vector = scored;
            }
          } catch (e) {
            debug.vector_error = toDebugErrorMessage(e);
            warnVectorChannelOnce("lancedb_search_error", e);
          }
        }
      } else if (!embeddingFailed) {
        debug.vector_error = "empty embedding";
        warnVectorChannelOnce("lancedb_embedding_empty");
      }
    }
  }

  if (!vectorHandled && !boundedMultiQueryEnabled) {
    if (debug.vector_stage === "ready_check") {
      debug.vector_stage = "fallback";
    }
    let vectorManager = null;
    try {
      const managerResult = cfg
        ? await getMemorySearchManagerFn({ cfg })
        : await getMemorySearchManagerFn();
      vectorManager = managerResult?.manager || null;
      if (!vectorManager) {
        warnVectorChannelOnce("manager_missing", managerResult?.error ? new Error(String(managerResult.error)) : null);
      }
    } catch (e) {
      warnVectorChannelOnce("manager_init_error", e);
    }

    if (vectorManager) {
      try {
        const raw = await vectorManager.search(strippedQuery, { limit: vectorTopK });
        const candidates = Array.isArray(raw)
          ? raw
          : (Array.isArray(raw?.entries) ? raw.entries : []);
        debug.vector_backend = "memory-core-sqlite";
        candidateCounts.vector_raw = candidates.length;
        const scored = uniqueById(
          candidates
            .map(c => {
              const id = c.id || c.chunkId;
              if (!id) return null;
              const meta = confidenceMap.get(id) || {};
              const chunkMeta = chunkMetaMap.get(id) || {};
              return normalizeCandidate({
                id,
                text: c.text || c.content || "",
                path: chunkMeta.path || "",
                created_at: chunkMeta.updated_at || 0,
                similarity: c.similarity ?? c.score ?? 0.5,
                ...meta,
              });
            })
            .filter(Boolean)
            .filter(item => Number.isFinite(item.semantic_score))
            .filter(filterForRerank)
            .sort((a, b) => b.semantic_score - a.semantic_score)
            .slice(0, vectorTopK)
        );
        candidateCounts.vector_after_conf_filter = scored.length;
        if (scored.length > 0) channels.vector = scored;
      } catch (e) {
        warnVectorChannelOnce("search_error", e);
      }
    }
  }
  debug.vector_ms = Date.now() - vectorStartMs;
}

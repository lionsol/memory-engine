import { createHash } from "node:crypto";
import { monotonicNow, normalizeHybridStageTiming } from "../debug.js";
import {
  awaitWithAutoRecallBudget,
  isAutoRecallCancellation,
  requestBudgetOptions,
} from "../../request-budget.js";

const BOUNDED_MULTI_QUERY_RRF_K = 60;
const RECALL_HINT_VECTOR_EXECUTION_SEQUENTIAL = "sequential";
const RECALL_HINT_VECTOR_EXECUTION_PARALLEL = "parallel";

async function callWithRequestBudget(ctx, operation, stage) {
  const budget = ctx.requestBudget;
  const result = await awaitWithAutoRecallBudget(
    Promise.resolve().then(operation),
    budget,
    stage,
  );
  budget?.throwIfCancelled(stage);
  return result;
}

async function generateQueryEmbedding(ctx, query, stage = "embedding") {
  const { generateEmbeddingRuntime, requestBudget } = ctx;
  return callWithRequestBudget(
    ctx,
    () => generateEmbeddingRuntime(query, requestBudgetOptions(requestBudget, stage)),
    stage,
  );
}

function markCancellation(debug, error) {
  if (!isAutoRecallCancellation(error)) return false;
  debug.request_cancelled = true;
  debug.cancellation_status = "cancelled";
  debug.cancellation_stage = String(error?.stage || "vector").slice(0, 64);
  debug.vector_timing_status = "cancelled";
  error.vectorTimings = Object.fromEntries(
    [
      "vector_ready_wait_ms",
      "vector_embedding_wait_ms",
      "vector_lancedb_search_ms",
      "vector_lancedb_collect_ms",
      "vector_candidate_postprocess_ms",
    ].filter(key => Object.hasOwn(debug, key)).map(key => [key, debug[key]]),
  );
  return true;
}

export const VECTOR_CHUNK_METADATA_SQL = `
WITH selected AS (
  SELECT CAST(value AS TEXT) AS id
  FROM json_each(?)
)
SELECT
  c.id,
  c.path,
  c.updated_at
FROM chunks c
JOIN selected s
  ON c.id = s.id`;

function normalizeRecallHintVectorExecutionMode(value) {
  return value === RECALL_HINT_VECTOR_EXECUTION_PARALLEL
    ? RECALL_HINT_VECTOR_EXECUTION_PARALLEL
    : RECALL_HINT_VECTOR_EXECUTION_SEQUENTIAL;
}

function uniqueById(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item || !item.id) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return Array.from(map.values());
}

function normalizeCandidateIds(ids = []) {
  return [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map(id => String(id ?? "").trim())
      .filter(Boolean),
  )].sort();
}

export function loadVectorChunkMetaByIds({ withCoreDb, ids = [] } = {}) {
  const normalizedIds = normalizeCandidateIds(ids);
  if (normalizedIds.length === 0 || typeof withCoreDb !== "function") return new Map();
  const rows = withCoreDb(db => db.prepare(VECTOR_CHUNK_METADATA_SQL).all(JSON.stringify(normalizedIds)));
  const metadata = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id ?? "").trim();
    if (!id) continue;
    metadata.set(id, {
      id,
      path: row?.path,
      updated_at: row?.updated_at,
    });
  }
  return metadata;
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

function maxFiniteNumber(...values) {
  const finite = values.map(value => Number(value)).filter(Number.isFinite);
  return finite.length > 0 ? Math.max(...finite) : null;
}

function normalizeLanceCandidates(lanceRows, ctx, { deterministicTieBreak = false } = {}) {
  const {
    confidenceMap,
    withCoreDb,
    normalizeCandidate,
    filterForRerank,
    vectorTopK,
  } = ctx;

  const vectorChunkMetadataById = loadVectorChunkMetaByIds({
    withCoreDb,
    ids: lanceRows.map(row => row?.id),
  });
  const candidates = lanceRows
      .map(row => {
        const id = String(row?.id || "").trim();
        if (!id) return null;
        const meta = confidenceMap.get(id) || {};
        const chunkMeta = vectorChunkMetadataById.get(id) || {};
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

function resolveVectorQueryInputs(vectorQueryPlan, strippedQuery) {
  const plannerQueries = vectorQueryPlan && typeof vectorQueryPlan === "object"
    ? vectorQueryPlan.queries
    : null;
  const isRecallHintPlan = vectorQueryPlan?.mode === "recall_hint_v1";
  if (!Array.isArray(plannerQueries)) return null;
  if (isRecallHintPlan) {
    if (plannerQueries.length < 1 || plannerQueries.length > 2) return null;
  } else if (plannerQueries.length !== 2) {
    // Historical/H2 shape is intentionally strict for benchmark compatibility.
    return null;
  }
  const queries = [strippedQuery, ...plannerQueries];
  if (queries.some(query => typeof query !== "string" || query.trim().length === 0)) {
    return null;
  }
  const trimmedQueries = queries.map(query => query.trim());
  if (new Set(trimmedQueries).size !== queries.length) return null;
  return { mode: isRecallHintPlan ? "recall_hint_v1" : "bounded_multi_query", queries: trimmedQueries };
}

function initializeMultiQueryDebug(debug, mode, queries = [], executionMode = RECALL_HINT_VECTOR_EXECUTION_SEQUENTIAL) {
  debug.vector_query_mode = mode;
  debug.vector_query_count = queries.length;
  debug.vector_query_execution = executionMode;
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

async function collectBoundedMultiQueryCandidatesSequential(ctx, queries, lancedbTable) {
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
      const embeddingStartedAt = monotonicNow();
      queryVec = await generateQueryEmbedding(ctx, query, "query_embedding");
      debug.vector_embedding_wait_ms = normalizeHybridStageTiming(
        Number(debug.vector_embedding_wait_ms || 0) + (monotonicNow() - embeddingStartedAt),
      );
    } catch (error) {
      if (markCancellation(debug, error)) throw error;
      return markBoundedMultiQueryFailure(debug, "query_embedding", error, toDebugErrorMessage);
    }
    const vectorError = validateEmbeddingVector(queryVec);
    if (vectorError) return markBoundedMultiQueryFailure(debug, "query_embedding", vectorError, toDebugErrorMessage);

    debug.vector_search_count += 1;
    let rawLance;
    const searchStartedAt = monotonicNow();
    try {
      rawLance = await callWithRequestBudget(
        ctx,
        () => lancedbTable.search(queryVec).limit(vectorTopK).execute(),
        "lancedb_search",
      );
      debug.vector_lancedb_search_ms = normalizeHybridStageTiming(
        Number(debug.vector_lancedb_search_ms || 0) + (monotonicNow() - searchStartedAt),
      );
    } catch (error) {
      if (markCancellation(debug, error)) throw error;
      return markBoundedMultiQueryFailure(debug, "vector_search", error, toDebugErrorMessage);
    }
    let lanceRows;
    const collectStartedAt = monotonicNow();
    try {
      lanceRows = await callWithRequestBudget(ctx, () => collectLanceRows(rawLance), "lancedb_collect");
      debug.vector_lancedb_collect_ms = normalizeHybridStageTiming(
        Number(debug.vector_lancedb_collect_ms || 0) + (monotonicNow() - collectStartedAt),
      );
    } catch (error) {
      if (markCancellation(debug, error)) throw error;
      return markBoundedMultiQueryFailure(debug, "vector_search", error, toDebugErrorMessage);
    }
    debug.vector_raw_total += lanceRows.length;
    candidateCounts.vector_raw += lanceRows.length;
    let scored;
    const postprocessStartedAt = monotonicNow();
    try {
      scored = normalizeLanceCandidates(lanceRows, ctx, { deterministicTieBreak: true });
      debug.vector_candidate_postprocess_ms = normalizeHybridStageTiming(
        Number(debug.vector_candidate_postprocess_ms || 0) + (monotonicNow() - postprocessStartedAt),
      );
      ctx.requestBudget?.throwIfCancelled("vector_candidate_postprocess");
    } catch (error) {
      if (markCancellation(debug, error)) throw error;
      return markBoundedMultiQueryFailure(debug, "vector_metadata", error, toDebugErrorMessage);
    }
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
      const maxSemanticScore = maxFiniteNumber(existing.semantic_score, item.semantic_score);
      if (maxSemanticScore !== null) existing.semantic_score = maxSemanticScore;
      const maxSimilarity = maxFiniteNumber(existing.similarity, item.similarity);
      if (maxSimilarity !== null) existing.similarity = maxSimilarity;
    }
  }

  const candidates = [...fusion.values()]
    .sort((left, right) => {
      const rrfDelta = right.vector_query_rrf_score - left.vector_query_rrf_score;
      if (rrfDelta !== 0) return rrfDelta;
      const leftSemantic = Number.isFinite(Number(left.semantic_score)) ? Number(left.semantic_score) : -Infinity;
      const rightSemantic = Number.isFinite(Number(right.semantic_score)) ? Number(right.semantic_score) : -Infinity;
      return rightSemantic - leftSemantic || left.id.localeCompare(right.id);
    })
    .slice(0, vectorTopK);
  candidateCounts.vector_after_conf_filter = candidates.length;
  debug.vector_unique_count = candidates.length;
  debug.vector_backend = "lancedb";
  debug.vector_stage = "lancedb_search";
  if (candidates.length > 0) channels.vector = candidates;
  return true;
}

async function executeParallelVectorQuery(ctx, query, queryIndex, lancedbTable) {
  const { vectorTopK, debug } = ctx;
  let queryVec;
  const embeddingStartedAt = monotonicNow();
  try {
    queryVec = await generateQueryEmbedding(ctx, query, "query_embedding");
  } catch (error) {
    if (markCancellation(debug, error)) throw error;
    return { ok: false, queryIndex, stage: "query_embedding", error, searchAttempted: false };
  }
  const embeddingMs = monotonicNow() - embeddingStartedAt;
  const vectorError = validateEmbeddingVector(queryVec);
  if (vectorError) {
    return { ok: false, queryIndex, stage: "query_embedding", error: vectorError, searchAttempted: false };
  }

  let rawLance;
  const searchStartedAt = monotonicNow();
  try {
    rawLance = await callWithRequestBudget(
      ctx,
      () => lancedbTable.search(queryVec).limit(vectorTopK).execute(),
      "lancedb_search",
    );
  } catch (error) {
    if (markCancellation(debug, error)) throw error;
    return { ok: false, queryIndex, stage: "vector_search", error, searchAttempted: true };
  }
  const searchMs = monotonicNow() - searchStartedAt;
  const collectStartedAt = monotonicNow();
  try {
    const lanceRows = await callWithRequestBudget(ctx, () => collectLanceRows(rawLance), "lancedb_collect");
    const collectMs = monotonicNow() - collectStartedAt;
    const postprocessStartedAt = monotonicNow();
    const scored = normalizeLanceCandidates(lanceRows, ctx, { deterministicTieBreak: true });
    ctx.requestBudget?.throwIfCancelled("vector_candidate_postprocess");
    return {
      ok: true,
      queryIndex,
      searchAttempted: true,
      lanceRows,
      scored,
      embeddingMs,
      searchMs,
      collectMs,
      postprocessMs: monotonicNow() - postprocessStartedAt,
    };
  } catch (error) {
    if (markCancellation(debug, error)) throw error;
    return { ok: false, queryIndex, stage: "vector_search", error, searchAttempted: true };
  }
}

async function collectRecallHintParallelCandidates(ctx, queries, lancedbTable) {
  const {
    channels,
    debug,
    candidateCounts,
    vectorTopK,
    toDebugErrorMessage,
  } = ctx;
  const results = await Promise.all(
    queries.map((query, queryIndex) => executeParallelVectorQuery(ctx, query, queryIndex, lancedbTable)),
  );
  debug.vector_embedding_wait_ms = normalizeHybridStageTiming(
    Math.max(0, ...results.map(row => Number(row.embeddingMs) || 0)),
  );
  debug.vector_lancedb_search_ms = normalizeHybridStageTiming(
    Math.max(0, ...results.map(row => Number(row.searchMs) || 0)),
  );
  debug.vector_lancedb_collect_ms = normalizeHybridStageTiming(
    Math.max(0, ...results.map(row => Number(row.collectMs) || 0)),
  );
  debug.vector_candidate_postprocess_ms = normalizeHybridStageTiming(
    Math.max(0, ...results.map(row => Number(row.postprocessMs) || 0)),
  );
  debug.vector_search_count = results.reduce((sum, row) => sum + Number(row.searchAttempted), 0);
  debug.vector_query_candidate_counts = results.map(row => row.ok ? row.scored.length : 0);

  const failure = results.find(row => !row.ok);
  if (failure) {
    return markBoundedMultiQueryFailure(debug, failure.stage, failure.error, toDebugErrorMessage);
  }

  const fusion = new Map();
  for (const row of results) {
    debug.vector_raw_total += row.lanceRows.length;
    candidateCounts.vector_raw += row.lanceRows.length;
    for (const [rank, item] of row.scored.entries()) {
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
      const maxSemanticScore = maxFiniteNumber(existing.semantic_score, item.semantic_score);
      if (maxSemanticScore !== null) existing.semantic_score = maxSemanticScore;
      const maxSimilarity = maxFiniteNumber(existing.similarity, item.similarity);
      if (maxSimilarity !== null) existing.similarity = maxSimilarity;
    }
  }

  const candidates = [...fusion.values()]
    .sort((left, right) => {
      const rrfDelta = right.vector_query_rrf_score - left.vector_query_rrf_score;
      if (rrfDelta !== 0) return rrfDelta;
      const leftSemantic = Number.isFinite(Number(left.semantic_score)) ? Number(left.semantic_score) : -Infinity;
      const rightSemantic = Number.isFinite(Number(right.semantic_score)) ? Number(right.semantic_score) : -Infinity;
      return rightSemantic - leftSemantic || left.id.localeCompare(right.id);
    })
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
    withCoreDb,
    normalizeCandidate,
    filterForRerank,
    toDebugErrorMessage,
    warnVectorChannelOnce,
    cfg,
    getMemorySearchManagerFn,
    vectorQueryPlan,
    recallHintVectorExecutionMode,
    requestBudget,
  } = ctx;

  requestBudget?.throwIfCancelled("vector_start");

  let lancedbTable = null;
  let lancedbReadyState = "disabled";
  let lancedbInitError = null;
  let lancedbTimedOut = false;
  const vectorStartMs = monotonicNow();
  const multiQueryEnabled = vectorQueryPlan !== null && vectorQueryPlan !== undefined;
  const recallHintMultiQuery = vectorQueryPlan?.mode === "recall_hint_v1";
  const recallHintExecutionMode = recallHintMultiQuery
    ? normalizeRecallHintVectorExecutionMode(recallHintVectorExecutionMode)
    : RECALL_HINT_VECTOR_EXECUTION_SEQUENTIAL;
  let multiQueryInputs = null;
  if (multiQueryEnabled) {
    const resolved = resolveVectorQueryInputs(vectorQueryPlan, strippedQuery);
    multiQueryInputs = resolved?.queries || null;
    initializeMultiQueryDebug(
      debug,
      resolved?.mode || "bounded_multi_query",
      multiQueryInputs || [],
      recallHintExecutionMode,
    );
    if (!multiQueryInputs) {
      markBoundedMultiQueryFailure(
        debug,
        "vector_query_plan",
        recallHintMultiQuery
          ? "recall_hint_v1 plan must contain one or two distinct non-empty expansion queries"
          : "bounded multi-query plan must contain exactly two distinct non-empty planner queries",
        toDebugErrorMessage,
      );
      if (recallHintMultiQuery) {
        debug.vector_hint_fallback_original = true;
        await collectVectorCandidates({ ...ctx, vectorQueryPlan: null });
        return;
      }
      debug.vector_ms = normalizeHybridStageTiming(monotonicNow() - vectorStartMs);
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
    debug.vector_ms = normalizeHybridStageTiming(monotonicNow() - vectorStartMs);
    return;
  }

  if (typeof getLancedbRuntimeRuntime === "function") {
    const readyStartedAt = monotonicNow();
    try {
      const readyTimeoutMs = requestBudget
        ? Math.min(vectorReadyTimeoutMs, requestBudget.remainingMs())
        : vectorReadyTimeoutMs;
      const runtimeInfo = await callWithRequestBudget(
        ctx,
        () => getLancedbRuntimeRuntime({
          timeoutMs: readyTimeoutMs,
          ...requestBudgetOptions(requestBudget, "vector_ready"),
        }),
        "vector_ready",
      );
      debug.vector_ready_wait_ms = normalizeHybridStageTiming(monotonicNow() - readyStartedAt);
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
      if (markCancellation(debug, e)) throw e;
      debug.vector_ready_wait_ms = normalizeHybridStageTiming(monotonicNow() - readyStartedAt);
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
    if (multiQueryEnabled) {
      markBoundedMultiQueryFailure(debug, "vector_store", "temporary LanceDB table unavailable", toDebugErrorMessage);
    }
  } else if (typeof generateEmbeddingRuntime !== "function") {
    warnVectorChannelOnce("lancedb_embedding_unavailable");
    debug.vector_stage = "fallback";
    debug.vector_error = "embedding runtime unavailable";
    if (multiQueryEnabled) {
      markBoundedMultiQueryFailure(debug, "query_embedding", "embedding runtime unavailable", toDebugErrorMessage);
    }
  } else {
    debug.vector_stage = "embedding";
    if (multiQueryEnabled) {
      vectorHandled = recallHintMultiQuery && recallHintExecutionMode === RECALL_HINT_VECTOR_EXECUTION_PARALLEL
        ? await collectRecallHintParallelCandidates(ctx, multiQueryInputs, lancedbTable)
        : await collectBoundedMultiQueryCandidatesSequential(ctx, multiQueryInputs, lancedbTable);
      if (!vectorHandled && recallHintMultiQuery) {
        debug.vector_hint_fallback_original = true;
        await collectVectorCandidates({ ...ctx, vectorQueryPlan: null });
        return;
      }
    } else {
      let queryVec = null;
      let embeddingFailed = false;
      const embeddingStartedAt = monotonicNow();
      try {
        queryVec = await generateQueryEmbedding(ctx, strippedQuery);
        debug.vector_embedding_wait_ms = normalizeHybridStageTiming(monotonicNow() - embeddingStartedAt);
      } catch (e) {
        if (markCancellation(debug, e)) throw e;
        debug.vector_embedding_wait_ms = normalizeHybridStageTiming(monotonicNow() - embeddingStartedAt);
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
          const searchStartedAt = monotonicNow();
          try {
            const rawLance = await callWithRequestBudget(
              ctx,
              () => lancedbTable.search(queryVec).limit(vectorTopK).execute(),
              "lancedb_search",
            );
            debug.vector_lancedb_search_ms = normalizeHybridStageTiming(monotonicNow() - searchStartedAt);
            const collectStartedAt = monotonicNow();
            const lanceRows = await callWithRequestBudget(ctx, () => collectLanceRows(rawLance), "lancedb_collect");
            debug.vector_lancedb_collect_ms = normalizeHybridStageTiming(monotonicNow() - collectStartedAt);
            vectorHandled = true;
            debug.vector_backend = "lancedb";
            candidateCounts.vector_raw = lanceRows.length;
            if (lanceRows.length > 0) {
              const postprocessStartedAt = monotonicNow();
              const scored = normalizeLanceCandidates(lanceRows, ctx);
              debug.vector_candidate_postprocess_ms = normalizeHybridStageTiming(monotonicNow() - postprocessStartedAt);
              requestBudget?.throwIfCancelled("vector_candidate_postprocess");
              candidateCounts.vector_after_conf_filter = scored.length;
              if (scored.length > 0) channels.vector = scored;
            }
          } catch (e) {
            if (markCancellation(debug, e)) throw e;
            debug.vector_lancedb_search_ms = normalizeHybridStageTiming(monotonicNow() - searchStartedAt);
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

  if (!vectorHandled && recallHintMultiQuery) {
    debug.vector_hint_fallback_original = true;
    await collectVectorCandidates({ ...ctx, vectorQueryPlan: null });
    return;
  }

  if (!vectorHandled && !multiQueryEnabled) {
    if (debug.vector_stage === "ready_check") {
      debug.vector_stage = "fallback";
    }
    let vectorManager = null;
    try {
      const managerResult = await callWithRequestBudget(
        ctx,
        () => cfg ? getMemorySearchManagerFn({ cfg }) : getMemorySearchManagerFn(),
        "manager_resolution",
      );
      vectorManager = managerResult?.manager || null;
      if (!vectorManager) {
        warnVectorChannelOnce("manager_missing", managerResult?.error ? new Error(String(managerResult.error)) : null);
      }
    } catch (e) {
      if (markCancellation(debug, e)) throw e;
      warnVectorChannelOnce("manager_init_error", e);
    }

    if (vectorManager) {
      try {
        const raw = await callWithRequestBudget(
          ctx,
          () => vectorManager.search(strippedQuery, {
            limit: vectorTopK,
            ...requestBudgetOptions(requestBudget, "manager_search"),
          }),
          "manager_search",
        );
        const candidates = Array.isArray(raw)
          ? raw
          : (Array.isArray(raw?.entries) ? raw.entries : []);
        const vectorChunkMetadataById = loadVectorChunkMetaByIds({
          withCoreDb,
          ids: candidates.map(candidate => candidate?.id || candidate?.chunkId),
        });
        debug.vector_backend = "memory-core-sqlite";
        candidateCounts.vector_raw = candidates.length;
        const scored = uniqueById(
          candidates
            .map(c => {
              const id = c.id || c.chunkId;
              if (!id) return null;
              const meta = confidenceMap.get(id) || {};
              const chunkMeta = vectorChunkMetadataById.get(String(id).trim()) || {};
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
        if (markCancellation(debug, e)) throw e;
        warnVectorChannelOnce("search_error", e);
      }
    }
  }
  requestBudget?.throwIfCancelled("vector_complete");
  debug.vector_ms = normalizeHybridStageTiming(monotonicNow() - vectorStartMs);
}

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
  } = ctx;

  let lancedbTable = null;
  let lancedbReadyState = "disabled";
  let lancedbInitError = null;
  let lancedbTimedOut = false;
  const vectorStartMs = Date.now();
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
  } else if (typeof generateEmbeddingRuntime !== "function") {
    warnVectorChannelOnce("lancedb_embedding_unavailable");
    debug.vector_stage = "fallback";
    debug.vector_error = "embedding runtime unavailable";
  } else {
    debug.vector_stage = "embedding";
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
            const scored = uniqueById(
              lanceRows
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
                .filter(filterForRerank)
                .sort((a, b) => b.semantic_score - a.semantic_score)
                .slice(0, vectorTopK)
            );
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

  if (!vectorHandled) {
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
        const candidates = raw?.entries || raw || [];
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

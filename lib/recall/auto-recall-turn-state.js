const DEFAULT_TTL_MS = 60_000;

function normalizeId(value) {
  const id = String(value || "").trim();
  return id || null;
}

function normalizeShortMemoryId(value) {
  const id = String(value || "").slice(0, 16).trim();
  return id || null;
}

function uniqueShortIds(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const shortId = normalizeShortMemoryId(value);
    if (!shortId || seen.has(shortId)) continue;
    seen.add(shortId);
    result.push(shortId);
  }
  return result;
}

function touchRecord(record, now, ttlMs) {
  record.lastTouchedAt = now;
  record.expiresAt = now + ttlMs;
  return record;
}

export function createAutoRecallTurnStateManager(options = {}) {
  const ttlMs = Math.max(1_000, Number(options.ttlMs || DEFAULT_TTL_MS) || DEFAULT_TTL_MS);
  const nowProvider = typeof options.now === "function" ? options.now : () => Date.now();
  const turnStates = new Map();
  const toolInvocationScopes = new Map();

  function now() {
    return Number(nowProvider());
  }

  function createTurnState({ runId, sessionId = null, traceId = null } = {}) {
    const normalizedRunId = normalizeId(runId);
    if (!normalizedRunId) return null;
    const timestamp = now();
    const existing = turnStates.get(normalizedRunId);
    if (existing) {
      existing.sessionId = normalizeId(sessionId);
      existing.traceId = normalizeId(traceId);
      return touchRecord(existing, timestamp, ttlMs);
    }
    const state = {
      runId: normalizedRunId,
      sessionId: normalizeId(sessionId),
      traceId: normalizeId(traceId),
      memoryEngineGetIds: new Set(),
      injectedIds: [],
      reinforcementAllowedIds: [],
      createdAt: timestamp,
      lastTouchedAt: timestamp,
      expiresAt: timestamp + ttlMs,
    };
    turnStates.set(normalizedRunId, state);
    return state;
  }

  function getTurnState(runId) {
    const normalizedRunId = normalizeId(runId);
    if (!normalizedRunId) return null;
    const state = turnStates.get(normalizedRunId);
    if (!state) return null;
    return touchRecord(state, now(), ttlMs);
  }

  function recordMemoryEngineGet({ runId, memoryId } = {}) {
    const state = getTurnState(runId);
    const shortId = normalizeShortMemoryId(memoryId);
    if (!state || !shortId) return false;
    state.memoryEngineGetIds.add(shortId);
    touchRecord(state, now(), ttlMs);
    return true;
  }

  function updateTurnRecallState({
    runId,
    injectedIds = [],
    reinforcementAllowedIds = [],
    traceId = null,
    sessionId = null,
  } = {}) {
    const state = createTurnState({ runId, sessionId, traceId });
    if (!state) return null;
    state.injectedIds = uniqueShortIds(injectedIds);
    state.reinforcementAllowedIds = uniqueShortIds(reinforcementAllowedIds);
    if (traceId !== null) state.traceId = normalizeId(traceId);
    if (sessionId !== null) state.sessionId = normalizeId(sessionId);
    return touchRecord(state, now(), ttlMs);
  }

  function getTurnStateBySession(sessionId) {
    const normalizedSessionId = normalizeId(sessionId);
    if (!normalizedSessionId) return null;
    const timestamp = now();
    let latest = null;
    for (const state of turnStates.values()) {
      if (Number(state.expiresAt || 0) <= timestamp) continue;
      if (state.sessionId !== normalizedSessionId) continue;
      if (!latest || Number(state.lastTouchedAt || 0) > Number(latest.lastTouchedAt || 0)) {
        latest = state;
      }
    }
    if (!latest) return null;
    return touchRecord(latest, timestamp, ttlMs);
  }

  function deleteTurnState(runId) {
    const normalizedRunId = normalizeId(runId);
    if (!normalizedRunId) return false;
    return turnStates.delete(normalizedRunId);
  }

  function recordToolInvocationScope({ toolCallId, runId, sessionId = null } = {}) {
    const normalizedToolCallId = normalizeId(toolCallId);
    const normalizedRunId = normalizeId(runId);
    if (!normalizedToolCallId || !normalizedRunId) return null;
    const timestamp = now();
    const scope = {
      toolCallId: normalizedToolCallId,
      runId: normalizedRunId,
      sessionId: normalizeId(sessionId),
      createdAt: timestamp,
      lastTouchedAt: timestamp,
      expiresAt: timestamp + ttlMs,
    };
    toolInvocationScopes.set(normalizedToolCallId, scope);
    return scope;
  }

  function getToolInvocationScope(toolCallId) {
    const normalizedToolCallId = normalizeId(toolCallId);
    if (!normalizedToolCallId) return null;
    const scope = toolInvocationScopes.get(normalizedToolCallId);
    if (!scope) return null;
    return touchRecord(scope, now(), ttlMs);
  }

  function deleteToolInvocationScope(toolCallId) {
    const normalizedToolCallId = normalizeId(toolCallId);
    if (!normalizedToolCallId) return false;
    return toolInvocationScopes.delete(normalizedToolCallId);
  }

  function deleteToolInvocationScopesByRunId(runId) {
    const normalizedRunId = normalizeId(runId);
    if (!normalizedRunId) return 0;
    let deleted = 0;
    for (const [toolCallId, scope] of toolInvocationScopes.entries()) {
      if (scope.runId !== normalizedRunId) continue;
      toolInvocationScopes.delete(toolCallId);
      deleted += 1;
    }
    return deleted;
  }

  function cleanupExpired(targetNow = now()) {
    let deletedTurnStates = 0;
    let deletedToolInvocationScopes = 0;
    for (const [runId, state] of turnStates.entries()) {
      if (Number(state.expiresAt || 0) > targetNow) continue;
      turnStates.delete(runId);
      deletedTurnStates += 1;
    }
    for (const [toolCallId, scope] of toolInvocationScopes.entries()) {
      if (Number(scope.expiresAt || 0) > targetNow) continue;
      toolInvocationScopes.delete(toolCallId);
      deletedToolInvocationScopes += 1;
    }
    return {
      deletedTurnStates,
      deletedToolInvocationScopes,
    };
  }

  return {
    ttlMs,
    createTurnState,
    getTurnState,
    getTurnStateBySession,
    updateTurnRecallState,
    recordMemoryEngineGet,
    deleteTurnState,
    recordToolInvocationScope,
    getToolInvocationScope,
    deleteToolInvocationScope,
    deleteToolInvocationScopesByRunId,
    cleanupExpired,
  };
}

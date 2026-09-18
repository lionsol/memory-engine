export const RECALL_HINT_RUNTIME_VECTOR_MODES = Object.freeze(["sequential", "parallel"]);

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSessionIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeString).filter(Boolean);
}

function contextSessionId(context) {
  return normalizeString(
    context?.sessionIdentity
    ?? context?.sessionId
    ?? context?.session_id
    ?? null,
  );
}

function baseDecision(overrides = {}) {
  return Object.freeze({
    enabled: false,
    in_scope: false,
    provider_allowed: false,
    vector_execution_mode: "sequential",
    reason: "disabled",
    session_id_present: false,
    ...overrides,
  });
}

export function evaluateRecallHintRuntimeCanaryV1({
  runtimeContext = null,
  config = null,
} = {}) {
  const source = config && typeof config === "object" && !Array.isArray(config)
    ? config
    : {};
  const requestedMode = normalizeString(source.vectorExecutionMode) || "sequential";
  if (!RECALL_HINT_RUNTIME_VECTOR_MODES.includes(requestedMode)) {
    return baseDecision({ reason: "invalid_vector_execution_mode" });
  }
  if (source.enabled !== true) {
    return baseDecision({
      vector_execution_mode: requestedMode,
      reason: "disabled",
    });
  }

  const sessionIds = normalizeSessionIds(source.sessionIds);
  if (sessionIds.length === 0) {
    return baseDecision({
      vector_execution_mode: requestedMode,
      reason: "empty_session_allowlist",
    });
  }

  if (!runtimeContext || runtimeContext.source !== "openclaw_runtime") {
    return baseDecision({
      vector_execution_mode: requestedMode,
      reason: "trusted_runtime_context_missing",
    });
  }

  const sessionId = contextSessionId(runtimeContext);
  if (!sessionId) {
    return baseDecision({
      vector_execution_mode: requestedMode,
      reason: "trusted_session_missing",
    });
  }
  if (!sessionIds.includes(sessionId)) {
    return baseDecision({
      vector_execution_mode: requestedMode,
      reason: "session_not_allowlisted",
      session_id_present: true,
    });
  }

  return baseDecision({
    enabled: true,
    in_scope: true,
    provider_allowed: true,
    vector_execution_mode: requestedMode,
    reason: "session_allowlisted",
    session_id_present: true,
  });
}

export function sanitizeRecallHintRuntimeContextV1(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.source !== "openclaw_runtime") return null;
  return Object.freeze({
    source: "openclaw_runtime",
    sessionIdentity: contextSessionId(value),
    requestIdentity: normalizeString(value.requestIdentity ?? value.toolCallId ?? null),
    runIdentity: normalizeString(value.runIdentity ?? value.runId ?? null),
  });
}

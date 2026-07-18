export const RECENT_FAIL_CLOSED_ALLOWED_MODES = Object.freeze([
  "legacy_fallback",
  "shadow_fail_closed",
  "fail_closed_canary",
]);

export const RECENT_FAIL_CLOSED_DEFAULT_MODE = "legacy_fallback";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAllowlist(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeString).filter(Boolean);
}

function contextValue(context, names) {
  for (const name of names) {
    const value = normalizeString(context?.[name]);
    if (value) return value;
  }
  return null;
}

function baseDecision(overrides = {}) {
  return {
    requested_mode: RECENT_FAIL_CLOSED_DEFAULT_MODE,
    mode: RECENT_FAIL_CLOSED_DEFAULT_MODE,
    eligible: false,
    in_scope: false,
    reason: "mode_not_canary",
    ...overrides,
  };
}

export function evaluateRecentFailClosedPolicy({
  runtimeContext = null,
  config = null,
} = {}) {
  const requestedMode = normalizeString(config?.mode) || RECENT_FAIL_CLOSED_DEFAULT_MODE;
  if (!RECENT_FAIL_CLOSED_ALLOWED_MODES.includes(requestedMode)) {
    return baseDecision({
      requested_mode: requestedMode,
      reason: "mode_not_allowed",
    });
  }

  if (requestedMode !== "fail_closed_canary") {
    return baseDecision({
      requested_mode: requestedMode,
      mode: requestedMode,
    });
  }

  const canary = config?.canary;
  if (!canary || typeof canary !== "object" || canary.enabled !== true) {
    return baseDecision({
      requested_mode: requestedMode,
      reason: "canary_disabled",
    });
  }

  if (runtimeContext?.source !== "openclaw_runtime") {
    return baseDecision({
      requested_mode: requestedMode,
      reason: "untrusted_runtime_context",
    });
  }

  const agentIds = normalizeAllowlist(canary.agentIds ?? canary.agents);
  const sessionIds = normalizeAllowlist(canary.sessionIds ?? canary.sessions);
  const canaryTokens = normalizeAllowlist(canary.tokens ?? canary.tokenAllowlist ?? canary.token);
  if (agentIds.length === 0 && sessionIds.length === 0 && canaryTokens.length === 0) {
    return baseDecision({
      requested_mode: requestedMode,
      reason: "scope_insufficient",
    });
  }

  const agentId = contextValue(runtimeContext, ["agent_id", "agentId", "agentIdentity"]);
  const sessionId = contextValue(runtimeContext, ["session_id", "sessionId", "sessionIdentity"]);
  const canaryToken = contextValue(runtimeContext, ["canary_token", "canaryToken", "runtimeCanaryToken"]);
  const agentMatches = agentIds.length === 0 || agentIds.includes(agentId);
  const sessionMatches = sessionIds.length === 0 || sessionIds.includes(sessionId);
  const tokenMatches = canaryTokens.length === 0 || canaryTokens.includes(canaryToken);
  if (!agentMatches || !sessionMatches || !tokenMatches) {
    return baseDecision({
      requested_mode: requestedMode,
      reason: "scope_mismatch",
    });
  }

  return {
    requested_mode: requestedMode,
    mode: "fail_closed_canary",
    eligible: true,
    in_scope: true,
    reason: "scope_match",
  };
}

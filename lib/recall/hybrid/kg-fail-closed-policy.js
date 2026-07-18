export const KG_FAIL_CLOSED_ALLOWED_MODES = Object.freeze([
  "legacy_fallback",
  "shadow_fail_closed",
  "fail_closed_canary",
]);

export const KG_FAIL_CLOSED_DEFAULT_MODE = "legacy_fallback";

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

export function resolveKgFailClosedDecision({
  mode = KG_FAIL_CLOSED_DEFAULT_MODE,
  canary = null,
  context = null,
} = {}) {
  const requestedMode = normalizeString(mode) || KG_FAIL_CLOSED_DEFAULT_MODE;
  if (!KG_FAIL_CLOSED_ALLOWED_MODES.includes(requestedMode)) {
    return {
      requested_mode: requestedMode,
      mode: KG_FAIL_CLOSED_DEFAULT_MODE,
      enabled: false,
      in_scope: false,
      reason: "mode_not_allowed",
    };
  }

  if (requestedMode !== "fail_closed_canary") {
    return {
      requested_mode: requestedMode,
      mode: requestedMode,
      enabled: false,
      in_scope: false,
      reason: "mode_not_canary",
    };
  }

  if (!canary || typeof canary !== "object" || canary.enabled !== true) {
    return {
      requested_mode: requestedMode,
      mode: KG_FAIL_CLOSED_DEFAULT_MODE,
      enabled: false,
      in_scope: false,
      reason: "canary_disabled",
    };
  }

  if (context?.source !== "openclaw_runtime") {
    return {
      requested_mode: requestedMode,
      mode: KG_FAIL_CLOSED_DEFAULT_MODE,
      enabled: false,
      in_scope: false,
      reason: "untrusted_runtime_context",
    };
  }

  const agentIds = normalizeAllowlist(canary.agentIds ?? canary.agents);
  const sessionIds = normalizeAllowlist(canary.sessionIds ?? canary.sessions);
  if (agentIds.length === 0 && sessionIds.length === 0) {
    return {
      requested_mode: requestedMode,
      mode: KG_FAIL_CLOSED_DEFAULT_MODE,
      enabled: false,
      in_scope: false,
      reason: "scope_insufficient",
    };
  }

  const agentId = contextValue(context, ["agentIdentity", "agentId"]);
  const sessionId = contextValue(context, ["sessionIdentity", "sessionId"]);
  const agentMatches = agentIds.length === 0 || agentIds.includes(agentId);
  const sessionMatches = sessionIds.length === 0 || sessionIds.includes(sessionId);
  if (!agentMatches || !sessionMatches) {
    return {
      requested_mode: requestedMode,
      mode: KG_FAIL_CLOSED_DEFAULT_MODE,
      enabled: false,
      in_scope: false,
      reason: "scope_mismatch",
    };
  }

  return {
    requested_mode: requestedMode,
    mode: "fail_closed_canary",
    enabled: true,
    in_scope: true,
    reason: "scope_match",
  };
}

export const KG_FAIL_CLOSED_ALLOWED_MODES = Object.freeze([
  "legacy_fallback",
  "shadow_fail_closed",
  "fail_closed_canary",
  "full_fail_closed",
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
      eligible: false,
      in_scope: false,
      scope_required: false,
      rollout_scope: "none",
      fallback_behavior: "enabled",
      reason: "invalid_mode_fallback_to_legacy",
    };
  }

  if (requestedMode === "full_fail_closed") {
    return {
      requested_mode: requestedMode,
      mode: requestedMode,
      enabled: true,
      eligible: true,
      in_scope: true,
      scope_required: false,
      rollout_scope: "full",
      fallback_behavior: "suppressed",
      reason: "full_rollout",
    };
  }

  if (requestedMode !== "fail_closed_canary") {
    const isShadow = requestedMode === "shadow_fail_closed";
    return {
      requested_mode: requestedMode,
      mode: requestedMode,
      enabled: false,
      eligible: false,
      in_scope: false,
      scope_required: false,
      rollout_scope: isShadow ? "shadow" : "none",
      fallback_behavior: isShadow ? "shadow_only" : "enabled",
      reason: "mode_not_canary",
    };
  }

  if (!canary || typeof canary !== "object" || canary.enabled !== true) {
    return {
      requested_mode: requestedMode,
      mode: KG_FAIL_CLOSED_DEFAULT_MODE,
      enabled: false,
      eligible: false,
      in_scope: false,
      scope_required: true,
      rollout_scope: "scoped_canary",
      fallback_behavior: "enabled",
      reason: "canary_disabled",
    };
  }

  if (context?.source !== "openclaw_runtime") {
    return {
      requested_mode: requestedMode,
      mode: KG_FAIL_CLOSED_DEFAULT_MODE,
      enabled: false,
      eligible: false,
      in_scope: false,
      scope_required: true,
      rollout_scope: "scoped_canary",
      fallback_behavior: "enabled",
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
      eligible: false,
      in_scope: false,
      scope_required: true,
      rollout_scope: "scoped_canary",
      fallback_behavior: "enabled",
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
      eligible: false,
      in_scope: false,
      scope_required: true,
      rollout_scope: "scoped_canary",
      fallback_behavior: "enabled",
      reason: "scope_mismatch",
    };
  }

  return {
    requested_mode: requestedMode,
    mode: "fail_closed_canary",
    enabled: true,
    eligible: true,
    in_scope: true,
    scope_required: true,
    rollout_scope: "scoped_canary",
    fallback_behavior: "suppressed",
    reason: "scope_match",
  };
}

export const TRAFFIC_ORIGIN_SCHEMA_VERSION = 1;

export const TRAFFIC_ORIGINS = Object.freeze([
  "natural_user_turn",
  "natural_agent_tool_call",
  "operator_verification_probe",
  "scheduled_healthcheck",
  "unknown",
]);

const ORIGIN_SET = new Set(TRAFFIC_ORIGINS);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readString(context, names) {
  for (const name of names) {
    const value = nonEmptyString(context?.[name]);
    if (value) return value;
  }
  return null;
}

function baseEvidence(context, source = "trusted_runtime_context") {
  return {
    source,
    agent_id_present: Boolean(readString(context, ["agentId", "agent_id", "agentIdentity"])),
    run_id_present: Boolean(readString(context, ["runId", "run_id", "requestIdentity"])),
    session_id_present: Boolean(readString(context, ["sessionId", "session_id", "sessionIdentity"])),
    trigger: readString(context, ["trigger"]),
  };
}

function result(origin, context, reasons = [], source = "trusted_runtime_context") {
  return {
    schema_version: TRAFFIC_ORIGIN_SCHEMA_VERSION,
    origin,
    evidence: baseEvidence(context, source),
    valid: origin !== "unknown" && reasons.length === 0,
    reasons: [...new Set(reasons)],
  };
}

function hasTurnIdentity(context) {
  return Boolean(
    readString(context, ["agentId", "agent_id", "agentIdentity"])
    && readString(context, ["runId", "run_id", "requestIdentity"])
    && readString(context, ["sessionId", "session_id", "sessionIdentity"]),
  );
}

function trustedContext(...values) {
  return values.find(value => isObject(value) && value.source === "openclaw_runtime") || null;
}

export function resolveHybridTrafficOrigin({
  surface,
  trustedRuntimeContext = null,
  hookContext = null,
  invocationContext = null,
} = {}) {
  const context = trustedContext(trustedRuntimeContext, hookContext, invocationContext);
  if (!context) return result("unknown", null, ["missing_trusted_context"], "untrusted_context");

  const normalizedSurface = nonEmptyString(surface) || "unknown";
  const trigger = readString(context, ["trigger"]);
  if (normalizedSurface === "auto_recall") {
    if (trigger !== "user") return result("unknown", context, ["non_user_trigger"]);
    if (!hasTurnIdentity(context)) return result("unknown", context, ["missing_turn_identity"]);
    return result("natural_user_turn", context);
  }

  if (![
    "memory_engine_search",
    "memory_engine_action_search",
  ].includes(normalizedSurface)) {
    return result("unknown", context, ["unsupported_surface"]);
  }

  const trustedHint = readString(context, [
    "trafficOrigin",
    "traffic_origin",
    "toolExecutionSource",
    "tool_execution_source",
    "invocationSource",
    "invocation_source",
  ]);
  if (trustedHint === "operator_verification_probe" || trustedHint === "probe") {
    return result("operator_verification_probe", context);
  }
  if (trustedHint === "scheduled_healthcheck" || trustedHint === "healthcheck") {
    return result("scheduled_healthcheck", context);
  }
  if (["natural_agent_tool_call", "agent_turn", "model_selected"].includes(trustedHint)) {
    if (trigger !== "user") return result("unknown", context, ["non_user_trigger"]);
    if (!hasTurnIdentity(context)) return result("unknown", context, ["missing_turn_identity"]);
    return result("natural_agent_tool_call", context);
  }

  return result("unknown", context, ["tool_origin_not_observable"]);
}

export function isTrafficOrigin(value) {
  return typeof value === "string" && ORIGIN_SET.has(value);
}

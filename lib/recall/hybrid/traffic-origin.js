export const TRAFFIC_ORIGIN_SCHEMA_VERSION = 1;

export const TRAFFIC_ORIGINS = Object.freeze([
  "natural_user_turn",
  "natural_agent_tool_call",
  "operator_verification_probe",
  "scheduled_healthcheck",
  "unknown",
]);

const ORIGIN_SET = new Set(TRAFFIC_ORIGINS);
const TOOL_SURFACES = new Set([
  "memory_engine_search",
  "memory_engine_action_search",
]);
const TRUSTED_SOURCES = new Set([
  "openclaw_runtime",
  "before_prompt_build",
  "before_tool_call",
  "scheduled_healthcheck_wrapper",
]);
const DEFAULT_REGISTRY_MAX_ENTRIES = 1024;
const DEFAULT_REGISTRY_TTL_MS = 5 * 60 * 1000;

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

function readAgentId(context) {
  return readString(context, ["agentId", "agent_id", "agentIdentity"]);
}

function readRunId(context) {
  return readString(context, ["runId", "run_id", "requestIdentity"]);
}

function readSessionId(context) {
  return readString(context, ["sessionId", "session_id", "sessionIdentity", "sessionKey"]);
}

function readToolCallId(context) {
  return readString(context, ["toolCallId", "tool_call_id"]);
}

function baseEvidence(context, source, extras = {}) {
  return {
    source,
    agent_id_present: Boolean(readAgentId(context)),
    run_id_present: Boolean(readRunId(context)),
    session_id_present: Boolean(readSessionId(context)),
    tool_call_id_present: Boolean(readToolCallId(context)),
    trigger: source === "before_prompt_build" ? readString(context, ["trigger"]) : null,
    ...extras,
  };
}

function result(origin, context, reasons = [], source = "untrusted_context", evidence = null) {
  const uniqueReasons = [...new Set(reasons)];
  return {
    schema_version: TRAFFIC_ORIGIN_SCHEMA_VERSION,
    origin,
    evidence: evidence || baseEvidence(context, source),
    valid: origin !== "unknown" && uniqueReasons.length === 0,
    reasons: uniqueReasons,
  };
}

function hasTurnIdentity(context) {
  return Boolean(readAgentId(context) && readRunId(context) && readSessionId(context));
}

function trustedContext(...values) {
  return values.find(value => isObject(value) && TRUSTED_SOURCES.has(value.source)) || null;
}

function toolTransport(toolCallId) {
  if (toolCallId.startsWith("http-")) return "http";
  if (toolCallId.startsWith("rpc-")) return "rpc";
  return null;
}

export function validateHybridTrafficOriginEvidence({
  surface,
  origin,
  evidence,
  valid,
  reasons,
} = {}) {
  const issues = [];
  const evidenceShape = isObject(evidence)
    && typeof evidence.source === "string"
    && typeof evidence.agent_id_present === "boolean"
    && typeof evidence.run_id_present === "boolean"
    && typeof evidence.session_id_present === "boolean"
    && typeof evidence.tool_call_id_present === "boolean";
  if (!evidenceShape) issues.push("origin_evidence_shape_invalid");
  if (valid !== true) issues.push("origin_evidence_mismatch");
  if (!Array.isArray(reasons) || reasons.length > 0) issues.push("origin_evidence_mismatch");
  if (!ORIGIN_SET.has(origin)) issues.push("invalid_traffic_origin");
  if (origin === "natural_user_turn") {
    if (surface !== "auto_recall"
      || !evidenceShape
      || evidence.source !== "before_prompt_build"
      || evidence.agent_id_present !== true
      || evidence.run_id_present !== true
      || evidence.session_id_present !== true
      || evidence.trigger !== "user") {
      issues.push("origin_evidence_mismatch");
    }
  }
  if (origin === "natural_agent_tool_call") {
    if (!TOOL_SURFACES.has(surface)
      || !evidenceShape
      || evidence.source !== "before_tool_call_agent"
      || evidence.agent_id_present !== true
      || evidence.run_id_present !== true
      || evidence.session_id_present !== true
      || evidence.tool_call_id_present !== true) {
      issues.push("origin_evidence_mismatch");
    }
  }
  if (origin === "operator_verification_probe") {
    if (!TOOL_SURFACES.has(surface)
      || !evidenceShape
      || evidence.source !== "gateway_tools_invoke"
      || evidence.run_id_present !== false
      || !["http", "rpc"].includes(evidence.tool_call_transport)) {
      issues.push("origin_evidence_mismatch");
    }
  }
  if (origin === "scheduled_healthcheck") {
    if (!TOOL_SURFACES.has(surface)
      || !evidenceShape
      || evidence.source !== "scheduled_healthcheck_wrapper"
      || evidence.agent_id_present !== true
      || evidence.session_id_present !== true
      || evidence.tool_call_id_present !== true
      || evidence.run_id_present !== false) {
      issues.push("origin_evidence_mismatch");
    }
  }
  if (origin === "unknown") issues.push("unknown_traffic_origin");
  return { valid: issues.length === 0, reasons: [...new Set(issues)] };
}

function resolveToolOrigin(context) {
  const source = context.source;
  const toolCallId = readToolCallId(context);
  const agentId = readAgentId(context);
  const sessionId = readSessionId(context);
  const runId = readRunId(context);
  const common = {
    source: "before_tool_call_agent",
    agent_id_present: Boolean(agentId),
    run_id_present: Boolean(runId),
    session_id_present: Boolean(sessionId),
    tool_call_id_present: Boolean(toolCallId),
    trigger: null,
  };

  if (context.registry_reason) {
    return result("unknown", context, [context.registry_reason], context.source, common);
  }

  if (source === "scheduled_healthcheck_wrapper") {
    return result(
      "scheduled_healthcheck",
      context,
      agentId && sessionId && toolCallId ? [] : ["invalid_healthcheck_context"],
      "scheduled_healthcheck_wrapper",
      baseEvidence(context, "scheduled_healthcheck_wrapper"),
    );
  }

  if (source !== "before_tool_call") {
    return result("unknown", context, ["untrusted_tool_context"], "untrusted_context", common);
  }
  if (!toolCallId) return result("unknown", context, ["missing_tool_call_id"], "before_tool_call", common);
  if (agentId && runId && sessionId) {
    return result("natural_agent_tool_call", context, [], "before_tool_call_agent", common);
  }
  const transport = toolTransport(toolCallId);
  if (!runId && agentId && sessionId && transport) {
    return result(
      "operator_verification_probe",
      context,
      [],
      "gateway_tools_invoke",
      baseEvidence(context, "gateway_tools_invoke", { tool_call_transport: transport }),
    );
  }
  return result("unknown", context, ["ambiguous_tool_origin"], "before_tool_call", common);
}

export function resolveHybridTrafficOrigin({
  surface,
  trustedRuntimeContext = null,
  hookContext = null,
  invocationContext = null,
} = {}) {
  const context = trustedContext(trustedRuntimeContext, hookContext, invocationContext);
  if (!context) return result("unknown", null, ["missing_trusted_context"]);

  const normalizedSurface = nonEmptyString(surface) || "unknown";
  if (normalizedSurface === "auto_recall") {
    const trigger = readString(context, ["trigger"]);
    const evidence = baseEvidence(context, "before_prompt_build");
    if (trigger !== "user") return result("unknown", context, ["non_user_trigger"], "before_prompt_build", evidence);
    if (!hasTurnIdentity(context)) return result("unknown", context, ["missing_turn_identity"], "before_prompt_build", evidence);
    return result("natural_user_turn", context, [], "before_prompt_build", evidence);
  }
  if (!TOOL_SURFACES.has(normalizedSurface)) {
    return result("unknown", context, ["unsupported_surface"]);
  }
  return resolveToolOrigin(context);
}

export function createHybridTrafficOriginRegistry({
  maxEntries = DEFAULT_REGISTRY_MAX_ENTRIES,
  ttlMs = DEFAULT_REGISTRY_TTL_MS,
  now = () => Date.now(),
} = {}) {
  const entries = new Map();

  function cleanup(currentTime = now()) {
    for (const [toolCallId, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(toolCallId);
    }
  }

  function recordContext(toolCallId, context) {
    cleanup();
    const previous = entries.get(toolCallId);
    const nextContext = {
      ...context,
      registry_reason: previous ? "tool_call_id_collision" : null,
    };
    if (entries.size >= maxEntries && !entries.has(toolCallId)) {
      entries.delete(entries.keys().next().value);
    }
    entries.set(toolCallId, { context: nextContext, expiresAt: now() + ttlMs });
  }

  return {
    recordBeforeToolCall({ event = {}, ctx = {}, surface = null } = {}) {
      const toolCallId = nonEmptyString(event.toolCallId || ctx.toolCallId);
      if (!toolCallId) return false;
      recordContext(toolCallId, {
        source: "before_tool_call",
        surface,
        agentId: ctx.agentId ?? null,
        runId: ctx.runId ?? event.runId ?? null,
        sessionId: ctx.sessionId ?? ctx.sessionKey ?? null,
        toolCallId,
      });
      return true;
    },

    recordScheduledHealthcheck({ toolCallId, agentId = null, sessionId = null, surface = null } = {}) {
      const normalizedId = nonEmptyString(toolCallId);
      if (!normalizedId) return false;
      recordContext(normalizedId, {
        source: "scheduled_healthcheck_wrapper",
        surface,
        agentId,
        sessionId,
        toolCallId: normalizedId,
      });
      return true;
    },

    consume(toolCallId, surface = null) {
      cleanup();
      const normalizedId = nonEmptyString(toolCallId);
      if (!normalizedId) return null;
      const entry = entries.get(normalizedId);
      entries.delete(normalizedId);
      if (!entry || (entry.context.surface && surface && entry.context.surface !== surface)) return null;
      return entry.context;
    },

    size() {
      cleanup();
      return entries.size;
    },
  };
}

export function isTrafficOrigin(value) {
  return typeof value === "string" && ORIGIN_SET.has(value);
}

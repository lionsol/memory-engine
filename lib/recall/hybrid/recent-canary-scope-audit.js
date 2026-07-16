import { createHash } from "node:crypto";

export const TRUST_CLASSES = Object.freeze([
  "trusted_framework_context",
  "framework_derived_but_ambiguous",
  "user_controlled",
  "locally_synthesized",
  "unavailable",
  "unknown",
]);

export const DECISION_CLASSES = Object.freeze([
  "pass_trusted_scope_feasibility",
  "partial_scope_feasibility",
  "inconclusive",
  "no_trusted_scope_available",
]);

export const CURRENT_SCOPE_INVENTORY = Object.freeze({
  available_at_plugin_entry: [
    "toolCallId",
    "params.action",
    "params.query_or_text",
  ],
  available_at_hybrid_search: [
    "runtime.recentCanaryContext (optional internal DI only)",
  ],
  available_at_recent_channel: [
    "resolved recentCanaryDecision",
  ],
  missing_fields: [
    "trusted agent identity on current tool path",
    "trusted chat type on current tool path",
    "trusted conversation/session identity on current tool path",
    "trusted request/turn identity on current tool path",
    "trusted plugin runtime scope context on current tool path",
  ],
});

function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizeBoolean(value, fallback = false) {
  return value === undefined ? fallback : value === true;
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map(entry => String(entry || "").trim()).filter(Boolean)
    : [];
}

export function buildFieldAssessment(field) {
  const trustClass = TRUST_CLASSES.includes(field?.trust_class)
    ? field.trust_class
    : "unknown";
  return {
    field: String(field?.field || "").trim(),
    available_at: normalizeStringArray(field?.available_at),
    source: String(field?.source || "unknown").trim() || "unknown",
    trust_class: trustClass,
    user_controllable: normalizeBoolean(field?.user_controllable),
    stable_within_session: normalizeBoolean(field?.stable_within_session),
    stable_across_sessions: normalizeBoolean(field?.stable_across_sessions),
    suitable_for_scope: normalizeBoolean(field?.suitable_for_scope),
    suitable_for_sample_key: normalizeBoolean(field?.suitable_for_sample_key),
    reachable_from_memory_engine_tool_path: normalizeBoolean(field?.reachable_from_memory_engine_tool_path),
    evidence: normalizeStringArray(field?.evidence),
  };
}

export function sanitizeRuntimeProbe(report = null) {
  if (!report || typeof report !== "object") {
    return {
      verified: false,
      handler_argument_count: null,
      context_present: null,
      fields: [],
      reason: "not_run",
    };
  }

  const handlerArgumentCount = Number.isInteger(report.handler_argument_count)
    ? report.handler_argument_count
    : null;
  const fields = Array.isArray(report.fields)
    ? report.fields.map((field) => {
      const value = field?.value;
      const present = field?.present === true || value !== undefined;
      const type = present
        ? (field?.type ? String(field.type) : typeof value)
        : null;
      const length = typeof field?.length === "number"
        ? field.length
        : typeof value === "string"
          ? value.length
          : null;
      return {
        name: String(field?.name || "").trim(),
        present,
        type,
        length: Number.isInteger(length) && length >= 0 ? length : null,
        hash: present && value !== undefined ? sha256Hex(value) : null,
        user_controllable: field?.user_controllable === true,
      };
    })
    : [];

  return {
    verified: report.verified === true,
    handler_argument_count: handlerArgumentCount,
    context_present: report.context_present === true,
    fields,
    reason: report.verified === true ? null : String(report.reason || "not_run"),
  };
}

function classifyDecision(fields) {
  const reachable = fields.filter(field => field.reachable_from_memory_engine_tool_path);
  const trustedScope = reachable.filter(field => field.trust_class === "trusted_framework_context" && field.suitable_for_scope);
  const trustedSample = reachable.filter(field => field.trust_class === "trusted_framework_context" && field.suitable_for_sample_key);
  const ambiguousSample = reachable.filter(field => field.suitable_for_sample_key && field.trust_class === "framework_derived_but_ambiguous");
  const unknownReachable = reachable.filter(field => field.trust_class === "unknown");

  if (trustedScope.length > 0 && trustedSample.length > 0) {
    return {
      class: "pass_trusted_scope_feasibility",
      reason: "trusted_scope_and_sample_key_available",
    };
  }
  if (trustedScope.length > 0 || trustedSample.length > 0) {
    return {
      class: "partial_scope_feasibility",
      reason: "only_partial_trusted_scope_available",
    };
  }
  if (unknownReachable.length > 0) {
    return {
      class: "inconclusive",
      reason: "reachable_fields_have_unknown_semantics",
    };
  }
  if (ambiguousSample.length > 0) {
    return {
      class: "no_trusted_scope_available",
      reason: "only_ambiguous_request_identity_available",
    };
  }
  return {
    class: "no_trusted_scope_available",
    reason: "tool_path_lacks_trusted_scope_fields",
  };
}

function recommendMapping(fields) {
  const reachableTrustedScope = fields.find(field => field.reachable_from_memory_engine_tool_path && field.trust_class === "trusted_framework_context" && field.suitable_for_scope);
  const reachableTrustedSample = fields.find(field => field.reachable_from_memory_engine_tool_path && field.trust_class === "trusted_framework_context" && field.suitable_for_sample_key);
  if (!reachableTrustedScope || !reachableTrustedSample) {
    return {
      scope_class_source: null,
      sample_key_source: null,
      propagation_path: [],
    };
  }
  return {
    scope_class_source: reachableTrustedScope.field,
    sample_key_source: reachableTrustedSample.field,
    propagation_path: [
      "OpenClaw tool runtime",
      "memory-engine tool handler",
      "memory-engine-actions.js",
      "hybridSearch runtime.recentCanaryContext",
    ],
  };
}

export function buildRecentCanaryScopeAuditReport({
  openclaw_install = {},
  plugin_handler = {},
  scope_inventory = CURRENT_SCOPE_INVENTORY,
  fields = [],
  runtime_probe = null,
  static_evidence = [],
  resolve_recent_canary_context = {},
} = {}) {
  const normalizedFields = fields.map(buildFieldAssessment);
  const decision = classifyDecision(normalizedFields);
  return {
    audit: "recent_canary_trusted_scope_source",
    report_schema_version: 1,
    openclaw_install: {
      which_openclaw: openclaw_install.which_openclaw || null,
      resolved_entry: openclaw_install.resolved_entry || null,
      npm_global_root: openclaw_install.npm_global_root || null,
      package_name: openclaw_install.package_name || null,
      package_version: openclaw_install.package_version || null,
    },
    plugin_handler: {
      signature: plugin_handler.signature || "execute(toolCallId, params)",
      context_parameter_exposed: plugin_handler.context_parameter_exposed === true,
      current_memory_engine_signature: plugin_handler.current_memory_engine_signature || "(_toolCallId, params)",
      tool_context_fields_visible: normalizeStringArray(plugin_handler.tool_context_fields_visible),
    },
    scope_inventory: {
      available_at_plugin_entry: normalizeStringArray(scope_inventory.available_at_plugin_entry),
      available_at_hybrid_search: normalizeStringArray(scope_inventory.available_at_hybrid_search),
      available_at_recent_channel: normalizeStringArray(scope_inventory.available_at_recent_channel),
      missing_fields: normalizeStringArray(scope_inventory.missing_fields),
    },
    fields: normalizedFields,
    recommended_scope_mapping: recommendMapping(normalizedFields),
    resolve_recent_canary_context: {
      current_inputs: normalizeStringArray(resolve_recent_canary_context.current_inputs),
      default_returns_null: resolve_recent_canary_context.default_returns_null === true,
      risk: resolve_recent_canary_context.risk || "untrusted_inputs_reachable",
      recommended_future_signature: resolve_recent_canary_context.recommended_future_signature || "resolveRecentCanaryContext({ trustedRuntimeContext })",
    },
    static_evidence: normalizeStringArray(static_evidence),
    runtime_probe: sanitizeRuntimeProbe(runtime_probe),
    decision: {
      class: decision.class,
      reason: decision.reason,
    },
    recent_shadow_remains_disabled: true,
    sample_rate_basis_points: 0,
    production_enablement_recommended: false,
  };
}

export function buildCurrentRecentCanaryScopeAuditReport(overrides = {}) {
  return buildRecentCanaryScopeAuditReport({
    openclaw_install: overrides.openclaw_install,
    plugin_handler: {
      signature: "execute(toolCallId, params, signal, onUpdate, ctx)",
      context_parameter_exposed: true,
      current_memory_engine_signature: "(_toolCallId, params)",
      tool_context_fields_visible: [
        "ui",
        "hasUI",
        "cwd",
        "sessionManager",
        "modelRegistry",
        "model",
        "signal",
      ],
    },
    fields: [
      {
        field: "toolCallId",
        available_at: ["plugin_handler"],
        source: "openclaw_runtime",
        trust_class: "framework_derived_but_ambiguous",
        user_controllable: false,
        stable_within_session: false,
        stable_across_sessions: false,
        suitable_for_scope: false,
        suitable_for_sample_key: false,
        reachable_from_memory_engine_tool_path: true,
        evidence: [
          "OpenClaw ToolDefinition execute() receives toolCallId.",
          "Command dispatch generates cmd_<secure token>; model tool path forwards toolCall.id.",
        ],
      },
      {
        field: "params.action",
        available_at: ["plugin_handler"],
        source: "tool_parameters",
        trust_class: "user_controlled",
        user_controllable: true,
        stable_within_session: false,
        stable_across_sessions: false,
        suitable_for_scope: false,
        suitable_for_sample_key: false,
        reachable_from_memory_engine_tool_path: true,
        evidence: [
          "memory-engine action handler reads action from params.",
        ],
      },
      {
        field: "params.query_or_text",
        available_at: ["plugin_handler"],
        source: "tool_parameters",
        trust_class: "user_controlled",
        user_controllable: true,
        stable_within_session: false,
        stable_across_sessions: false,
        suitable_for_scope: false,
        suitable_for_sample_key: false,
        reachable_from_memory_engine_tool_path: true,
        evidence: [
          "memory-engine search path reads query/text from params.",
        ],
      },
      {
        field: "ctx.sessionId",
        available_at: ["plugin_handler"],
        source: "extension_context",
        trust_class: "unavailable",
        user_controllable: false,
        stable_within_session: false,
        stable_across_sessions: false,
        suitable_for_scope: false,
        suitable_for_sample_key: false,
        reachable_from_memory_engine_tool_path: true,
        evidence: [
          "OpenClaw ExtensionContext type and createContext() omit sessionId.",
        ],
      },
      {
        field: "ctx.agentId",
        available_at: ["plugin_handler"],
        source: "extension_context",
        trust_class: "unavailable",
        user_controllable: false,
        stable_within_session: false,
        stable_across_sessions: false,
        suitable_for_scope: false,
        suitable_for_sample_key: false,
        reachable_from_memory_engine_tool_path: true,
        evidence: [
          "OpenClaw ExtensionContext type and createContext() omit agentId.",
        ],
      },
      {
        field: "PluginCommandContext.sessionId",
        available_at: ["plugin_command"],
        source: "openclaw_runtime",
        trust_class: "trusted_framework_context",
        user_controllable: false,
        stable_within_session: true,
        stable_across_sessions: false,
        suitable_for_scope: false,
        suitable_for_sample_key: true,
        reachable_from_memory_engine_tool_path: false,
        evidence: [
          "PluginCommandContext exposes sessionId on command path only.",
        ],
      },
      {
        field: "PluginHookToolContext.agentId",
        available_at: ["before_tool_call_hook", "after_tool_call_hook"],
        source: "openclaw_runtime",
        trust_class: "trusted_framework_context",
        user_controllable: false,
        stable_within_session: true,
        stable_across_sessions: false,
        suitable_for_scope: true,
        suitable_for_sample_key: false,
        reachable_from_memory_engine_tool_path: false,
        evidence: [
          "PluginHookToolContext exposes agentId on hook path, not tool execute args.",
        ],
      },
      {
        field: "PluginHookToolContext.sessionId",
        available_at: ["before_tool_call_hook", "after_tool_call_hook"],
        source: "openclaw_runtime",
        trust_class: "trusted_framework_context",
        user_controllable: false,
        stable_within_session: true,
        stable_across_sessions: false,
        suitable_for_scope: false,
        suitable_for_sample_key: true,
        reachable_from_memory_engine_tool_path: false,
        evidence: [
          "PluginHookToolContext exposes sessionId on hook path, not tool execute args.",
        ],
      },
      {
        field: "PluginHookReplyUsageState.chatType",
        available_at: ["reply_payload_sending_hook"],
        source: "openclaw_runtime",
        trust_class: "trusted_framework_context",
        user_controllable: false,
        stable_within_session: true,
        stable_across_sessions: false,
        suitable_for_scope: false,
        suitable_for_sample_key: false,
        reachable_from_memory_engine_tool_path: false,
        evidence: [
          "Reply usage hook exposes chatType after reply path, not before recent retrieval.",
        ],
      },
    ],
    runtime_probe: overrides.runtime_probe,
    static_evidence: [
      "memory-engine tool handlers currently declare only (_toolCallId, params).",
      "createSearchRunner() passes toolCallId/action/params into resolveRecentCanaryContext when a resolver is injected.",
      "index.js does not inject recentCanaryProvider or resolveRecentCanaryContext in production wiring.",
      "OpenClaw ToolDefinition execute signature includes ctx, but ExtensionContext does not expose agent/session/request identity.",
      "OpenClaw command and hook surfaces expose richer scope fields than the tool execution surface.",
    ],
    resolve_recent_canary_context: {
      current_inputs: ["toolCallId", "action", "params"],
      default_returns_null: true,
      risk: "future resolver could accidentally derive scope from user-controlled params or query text",
      recommended_future_signature: "resolveRecentCanaryContext({ trustedRuntimeContext })",
    },
  });
}

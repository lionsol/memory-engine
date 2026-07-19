const DEFAULT_AUTO_RECALL = Object.freeze({
  enabled: false,
  topK: 3,
  timeoutMs: 8000,
  agentAllowlist: ["edi"],
  triggerAllowlist: ["user"],
  chatTypeAllowlist: ["interactive_user_chat"],
  messageRoleAllowlist: ["user"],
  cardFirstRuntime: { enabled: false },
});

const DEFAULT_CANARY = Object.freeze({
  enabled: false,
  agentIds: [],
  sessionIds: [],
  tokens: [],
});

const DEFAULT_EVIDENCE_WINDOW = Object.freeze({
  enabled: false,
  epochId: null,
});

const DEFAULT_MODES = Object.freeze({
  kgFailClosedMode: "legacy_fallback",
  recentFailClosedMode: "legacy_fallback",
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return [...value];
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function firstObject(...values) {
  return values.find(value => isObject(value)) || {};
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function normalizeStringArray(value, fallback, errors, field) {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) {
    errors.push(`invalid_array:${field}`);
    return [...fallback];
  }
  return value.map(item => item.trim());
}

function normalizeCanary(value, errors, field) {
  const source = value === undefined || value === null ? {} : value;
  if (!isObject(source)) {
    errors.push(`invalid_object:${field}`);
    return clone(DEFAULT_CANARY);
  }
  return {
    enabled: source.enabled === true,
    agentIds: normalizeStringArray(source.agentIds ?? source.agents, [], errors, `${field}.agentIds`),
    sessionIds: normalizeStringArray(source.sessionIds ?? source.sessions, [], errors, `${field}.sessionIds`),
    tokens: normalizeStringArray(
      source.tokens ?? source.tokenAllowlist,
      [],
      errors,
      `${field}.tokens`,
    ),
  };
}

const ALLOWED_MODES = new Set([
  "legacy_fallback",
  "shadow_fail_closed",
  "fail_closed_canary",
  "full_fail_closed",
]);

function normalizeMode(value, fallback, errors, field) {
  const mode = value === undefined || value === null ? fallback : value;
  if (typeof mode !== "string" || !ALLOWED_MODES.has(mode.trim())) {
    errors.push(`invalid_mode:${field}`);
    return fallback;
  }
  return mode.trim();
}

function normalizeAutoRecall(value, errors) {
  const source = value === undefined || value === null ? {} : value;
  if (!isObject(source)) {
    errors.push("invalid_object:autoRecall");
    return clone(DEFAULT_AUTO_RECALL);
  }
  const cardFirstRuntime = source.cardFirstRuntime === undefined || source.cardFirstRuntime === null
    ? clone(DEFAULT_AUTO_RECALL.cardFirstRuntime)
    : isObject(source.cardFirstRuntime)
      ? { enabled: source.cardFirstRuntime.enabled === true }
      : (errors.push("invalid_object:autoRecall.cardFirstRuntime"), clone(DEFAULT_AUTO_RECALL.cardFirstRuntime));
  return {
    enabled: source.enabled === undefined ? DEFAULT_AUTO_RECALL.enabled : source.enabled === true,
    topK: source.topK === undefined ? DEFAULT_AUTO_RECALL.topK : source.topK,
    timeoutMs: source.timeoutMs === undefined ? DEFAULT_AUTO_RECALL.timeoutMs : source.timeoutMs,
    agentAllowlist: normalizeStringArray(source.agentAllowlist ?? source.agent_allowlist, DEFAULT_AUTO_RECALL.agentAllowlist, errors, "autoRecall.agentAllowlist"),
    triggerAllowlist: normalizeStringArray(source.triggerAllowlist ?? source.trigger_allowlist, DEFAULT_AUTO_RECALL.triggerAllowlist, errors, "autoRecall.triggerAllowlist"),
    chatTypeAllowlist: normalizeStringArray(source.chatTypeAllowlist ?? source.chat_type_allowlist, DEFAULT_AUTO_RECALL.chatTypeAllowlist, errors, "autoRecall.chatTypeAllowlist"),
    messageRoleAllowlist: normalizeStringArray(source.messageRoleAllowlist ?? source.message_role_allowlist, DEFAULT_AUTO_RECALL.messageRoleAllowlist, errors, "autoRecall.messageRoleAllowlist"),
    cardFirstRuntime,
  };
}

function normalizeEvidenceWindow(value, errors) {
  const source = value === undefined || value === null ? {} : value;
  if (!isObject(source)) {
    errors.push("invalid_object:productionEvidenceWindow");
    return clone(DEFAULT_EVIDENCE_WINDOW);
  }
  if (source.epochId !== undefined && source.epochId !== null && (typeof source.epochId !== "string" || !source.epochId.trim())) {
    errors.push("invalid_string:productionEvidenceWindow.epochId");
  }
  return {
    enabled: source.enabled === true,
    epochId: typeof source.epochId === "string" && source.epochId.trim() ? source.epochId.trim() : null,
  };
}

export function resolveEffectiveHybridRuntimeConfig({
  pluginConfig,
  pluginEntryConfig,
  apiConfig,
} = {}) {
  const errors = [];
  const official = isObject(pluginConfig) ? pluginConfig : {};
  const entry = isObject(pluginEntryConfig) ? pluginEntryConfig : {};
  const global = isObject(apiConfig) ? apiConfig : {};
  const autoRecallSource = firstObject(official.autoRecall, entry.autoRecall, global.autoRecall);
  const autoRecall = normalizeAutoRecall(autoRecallSource, errors);

  const config = {
    autoRecall,
    kgFailClosedMode: normalizeMode(firstDefined(
      official.kgFailClosedMode,
      autoRecallSource.kgFailClosedMode,
      entry.kgFailClosedMode,
      global.kgFailClosedMode,
      DEFAULT_MODES.kgFailClosedMode,
    ), DEFAULT_MODES.kgFailClosedMode, errors, "kgFailClosedMode"),
    kgFailClosedCanary: normalizeCanary(firstDefined(
      official.kgFailClosedCanary,
      autoRecallSource.kgFailClosedCanary,
      entry.kgFailClosedCanary,
      global.kgFailClosedCanary,
    ), errors, "kgFailClosedCanary"),
    recentFailClosedMode: normalizeMode(firstDefined(
      official.recentFailClosedMode,
      autoRecallSource.recentFailClosedMode,
      entry.recentFailClosedMode,
      global.recentFailClosedMode,
      DEFAULT_MODES.recentFailClosedMode,
    ), DEFAULT_MODES.recentFailClosedMode, errors, "recentFailClosedMode"),
    recentFailClosedCanary: normalizeCanary(firstDefined(
      official.recentFailClosedCanary,
      autoRecallSource.recentFailClosedCanary,
      entry.recentFailClosedCanary,
      global.recentFailClosedCanary,
    ), errors, "recentFailClosedCanary"),
    productionEvidenceWindow: normalizeEvidenceWindow(firstDefined(
      official.productionEvidenceWindow,
      entry.productionEvidenceWindow,
      global.productionEvidenceWindow,
    ), errors),
  };
  return {
    ...config,
    valid: errors.length === 0,
    errors: [...new Set(errors)].sort(),
  };
}

export { DEFAULT_AUTO_RECALL, DEFAULT_CANARY, DEFAULT_EVIDENCE_WINDOW, DEFAULT_MODES };

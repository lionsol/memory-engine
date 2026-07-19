import { getMemoryEngineConfig } from "./runtime.js";

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

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function selectAutoRecallSource(values, errors) {
  for (const value of values) {
    if (value === undefined) continue;
    if (!isObject(value)) {
      errors.push("invalid_object:autoRecall");
      return {};
    }
    return value;
  }
  return {};
}

function normalizeStringArray(value, fallback, errors, field) {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) {
    errors.push(`invalid_array:${field}`);
    return [...fallback];
  }
  return value.map(item => item.trim());
}

function parseFiniteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeNumber(value, fallback, minimum, errors, field) {
  if (value === undefined || value === null) return Math.max(minimum, fallback);
  const parsed = parseFiniteNumber(value);
  if (parsed === null) {
    errors.push(`invalid_number:${field}`);
    return Math.max(minimum, fallback);
  }
  return Math.max(minimum, parsed);
}

function normalizeBoolean(value, fallback, errors, field) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") {
    errors.push(`invalid_boolean:${field}`);
    return fallback;
  }
  return value;
}

function normalizeCanary(value, errors, field, { allowSingleTokenAlias = false } = {}) {
  const source = value === undefined || value === null ? {} : value;
  if (!isObject(source)) {
    errors.push(`invalid_object:${field}`);
    return clone(DEFAULT_CANARY);
  }
  let tokenValue = source.tokens ?? source.tokenAllowlist;
  if (tokenValue === undefined && allowSingleTokenAlias && Object.hasOwn(source, "token")) {
    if (typeof source.token === "string") tokenValue = [source.token];
    else if (Array.isArray(source.token)) {
      errors.push(`invalid_array:${field}.tokens`);
      tokenValue = undefined;
    } else {
      tokenValue = source.token;
    }
  }
  return {
    enabled: normalizeBoolean(source.enabled, false, errors, `${field}.enabled`),
    agentIds: normalizeStringArray(source.agentIds ?? source.agents, [], errors, `${field}.agentIds`),
    sessionIds: normalizeStringArray(source.sessionIds ?? source.sessions, [], errors, `${field}.sessionIds`),
    tokens: normalizeStringArray(
      tokenValue,
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

function normalizeAutoRecall(value, memoryEngineConfig, errors) {
  const source = value === undefined || value === null ? {} : value;
  if (!isObject(source)) {
    errors.push("invalid_object:autoRecall");
    return {
      ...clone(DEFAULT_AUTO_RECALL),
      topK: normalizeNumber(memoryEngineConfig?.recall?.topK, 5, 1, errors, "memoryEngineConfig.recall.topK"),
    };
  }
  const cardFirstRuntime = source.cardFirstRuntime === undefined || source.cardFirstRuntime === null
    ? clone(DEFAULT_AUTO_RECALL.cardFirstRuntime)
    : isObject(source.cardFirstRuntime)
      ? { enabled: normalizeBoolean(source.cardFirstRuntime.enabled, false, errors, "autoRecall.cardFirstRuntime.enabled") }
      : (errors.push("invalid_object:autoRecall.cardFirstRuntime"), clone(DEFAULT_AUTO_RECALL.cardFirstRuntime));
  const memoryTopK = normalizeNumber(
    memoryEngineConfig?.recall?.topK,
    5,
    1,
    errors,
    "memoryEngineConfig.recall.topK",
  );
  return {
    enabled: normalizeBoolean(source.enabled, DEFAULT_AUTO_RECALL.enabled, errors, "autoRecall.enabled"),
    topK: normalizeNumber(source.topK, memoryTopK, 1, errors, "autoRecall.topK"),
    timeoutMs: normalizeNumber(source.timeoutMs, DEFAULT_AUTO_RECALL.timeoutMs, 1000, errors, "autoRecall.timeoutMs"),
    agentAllowlist: normalizeStringArray(source.agentAllowlist ?? source.agent_allowlist, DEFAULT_AUTO_RECALL.agentAllowlist, errors, "autoRecall.agentAllowlist"),
    triggerAllowlist: normalizeStringArray(source.triggerAllowlist ?? source.trigger_allowlist, DEFAULT_AUTO_RECALL.triggerAllowlist, errors, "autoRecall.triggerAllowlist"),
    chatTypeAllowlist: normalizeStringArray(source.chatTypeAllowlist ?? source.chat_type_allowlist, DEFAULT_AUTO_RECALL.chatTypeAllowlist, errors, "autoRecall.chatTypeAllowlist"),
    messageRoleAllowlist: normalizeStringArray(source.messageRoleAllowlist ?? source.message_role_allowlist, DEFAULT_AUTO_RECALL.messageRoleAllowlist, errors, "autoRecall.messageRoleAllowlist"),
    cardFirstRuntime,
    minConfidence: normalizeOptionalThreshold(source.minConfidence, errors, "autoRecall.minConfidence"),
    lexicalConfidenceThreshold: normalizeOptionalThreshold(source.lexicalConfidenceThreshold, errors, "autoRecall.lexicalConfidenceThreshold"),
  };
}

function normalizeOptionalThreshold(value, errors, field) {
  if (value === undefined || value === null) return null;
  const parsed = parseFiniteNumber(value);
  if (parsed === null) {
    errors.push(`invalid_number:${field}`);
    return null;
  }
  return Math.max(0, Math.min(1, parsed));
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
    enabled: normalizeBoolean(source.enabled, false, errors, "productionEvidenceWindow.enabled"),
    epochId: typeof source.epochId === "string" && source.epochId.trim() ? source.epochId.trim() : null,
  };
}

function readPath(source, path) {
  let value = source;
  for (const key of path) {
    if (!isObject(value)) return undefined;
    value = value[key];
  }
  return value;
}

function resolveEffectiveThreshold({
  apiConfig,
  memoryEngineConfig,
  configPaths,
  environmentName,
  fallback,
  minimum,
  maximum,
  engineValue,
  errors,
}) {
  const configured = firstDefined(...configPaths.map(path => readPath(apiConfig, path)));
  const environmentValue = process.env[environmentName];
  const source = configured !== undefined && configured !== null
    ? configured
    : environmentValue !== undefined
      ? environmentValue
      : engineValue;
  if (source === undefined || source === null) return fallback;
  const parsed = parseFiniteNumber(source);
  if (parsed === null) {
    if (errors) errors.push(`invalid_number:${environmentName}`);
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, parsed));
}

export function resolveEffectiveMinConfidence(apiConfig = {}, memoryEngineConfig = {}, errors = null) {
  return resolveEffectiveThreshold({
    apiConfig,
    memoryEngineConfig,
    configPaths: [["memory", "minConfidence"], ["autoRecall", "minConfidence"]],
    environmentName: "MEMORY_ENGINE_MIN_CONFIDENCE",
    fallback: 0.15,
    minimum: 0,
    maximum: 1,
    engineValue: memoryEngineConfig?.confidence?.min,
    errors,
  });
}

export function resolveEffectiveLexicalConfidenceThreshold(apiConfig = {}, memoryEngineConfig = {}, errors = null) {
  return resolveEffectiveThreshold({
    apiConfig,
    memoryEngineConfig,
    configPaths: [["memory", "autoRecallLexicalConfidenceThreshold"], ["autoRecall", "lexicalConfidenceThreshold"]],
    environmentName: "AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD",
    fallback: 0.7,
    minimum: 0,
    maximum: 1,
    engineValue: memoryEngineConfig?.recall?.lexicalConfidenceThreshold,
    errors,
  });
}

export function resolveEffectiveHybridRuntimeConfig({
  pluginConfig,
  pluginEntryConfig,
  apiConfig,
  memoryEngineConfig,
} = {}) {
  const errors = [];
  const official = isObject(pluginConfig) ? pluginConfig : {};
  const entry = isObject(pluginEntryConfig) ? pluginEntryConfig : {};
  const global = isObject(apiConfig) ? apiConfig : {};
  const effectiveMemoryEngineConfig = isObject(memoryEngineConfig)
    ? memoryEngineConfig
    : getMemoryEngineConfig(global);
  const autoRecallSource = selectAutoRecallSource(
    [official.autoRecall, entry.autoRecall, global.autoRecall],
    errors,
  );
  const autoRecall = normalizeAutoRecall(autoRecallSource, effectiveMemoryEngineConfig, errors);
  const effectiveMinConfidence = resolveEffectiveMinConfidence(global, effectiveMemoryEngineConfig, errors);
  const effectiveLexicalConfidenceThreshold = resolveEffectiveLexicalConfidenceThreshold(
    global,
    effectiveMemoryEngineConfig,
    errors,
  );

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
    ), errors, "recentFailClosedCanary", { allowSingleTokenAlias: true }),
    productionEvidenceWindow: normalizeEvidenceWindow(firstDefined(
      official.productionEvidenceWindow,
      entry.productionEvidenceWindow,
      global.productionEvidenceWindow,
    ), errors),
    hybridRetrieval: {
      recall: {
        ...clone(effectiveMemoryEngineConfig.recall || {}),
        lexicalConfidenceThreshold: effectiveLexicalConfidenceThreshold,
      },
      ranking: clone(effectiveMemoryEngineConfig.ranking || {}),
      confidence: {
        ...clone(effectiveMemoryEngineConfig.confidence || {}),
        min: effectiveMinConfidence,
      },
      effectiveMinConfidence,
      effectiveLexicalConfidenceThreshold,
    },
  };
  return {
    ...config,
    valid: errors.length === 0,
    errors: [...new Set(errors)].sort(),
  };
}

export { DEFAULT_AUTO_RECALL, DEFAULT_CANARY, DEFAULT_EVIDENCE_WINDOW, DEFAULT_MODES };

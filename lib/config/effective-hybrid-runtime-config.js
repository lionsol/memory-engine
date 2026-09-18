import { getMemoryEngineConfig } from "./runtime.js";
import { getDefaultMemoryEngineConfig } from "./defaults.js";
import {
  PRODUCTION_DEFAULT_TOP_K,
  validateTopK,
} from "../recall/top-k-policy.js";

const DEFAULT_AUTO_RECALL = Object.freeze({
  enabled: false,
  topK: 3,
  timeoutMs: 8000,
  agentAllowlist: ["edi"],
  sessionAllowlist: [],
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

const DEFAULT_MODES = Object.freeze({
  kgFailClosedMode: "legacy_fallback",
  recentFailClosedMode: "legacy_fallback",
});

const DEFAULT_EXPLICIT_SEARCH_RERANK_CONTROL = Object.freeze({
  enabled: false,
});

const DEFAULT_EXPLICIT_SEARCH_RERANK_PROVIDER = Object.freeze({
  enabled: false,
});

const DEFAULT_RECALL_HINT_RUNTIME_CANARY = Object.freeze({
  enabled: false,
  sessionIds: [],
  vectorExecutionMode: "sequential",
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

function normalizeConfigLayer(value, field, errors) {
  if (value === undefined || value === null) {
    return { name: field, value: {}, valid: true };
  }
  if (!isObject(value)) {
    errors.push(`invalid_object:${field}`);
    return { name: field, value: {}, valid: false };
  }
  return { name: field, value, valid: true };
}

function validateConfigContainer(source, key, field, errors) {
  const value = source?.[key];
  if (value === undefined || value === null) return true;
  if (!isObject(value)) {
    errors.push(`invalid_object:${field}`);
    return false;
  }
  return true;
}

function normalizeExplicitSearchRerankControl(value, field, errors) {
  if (value === undefined) {
    return { present: false, valid: true, value: { ...DEFAULT_EXPLICIT_SEARCH_RERANK_CONTROL } };
  }
  if (!isObject(value)) {
    errors.push(`invalid_object:${field}`);
    return { present: true, valid: false, value: { ...DEFAULT_EXPLICIT_SEARCH_RERANK_CONTROL } };
  }

  let valid = true;
  for (const key of Object.keys(value)) {
    if (key !== "enabled") {
      errors.push(`unknown_field:${field}.${key}`);
      valid = false;
    }
  }
  const enabled = value.enabled === undefined ? false : value.enabled;
  if (typeof enabled !== "boolean") {
    errors.push(`invalid_boolean:${field}.enabled`);
    valid = false;
  }
  return {
    present: true,
    valid,
    value: { enabled: typeof enabled === "boolean" ? enabled : false },
  };
}

function resolveExplicitSearchRerankControl(layers, errors) {
  for (const layer of layers.slice(0, 2)) {
    if (!layer.valid) {
      return { ...DEFAULT_EXPLICIT_SEARCH_RERANK_CONTROL };
    }
    if (layer.value.explicitSearchRerankControl === undefined) continue;
    const normalized = normalizeExplicitSearchRerankControl(
      layer.value.explicitSearchRerankControl,
      `${layer.name}.explicitSearchRerankControl`,
      errors,
    );
    if (!normalized.valid) return { ...DEFAULT_EXPLICIT_SEARCH_RERANK_CONTROL };
    return normalized.value;
  }
  return { ...DEFAULT_EXPLICIT_SEARCH_RERANK_CONTROL };
}

function normalizeExplicitSearchRerankProvider(value, field, errors) {
  if (value === undefined) {
    return { present: false, valid: true, value: { ...DEFAULT_EXPLICIT_SEARCH_RERANK_PROVIDER } };
  }
  if (!isObject(value)) {
    errors.push(`invalid_object:${field}`);
    return { present: true, valid: false, value: { ...DEFAULT_EXPLICIT_SEARCH_RERANK_PROVIDER } };
  }
  let valid = true;
  for (const key of Object.keys(value)) {
    if (key !== "enabled") {
      errors.push(`unknown_field:${field}.${key}`);
      valid = false;
    }
  }
  const enabled = value.enabled === undefined ? false : value.enabled;
  if (typeof enabled !== "boolean") {
    errors.push(`invalid_boolean:${field}.enabled`);
    valid = false;
  }
  return {
    present: true,
    valid,
    value: { enabled: typeof enabled === "boolean" ? enabled : false },
  };
}

function resolveExplicitSearchRerankProvider(layers, errors) {
  for (const layer of layers.slice(0, 2)) {
    if (!layer.valid) return { ...DEFAULT_EXPLICIT_SEARCH_RERANK_PROVIDER };
    if (layer.value.explicitSearchRerankProvider === undefined) continue;
    const normalized = normalizeExplicitSearchRerankProvider(
      layer.value.explicitSearchRerankProvider,
      `${layer.name}.explicitSearchRerankProvider`,
      errors,
    );
    if (!normalized.valid) return { ...DEFAULT_EXPLICIT_SEARCH_RERANK_PROVIDER };
    return normalized.value;
  }
  return { ...DEFAULT_EXPLICIT_SEARCH_RERANK_PROVIDER };
}

function normalizeRecallHintRuntimeCanary(value, field, errors) {
  if (value === undefined) {
    return { present: false, valid: true, value: clone(DEFAULT_RECALL_HINT_RUNTIME_CANARY) };
  }
  if (!isObject(value)) {
    errors.push(`invalid_object:${field}`);
    return { present: true, valid: false, value: clone(DEFAULT_RECALL_HINT_RUNTIME_CANARY) };
  }

  let valid = true;
  const allowed = new Set(["enabled", "sessionIds", "vectorExecutionMode"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`unknown_field:${field}.${key}`);
      valid = false;
    }
  }
  const enabled = value.enabled === undefined ? false : value.enabled;
  if (typeof enabled !== "boolean") {
    errors.push(`invalid_boolean:${field}.enabled`);
    valid = false;
  }
  const sessionIds = value.sessionIds === undefined ? [] : value.sessionIds;
  if (!Array.isArray(sessionIds)
      || sessionIds.some(item => typeof item !== "string" || !item.trim())) {
    errors.push(`invalid_array:${field}.sessionIds`);
    valid = false;
  }
  const vectorExecutionMode = value.vectorExecutionMode === undefined
    ? "sequential"
    : value.vectorExecutionMode;
  if (!["sequential", "parallel"].includes(vectorExecutionMode)) {
    errors.push(`invalid_mode:${field}.vectorExecutionMode`);
    valid = false;
  }
  return {
    present: true,
    valid,
    value: {
      enabled: typeof enabled === "boolean" ? enabled : false,
      sessionIds: Array.isArray(sessionIds)
        ? sessionIds.filter(item => typeof item === "string" && item.trim()).map(item => item.trim())
        : [],
      vectorExecutionMode: ["sequential", "parallel"].includes(vectorExecutionMode)
        ? vectorExecutionMode
        : "sequential",
    },
  };
}

function resolveRecallHintRuntimeCanary(layers, errors) {
  for (const layer of layers.slice(0, 2)) {
    if (!layer.valid) return clone(DEFAULT_RECALL_HINT_RUNTIME_CANARY);
    if (layer.value.recallHintRuntimeCanary === undefined) continue;
    const normalized = normalizeRecallHintRuntimeCanary(
      layer.value.recallHintRuntimeCanary,
      `${layer.name}.recallHintRuntimeCanary`,
      errors,
    );
    if (!normalized.valid) return clone(DEFAULT_RECALL_HINT_RUNTIME_CANARY);
    return normalized.value;
  }
  return clone(DEFAULT_RECALL_HINT_RUNTIME_CANARY);
}

function selectAutoRecallSource(layers, errors) {
  let selected = { value: {}, blocked: false };
  let sourceResolved = false;

  for (const layer of layers) {
    if (!layer.valid) {
      if (!sourceResolved) {
        selected = { value: {}, blocked: true };
        sourceResolved = true;
      }
      continue;
    }
    if (layer.value.autoRecall === undefined) continue;
    const value = layer.value.autoRecall;
    if (!isObject(value)) {
      errors.push("invalid_object:autoRecall");
      if (!sourceResolved) {
        selected = { value: {}, blocked: true };
        sourceResolved = true;
      }
      continue;
    }
    if (!sourceResolved) {
      selected = { value, blocked: false };
      sourceResolved = true;
    }
  }
  return selected;
}

function resolveLayeredSetting(layers, autoRecallSelection, key) {
  const official = layers[0];
  if (!official.valid) return undefined;
  if (official.value[key] !== undefined && official.value[key] !== null) return official.value[key];

  if (autoRecallSelection.blocked) return undefined;
  if (autoRecallSelection.value[key] !== undefined && autoRecallSelection.value[key] !== null) {
    return autoRecallSelection.value[key];
  }

  const entry = layers[1];
  if (!entry.valid) return undefined;
  if (entry.value[key] !== undefined && entry.value[key] !== null) return entry.value[key];

  const global = layers[2];
  if (!global.valid) return undefined;
  if (global.value[key] !== undefined && global.value[key] !== null) return global.value[key];
  return undefined;
}

function normalizeStringArray(value, fallback, errors, field) {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) {
    errors.push(`invalid_array:${field}`);
    return [...fallback];
  }
  return value.map(item => item.trim());
}

function normalizeNumber(value, fallback, minimum, errors, field) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    errors.push(`invalid_number:${field}`);
    return fallback;
  }
  return value;
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

function normalizeConfiguredTopK(value, fallback, errors, field) {
  const result = validateTopK(value, { defaultValue: fallback });
  if (!result.valid) errors.push(`invalid_top_k:${field}`);
  return result.value === null ? fallback : result.value;
}

function normalizeFiniteInteger(value, fallback, minimum, errors, field) {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || !Number.isInteger(value)
    || value < minimum
  ) {
    errors.push(`invalid_integer:${field}`);
    return fallback;
  }
  return value;
}

function normalizePositiveFiniteNumber(value, fallback, errors, field) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push(`invalid_number:${field}`);
    return fallback;
  }
  return value;
}

function normalizeHybridRetrievalConfig(memoryEngineConfig, errors) {
  const defaults = getDefaultMemoryEngineConfig();
  const rawRecall = memoryEngineConfig?.recall;
  const rawRanking = memoryEngineConfig?.ranking;
  const recall = rawRecall === undefined
    ? {}
    : isObject(rawRecall)
      ? rawRecall
      : (errors.push("invalid_object:memoryEngineConfig.recall"), {});
  const ranking = rawRanking === undefined
    ? {}
    : isObject(rawRanking)
      ? rawRanking
      : (errors.push("invalid_object:memoryEngineConfig.ranking"), {});

  return {
    recall: {
      ...clone(recall),
      topK: normalizeConfiguredTopK(
        recall.topK,
        defaults.recall.topK,
        errors,
        "memoryEngineConfig.recall.topK",
      ),
      vectorTopK: normalizeFiniteInteger(
        recall.vectorTopK,
        defaults.recall.vectorTopK,
        1,
        errors,
        "memoryEngineConfig.recall.vectorTopK",
      ),
      ftsTopK: normalizeFiniteInteger(
        recall.ftsTopK,
        defaults.recall.ftsTopK,
        1,
        errors,
        "memoryEngineConfig.recall.ftsTopK",
      ),
      likePatternTopN: normalizeFiniteInteger(
        recall.likePatternTopN,
        defaults.recall.likePatternTopN,
        4,
        errors,
        "memoryEngineConfig.recall.likePatternTopN",
      ),
      likeTopK: normalizeFiniteInteger(
        recall.likeTopK,
        defaults.recall.likeTopK,
        1,
        errors,
        "memoryEngineConfig.recall.likeTopK",
      ),
      recentTopK: normalizeFiniteInteger(
        recall.recentTopK,
        defaults.recall.recentTopK,
        1,
        errors,
        "memoryEngineConfig.recall.recentTopK",
      ),
      recentRerankTopK: normalizeFiniteInteger(
        recall.recentRerankTopK,
        defaults.recall.recentRerankTopK,
        1,
        errors,
        "memoryEngineConfig.recall.recentRerankTopK",
      ),
      recentFallbackTopK: normalizeFiniteInteger(
        recall.recentFallbackTopK,
        defaults.recall.recentFallbackTopK,
        1,
        errors,
        "memoryEngineConfig.recall.recentFallbackTopK",
      ),
    },
    ranking: {
      ...clone(ranking),
      rrfK: normalizePositiveFiniteNumber(
        ranking.rrfK,
        defaults.ranking.rrfK,
        errors,
        "memoryEngineConfig.ranking.rrfK",
      ),
    },
  };
}

function normalizeAutoRecall(value, memoryTopK, errors) {
  const source = value === undefined || value === null ? {} : value;
  if (!isObject(source)) {
    errors.push("invalid_object:autoRecall");
    return {
      ...clone(DEFAULT_AUTO_RECALL),
      topK: memoryTopK,
    };
  }
  const cardFirstRuntime = source.cardFirstRuntime === undefined || source.cardFirstRuntime === null
    ? clone(DEFAULT_AUTO_RECALL.cardFirstRuntime)
    : isObject(source.cardFirstRuntime)
      ? { enabled: normalizeBoolean(source.cardFirstRuntime.enabled, false, errors, "autoRecall.cardFirstRuntime.enabled") }
      : (errors.push("invalid_object:autoRecall.cardFirstRuntime"), clone(DEFAULT_AUTO_RECALL.cardFirstRuntime));
  return {
    enabled: normalizeBoolean(source.enabled, DEFAULT_AUTO_RECALL.enabled, errors, "autoRecall.enabled"),
    topK: normalizeConfiguredTopK(source.topK, memoryTopK, errors, "autoRecall.topK"),
    timeoutMs: normalizeNumber(source.timeoutMs, DEFAULT_AUTO_RECALL.timeoutMs, 1000, errors, "autoRecall.timeoutMs"),
    agentAllowlist: normalizeStringArray(source.agentAllowlist ?? source.agent_allowlist, DEFAULT_AUTO_RECALL.agentAllowlist, errors, "autoRecall.agentAllowlist"),
    sessionAllowlist: normalizeStringArray(source.sessionAllowlist ?? source.session_allowlist, DEFAULT_AUTO_RECALL.sessionAllowlist, errors, "autoRecall.sessionAllowlist"),
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
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    errors.push(`invalid_number:${field}`);
    return null;
  }
  return value;
}

function readPath(source, path) {
  let value = source;
  for (const key of path) {
    if (!isObject(value)) return undefined;
    value = value[key];
  }
  return value;
}

const MEMORY_ENGINE_CONFIG_SECTIONS = ["confidence", "recall", "ranking"];

function inspectMemoryEngineSource(source, errors, {
  rootError,
  sectionErrorPrefix = "memoryEngineConfig",
} = {}) {
  if (source === undefined || source === null) {
    return { present: false, valid: true };
  }
  if (!isObject(source)) {
    errors.push(rootError);
    return { present: true, valid: false };
  }
  for (const section of MEMORY_ENGINE_CONFIG_SECTIONS) {
    const value = source[section];
    if (value !== undefined && value !== null && !isObject(value)) {
      errors.push(`invalid_object:${sectionErrorPrefix}.${section}`);
    }
  }
  return { present: true, valid: true };
}

function firstConfiguredMemoryEngineSection(sources, section) {
  for (const source of sources) {
    if (source === undefined || source === null) continue;
    if (!isObject(source)) return { present: true, valid: false };
    const value = source[section];
    if (value === undefined || value === null) continue;
    return { present: true, valid: isObject(value) };
  }
  return { present: false, valid: true };
}

function resolveMemoryEngineConfig({ global, supplied, errors }) {
  const blocked = {
    all: false,
    confidence: false,
    recall: false,
    ranking: false,
  };
  let candidate;
  if (supplied !== undefined && supplied !== null) {
    const state = inspectMemoryEngineSource(supplied, errors, {
      rootError: "invalid_object:memoryEngineConfig",
    });
    if (!state.valid) {
      blocked.all = true;
      candidate = getDefaultMemoryEngineConfig();
    } else {
      candidate = supplied;
    }
  } else {
    const directMemoryEngine = global?.memoryEngine;
    const nestedMemoryEngine = isObject(global?.config) ? global.config.memoryEngine : undefined;
    const sources = [directMemoryEngine, nestedMemoryEngine];
    inspectMemoryEngineSource(directMemoryEngine, errors, {
      rootError: "invalid_object:apiConfig.memoryEngine",
    });
    inspectMemoryEngineSource(nestedMemoryEngine, errors, {
      rootError: "invalid_object:apiConfig.memoryEngine",
    });
    const selectedRoot = sources.find(source => source !== undefined && source !== null);
    if (selectedRoot !== undefined && selectedRoot !== null && !isObject(selectedRoot)) {
      blocked.all = true;
      candidate = getDefaultMemoryEngineConfig();
    } else {
      candidate = getMemoryEngineConfig(global);
    }
    for (const section of MEMORY_ENGINE_CONFIG_SECTIONS) {
      const state = firstConfiguredMemoryEngineSection(sources, section);
      if (state.present && !state.valid) {
        blocked[section] = true;
        candidate = { ...candidate, [section]: {} };
      }
    }
  }

  if (blocked.all) return { config: getDefaultMemoryEngineConfig(), blocked };
  for (const section of MEMORY_ENGINE_CONFIG_SECTIONS) {
    const value = candidate?.[section];
    if (value !== undefined && value !== null && !isObject(value)) {
      errors.push(`invalid_object:memoryEngineConfig.${section}`);
      blocked[section] = true;
      candidate = { ...candidate, [section]: {} };
    }
  }
  return { config: candidate, blocked };
}

const DECIMAL_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseConfiguredFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseEnvironmentFiniteDecimal(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!DECIMAL_NUMBER_PATTERN.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function findConfiguredSource(source, paths, errors) {
  for (const path of paths) {
    const containerName = path[0];
    const container = readPath(source, [containerName]);
    if (container === undefined || container === null) continue;
    if (!isObject(container)) {
      errors?.push(containerName === "autoRecall"
        ? "invalid_object:autoRecall"
        : `invalid_object:apiConfig.${containerName}`);
      return { blocked: true, present: false };
    }
    const value = readPath(container, path.slice(1));
    if (value !== undefined) {
      return {
        blocked: false,
        present: true,
        value,
        name: path.join("."),
      };
    }
  }
  return { blocked: false, present: false };
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
  engineField,
  blocked = false,
  errors,
}) {
  const configured = findConfiguredSource(apiConfig, configPaths, errors);
  if (configured.blocked) return fallback;
  const environmentValue = process.env[environmentName];
  let source;
  let sourceName;
  let parse;
  if (configured.present) {
    source = configured.value;
    sourceName = configured.name;
    parse = parseConfiguredFiniteNumber;
  } else if (blocked) {
    return fallback;
  } else if (environmentValue !== undefined) {
    source = environmentValue;
    sourceName = environmentName;
    parse = parseEnvironmentFiniteDecimal;
  } else if (engineValue !== undefined) {
    source = engineValue;
    sourceName = engineField || "memoryEngineConfig";
    parse = parseConfiguredFiniteNumber;
  } else {
    return fallback;
  }

  const parsed = parse(source);
  if (parsed === null || parsed < minimum || parsed > maximum) {
    if (errors) errors.push(`invalid_number:${sourceName}`);
    return fallback;
  }
  return parsed;
}

export function resolveEffectiveMinConfidence(
  apiConfig = {},
  memoryEngineConfig = {},
  errors = null,
  blocked = false,
) {
  return resolveEffectiveThreshold({
    apiConfig,
    memoryEngineConfig,
    configPaths: [["memory", "minConfidence"], ["autoRecall", "minConfidence"]],
    environmentName: "MEMORY_ENGINE_MIN_CONFIDENCE",
    fallback: 0.15,
    minimum: 0,
    maximum: 1,
    engineValue: memoryEngineConfig?.confidence?.min,
    engineField: "memoryEngineConfig.confidence.min",
    blocked,
    errors,
  });
}

export function resolveEffectiveLexicalConfidenceThreshold(
  apiConfig = {},
  memoryEngineConfig = {},
  errors = null,
  blocked = false,
) {
  return resolveEffectiveThreshold({
    apiConfig,
    memoryEngineConfig,
    configPaths: [["memory", "autoRecallLexicalConfidenceThreshold"], ["autoRecall", "lexicalConfidenceThreshold"]],
    environmentName: "AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD",
    fallback: 0.7,
    minimum: 0,
    maximum: 1,
    engineValue: memoryEngineConfig?.recall?.lexicalConfidenceThreshold,
    engineField: "memoryEngineConfig.recall.lexicalConfidenceThreshold",
    blocked,
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
  const layers = [
    normalizeConfigLayer(pluginConfig, "pluginConfig", errors),
    normalizeConfigLayer(pluginEntryConfig, "pluginEntryConfig", errors),
    normalizeConfigLayer(apiConfig, "apiConfig", errors),
  ];
  const globalLayer = layers[2];
  const global = globalLayer.value;
  validateConfigContainer(global, "memoryEngine", "apiConfig.memoryEngine", errors);
  validateConfigContainer(global, "memory", "apiConfig.memory", errors);
  const memoryEngineResolution = resolveMemoryEngineConfig({
    global,
    supplied: memoryEngineConfig,
    errors,
  });
  const effectiveMemoryEngineConfig = memoryEngineResolution.config;
  const normalizedHybridRetrieval = normalizeHybridRetrievalConfig(effectiveMemoryEngineConfig, errors);
  const memoryTopK = normalizedHybridRetrieval.recall.topK || PRODUCTION_DEFAULT_TOP_K;
  const autoRecallSelection = selectAutoRecallSource(layers, errors);
  const autoRecall = normalizeAutoRecall(autoRecallSelection.value, memoryTopK, errors);
  const explicitSearchRerankControl = resolveExplicitSearchRerankControl(layers, errors);
  const explicitSearchRerankProvider = resolveExplicitSearchRerankProvider(layers, errors);
  const recallHintRuntimeCanary = resolveRecallHintRuntimeCanary(layers, errors);
  if (explicitSearchRerankControl.enabled && explicitSearchRerankProvider.enabled) {
    errors.push("conflict:explicitSearchRerankControl:explicitSearchRerankProvider");
  }
  const effectiveMinConfidence = resolveEffectiveMinConfidence(
    global,
    effectiveMemoryEngineConfig,
    errors,
    memoryEngineResolution.blocked.confidence
      || memoryEngineResolution.blocked.all
      || !globalLayer.valid,
  );
  const effectiveLexicalConfidenceThreshold = resolveEffectiveLexicalConfidenceThreshold(
    global,
    effectiveMemoryEngineConfig,
    errors,
    memoryEngineResolution.blocked.recall
      || memoryEngineResolution.blocked.all
      || !globalLayer.valid,
  );

  const config = {
    autoRecall,
    explicitSearchRerankControl,
    explicitSearchRerankProvider,
    recallHintRuntimeCanary,
    kgFailClosedMode: normalizeMode(
      firstDefined(
        resolveLayeredSetting(layers, autoRecallSelection, "kgFailClosedMode"),
        DEFAULT_MODES.kgFailClosedMode,
      ),
      DEFAULT_MODES.kgFailClosedMode,
      errors,
      "kgFailClosedMode",
    ),
    kgFailClosedCanary: normalizeCanary(
      resolveLayeredSetting(layers, autoRecallSelection, "kgFailClosedCanary"),
      errors,
      "kgFailClosedCanary",
    ),
    recentFailClosedMode: normalizeMode(
      firstDefined(
        resolveLayeredSetting(layers, autoRecallSelection, "recentFailClosedMode"),
        DEFAULT_MODES.recentFailClosedMode,
      ),
      DEFAULT_MODES.recentFailClosedMode,
      errors,
      "recentFailClosedMode",
    ),
    recentFailClosedCanary: normalizeCanary(
      resolveLayeredSetting(layers, autoRecallSelection, "recentFailClosedCanary"),
      errors,
      "recentFailClosedCanary",
      { allowSingleTokenAlias: true },
    ),
    hybridRetrieval: {
      recall: {
        ...normalizedHybridRetrieval.recall,
        topK: memoryTopK,
        lexicalConfidenceThreshold: effectiveLexicalConfidenceThreshold,
      },
      ranking: normalizedHybridRetrieval.ranking,
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

export {
  DEFAULT_AUTO_RECALL,
  DEFAULT_CANARY,
  DEFAULT_MODES,
  DEFAULT_EXPLICIT_SEARCH_RERANK_CONTROL,
  DEFAULT_EXPLICIT_SEARCH_RERANK_PROVIDER,
  DEFAULT_RECALL_HINT_RUNTIME_CANARY,
};

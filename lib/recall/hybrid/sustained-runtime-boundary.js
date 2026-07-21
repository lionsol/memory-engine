import { canonicalIsoTimestamp } from "./hybrid-observation-provenance.js";

const ACTIVE_MEMORY_ID = "active-memory";

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function booleanField(value, field, errors) {
  if (value === undefined) return null;
  if (typeof value !== "boolean") {
    errors.push(`invalid_boolean:${field}`);
    return null;
  }
  return value;
}

function stringListField(value, field, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`invalid_array:${field}`);
    return [];
  }
  const normalized = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      errors.push(`invalid_string:${field}`);
      continue;
    }
    normalized.push(item.trim().toLowerCase());
  }
  return [...new Set(normalized)];
}

function invalidBoundary({
  resolution,
  entryPresent = false,
  entryEnabled = null,
  configEnabled = null,
  pluginsEnabled = null,
  allowConfigured = null,
  allowContainsActiveMemory = null,
  denyContainsActiveMemory = null,
  errors,
}) {
  return {
    valid: false,
    enabled: null,
    resolution,
    entry_present: entryPresent,
    entry_enabled: entryEnabled,
    config_enabled: configEnabled,
    plugins_enabled: pluginsEnabled,
    allow_configured: allowConfigured,
    allow_contains_active_memory: allowContainsActiveMemory,
    deny_contains_active_memory: denyContainsActiveMemory,
    errors,
  };
}

export function resolveActiveMemoryBoundary(config) {
  const errors = [];
  if (!isPlainObject(config)) {
    return invalidBoundary({
      resolution: "invalid_openclaw_config",
      errors: ["invalid_openclaw_config"],
    });
  }

  const rawPlugins = config.plugins;
  if (rawPlugins !== undefined && !isPlainObject(rawPlugins)) {
    errors.push("invalid_object:plugins");
  }
  const plugins = isPlainObject(rawPlugins) ? rawPlugins : {};
  const pluginsEnabledField = booleanField(plugins.enabled, "plugins.enabled", errors);
  const pluginsEnabled = pluginsEnabledField ?? true;
  const allow = stringListField(plugins.allow, "plugins.allow", errors);
  const deny = stringListField(plugins.deny, "plugins.deny", errors);

  const rawEntries = plugins.entries;
  if (rawEntries !== undefined && !isPlainObject(rawEntries)) {
    errors.push("invalid_object:plugins.entries");
  }
  const entries = isPlainObject(rawEntries) ? rawEntries : {};
  const rawEntry = entries[ACTIVE_MEMORY_ID];
  if (rawEntry !== undefined && !isPlainObject(rawEntry)) {
    errors.push("invalid_object:plugins.entries.active-memory");
  }
  const entry = isPlainObject(rawEntry) ? rawEntry : null;
  const rawPluginConfig = entry?.config;
  if (rawPluginConfig !== undefined && !isPlainObject(rawPluginConfig)) {
    errors.push("invalid_object:plugins.entries.active-memory.config");
  }
  const pluginConfig = isPlainObject(rawPluginConfig) ? rawPluginConfig : null;
  const entryEnabled = booleanField(entry?.enabled, "plugins.entries.active-memory.enabled", errors);
  const configEnabled = booleanField(pluginConfig?.enabled, "plugins.entries.active-memory.config.enabled", errors);
  const allowConfigured = allow.length > 0;
  const allowContainsActiveMemory = allow.includes(ACTIVE_MEMORY_ID);
  const denyContainsActiveMemory = deny.includes(ACTIVE_MEMORY_ID);

  if (errors.length > 0) {
    return invalidBoundary({
      resolution: "invalid_active_memory_config",
      entryPresent: Boolean(entry),
      entryEnabled,
      configEnabled,
      pluginsEnabled,
      allowConfigured,
      allowContainsActiveMemory,
      denyContainsActiveMemory,
      errors,
    });
  }

  const common = {
    valid: true,
    entry_present: Boolean(entry),
    entry_enabled: entryEnabled,
    config_enabled: configEnabled,
    plugins_enabled: pluginsEnabled,
    allow_configured: allowConfigured,
    allow_contains_active_memory: allowContainsActiveMemory,
    deny_contains_active_memory: denyContainsActiveMemory,
    errors: [],
  };

  if (!pluginsEnabled) {
    return {
      ...common,
      enabled: false,
      resolution: "disabled_by_plugins_global",
    };
  }
  if (denyContainsActiveMemory) {
    return {
      ...common,
      enabled: false,
      resolution: "disabled_by_plugins_denylist",
    };
  }
  if (entryEnabled === false) {
    return {
      ...common,
      enabled: false,
      resolution: "disabled_by_plugin_entry",
    };
  }
  if (allowConfigured && !allowContainsActiveMemory) {
    return {
      ...common,
      enabled: false,
      resolution: "disabled_by_plugins_allowlist",
    };
  }
  if (configEnabled === false) {
    return {
      ...common,
      enabled: false,
      resolution: "disabled_by_plugin_config",
    };
  }

  return {
    ...common,
    enabled: true,
    resolution: entryEnabled === true || configEnabled === true
      ? "enabled_by_explicit_or_default_plugin_config"
      : "enabled_by_active_memory_runtime_default",
  };
}

export function buildSustainedRuntimeBoundaryReport({
  openclawConfig,
  checkedAt = new Date().toISOString(),
} = {}) {
  const checkedAtIso = canonicalIsoTimestamp(checkedAt);
  if (!checkedAtIso) throw new TypeError("checkedAt must be a canonical UTC ISO timestamp");
  const activeMemory = resolveActiveMemoryBoundary(openclawConfig);
  const status = !activeMemory.valid
    ? "invalid"
    : activeMemory.enabled
      ? "conflict"
      : "clean";
  return {
    schema_version: 1,
    checked_at: checkedAtIso,
    status,
    active_memory_enabled: activeMemory.enabled,
    active_memory_resolution: activeMemory.resolution,
    active_memory_entry_present: activeMemory.entry_present,
    active_memory_entry_enabled: activeMemory.entry_enabled,
    active_memory_config_enabled: activeMemory.config_enabled,
    active_memory_plugins_enabled: activeMemory.plugins_enabled,
    active_memory_allowlist_configured: activeMemory.allow_configured,
    active_memory_allowlisted: activeMemory.allow_contains_active_memory,
    active_memory_denylisted: activeMemory.deny_contains_active_memory,
    blockers: status === "clean"
      ? []
      : activeMemory.valid
        ? ["active_memory_enabled"]
        : [...activeMemory.errors],
  };
}

export { booleanField, isPlainObject, stringListField };

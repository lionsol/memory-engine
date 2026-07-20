import { canonicalIsoTimestamp } from "./hybrid-observation-provenance.js";

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

export function resolveActiveMemoryBoundary(config) {
  const errors = [];
  if (!isPlainObject(config)) {
    return {
      valid: false,
      enabled: null,
      resolution: "invalid_openclaw_config",
      entry_present: false,
      entry_enabled: null,
      config_enabled: null,
      errors: ["invalid_openclaw_config"],
    };
  }
  const rawEntries = config.plugins?.entries;
  if (rawEntries !== undefined && !isPlainObject(rawEntries)) errors.push("invalid_object:plugins.entries");
  const rawEntry = isPlainObject(rawEntries) ? rawEntries["active-memory"] : undefined;
  if (rawEntry !== undefined && !isPlainObject(rawEntry)) errors.push("invalid_object:plugins.entries.active-memory");
  const entry = isPlainObject(rawEntry) ? rawEntry : null;
  const rawPluginConfig = entry?.config;
  if (rawPluginConfig !== undefined && !isPlainObject(rawPluginConfig)) {
    errors.push("invalid_object:plugins.entries.active-memory.config");
  }
  const pluginConfig = isPlainObject(rawPluginConfig) ? rawPluginConfig : null;
  const entryEnabled = booleanField(entry?.enabled, "plugins.entries.active-memory.enabled", errors);
  const configEnabled = booleanField(pluginConfig?.enabled, "plugins.entries.active-memory.config.enabled", errors);

  if (errors.length > 0) {
    return {
      valid: false,
      enabled: null,
      resolution: "invalid_active_memory_config",
      entry_present: Boolean(entry),
      entry_enabled: entryEnabled,
      config_enabled: configEnabled,
      errors,
    };
  }
  if (entryEnabled === false) {
    return {
      valid: true,
      enabled: false,
      resolution: "disabled_by_plugin_entry",
      entry_present: true,
      entry_enabled: false,
      config_enabled: configEnabled,
      errors: [],
    };
  }
  if (configEnabled === false) {
    return {
      valid: true,
      enabled: false,
      resolution: "disabled_by_plugin_config",
      entry_present: true,
      entry_enabled: entryEnabled,
      config_enabled: false,
      errors: [],
    };
  }
  return {
    valid: true,
    enabled: true,
    resolution: entry
      ? "enabled_by_explicit_or_default_plugin_config"
      : "enabled_by_active_memory_runtime_default",
    entry_present: Boolean(entry),
    entry_enabled: entryEnabled,
    config_enabled: configEnabled,
    errors: [],
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
    blockers: status === "clean"
      ? []
      : activeMemory.valid
        ? ["active_memory_enabled"]
        : [...activeMemory.errors],
  };
}

export { isPlainObject };

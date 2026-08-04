import { createHash } from "node:crypto";

const CONFIG_FINGERPRINT_SCHEMA_VERSION = 1;
const CONFIG_FINGERPRINT_ALGORITHM = "sha256";
const CONFIG_UNDEFINED_MARKER = "__memory_engine_undefined__";

function canonicalize(value) {
  if (value === undefined) return { [CONFIG_UNDEFINED_MARKER]: true };
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("config contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map(item => canonicalize(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map(key => [key, canonicalize(value[key])]),
    );
  }
  throw new TypeError(`config contains unsupported value type: ${typeof value}`);
}

export function canonicalizeConfig(config) {
  return canonicalize(config ?? {});
}

export function fingerprintConfig(config) {
  try {
    const canonical = canonicalizeConfig(config);
    const serialized = JSON.stringify(canonical);
    return {
      schema_version: CONFIG_FINGERPRINT_SCHEMA_VERSION,
      algorithm: CONFIG_FINGERPRINT_ALGORITHM,
      fingerprint: createHash(CONFIG_FINGERPRINT_ALGORITHM).update(serialized).digest("hex"),
      valid: true,
      errors: [],
    };
  } catch (error) {
    return {
      schema_version: CONFIG_FINGERPRINT_SCHEMA_VERSION,
      algorithm: CONFIG_FINGERPRINT_ALGORITHM,
      fingerprint: null,
      valid: false,
      errors: [error.message],
    };
  }
}

export { CONFIG_FINGERPRINT_SCHEMA_VERSION };

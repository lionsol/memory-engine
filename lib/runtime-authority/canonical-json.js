const { createHash } = require("node:crypto");

function normalize(value, path = "$", arrayOrder = true) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`unsupported numeric value at ${path}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => normalize(item, `${path}[${index}]`, arrayOrder));
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = normalize(value[key], `${path}.${key}`, arrayOrder);
    return result;
  }
  throw new TypeError(`unsupported value at ${path}`);
}

function canonicalize(value) {
  return JSON.stringify(normalize(value));
}

function canonicalBytes(value) {
  return Buffer.from(canonicalize(value), "utf8");
}

function sha256Canonical(value) {
  return createHash("sha256").update(canonicalBytes(value)).digest("hex");
}

module.exports = { normalize, canonicalize, canonicalBytes, sha256Canonical };

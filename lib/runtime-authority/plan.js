const { createHash } = require("node:crypto");
const {
  lstatSync,
  readFileSync,
} = require("node:fs");
const { isAbsolute, normalize, posix } = require("node:path");
const { PLAN_FIELDS, PLAN_SCHEMA, PATH_FIELDS, TOOL_FIELDS } = require("./constants.js");

const SHA256 = /^[0-9a-f]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SERVICE_UNIT = /^[A-Za-z0-9][A-Za-z0-9_.@-]*\.service$/;

class JsonReader {
  constructor(text) { this.text = text; this.index = 0; }
  whitespace() { while (/\s/.test(this.text[this.index] || "")) this.index += 1; }
  expect(char) { this.whitespace(); if (this.text[this.index] !== char) throw new Error(`expected ${char}`); this.index += 1; }
  string() {
    this.whitespace();
    if (this.text[this.index] !== '"') throw new Error("expected JSON string");
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.text.length) {
      const char = this.text[this.index++];
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === '"') return JSON.parse(this.text.slice(start, this.index));
    }
    throw new Error("unterminated JSON string");
  }
  value() {
    this.whitespace();
    const char = this.text[this.index];
    if (char === "{") return this.object();
    if (char === "[") return this.array();
    if (char === '"') return this.string();
    const start = this.index;
    while (this.index < this.text.length && !/[\s,\]}]/.test(this.text[this.index])) this.index += 1;
    const token = this.text.slice(start, this.index);
    if (!token) throw new Error("expected JSON value");
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) return Number(token);
    throw new Error(`invalid JSON value ${token}`);
  }
  object() {
    this.expect("{");
    const object = {};
    const keys = new Set();
    this.whitespace();
    if (this.text[this.index] === "}") { this.index += 1; return object; }
    while (true) {
      const key = this.string();
      if (keys.has(key)) throw new Error(`duplicate JSON key ${key}`);
      keys.add(key);
      this.expect(":");
      object[key] = this.value();
      this.whitespace();
      if (this.text[this.index] === "}") { this.index += 1; return object; }
      this.expect(",");
    }
  }
  array() {
    this.expect("[");
    const values = [];
    this.whitespace();
    if (this.text[this.index] === "]") { this.index += 1; return values; }
    while (true) {
      values.push(this.value());
      this.whitespace();
      if (this.text[this.index] === "]") { this.index += 1; return values; }
      this.expect(",");
    }
  }
  parse() {
    const value = this.value();
    this.whitespace();
    if (this.index !== this.text.length) throw new Error("trailing JSON data");
    return value;
  }
}

function parseJson(text) {
  return new JsonReader(text).parse();
}

function invalidPath(value) {
  return !isAbsolute(value) || value.includes("\0") || value.includes("\\") || normalize(value) !== value
    || (value.length > 1 && value.endsWith("/")) || value.startsWith("//");
}

function validatePlanObject(plan, { now = new Date() } = {}) {
  const errors = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return ["root object required"];
  const actual = Object.keys(plan).sort();
  const expected = [...PLAN_FIELDS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) errors.push("exact field set mismatch");
  if (plan.schema !== PLAN_SCHEMA) errors.push("schema mismatch");
  for (const field of PATH_FIELDS) {
    if (typeof plan[field] !== "string" || invalidPath(plan[field])) errors.push(`invalid absolute path:${field}`);
  }
  if (typeof plan.run_id !== "string" || !RUN_ID.test(plan.run_id) || plan.run_id.includes("..")) errors.push("invalid run_id");
  const created = Date.parse(plan.created_at);
  const expires = Date.parse(plan.expires_at);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || !(created <= current && current < expires)) errors.push("invalid plan time window");
  if (typeof plan.origin_remote !== "string" || !plan.origin_remote) errors.push("invalid origin_remote");
  for (const field of PLAN_FIELDS.filter(field => field.startsWith("expected_") && field.endsWith("_sha256"))) {
    if (typeof plan[field] !== "string" || !SHA256.test(plan[field])) errors.push(`invalid sha256:${field}`);
  }
  for (const field of ["expected_source_runtime_identity", "expected_active_runtime_identity", "expected_release_runtime_identity"]) {
    if (typeof plan[field] !== "string" || !SHA256.test(plan[field])) errors.push(`invalid runtime identity:${field}`);
  }
  for (const field of ["expected_gateway_pid", "expected_gateway_restart_count", "expected_console_pid", "expected_console_restart_count", "expected_node_abi"]) {
    if (!Number.isSafeInteger(plan[field]) || plan[field] < 0) errors.push(`invalid nonnegative integer:${field}`);
  }
  for (const field of ["gateway_unit", "console_unit"]) if (typeof plan[field] !== "string" || !SERVICE_UNIT.test(plan[field])) errors.push(`invalid service unit:${field}`);
  for (const field of ["expected_node_version", "expected_npm_version", "expected_git_version", "expected_tar_version", "expected_unshare_version", "expected_mount_version", "expected_chroot_version", "expected_systemctl_version"]) {
    if (typeof plan[field] !== "string" || !plan[field]) errors.push(`invalid tool version:${field}`);
  }
  for (const field of ["expected_python_version", "expected_cc_version", "expected_cxx_version", "expected_make_version", "expected_ar_version"]) {
    if (typeof plan[field] !== "string" || !plan[field]) errors.push(`invalid tool version:${field}`);
  }
  if (typeof plan.expected_node_gyp_tree_identity !== "string" || !SHA256.test(plan.expected_node_gyp_tree_identity)) errors.push("invalid node-gyp closure identity");
  if (!Array.isArray(plan.targeted_test_files) || plan.targeted_test_files.length === 0) errors.push("targeted_test_files required");
  else {
    const seen = new Set();
    for (const file of plan.targeted_test_files) {
      if (typeof file !== "string" || !file || isAbsolute(file) || file.includes("\0") || file.includes("\\") || file.split("/").includes("..") || posix.normalize(file) !== file || file.startsWith("/")) errors.push(`invalid targeted test:${file}`);
      if (seen.has(file)) errors.push(`duplicate targeted test:${file}`);
      seen.add(file);
    }
  }
  return errors;
}

function readPlanFile(planPath, { now = new Date(), uid = typeof process.getuid === "function" ? process.getuid() : null } = {}) {
  const stats = lstatSync(planPath);
  if (!stats.isFile()) throw new Error("plan must be a regular file");
  if ((stats.mode & 0o7777) !== 0o600) throw new Error("plan mode must be 0600");
  if (uid !== null && stats.uid !== uid) throw new Error("plan owner mismatch");
  const bytes = readFileSync(planPath);
  if (bytes.includes(0)) throw new Error("plan contains NUL");
  const text = bytes.toString("utf8");
  let plan;
  try { plan = parseJson(text); } catch (error) { throw new Error(`invalid plan JSON: ${error.message}`); }
  const errors = validatePlanObject(plan, { now });
  if (errors.length > 0) throw new Error(errors.join("; "));
  return { plan, planPath, planSha256: createHash("sha256").update(bytes).digest("hex") };
}

module.exports = { JsonReader, parseJson, readPlanFile, validatePlanObject, invalidPath, SHA256 };

const { createHash } = require("node:crypto");
const {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  lstatSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { join, posix, relative } = require("node:path");
const { canonicalize } = require("./canonical-json.js");
const { commandFailureDetails } = require("./command-failure.js");

const FAILURE_EVIDENCE_SCHEMA = "memory-engine-runtime-authority-failure-evidence-v1";
const FAILURE_EVIDENCE_MAX_TEXT_BYTES = 64 * 1024;
const FAILURE_EVIDENCE_MAX_LOG_BYTES = 64 * 1024;
const FAILURE_EVIDENCE_MAX_LOG_AGGREGATE_BYTES = 256 * 1024;
const FAILURE_EVIDENCE_MAX_LOG_FILES = 8;
const NPM_DEBUG_LOG_NAME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}_[0-9]{2}_[0-9]{2}_[0-9]{3}Z-debug-[0-9]+\.log$/;

function hashBytes(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function hashFile(path) { return hashBytes(readFileSync(path)); }

function redactEvidenceText(value) {
  return String(value || "")
    .replace(/(https?:\/\/)([^\s/:@]+):([^\s/@]+)@/gi, "$1<redacted>@")
    .replace(/(\b[A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|KEY|AUTH|COOKIE|PROXY)[A-Z0-9_]*\b\s*[:=]\s*)[^\s,;]+/gi, "$1<redacted>")
    .replace(/(\bauthorization\s*[:=]\s*)[^\r\n]+/gi, "$1<redacted>");
}

function boundedBytes(bytes, limit) {
  if (bytes.length <= limit) return bytes;
  const marker = Buffer.from("\n...[truncated]...\n");
  const budget = Math.max(0, limit - marker.length);
  const head = Math.ceil(budget / 2);
  const tail = budget - head;
  return Buffer.concat([bytes.subarray(0, head), marker, tail > 0 ? bytes.subarray(bytes.length - tail) : Buffer.alloc(0)]);
}

function captureText(value, limit = FAILURE_EVIDENCE_MAX_TEXT_BYTES) {
  const source = String(value || "");
  const redacted = Buffer.from(redactEvidenceText(source));
  const captured = boundedBytes(redacted, limit);
  return {
    text: captured.toString("utf8"),
    bytes: Buffer.byteLength(source),
    captured_bytes: captured.length,
    truncated: Buffer.byteLength(source) > limit || redacted.length > limit,
    sha256: hashBytes(captured),
  };
}

function readBytesAt(fd, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const read = readSync(fd, buffer, offset, length - offset, position + offset);
    if (read === 0) break;
    offset += read;
  }
  return buffer.subarray(0, offset);
}

function captureFile(path, limit) {
  const size = statSync(path).size;
  const marker = Buffer.from("\n...[truncated]...\n");
  const fd = openSync(path, "r");
  let raw;
  try {
    if (size <= limit) raw = readBytesAt(fd, size, 0);
    else {
      const budget = Math.max(0, limit - marker.length);
      const head = Math.ceil(budget / 2);
      const tail = budget - head;
      raw = Buffer.concat([readBytesAt(fd, head, 0), marker, tail > 0 ? readBytesAt(fd, tail, size - tail) : Buffer.alloc(0)]);
    }
  } finally { closeSync(fd); }
  const redacted = Buffer.from(redactEvidenceText(raw.toString("utf8")));
  const captured = boundedBytes(redacted, limit);
  return {
    bytes: size,
    captured_bytes: captured.length,
    truncated: size > limit || redacted.length > limit,
    sha256: hashBytes(captured),
    content: captured.toString("utf8"),
  };
}

function captureNpmDebugLogs(stagingRoot, broker) {
  const logsRoot = join(stagingRoot, "npm-cache", "_logs");
  try { broker.assertRead(logsRoot, { root: "persistent_parent", type: "directory" }); } catch { return { files: [], omitted_files: 0 }; }
  const entries = readdirSync(logsRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && NPM_DEBUG_LOG_NAME.test(entry.name))
    .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
  const files = [];
  let aggregate = 0;
  let omitted = Math.max(0, entries.length - FAILURE_EVIDENCE_MAX_LOG_FILES);
  for (const entry of entries.slice(0, FAILURE_EVIDENCE_MAX_LOG_FILES)) {
    const path = join(logsRoot, entry.name);
    const remaining = FAILURE_EVIDENCE_MAX_LOG_AGGREGATE_BYTES - aggregate;
    if (remaining <= 0) { omitted += 1; continue; }
    try {
      broker.assertRead(path, { root: "persistent_parent", type: "file" });
      if (lstatSync(path).isSymbolicLink()) { omitted += 1; continue; }
      const captured = captureFile(path, Math.min(FAILURE_EVIDENCE_MAX_LOG_BYTES, remaining));
      aggregate += captured.captured_bytes;
      files.push({ path: `npm-cache/_logs/${entry.name}`, ...captured });
    } catch { omitted += 1; }
  }
  return { files, omitted_files: omitted };
}

function writeJson(path, value, mode = 0o600) {
  writeFileSync(path, `${canonicalize(value)}\n`, { mode });
  chmodSync(path, mode);
}

function listRegularFiles(root, current = root, result = []) {
  for (const name of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, name.name);
    if (name.isDirectory()) listRegularFiles(root, path, result);
    else if (name.isFile()) result.push({ path: relative(root, path).replaceAll("\\", "/"), absolute: path });
    else if (name.isSymbolicLink()) continue;
    else throw new Error(`unexpected authority entry:${relative(root, path)}`);
  }
  return result.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
}

function buildChecksums(root, { exclude = ["checksums.sha256"] } = {}) {
  return listRegularFiles(root).filter(entry => !exclude.includes(entry.path)).map(entry => `${hashFile(entry.absolute)}  ${entry.path}`).join("\n") + "\n";
}

function writeChecksums(root, { owned = null } = {}) {
  const path = join(root, "checksums.sha256");
  if (owned) owned.write(path, buildChecksums(root), 0o600);
  else { writeFileSync(path, buildChecksums(root), { mode: 0o600 }); chmodSync(path, 0o600); }
  return path;
}

function verifyChecksums(root, { exactFiles = null } = {}) {
  const path = join(root, "checksums.sha256");
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean);
  const seen = new Set();
  for (const line of lines) {
    const match = /^(?<hash>[0-9a-f]{64})  (?<path>[^\0\r\n]+)$/.exec(line);
    if (!match || match.groups.path.startsWith("/") || match.groups.path.includes("\\") || match.groups.path.includes("\0") || match.groups.path.split("/").includes("..") || match.groups.path.split("/").includes("") || match.groups.path === "." || posix.normalize(match.groups.path) !== match.groups.path) throw new Error("invalid checksums");
    if (seen.has(match.groups.path)) throw new Error("duplicate checksum path");
    seen.add(match.groups.path);
    if (hashFile(join(root, match.groups.path)) !== match.groups.hash) throw new Error(`checksum mismatch:${match.groups.path}`);
  }
  if (exactFiles) {
    const expected = new Set(exactFiles);
    if (expected.size !== seen.size || [...expected].some(path => !seen.has(path))) throw new Error("checksums do not cover exact file set");
  }
  return { valid: true, files: [...seen].sort() };
}

function claimPath(parent, runId) { return join(parent, ".run-claims", `${runId}.json`); }
function failureEvidencePath(parent, runId) { return join(parent, ".run-claims", `${runId}.failure-evidence.json`); }

function writeFailureEvidence({ parent, runId, planSha256, journalStage, error, stagingRoot, broker }) {
  const failure = commandFailureDetails(error);
  const npmLogs = failure?.operation_id?.startsWith("npm.")
    ? captureNpmDebugLogs(stagingRoot, broker)
    : { files: [], omitted_files: 0 };
  const payload = {
    schema: FAILURE_EVIDENCE_SCHEMA,
    run_id: runId,
    plan_sha256: planSha256,
    journal_stage: journalStage || "RUN_CLAIMED",
    command_registry_operation_id: failure?.operation_id || null,
    command_exit_code: failure?.exit_code ?? null,
    stdout: captureText(failure?.stdout || ""),
    stderr: captureText(failure?.stderr || ""),
    npm_debug_logs: npmLogs.files,
    npm_debug_logs_omitted: npmLogs.omitted_files,
    limits: {
      text_bytes: FAILURE_EVIDENCE_MAX_TEXT_BYTES,
      log_file_bytes: FAILURE_EVIDENCE_MAX_LOG_BYTES,
      log_aggregate_bytes: FAILURE_EVIDENCE_MAX_LOG_AGGREGATE_BYTES,
      log_files: FAILURE_EVIDENCE_MAX_LOG_FILES,
    },
  };
  const path = failureEvidencePath(parent, runId);
  const bytes = Buffer.from(`${canonicalize(payload)}\n`);
  if (broker) broker.atomicCreate(path, bytes, 0o600);
  else {
    const fd = openSync(path, "wx", 0o600);
    try { require("node:fs").writeFileSync(fd, bytes); } finally { closeSync(fd); }
    chmodSync(path, 0o600);
  }
  return path;
}

function claimRun({ parent, runId, planSha256, claimedAt = new Date().toISOString(), broker = null }) {
  if (broker && typeof broker.validateOwnedParent === "function") broker.validateOwnedParent(parent);
  const directory = join(parent, ".run-claims");
  if (broker) broker.recheckBeforeMutation(directory, { root: "persistent_parent", mustExist: false });
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const path = claimPath(parent, runId);
  const payload = Buffer.from(`${canonicalize({ run_id: runId, plan_sha256: planSha256, claimed_at: claimedAt, outcome: null })}\n`);
  if (broker) broker.atomicCreate(path, payload, 0o600);
  else {
    const fd = openSync(path, "wx", 0o600);
    try { writeFileSync(fd, payload); } finally { closeSync(fd); }
    chmodSync(path, 0o600);
  }
  return path;
}

function updateClaim(path, outcome, updatedAt = new Date().toISOString(), broker = null) {
  if (!["FAILED", "PUBLISHED"].includes(outcome)) throw new Error("invalid claim outcome");
  const current = JSON.parse(readFileSync(path, "utf8"));
  const next = { run_id: current.run_id, plan_sha256: current.plan_sha256, claimed_at: current.claimed_at, outcome };
  const temp = `${path}.tmp-${process.pid}`;
  if (broker) {
    broker.atomicCreate(temp, Buffer.from(`${canonicalize(next)}\n`), 0o600);
    broker.atomicRename(temp, path, { root: "persistent_parent" });
  } else {
    writeJson(temp, next);
    renameSync(temp, path);
  }
  chmodSync(path, 0o600);
}

module.exports = { hashBytes, hashFile, writeJson, listRegularFiles, buildChecksums, writeChecksums, verifyChecksums, claimPath, failureEvidencePath, writeFailureEvidence, claimRun, updateClaim };

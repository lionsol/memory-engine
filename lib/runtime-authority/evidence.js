const { createHash } = require("node:crypto");
const {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { join, posix, relative } = require("node:path");
const { canonicalize } = require("./canonical-json.js");

function hashBytes(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function hashFile(path) { return hashBytes(readFileSync(path)); }

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

module.exports = { hashBytes, hashFile, writeJson, listRegularFiles, buildChecksums, writeChecksums, verifyChecksums, claimPath, claimRun, updateClaim };

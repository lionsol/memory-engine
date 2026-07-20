import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const LIBRARY = readFileSync(path.join(ROOT, "lib/ops/synthetic-host-plugin-metadata-manifest.js"), "utf8");
const CLI = readFileSync(path.join(ROOT, "bin/run-host-plugin-metadata-manifest-smoke.js"), "utf8");
const BIN_PACKAGE = JSON.parse(readFileSync(path.join(ROOT, "bin/package.json"), "utf8"));

test("R3A production files remain synthetic, read-only, and dependency-free", () => {
  for (const source of [LIBRARY, CLI]) {
    assert.doesNotMatch(source, /\.openclaw|OPENCLAW_STATE_DIR|openclaw\.sqlite|main\.sqlite|memory-engine\.sqlite/);
    assert.doesNotMatch(source, /node:sqlite|child_process|process\.env/);
    assert.doesNotMatch(source, /from ["'].*(?:OpenClaw|plugin|discovery|LanceDB)/i);
    assert.doesNotMatch(source, /(?:spawn|spawnSync|execFile|execFileSync|execSync)\s*\(/);
    assert.doesNotMatch(source, /--path|--file|--state-dir|--manifest|--root/);
  }
});

test("manifest constants, canonical serialization, and atomic publication are explicit", () => {
  assert.match(LIBRARY, /TEMP_PREFIX = ["']memory-engine-r3a-["']/);
  assert.match(LIBRARY, /MANIFEST_NAME = ["']memory-engine\.install-metadata\.json["']/);
  assert.match(LIBRARY, /function sortedValue/);
  assert.match(LIBRARY, /Object\.keys\(value\)\.sort/);
  assert.match(LIBRARY, /detectDuplicateJsonKeys/);
  assert.match(LIBRARY, /manifest_duplicate_key/);
  assert.match(LIBRARY, /O_CREAT/);
  assert.match(LIBRARY, /O_EXCL/);
  assert.match(LIBRARY, /O_WRONLY/);
  assert.match(LIBRARY, /O_NOFOLLOW/);
  assert.match(LIBRARY, /fsyncSync\(fd\)/);
  assert.match(LIBRARY, /renameSync\(tempPath, finalPath\)/);
  assert.match(LIBRARY, /0o600/);
  assert.match(LIBRARY, /MANIFEST_MAX_BYTES = 64 \* 1024/);
  assert.match(LIBRARY, /state === "absent"/);
  assert.match(LIBRARY, /disabled-by-host-policy/);
});

test("consumer uses descriptor identity checks and does not inspect install paths", () => {
  assert.match(LIBRARY, /openSync\(finalPath/);
  assert.match(LIBRARY, /fstatSync\(descriptor/);
  assert.match(LIBRARY, /sameIdentity/);
  assert.match(LIBRARY, /manifest_link_count_invalid/);
  assert.match(LIBRARY, /manifest_permissions_invalid/);
  assert.match(LIBRARY, /manifest_changed_during_read/);
  assert.match(LIBRARY, /source_type: "host_published_plugin_metadata_manifest"/);
  assert.match(LIBRARY, /observable_write_detected/);
  assert.match(LIBRARY, /fingerprintManifestArtifacts/);
  assert.doesNotMatch(LIBRARY, /function fingerprintFileTree/);
});

test("smoke separates expected invalid scenarios from unexpected failures", () => {
  assert.match(LIBRARY, /expected_valid/);
  assert.match(LIBRARY, /actual_valid/);
  assert.match(LIBRARY, /expected_block/);
  assert.match(LIBRARY, /unexpected_failures/);
  assert.match(LIBRARY, /scenario_validity_mismatch/);
  assert.match(LIBRARY, /duplicate-manifest-key/);
  assert.match(LIBRARY, /atomic_snapshot_mismatch/);
  assert.match(LIBRARY, /final-hardlink/);
  assert.match(LIBRARY, /manifest_hardlink/);
});

test("CLI preserves the CommonJS lazy-import boundary", () => {
  assert.equal(BIN_PACKAGE.type, "commonjs");
  assert.match(CLI, /await import\(["']\.\.\/lib\/ops\/synthetic-host-plugin-metadata-manifest\.js["']\)/);
  assert.match(CLI, /module\.exports\s*=\s*\{\s*main/s);
  assert.match(CLI, /require\.main === module/);
  assert.doesNotMatch(CLI, /^\s*import\s+/m);
  assert.match(CLI, /return 64/);
});

test("R3A decisions never authorize host or production access", () => {
  assert.match(LIBRARY, /BLOCKED \/ ATOMICITY OR READ-ONLY CONTRACT NOT PROVEN/);
  assert.match(LIBRARY, /PASSED \/ HOST INTEGRATION SOURCE AUDIT REQUIRED/);
  assert.match(LIBRARY, /production_authorized: false/);
  assert.doesNotMatch(LIBRARY, /production ready|host integration accepted|A7 authorized/i);
});

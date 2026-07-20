import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const LIBRARY = readFileSync(path.join(ROOT, "lib/ops/sqlite-readonly-feasibility.js"), "utf8");
const CLI = readFileSync(path.join(ROOT, "bin/run-openclaw-state-db-readonly-feasibility-smoke.js"), "utf8");

test("synthetic feasibility production files stay outside real runtime boundaries", () => {
  for (const source of [LIBRARY, CLI]) {
    assert.doesNotMatch(source, /\.openclaw|openclaw\.sqlite|main\.sqlite|memory-engine\.sqlite/);
    assert.doesNotMatch(source, /OPENCLAW_STATE_DIR/);
    assert.doesNotMatch(source, /from ["'].*(?:openclaw|memory-engine|lancedb)/i);
    assert.doesNotMatch(source, /import\s+[^;]+(?:plugin|discovery|loader|lancedb)/i);
    assert.doesNotMatch(source, /node:child_process|from ["']child_process["']/);
    assert.doesNotMatch(source, /\b(?:spawn|spawnSync|execFile|execFileSync|execSync)\s*\(/);
  }
});

test("synthetic feasibility uses a private temporary family and fixed synthetic database name", () => {
  assert.match(LIBRARY, /mkdtempSync\(path\.join\(tmpdir\(\), TEMP_PREFIX\)\)/);
  assert.match(LIBRARY, /TEMP_PREFIX = ["']memory-engine-r2b-["']/);
  assert.match(LIBRARY, /DATABASE_NAME = ["']r2b-synthetic-state\.sqlite["']/);
  assert.match(LIBRARY, /rmSync\(tempRoot, \{ recursive: true, force: true \}\)/);
  assert.match(LIBRARY, /new DatabaseSync\(.*readOnly: true/s);
  assert.match(LIBRARY, /installed_plugin_index/);
  assert.match(LIBRARY, /lstatSync\([^)]*\{ bigint: true \}/);
  assert.match(LIBRARY, /CHECKPOINT_REVISION/);
  assert.match(LIBRARY, /WAL_REVISION/);
  assert.match(LIBRARY, /expected_revision/);
  assert.match(LIBRARY, /observed_revision/);
});

test("CLI accepts only json output mode and rejects external database paths", () => {
  assert.match(CLI, /arg !== ["']--json["']/);
  assert.doesNotMatch(CLI, /--db|--path|--state-dir/);
  assert.doesNotMatch(CLI, /process\.env/);
});

test("decision and report boundaries do not authorize production access", () => {
  assert.match(LIBRARY, /ZERO-WRITE OR FRESHNESS NOT PROVEN/);
  assert.match(LIBRARY, /SYSCALL PROOF REQUIRED/);
  assert.match(LIBRARY, /real_path_accessed: false/);
  assert.match(LIBRARY, /plugin_imported: false/);
  assert.match(CLI, /process\.exitCode = 64/);
});

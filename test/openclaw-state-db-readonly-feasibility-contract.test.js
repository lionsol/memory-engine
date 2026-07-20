import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const LIBRARY = readFileSync(path.join(ROOT, "lib/ops/sqlite-readonly-feasibility.js"), "utf8");
const CLI = readFileSync(path.join(ROOT, "bin/run-openclaw-state-db-readonly-feasibility-smoke.js"), "utf8");
const BIN_PACKAGE = JSON.parse(readFileSync(path.join(ROOT, "bin/package.json"), "utf8"));

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
  assert.match(LIBRARY, /POST_OPEN_WAL_REVISION/);
  assert.match(LIBRARY, /database\.location\(\)/);
  assert.match(LIBRARY, /normal_post_update_revision/);
  assert.match(LIBRARY, /immutable_post_update_revision/);
  assert.match(LIBRARY, /immutable_candidate_allowed/);
  assert.match(LIBRARY, /reader_phase_1_diff/);
  assert.match(LIBRARY, /reader_phase_2_diff/);
  assert.match(LIBRARY, /probeSqlWriteRejections/);
  assert.match(LIBRARY, /classifyImmutableBehavior/);
  assert.match(LIBRARY, /immutable_database_shape_not_verified/);
  assert.match(LIBRARY, /immutable_initial_query_failed/);
  assert.match(LIBRARY, /immutable_post_update_query_failed/);
  assert.match(LIBRARY, /initial-query-failed/);
  assert.match(LIBRARY, /retained-stale-snapshot/);
  assert.match(LIBRARY, /immutable_candidate_allowed/);
  assert.match(LIBRARY, /expected_revision/);
  assert.match(LIBRARY, /observed_revision/);
  assert.match(LIBRARY, /database\.location\(\)/);
  assert.match(LIBRARY, /normal_post_update_revision/);
  assert.match(LIBRARY, /immutable_post_update_revision/);
  assert.match(LIBRARY, /immutable_candidate_allowed/);
  assert.match(LIBRARY, /reader_phase_1_diff/);
  assert.match(LIBRARY, /reader_phase_2_diff/);
});

test("CLI accepts only json output mode and rejects external database paths", () => {
  assert.match(CLI, /arg !== ["']--json["']/);
  assert.doesNotMatch(CLI, /--db|--path|--state-dir/);
  assert.doesNotMatch(CLI, /process\.env/);
});

test("CLI preserves the CommonJS module boundary and lazy-loads the ESM library", () => {
  assert.equal(BIN_PACKAGE.type, "commonjs");
  assert.match(CLI, /await import\(["']\.\.\/lib\/ops\/sqlite-readonly-feasibility\.js["']\)/);
  assert.match(CLI, /module\.exports\s*=\s*\{\s*main/s);
  assert.match(CLI, /require\.main === module/);
  assert.doesNotMatch(CLI, /^\s*import\s+/m);
  assert.match(LIBRARY, /mkdtempSync/);
  assert.match(LIBRARY, /from "node:fs"/);
  assert.match(LIBRARY, /import \{ tmpdir \} from "node:os"/);
  assert.doesNotMatch(LIBRARY, /import \{[^}]*mkdtempSync[^}]*\} from "node:os"/s);
});

test("decision and report boundaries do not authorize production access", () => {
  assert.match(LIBRARY, /ZERO-WRITE OR FRESHNESS NOT PROVEN/);
  assert.match(LIBRARY, /SYSCALL PROOF REQUIRED/);
  assert.match(LIBRARY, /real_path_accessed: false/);
  assert.match(LIBRARY, /plugin_imported: false/);
  assert.match(CLI, /process\.exitCode = 64/);
});

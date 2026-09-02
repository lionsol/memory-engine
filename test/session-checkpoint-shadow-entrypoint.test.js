import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const legacyScriptPath = resolve(repoRoot, "..", "..", "scripts", "session-checkpoint.js");

const FORBIDDEN_LEGACY_PATTERNS = [
  "WHERE mc.category = 'raw_log'",
  "ORDER BY c.updated_at DESC",
  "LIMIT 100",
  ".jsonl.reset.",
  "llmNightlyExtract",
  "llmComplete",
  "readCheckpointRawLogs",
  "readYesterdayRawLogs",
];

test("legacy workspace session-checkpoint script is a thin shim to plugin canonical entrypoint", () => {
  assert.equal(existsSync(legacyScriptPath), true, `missing legacy checkpoint script: ${legacyScriptPath}`);
  const source = readFileSync(legacyScriptPath, "utf8");

  assert.match(source, /^#!\/usr\/bin\/env node/m);
  assert.match(source, /plugins\/memory-engine\/bin\/session-checkpoint\.js/);
  assert.match(source, /process\.argv\.slice\(2\)/);
  assert.match(source, /stdio:\s*"inherit"/);
  assert.match(source, /env:\s*process\.env/);

  for (const pattern of FORBIDDEN_LEGACY_PATTERNS) {
    assert.equal(
      source.includes(pattern),
      false,
      `legacy checkpoint shim must not contain implementation detail: ${pattern}`,
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL(
  "../lib/recall/hybrid/legacy-fallback-code-inventory.js",
  import.meta.url,
), "utf8");
const cliSource = readFileSync(new URL(
  "../bin/audit-legacy-fallback-code-inventory.js",
  import.meta.url,
), "utf8");

test("inventory production code is read-only and runtime-independent", () => {
  assert.match(source, /buildLegacyFallbackCodeInventory/);
  assert.match(source, /collectLegacyFallbackInventoryFiles/);
  assert.match(source, /readFileSync/);
  assert.doesNotMatch(source, /better-sqlite3/);
  assert.doesNotMatch(source, /hybridSearch\s*\(/);
  assert.doesNotMatch(source, /writeFileSync|unlinkSync|rmSync/);
  assert.doesNotMatch(source, /openclaw\/plugin-sdk/);
});

test("inventory CLI only reads bounded repository files", () => {
  assert.match(cliSource, /--root/);
  assert.match(cliSource, /realpathSync/);
  assert.match(cliSource, /auditLegacyFallbackCodeInventory/);
  assert.doesNotMatch(cliSource, /better-sqlite3|hybridSearch\s*\(/);
  assert.doesNotMatch(cliSource, /writeFileSync|unlinkSync|rmSync/);
  assert.doesNotMatch(cliSource, /child_process|spawnSync/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const cliPath = resolve(repoRoot, "bin/audit-legacy-fallback-code-inventory.js");
const require = createRequire(import.meta.url);
const { auditLegacyFallbackCodeInventory } = require(cliPath);

function makeFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-inventory-"));
  mkdirSync(resolve(root, ".git"));
  mkdirSync(resolve(root, "lib"));
  writeFileSync(resolve(root, "package.json"), JSON.stringify({ name: "memory-engine-plugin" }));
  return root;
}

async function runCli(root) {
  return auditLegacyFallbackCodeInventory(["--root", root]);
}

test("CLI returns complete report with exit 0 when no dynamic references exist", async () => {
  const root = makeFixture();
  writeFileSync(resolve(root, "lib/example.js"), "export const value = 1;\n");
  const result = await runCli(root);
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(result.output);
  assert.equal(report.inventory_complete, true);
  assert.equal(report.known_dynamic_references, 0);
});

test("CLI returns exit 1 for complete inventory with dynamic references", async () => {
  const root = makeFixture();
  writeFileSync(resolve(root, "lib/example.js"), ["const accessor = scope[", "key];\n"].join(""));
  const result = await runCli(root);
  assert.equal(result.exitCode, 1);
  const report = JSON.parse(result.output);
  assert.equal(report.inventory_complete, true);
  assert.equal(report.known_dynamic_references, 1);
});

test("CLI returns exit 2 when an allowed source symlink is skipped", async () => {
  const root = makeFixture();
  const outside = resolve(root, "..", "inventory-outside.js");
  writeFileSync(outside, "export const value = 1;\n");
  symlinkSync(outside, resolve(root, "lib/outside.js"));
  const result = await runCli(root);
  assert.equal(result.exitCode, 2);
  const report = JSON.parse(result.output);
  assert.equal(report.inventory_complete, false);
  assert.ok(report.skipped_files.some(value => value.startsWith("lib/outside.js")));
});

test("CLI rejects an invalid or overly broad root", async () => {
  await assert.rejects(
    () => runCli("/tmp"),
    /invalid inventory root|memory-engine repository|\.git|too broad/,
  );
});

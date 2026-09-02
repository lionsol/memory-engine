import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const applyScriptPath = resolve(repoRoot, "bin/apply-smart-add-duplicate-cleanup.js");
const packageJsonPath = resolve(repoRoot, "package.json");
const validatorPath = resolve(repoRoot, "bin/validate-smart-add-duplicate-cleanup-manifest.js");

function read(path) {
  return readFileSync(path, "utf8");
}

test("static repo guard confirms no apply CLI or package script exists yet", () => {
  assert.equal(existsSync(applyScriptPath), false);

  const packageJson = JSON.parse(read(packageJsonPath));
  const scripts = packageJson?.scripts || {};
  assert.equal(Object.values(scripts).some(value => String(value).includes("apply-smart-add-duplicate-cleanup")), false);
});

test("existing validator remains read-only and does not expose apply flag", () => {
  const source = read(validatorPath);
  assert.equal(source.includes("--apply"), false);
});

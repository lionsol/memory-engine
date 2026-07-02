import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const designDocPath = resolve(repoRoot, "docs/smart-add-duplicate-cleanup-apply-design.md");
const applyScriptPath = resolve(repoRoot, "bin/apply-smart-add-duplicate-cleanup.js");
const packageJsonPath = resolve(repoRoot, "package.json");
const validatorPath = resolve(repoRoot, "bin/validate-smart-add-duplicate-cleanup-manifest.js");

function read(path) {
  return readFileSync(path, "utf8");
}

test("design doc exists", () => {
  assert.equal(existsSync(designDocPath), true);
});

test("design doc contains required command gates", () => {
  const doc = read(designDocPath);
  assert.equal(doc.includes("--apply"), true);
  assert.equal(doc.includes("--manifest <path>"), true);
  assert.equal(doc.includes("--confirm-smart-add-duplicate-cleanup"), true);
});

test("design doc requires current safety chain", () => {
  const doc = read(designDocPath);
  assert.equal(doc.includes("smoke:smart-add-duplicates"), true);
  assert.equal(doc.includes("preview:smart-add-duplicate-cleanup"), true);
  assert.equal(doc.includes("validate-smart-add-duplicate-cleanup-manifest.js"), true);
});

test("design doc requires no mutation before backup succeeds", () => {
  const doc = read(designDocPath);
  assert.equal(doc.includes("No deletion may occur before backup succeeds."), true);
});

test("design doc requires transaction rollback on error", () => {
  const doc = read(designDocPath);
  assert.equal(doc.includes("Transaction must rollback on any error."), true);
});

test("design doc forbids rewriting real memory markdown files in first implementation", () => {
  const doc = read(designDocPath);
  assert.equal(doc.includes("The first apply implementation must not rewrite real memory markdown files."), true);
});

test("design doc forbids touching retrieved and injected chunks in first implementation", () => {
  const doc = read(designDocPath);
  assert.equal(doc.includes("The first apply implementation must not touch retrieved or injected chunks."), true);
});

test("design doc limits first implementation to validator would_delete items", () => {
  const doc = read(designDocPath);
  assert.equal(doc.includes("The first implementation may only delete indexed duplicate rows that correspond exactly to validator `would_delete` items."), true);
});

test("design doc explicitly lists non-goals for this phase", () => {
  const doc = read(designDocPath);
  assert.equal(doc.includes("This phase does not implement:"), true);
  assert.equal(doc.includes("- apply CLI"), true);
  assert.equal(doc.includes("- DB deletion"), true);
  assert.equal(doc.includes("- markdown memory file rewrite"), true);
  assert.equal(doc.includes("- automatic approval"), true);
});

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

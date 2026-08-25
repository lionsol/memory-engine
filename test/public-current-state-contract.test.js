import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const currentStatePath = join(root, "docs/current-state.md");
const currentState = readFileSync(currentStatePath, "utf8");

function unpublishedHashes() {
  try {
    return execFileSync(
      "git",
      ["rev-list", "origin/main..archive/private-main-20260804-null-semantics"],
      { cwd: root, encoding: "utf8" },
    ).trim().split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

test("public current-state authority exists and states public safety contracts", () => {
  assert.equal(existsSync(currentStatePath), true);
  assert.match(currentState, /does not[\s>]+generalize them to unrelated private deployments\./);
  assert.match(currentState, /AutoRecall is disabled by default\./);
  assert.match(currentState, /Core storage is read-only from memory-engine/);
  assert.match(currentState, /writes to Core-owned data are prohibited/);
});

test("public current-state authority contains no private deployment evidence", () => {
  assert.doesNotMatch(currentState, /\/home\/lionsol|\.openclaw|backups\/memory-engine|evidence[_-]?root/i);
  assert.doesNotMatch(currentState, /\b(?:gateway|console)_pid\s*=/i);
  assert.doesNotMatch(currentState, /\bPID\s*=/i);
  for (const hash of unpublishedHashes()) {
    assert.equal(currentState.includes(hash), false, `private unpublished hash leaked: ${hash}`);
  }
});

test("removed private handoff files are absent", () => {
  for (const relativePath of [
    "docs/session-handoff-2026-07-30-h5.md",
    "docs/session-handoff-2026-08-01-anti-drift.md",
    "docs/session-handoff-2026-08-04-low-coverage-audit.md",
    "docs/smoke-tests/personal-runtime-persistent-artifact-freeze-model-repair-design-20260722.md",
    "test/current-state-post-h6-authority.test.js",
  ]) {
    assert.equal(existsSync(join(root, relativePath)), false, relativePath);
  }
});

test("public documentation does not depend on private AGENTS instructions", () => {
  for (const relativePath of [
    "README.md",
    "docs/README.md",
    "docs/openclaw-memory-contract-compat.md",
  ]) {
    const content = readFileSync(join(root, relativePath), "utf8");
    assert.equal(
      content.match(/AGENTS\.md/g)?.length ?? 0,
      0,
      `${relativePath} references private AGENTS instructions`,
    );
  }
});

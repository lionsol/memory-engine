import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const INDEX = new URL("../docs/smoke-tests/README.md", import.meta.url);

function readIndex() {
  return readFileSync(INDEX, "utf8");
}

test("smoke tests index exists", () => {
  assert.equal(existsSync(INDEX), true);
});

test("smoke tests index links available runbooks", () => {
  const index = readIndex();
  for (const token of [
    "console-annotation-report-handoff.md",
    "openclaw-memory-tools.md",
    "full-fail-closed-safety-smoke.md",
    "full-fail-closed-runtime-rollout.md",
    "tool-surface-runtime-access-audit.md",
    "openclaw-no-load-plugin-metadata-audit.md",
    "Console `/reports` ↔ `/annotations` GUI handoff",
    "OpenClaw memory tool contract",
    "memory-core / memory-engine split",
    "F1-D-B8-A5 Hybrid Search full fail-closed matrix",
    "F1-D-B8-A6.2 registry vs effective tool visibility audit",
  ]) {
    assert.equal(index.includes(token), true, `missing smoke index token: ${token}`);
  }
});

test("smoke tests index preserves Console handoff safety boundary", () => {
  const index = readIndex();
  for (const token of [
    "Read-only report fetches only",
    "no label upload",
    "DB write",
    "memory mutation",
    "apply",
    "unarchive",
    "category update",
    "delete",
    "quarantine",
    "reinforce",
    "LLM call",
  ]) {
    assert.equal(index.includes(token), true, `missing safety token: ${token}`);
  }
});

test("smoke tests index records regression guard command", () => {
  const index = readIndex();
  for (const token of [
    "npm run smoke:console-annotation-handoff",
    "npm run smoke:full-fail-closed",
    "node --test test/full-fail-closed-runtime-rollout-contract.test.js",
    "node --test test/openclaw-no-load-plugin-metadata-audit-contract.test.js",
    "node --test test/tool-surface-runtime-access-audit-doc.test.js",
    "node --test test/agent-memory-tool-strategy.test.js",
    "key links, workflow steps, and safety boundaries remain discoverable",
  ]) {
    assert.equal(index.includes(token), true, `missing regression guard token: ${token}`);
  }
});

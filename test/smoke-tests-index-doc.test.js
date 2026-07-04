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
    "Console `/reports` ↔ `/annotations` GUI handoff",
    "OpenClaw memory tool contract",
    "memory-core / memory-engine split",
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
    "node --test test/console-annotation-report-handoff-doc.test.js test/agent-memory-tool-strategy.test.js",
    "key links, workflow steps, and safety boundaries remain discoverable",
  ]) {
    assert.equal(index.includes(token), true, `missing regression guard token: ${token}`);
  }
});

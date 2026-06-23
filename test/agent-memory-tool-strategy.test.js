import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const STRATEGY_DOC = new URL("../docs/agent-memory-tool-strategy.md", import.meta.url);
const SMOKE_DOC = new URL("../docs/smoke-tests/openclaw-memory-tools.md", import.meta.url);
const MANIFEST = new URL("../openclaw.plugin.json", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

test("strategy doc exists", () => {
  assert.equal(existsSync(STRATEGY_DOC), true);
});

test("smoke test doc exists", () => {
  assert.equal(existsSync(SMOKE_DOC), true);
});

test("strategy docs describe the required architecture decisions", () => {
  const strategy = read(STRATEGY_DOC);
  const smoke = read(SMOKE_DOC);
  const combined = `${strategy}\n${smoke}`;

  assert.match(combined, /memory-core is the OpenClaw standard memory substrate/i);
  assert.match(combined, /memory-engine is an enhancement (and|\/) governance layer|memory-engine is an enhancement and governance layer/i);
  assert.match(combined, /memory_search\s*\/\s*memory_get belong to .*memory-core|memory_search.*memory-core/i);
  assert.match(combined, /memory_engine_search\s*\/\s*memory_engine_get belong to .*memory-engine|memory_engine_search.*memory-engine/i);
  assert.match(combined, /memory_engine remains the management( and|\/) action router|memory_engine remains the management and action router/i);
  assert.match(combined, /must not shadow .*memory_search.*memory_get/i);
});

test("docs warn against enabling active-memory and memory-engine autoRecall together", () => {
  const combined = `${read(STRATEGY_DOC)}\n${read(SMOKE_DOC)}`;
  assert.match(combined, /active-memory.*memory-engine autoRecall.*(not both|should not both|unless dedup|without dedup)/i);
});

test("docs include ambiguous id prefix guidance for memory_engine_get", () => {
  const combined = `${read(STRATEGY_DOC)}\n${read(SMOKE_DOC)}`;
  assert.match(combined, /memory_engine_get/i);
  assert.match(combined, /ambiguous.*prefix/i);
  assert.match(combined, /longer prefix/i);
});

test("manifest exposes memory_engine, memory_engine_search, memory_engine_get only", () => {
  const manifest = JSON.parse(read(MANIFEST));
  assert.deepEqual(manifest.contracts.tools, [
    "memory_engine",
    "memory_engine_search",
    "memory_engine_get",
  ]);
});

test("manifest does not expose memory_search or memory_get", () => {
  const manifest = JSON.parse(read(MANIFEST));
  assert.equal(manifest.contracts.tools.includes("memory_search"), false);
  assert.equal(manifest.contracts.tools.includes("memory_get"), false);
});

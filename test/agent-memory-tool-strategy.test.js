import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MANIFEST = new URL("../openclaw.plugin.json", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

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

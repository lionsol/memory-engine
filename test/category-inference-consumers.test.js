import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { inferCategoryFromPath } from "../lib/category-inference.js";

test("hybrid-search inferCategoryFromPath stays consistent with shared rules", async () => {
  const { inferCategoryFromPath: inferHybridCategoryFromPath } = await import("../lib/recall/hybrid-search.js");
  const samples = [
    "memory.md",
    "memory/projects/roadmap.md",
    "memory/2026-06-08.md",
    "memory/dreaming/night.md",
    "memory/stats-history.md",
    "memory/episodes/e1.md",
    "memory/smart-add/2026-06-08.md",
    "docs/other.md",
  ];

  for (const sample of samples) {
    assert.equal(inferHybridCategoryFromPath(sample), inferCategoryFromPath(sample), sample);
  }
});

test("console memory normalization uses the shared path rules for external memories", async () => {
  const source = readFileSync(new URL("../console/services/memory-service.js", import.meta.url), "utf8");
  const transformed = source
    .replace(/^import[^\n]*\n/gm, "")
    .replace(/export function /g, "function ");
  const context = {
    ensureMemoryConfidenceTable: () => {},
    recordEvent: () => {},
    safeJson: () => null,
    tableExists: () => true,
    withDb: fn => fn({}),
    inferCategoryFromPath,
  };
  vm.runInNewContext(`${transformed}\nthis.__normalizeMemory = normalizeMemory;`, context);
  const normalizeMemory = context.__normalizeMemory;

  const normalized = normalizeMemory({
    id: "chunk-1",
    path: "memory/smart-add/2026-06-08.md",
    text: "hello",
    confidence: null,
  });
  assert.equal(normalized.category, "raw_log");
  assert.equal(normalized.confidence_mode, "external");
});

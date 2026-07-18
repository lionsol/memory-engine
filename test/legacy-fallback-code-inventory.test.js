import test from "node:test";
import assert from "node:assert/strict";

import { buildLegacyFallbackCodeInventory } from "../lib/recall/hybrid/legacy-fallback-code-inventory.js";

function inventory(fileEntries) {
  return buildLegacyFallbackCodeInventory({ rootDir: "/fixture/memory-engine", fileEntries });
}

test("Recent definitions and call sites are counted separately", () => {
  const report = inventory([{
    path: "lib/recall/hybrid/channels/recent.js",
    content: [
      "async function collectLegacyRecentCandidates(ctx) {}",
      "return collectLegacyRecentCandidates(ctx);",
    ].join("\n"),
  }]);
  assert.equal(report.legacy_query_definitions, 1);
  assert.equal(report.legacy_query_call_sites, 1);
  assert.equal(report.categories.recent_query_definitions[0].line, 1);
  assert.equal(report.categories.recent_query_call_sites[0].line, 2);
});

test("KG legacy query definitions and call sites are classified separately", () => {
  const report = inventory([{
    path: "lib/recall/hybrid/channels/kg.js",
    content: [
      "function selectLegacyKgRows(db) {}",
      "return selectLegacyKgRows(db);",
    ].join("\n"),
  }]);
  assert.equal(report.categories.kg_query_definitions.length, 1);
  assert.equal(report.categories.kg_query_call_sites.length, 1);
});

test("contract-test forbidden strings are not runtime dependencies", () => {
  const report = inventory([{
    path: "test/example-contract.test.js",
    content: 'const forbidden = ["withLegacyDb", "collectLegacyRecentCandidates"];',
  }]);
  assert.equal(report.tests_requiring_legacy_fallback, 0);
  assert.equal(report.categories.tests_forbidding_legacy_dependencies.length, 2);
});

test("runtime tests requiring legacy fallback remain visible", () => {
  const report = inventory([{
    path: "test/runtime-fallback.test.js",
    content: 'const result = policy("legacy_fallback");',
  }]);
  assert.equal(report.tests_requiring_legacy_fallback, 1);
  assert.equal(report.categories.tests_requiring_legacy_fallback[0].execution_relevant, true);
});

test("metrics and observation references are non-executable categories", () => {
  const report = inventory([
    {
      path: "console/services/metrics-service.js",
      content: 'metadata.kg_access_mode === "legacy_fallback";',
    },
    {
      path: "lib/recall/hybrid-observation.js",
      content: 'debug.recent_runtime_mode = "legacy_fallback";',
    },
  ]);
  assert.ok(report.categories.metrics_only_references.length > 0);
  assert.ok(report.categories.observation_only_references.length > 0);
  assert.equal(report.categories.metrics_only_references.every(item => item.execution_relevant === false), true);
  assert.equal(report.categories.observation_only_references.every(item => item.execution_relevant === false), true);
  assert.equal(report.config_modes_referencing_legacy_fallback, 0);
});

test("legacy DB entrypoints are classified in production context", () => {
  const report = inventory([{
    path: "lib/recall/hybrid/db-access.js",
    content: [
      "runWithScope(async ({ withLegacyDb }) => {",
      "  return withLegacyDb(db => query(db));",
      "});",
    ].join("\n"),
  }]);
  assert.ok(report.legacy_db_entrypoints > 0);
  assert.equal(report.categories.legacy_db_entrypoints.every(item => item.execution_relevant), true);
});

test("dynamic access is surfaced without making the inventory incomplete", () => {
  const report = inventory([{
    path: "test/dynamic-access.test.js",
    content: ["const accessor = scope[", "key];"].join(""),
  }]);
  assert.equal(report.inventory_complete, true);
  assert.equal(report.known_dynamic_references, 1);
  assert.equal(report.categories.dynamic_or_ambiguous_references[0].execution_relevant, true);
});

test("read failures make the inventory incomplete", () => {
  const report = inventory([{ path: "lib/broken.js", readError: "permission denied" }]);
  assert.equal(report.inventory_complete, false);
  assert.equal(report.parse_errors.length, 1);
  assert.equal(report.parse_errors[0].path, "lib/broken.js");
});

test("file entry order does not affect findings", () => {
  const entries = [
    { path: "lib/recall/hybrid/channels/kg.js", content: "function selectLegacyKgRows(db) {}\nselectLegacyKgRows(db);" },
    { path: "lib/recall/hybrid/channels/recent.js", content: "function collectLegacyRecentCandidates(ctx) {}" },
  ];
  const first = inventory(entries);
  const second = inventory([...entries].reverse());
  const comparable = report => ({ ...report, generated_at: "", root_dir: "" });
  assert.deepEqual(comparable(first), comparable(second));
});

test("current repository smoke finds the known production paths", async () => {
  const { collectLegacyFallbackInventoryFiles } = await import(
    "../lib/recall/hybrid/legacy-fallback-code-inventory.js"
  );
  const { fileEntries } = collectLegacyFallbackInventoryFiles({ rootDir: new URL("..", import.meta.url).pathname });
  const report = inventory(fileEntries);
  const allFindings = Object.values(report.categories).flat();
  const paths = new Set(allFindings.map(item => item.path));
  for (const expected of [
    "lib/recall/hybrid/channels/recent.js",
    "lib/recall/hybrid/channels/kg.js",
    "lib/recall/hybrid/db-access.js",
    "lib/recall/hybrid-search.js",
  ]) assert.equal(paths.has(expected), true, `missing ${expected}`);
  assert.ok(report.legacy_query_definitions > 0);
  assert.ok(report.legacy_db_entrypoints > 0);
});

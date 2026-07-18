import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const cli = require(resolve(repoRoot, "bin/audit-tool-surface-runtime-access.js"));

const catalog = resolve(repoRoot, "test/fixtures/tool-surface-catalog-memory-engine.json");
const effective = resolve(repoRoot, "test/fixtures/tool-surface-effective-coding-filtered.json");
const observations = resolve(repoRoot, "test/fixtures/tool-surface-runtime-observations.jsonl");

test("CLI classifies gateway RPC execution with filtered model visibility", async () => {
  const result = await cli.auditToolSurfaceRuntimeAccess([
    "--catalog", catalog,
    "--effective", effective,
    "--observations", observations,
    "--invocation-mode", "gateway_rpc",
    "--pretty",
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, "tool_surface_runtime_confirmed_effective_filtered");
  assert.equal(result.report.production_surface_execution_confirmed, true);
  assert.equal(result.report.model_visibility_confirmed, false);
  assert.match(result.output, /"invocation_mode": "gateway_rpc"/);
});

test("CLI accepts repeated observation reports", async () => {
  const result = await cli.auditToolSurfaceRuntimeAccess([
    "--catalog", catalog,
    "--effective", effective,
    "--observations", observations,
    "--observations", observations,
    "--invocation-mode", "gateway_rpc",
  ]);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.report.production_observed_by_surface, {
    memory_engine_action_search: 2,
    memory_engine_search: 2,
  });
});

test("CLI validates required inputs and invocation mode", async () => {
  await assert.rejects(
    () => cli.auditToolSurfaceRuntimeAccess([]),
    /--catalog is required/,
  );
  await assert.rejects(
    () => cli.auditToolSurfaceRuntimeAccess([
      "--catalog", catalog,
      "--effective", effective,
      "--observations", observations,
      "--invocation-mode", "direct_wrapper",
    ]),
    /--invocation-mode must be/,
  );
});

test("CLI source is report-only and documents gateway capture commands", () => {
  const source = readFileSync(resolve(repoRoot, "bin/audit-tool-surface-runtime-access.js"), "utf8");
  assert.match(source, /loadObservationReports/);
  assert.match(cli.usage(), /tools\.catalog/);
  assert.match(cli.usage(), /tools\.effective/);
  assert.match(cli.usage(), /never connects to the gateway/i);
  assert.doesNotMatch(source, /better-sqlite3|openEngineDb|tools\.invoke\s*\(/);
});

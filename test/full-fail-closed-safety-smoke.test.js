import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import smokeCli from "../bin/run-full-fail-closed-safety-smoke.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(repoRoot, "bin/run-full-fail-closed-safety-smoke.js");
const {
  PRODUCTION_SURFACES,
  parseArgs,
  runSmoke,
  renderMarkdown,
} = smokeCli;

const REQUIRED_CHECK_IDS = [
  "production_surfaces_observed",
  "legacy_mode_restores_fallback",
  "canary_scope_hit_suppresses_fallback",
  "canary_scope_miss_restores_fallback",
  "full_mode_suppresses_without_scope",
  "kg_full_mode_channel_isolation",
  "recent_full_mode_channel_isolation",
  "full_mode_observation_markers",
  "full_events_excluded_from_canary_metrics",
  "dynamic_rollback_restores_fallback",
];

test("full fail-closed safety smoke script exists and accepts deterministic output flags", () => {
  assert.equal(existsSync(scriptPath), true);
  assert.deepEqual(parseArgs([]), { help: false, json: true, markdown: false });
  assert.deepEqual(parseArgs(["--json"]), { help: false, json: true, markdown: false });
  assert.deepEqual(parseArgs(["--markdown"]), { help: false, json: false, markdown: true });
  assert.throws(() => parseArgs(["--json", "--markdown"]), /choose exactly one output format/);
  assert.throws(() => parseArgs(["--apply"]), /unknown argument/);
});

test("safety smoke is synthetic-only by construction", () => {
  const source = readFileSync(scriptPath, "utf8");
  assert.match(source, /new Database\(":memory:"\)/);
  assert.doesNotMatch(source, /\.openclaw\/memory|memory-engine\.sqlite|main\.sqlite/);
  assert.doesNotMatch(source, /openclaw\s+plugins\s+install|openclaw\s+restart|execFileSync|spawnSync/i);
  assert.doesNotMatch(source, /writeFileSync\([^)]*reports|--out|--apply/);
  assert.doesNotMatch(source, /fetch\(|https?:\/\//);
});

test("safety smoke covers the required production surfaces and matrix", async () => {
  const report = await runSmoke({ now: "2026-07-18T12:00:00.000Z" });
  assert.equal(report.stage, "F1-D-B8-A5");
  assert.equal(report.summary.status, "pass");
  assert.equal(report.summary.failed_count, 0);
  assert.equal(report.summary.passed_count, REQUIRED_CHECK_IDS.length);
  assert.deepEqual(report.summary.failed_check_ids, []);
  assert.deepEqual(report.summary.production_surfaces, PRODUCTION_SURFACES);
  assert.deepEqual(report.checks.map(check => check.id), REQUIRED_CHECK_IDS);
  assert.equal(report.checks.every(check => check.pass), true);
});

test("safety smoke reports the prohibited side effects as disabled", async () => {
  const report = await runSmoke({ now: "2026-07-18T12:00:00.000Z" });
  assert.deepEqual(report.side_effects, {
    real_db_access: false,
    synthetic_in_memory_sqlite: true,
    plugin_reload: false,
    openclaw_runtime: false,
    config_mutation: false,
    network: false,
    runtime_report_files: false,
    legacy_code_removal: false,
  });
});

test("markdown output names every required safety check", async () => {
  const report = await runSmoke({ now: "2026-07-18T12:00:00.000Z" });
  const markdown = renderMarkdown(report);
  assert.match(markdown, /F1-D-B8-A5 Full Fail-Closed Safety Smoke/);
  assert.match(markdown, /status: pass/);
  for (const id of REQUIRED_CHECK_IDS) assert.match(markdown, new RegExp(id));
});

test("CLI emits parseable JSON and exits zero with clean stderr", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal((result.stderr || "").trim(), "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.status, "pass");
  assert.deepEqual(report.summary.failed_check_ids, []);
  assert.deepEqual(report.summary.production_surfaces, PRODUCTION_SURFACES);
});

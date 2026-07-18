import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const cli = require(resolve(repoRoot, "bin/summarize-hybrid-search-observations.js"));
const input = require(resolve(repoRoot, "bin/lib/observation-report-input.js"));
const fixturePath = resolve(repoRoot, "test/fixtures/scoped-fail-closed-canary-no-opportunity.jsonl");

function tempFile(name, content) {
  const root = mkdtempSync(resolve(tmpdir(), "hybrid-observation-summary-"));
  const path = resolve(root, name);
  writeFileSync(path, content, "utf8");
  return path;
}

test("summary CLI consumes exporter-shaped JSONL through the metrics service", async () => {
  const result = await cli.summarizeHybridSearchObservations([
    "--observations", fixturePath,
    "--window-days", "1",
    "--now", "2026-07-18T14:12:00.000Z",
    "--pretty",
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.input_row_count, 6);
  assert.equal(result.report.window_days, 1);
  assert.equal(result.report.summary.observed_hybrid_events, 6);
  assert.deepEqual(result.report.summary.production_observed_by_surface, { auto_recall: 6 });
  assert.deepEqual(result.report.summary.kg_runtime_mode_distribution, { fail_closed_canary: 6 });
  assert.equal(result.report.summary.kg_fail_closed_canary.enabled_events, 6);
  assert.equal(result.report.summary.kg_fail_closed_canary.applied_events, 0);
  assert.equal(result.report.summary.kg_fail_closed_canary.suppressed_fallback_events, 0);
  assert.equal(result.report.summary.kg_full_fail_closed_events, 0);
  assert.equal(result.report.summary.recent_full_fail_closed_events, 0);
  assert.match(result.output, /"observed_hybrid_events": 6/);
});

test("shared observation loader accepts JSON arrays, JSONL, and multiple reports", () => {
  const rows = input.loadObservationReport(fixturePath);
  const jsonPath = tempFile("observations.json", JSON.stringify(rows));
  assert.deepEqual(input.loadObservationReport(jsonPath), rows);
  assert.deepEqual(input.loadObservationReports([fixturePath, jsonPath]), [...rows, ...rows]);

  const badPath = tempFile("observations.jsonl", "{\"ok\":true}\nnot-json\n");
  assert.throws(
    () => input.loadObservationReport(badPath),
    /invalid .*JSONL at line 2/,
  );
});

test("summary CLI accepts repeated observation reports", async () => {
  const result = await cli.summarizeHybridSearchObservations([
    "--observations", fixturePath,
    "--observations", fixturePath,
    "--window-days", "1",
    "--now", "2026-07-18T14:12:00.000Z",
  ]);
  assert.equal(result.report.input_row_count, 12);
  assert.equal(result.report.summary.observed_hybrid_events, 12);
  assert.deepEqual(result.report.summary.production_observed_by_surface, { auto_recall: 12 });
});

test("summary CLI validates time and window arguments", async () => {
  await assert.rejects(
    () => cli.summarizeHybridSearchObservations([]),
    /--observations is required/,
  );
  await assert.rejects(
    () => cli.summarizeHybridSearchObservations([
      "--observations", fixturePath,
      "--window-days", "0",
    ]),
    /--window-days must be/,
  );
  assert.throws(() => cli.parseNowMs("not-a-time"), /--now must be/);
  assert.equal(cli.parseNowMs("2026-07-18T14:12:00Z"), Date.parse("2026-07-18T14:12:00Z"));
});

test("summary CLI source is report-only and invokes the canonical metrics builder", () => {
  const source = readFileSync(resolve(repoRoot, "bin/summarize-hybrid-search-observations.js"), "utf8");
  assert.match(source, /buildHybridFallbackObservabilitySummary/);
  assert.match(source, /loadObservationReports/);
  assert.match(cli.usage(), /repeatable/);
  assert.doesNotMatch(source, /better-sqlite3|openEngineDb|withDb|gateway restart|plugins install/);
  assert.match(cli.usage(), /reads JSON or JSONL observation reports only/i);
  assert.match(cli.usage(), /never opens a database/i);
});

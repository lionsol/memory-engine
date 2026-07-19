import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const cli = require(resolve(repoRoot, "bin/audit-scoped-fail-closed-canary-evidence.js"));
const fixturePath = resolve(repoRoot, "test/fixtures/scoped-fail-closed-canary-no-opportunity.jsonl");

function tempObservations(rows) {
  const root = mkdtempSync(resolve(tmpdir(), "scoped-canary-evidence-"));
  const path = resolve(root, "observations.json");
  writeFileSync(path, JSON.stringify(rows), "utf8");
  return path;
}

function event(surface, overrides = {}) {
  const completedAt = "2026-07-18T14:00:00.000Z";
  return {
    event_type: "hybrid_search_observation",
    source: `hybrid.${surface}`,
    session_id: surface === "auto_recall" ? `session-${surface}` : null,
    trace_id: `trace-${surface}`,
    created_at: completedAt,
    metadata_json: {
      schema_version: 1,
      surface,
      search_executed: true,
      completed_at: completedAt,
      legacy_db_fallback_used: false,
      legacy_db_fallback_channels: [],
      channel_error_count: 0,
      kg_access_mode: surface === "auto_recall" ? "isolated_blocked" : "isolated",
      kg_runtime_mode: surface === "auto_recall" ? "fail_closed_canary" : "legacy_fallback",
      kg_rollout_scope: surface === "auto_recall" ? "scoped_canary" : null,
      kg_scope_required: surface === "auto_recall" ? true : null,
      kg_fail_closed_scope_match: surface === "auto_recall" ? true : null,
      kg_fail_closed_applied: surface === "auto_recall",
      kg_fail_closed_would_have_used_fallback: surface === "auto_recall",
      kg_fail_closed_fallback_suppressed: surface === "auto_recall",
      recent_access_mode: "isolated",
      recent_runtime_mode: "legacy_fallback",
      ...overrides,
    },
  };
}

test("CLI classifies the redacted real-shaped JSONL as scope-confirmed without opportunity", async () => {
  const result = await cli.auditScopedFailClosedCanaryEvidence([
    "--observations", fixturePath,
    "--channel", "kg",
    "--expected-agent", "edi",
    "--pretty",
  ]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, "canary_scope_confirmed_no_fallback_opportunity");
  assert.equal(result.report.auto_recall_canary_scope_hit_count, 6);
  assert.equal(result.report.fallback_opportunity_count, 0);
  assert.equal(result.report.surface_coverage_status, "auto_recall_only");
  assert.equal(result.report.stage2_review_eligible, false);
  assert.match(result.output, /"expected_agent": "edi"/);
});

test("CLI maps complete suppression evidence to exit zero", async () => {
  const path = tempObservations([
    event("auto_recall"),
    event("memory_engine_action_search"),
    event("memory_engine_search"),
  ]);
  const result = await cli.auditScopedFailClosedCanaryEvidence([
    "--observations", path,
    "--channel", "kg",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, "canary_suppression_confirmed");
  assert.equal(result.report.stage2_review_eligible, true);
});

test("CLI also exits zero for healthy no-opportunity evidence with complete surface coverage", async () => {
  const noOpportunityAutoRecall = event("auto_recall", {
    kg_access_mode: "isolated",
    kg_fail_closed_applied: false,
    kg_fail_closed_would_have_used_fallback: false,
    kg_fail_closed_fallback_suppressed: false,
  });
  const path = tempObservations([
    noOpportunityAutoRecall,
    event("memory_engine_action_search"),
    event("memory_engine_search"),
  ]);
  const result = await cli.auditScopedFailClosedCanaryEvidence([
    "--observations", path,
    "--channel", "kg",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, "canary_scope_confirmed_no_fallback_opportunity");
  assert.equal(result.report.stage2_review_eligible, true);
});

test("CLI accepts repeated observation reports without manual concatenation", async () => {
  const autoPath = tempObservations([event("auto_recall", {
    kg_access_mode: "isolated",
    kg_fail_closed_applied: false,
    kg_fail_closed_would_have_used_fallback: false,
    kg_fail_closed_fallback_suppressed: false,
  })]);
  const toolsPath = tempObservations([
    event("memory_engine_action_search"),
    event("memory_engine_search"),
  ]);
  const result = await cli.auditScopedFailClosedCanaryEvidence([
    "--observations", autoPath,
    "--observations", toolsPath,
    "--channel", "kg",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.input_row_count, 3);
  assert.equal(result.report.surface_coverage_status, "complete");
});

test("CLI uses distinct exit codes for missing scope, safety violations, and input errors", async () => {
  const missingScope = await cli.auditScopedFailClosedCanaryEvidence([
    "--observations", tempObservations([event("memory_engine_search")]),
  ]);
  assert.equal(missingScope.exitCode, 2);
  assert.equal(missingScope.report.status, "canary_scope_not_confirmed");

  const violation = await cli.auditScopedFailClosedCanaryEvidence([
    "--observations", tempObservations([event("auto_recall", {
      kg_access_mode: "legacy_fallback",
      kg_fail_closed_applied: false,
      kg_fail_closed_fallback_suppressed: false,
      legacy_db_fallback_used: true,
      legacy_db_fallback_channels: ["kg"],
    })]),
  ]);
  assert.equal(violation.exitCode, 3);
  assert.equal(violation.report.status, "canary_safety_violation");

  await assert.rejects(
    () => cli.auditScopedFailClosedCanaryEvidence([]),
    /--observations is required/,
  );
  await assert.rejects(
    () => cli.auditScopedFailClosedCanaryEvidence(["--observations", fixturePath, "--channel", "fts"]),
    /--channel must be kg or recent/,
  );
  assert.equal(cli.exitCodeForReport({
    status: "canary_suppression_confirmed",
    stage2_review_eligible: false,
  }), 1);
  assert.equal(cli.exitCodeForReport({ status: "invalid" }), 4);
});

test("CLI source is report-only and has no database or runtime mutation dependency", () => {
  const source = readFileSync(resolve(repoRoot, "bin/audit-scoped-fail-closed-canary-evidence.js"), "utf8");
  assert.match(source, /loadObservationReports/);
  assert.match(cli.usage(), /repeatable/);
  assert.doesNotMatch(source, /better-sqlite3|openEngineDb|withDb|gateway restart|plugins install/);
  assert.match(cli.usage(), /never opens a database/i);
  assert.match(cli.usage(), /never.*changes rollout configuration/i);
});

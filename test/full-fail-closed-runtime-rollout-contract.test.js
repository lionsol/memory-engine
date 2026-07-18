import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const RUNBOOK = new URL("../docs/smoke-tests/full-fail-closed-runtime-rollout.md", import.meta.url);

function readRunbook() {
  return readFileSync(RUNBOOK, "utf8");
}

test("controlled full fail-closed runtime rollout runbook exists", () => {
  assert.equal(existsSync(RUNBOOK), true);
});

test("runbook documents official config schema and legacy defaults", () => {
  const doc = readRunbook();
  for (const token of [
    "F1-D-B8-A6",
    '"kgFailClosedMode": "legacy_fallback"',
    '"recentFailClosedMode": "legacy_fallback"',
    '"kgFailClosedCanary"',
    '"recentFailClosedCanary"',
    "legacy_fallback",
    "shadow_fail_closed",
    "fail_closed_canary",
    "full_fail_closed",
    "Both channel defaults remain `legacy_fallback`",
  ]) {
    assert.equal(doc.includes(token), true, `missing runtime rollout token: ${token}`);
  }
});

test("runbook preserves trusted-scope and production-surface boundaries", () => {
  const doc = readRunbook();
  for (const token of [
    "auto_recall",
    "memory_engine_action_search",
    "memory_engine_search",
    "do not accept caller-supplied agent or session identity",
    "tool searches without trusted runtime scope must continue to legacy fallback",
    "`full_fail_closed` does not use scope",
  ]) {
    assert.equal(doc.includes(token), true, `missing scope boundary token: ${token}`);
  }
});

test("runbook requires channel-by-channel rollout and real rollback", () => {
  const doc = readRunbook();
  for (const token of [
    "Stage 0: Baseline Install",
    "Stage 1: Scoped Canary",
    "Stage 2: KG Full Rollout",
    "Stage 3: KG Rollback Validation",
    "Stage 4: Recent Full Rollout",
    "openclaw plugins install . --force",
    "A rollback that changes only the source checkout but does not reinstall or reload the runtime is not valid",
  ]) {
    assert.equal(doc.includes(token), true, `missing rollout stage token: ${token}`);
  }
});

test("runbook classifies scoped-canary evidence without manufacturing production fallback", () => {
  const doc = readRunbook();
  for (const token of [
    "bin/audit-scoped-fail-closed-canary-evidence.js",
    "canary_scope_confirmed_no_fallback_opportunity",
    "scope_status",
    "suppression_status",
    "surface_coverage_status",
    "isolation_status",
    "not mandatory for Stage 2 review",
    "Do not mutate a production DB",
    "A5 synthetic smoke remains authoritative",
    "stage2_review_eligible=true",
    "observation-evidence-only",
    "search_executed=true",
    "real registered OpenClaw tools",
    "operator-supplied run label",
  ]) {
    assert.equal(doc.includes(token), true, `missing scoped-canary evidence token: ${token}`);
  }
});

test("runbook defines explicit full markers, stop conditions, and evidence thresholds", () => {
  const doc = readRunbook();
  for (const token of [
    "kg_runtime_mode=full_fail_closed",
    "kg_rollout_scope=full",
    "kg_scope_required=false",
    "kg_fail_closed_scope_match=null",
    "recent_runtime_mode=full_fail_closed",
    "recent_rollout_scope=full",
    "recent_scope_required=false",
    "recent_fail_closed_scope_match=null",
    "Immediate Stop Conditions",
    "minimum_window_days: 30",
    "minimum_observations: 500",
    "minimum_surface_observations: 100",
  ]) {
    assert.equal(doc.includes(token), true, `missing evidence token: ${token}`);
  }
});

test("runbook uses the canonical metrics summary CLI for JSON and JSONL evidence", () => {
  const doc = readRunbook();
  for (const token of [
    "bin/summarize-hybrid-search-observations.js",
    "buildHybridFallbackObservabilitySummary",
    "does not open SQLite or contact the runtime",
  ]) {
    assert.equal(doc.includes(token), true, `missing observation summary token: ${token}`);
  }
});

test("runbook keeps real DB access read-only and B8-B prohibited", () => {
  const doc = readRunbook();
  for (const token of [
    "bin/export-hybrid-search-observations.js",
    "opens SQLite read-only with file-must-exist mode",
    "/tmp/memory-engine-full-fail-closed-observations.jsonl",
    "do not delete legacy query definitions",
    "do not remove `withLegacyDb` reachability",
    "do not authorize B8-B",
    "fresh removal-gate audit, not direct code deletion",
  ]) {
    assert.equal(doc.includes(token), true, `missing safety boundary token: ${token}`);
  }
});

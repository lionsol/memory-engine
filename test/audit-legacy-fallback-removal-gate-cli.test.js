import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  auditLegacyFallbackRemovalGate,
  exitCodeForDecision,
  parseArgs,
  usage,
} from "../bin/audit-legacy-fallback-removal-gate.js";

const reports = {
  closure: { decision: { class: "ready_for_removal" } },
  evidence: { decision: "ready", status: "sufficient", window_days: 30 },
  kg: { status: "full_fail_closed" },
  review: { status: "healthy" },
  expansion: { decision: "expand" },
  rollback: { status: "rollback_confirmed" },
  production: {
    target_mode: "full_fail_closed",
    kg_mode: "full_fail_closed",
    recent_mode: "full_fail_closed",
    observation_count: 500,
    window_days: 30,
    production_observed_by_surface: {
      auto_recall: 100,
      memory_engine_action_search: 100,
      memory_engine_search: 100,
    },
    kg_fallback_events: 0,
    recent_fallback_events: 0,
    unknown_surface_events: 0,
    missing_schema_version_events: 0,
    unsupported_schema_version_events: 0,
    invalid_provenance_observation_count: 0,
  },
  reachability: { inventory_complete: true, known_dynamic_references: 0 },
  strategy: { strategy: "release_revert", tested: true, documented: true, owner_assigned: true },
};

const flagToName = {
  "--closure-report": "closure",
  "--evidence-window-report": "evidence",
  "--kg-rollout-report": "kg",
  "--recent-review-report": "review",
  "--recent-expansion-report": "expansion",
  "--recent-rollback-report": "rollback",
  "--production-rollout-report": "production",
  "--code-reachability-report": "reachability",
  "--rollback-strategy-report": "strategy",
};

function writeReports(root, values = reports) {
  const paths = {};
  for (const [key, value] of Object.entries(values)) {
    paths[key] = join(root, `${key}.json`);
    writeFileSync(paths[key], JSON.stringify(value));
  }
  return paths;
}

function argsFor(paths) {
  return Object.entries(flagToName).flatMap(([flag, name]) => [flag, paths[name]]);
}

async function run(values = reports) {
  const root = mkdtempSync(join(tmpdir(), "legacy-removal-gate-cli-"));
  const paths = writeReports(root, values);
  try {
    return await auditLegacyFallbackRemovalGate(argsFor(paths));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("CLI maps ready removal to exit code 0", async () => {
  const result = await run();
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.output).decision, "ready_for_code_removal");
});

test("CLI maps insufficient evidence to exit code 1", async () => {
  const result = await run({ ...reports, production: { ...reports.production, recent_mode: "scoped_canary" } });
  assert.equal(result.exitCode, 1);
  assert.equal(JSON.parse(result.output).decision, "insufficient_evidence");
});

test("CLI maps blocked to exit code 2", async () => {
  const result = await run({ ...reports, review: { status: "rollback_required" } });
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(result.output).decision, "blocked");
});

test("CLI invalid JSON and missing flags use exit code 3 contract", async () => {
  const root = mkdtempSync(join(tmpdir(), "legacy-removal-gate-cli-invalid-"));
  const invalidPath = join(root, "invalid.json");
  writeFileSync(invalidPath, "not-json");
  try {
    assert.throws(() => parseArgs(["--closure-report", invalidPath]), /required/);
    await assert.rejects(
      auditLegacyFallbackRemovalGate([...argsFor({ ...writeReports(root), closure: invalidPath })]),
      /failed to read closure report JSON/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(exitCodeForDecision("ready_for_code_removal"), 0);
  assert.equal(exitCodeForDecision("insufficient_evidence"), 1);
  assert.equal(exitCodeForDecision("blocked"), 2);
  assert.equal(exitCodeForDecision("unknown"), 3);
});

test("CLI rejects mutation flags and documents read-only behavior", () => {
  assert.throws(() => parseArgs(["--apply"]), /unknown argument/);
  assert.match(usage(), /never removes code or changes rollout configuration/);
});

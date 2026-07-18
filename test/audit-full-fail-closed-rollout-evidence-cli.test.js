import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const cli = require(resolve(repoRoot, "bin/audit-full-fail-closed-rollout-evidence.js"));

function tempFile(extension, content) {
  const root = mkdtempSync(resolve(tmpdir(), "full-fail-closed-evidence-"));
  const path = resolve(root, `observations${extension}`);
  writeFileSync(path, content);
  return path;
}

function event(surface, overrides = {}) {
  return {
    event_type: "hybrid_search_observation",
    metadata_json: {
      schema_version: 1,
      surface,
      search_executed: true,
      completed_at: "2026-07-15T00:00:00.000Z",
      kg_access_mode: "full_fail_closed",
      recent_access_mode: "full_fail_closed",
      kg_runtime_mode: "full_fail_closed",
      recent_runtime_mode: "full_fail_closed",
      kg_rollout_scope: "full",
      recent_rollout_scope: "full",
      kg_scope_required: false,
      recent_scope_required: false,
      ...overrides,
    },
  };
}

function confirmedEvents() {
  return [
    event("auto_recall"),
    event("memory_engine_action_search"),
    event("memory_engine_search"),
  ];
}

test("CLI maps report statuses to required exit codes", async () => {
  const confirmedPath = tempFile(".json", JSON.stringify(confirmedEvents()));
  const confirmed = await cli.auditFullFailClosedRolloutEvidence(["--observations", confirmedPath]);
  assert.equal(confirmed.exitCode, 1);

  const partialPath = tempFile(".json", JSON.stringify([event("memory_engine_search", {
    kg_access_mode: "isolated",
    kg_runtime_mode: null,
    recent_access_mode: "isolated_blocked",
    recent_runtime_mode: "fail_closed_canary",
    recent_fail_closed_applied: true,
    recent_fail_closed_scope_match: true,
  })]));
  const partial = await cli.auditFullFailClosedRolloutEvidence([
    "--observations", partialPath,
    "--thresholds", tempFile(".json", JSON.stringify({ minimum_window_days: 0, minimum_observations: 1, minimum_surface_observations: 1 })),
  ]);
  assert.equal(partial.exitCode, 2);

  const blockedPath = tempFile(".json", JSON.stringify([event("memory_engine_search", { recent_access_mode: "guarded_fallback" })]));
  const blocked = await cli.auditFullFailClosedRolloutEvidence([
    "--observations", blockedPath,
    "--thresholds", tempFile(".json", JSON.stringify({ minimum_window_days: 0, minimum_observations: 1, minimum_surface_observations: 1 })),
  ]);
  assert.equal(blocked.exitCode, 3);
});

test("CLI accepts JSONL and maps insufficient evidence to exit 1", async () => {
  const path = tempFile(".jsonl", confirmedEvents().map(eventValue => JSON.stringify(eventValue)).join("\n"));
  const result = await cli.auditFullFailClosedRolloutEvidence(["--observations", path]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, "insufficient_evidence");
});

test("CLI usage and parse errors are distinct from report decisions", async () => {
  await assert.rejects(
    () => cli.auditFullFailClosedRolloutEvidence([]),
    /--observations is required/,
  );
  const invalid = tempFile(".json", "not json");
  await assert.rejects(
    () => cli.auditFullFailClosedRolloutEvidence(["--observations", invalid]),
    /failed to read|Unexpected token/,
  );
  assert.equal(cli.exitCodeForStatus("full_fail_closed_confirmed"), 0);
  assert.equal(cli.exitCodeForStatus("insufficient_evidence"), 1);
  assert.equal(cli.exitCodeForStatus("partial_rollout"), 2);
  assert.equal(cli.exitCodeForStatus("blocked"), 3);
  assert.equal(cli.exitCodeForStatus("invalid"), 4);
});

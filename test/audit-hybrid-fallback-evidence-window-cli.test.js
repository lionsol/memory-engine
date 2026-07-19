import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  auditHybridFallbackEvidenceWindow,
  exitCodeForDecision,
  parseArgs,
  usage,
} from "../bin/audit-hybrid-fallback-evidence-window.js";

function event(surface, createdAt) {
  const completedAt = new Date(createdAt).toISOString();
  return {
    event_type: "hybrid_search_observation",
    source: `hybrid.${surface}`,
    session_id: surface === "auto_recall" ? `session-${surface}` : null,
    trace_id: `trace-${surface}`,
    created_at: createdAt,
    metadata_json: JSON.stringify({
      surface,
      schema_version: 1,
      search_executed: true,
      completed_at: completedAt,
      kg_access_mode: "isolated",
      recent_access_mode: "isolated",
    }),
  };
}

test("CLI reads an event report and returns JSON", async () => {
  const root = mkdtempSync(join(tmpdir(), "hybrid-evidence-window-cli-"));
  try {
    const events = Array.from({ length: 3 }, (_, index) => event(
      ["auto_recall", "memory_engine_action_search", "memory_engine_search"][index],
      index === 2 ? "2026-07-02T00:00:00Z" : "2026-07-01T00:00:00Z",
    ));
    const path = join(root, "events.json");
    writeFileSync(path, JSON.stringify({ observations: events }));
    const result = await auditHybridFallbackEvidenceWindow([
      "--events", path,
      "--minimum-window-days", "1",
      "--minimum-observations", "3",
      "--minimum-surface-observations", "1",
    ]);
    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.output).decision, "ready");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI maps decisions and rejects mutation arguments", async () => {
  assert.equal(exitCodeForDecision("ready"), 0);
  assert.equal(exitCodeForDecision("insufficient_evidence"), 1);
  assert.equal(exitCodeForDecision("blocked"), 2);
  assert.throws(() => parseArgs(["--apply"]), /unknown argument/);
  assert.match(usage(), /never opens a database/);
  const empty = await auditHybridFallbackEvidenceWindow([]);
  assert.equal(empty.exitCode, 1);
  assert.equal(JSON.parse(empty.output).decision, "insufficient_evidence");
});

test("CLI reports unknown surface as blocked", async () => {
  const root = mkdtempSync(join(tmpdir(), "hybrid-evidence-window-cli-blocked-"));
  try {
    const path = join(root, "events.json");
    writeFileSync(path, JSON.stringify([event("unknown", "2026-07-01T00:00:00Z")]));
    const result = await auditHybridFallbackEvidenceWindow(["--events", path]);
    assert.equal(result.exitCode, 2);
    assert.equal(JSON.parse(result.output).decision, "blocked");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

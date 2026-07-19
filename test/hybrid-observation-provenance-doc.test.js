import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const DOC = new URL("../docs/hybrid-observation-provenance.md", import.meta.url);
const INDEX = new URL("../docs/README.md", import.meta.url);
const ROLLOUT = new URL("../docs/smoke-tests/full-fail-closed-runtime-rollout.md", import.meta.url);
const TOOL_AUDIT = new URL("../docs/smoke-tests/tool-surface-runtime-access-audit.md", import.meta.url);
const INVENTORY = new URL("../docs/legacy-fallback-code-inventory.md", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

test("Hybrid observation provenance contract exists and is indexed", () => {
  assert.equal(existsSync(DOC), true);
  const index = read(INDEX);
  assert.match(index, /hybrid-observation-provenance\.md/);
  assert.match(index, /canonical envelope/);
});

test("contract defines canonical envelope and surface-specific provenance", () => {
  const doc = read(DOC);
  for (const token of [
    "Status: Current contract",
    "event_type = hybrid_search_observation",
    "metadata_json.schema_version = 1",
    "metadata_json.search_executed = true",
    "metadata_json.completed_at = canonical UTC ISO timestamp",
    "source = hybrid.<metadata_json.surface>",
    "trace_id = non-empty",
    "session_id = non-empty",
    "source = hybrid.auto_recall",
    "source = hybrid.memory_engine_search",
    "source = hybrid.memory_engine_action_search",
  ]) {
    assert.equal(doc.includes(token), true, `missing provenance contract token: ${token}`);
  }
});

test("contract isolates invalid rows and exposes stable diagnostics", () => {
  const doc = read(DOC);
  for (const token of [
    "invalid_provenance_observation_count",
    "invalid_provenance_observation_ids",
    "invalid_provenance_reason_distribution",
    "source_mismatch",
    "invalid_completed_at",
    "missing_trace_id",
    "missing_auto_recall_session_id",
    "excluded from `observed_hybrid_events`",
    "treated as a blocker",
  ]) {
    assert.equal(doc.includes(token), true, `missing invalid-provenance token: ${token}`);
  }
});

test("contract lists every decision integration and the historical contamination boundary", () => {
  const doc = read(DOC);
  for (const token of [
    "console/services/metrics-service.js",
    "scoped-fail-closed-canary-evidence.js",
    "fallback-evidence-window.js",
    "full-fail-closed-rollout-evidence.js",
    "tool-surface-runtime-access-audit.js",
    "legacy-fallback-removal-gate.js",
    "hybrid-observation-provenance.js",
    "ID `11087`",
    "not authoritative Stage 2 evidence",
    "opencode/deepseek-v4-flash",
  ]) {
    assert.equal(doc.includes(token), true, `missing integration token: ${token}`);
  }
});

test("runbooks and removal inventory require zero invalid provenance", () => {
  const rollout = read(ROLLOUT);
  const toolAudit = read(TOOL_AUDIT);
  const inventory = read(INVENTORY);

  assert.match(rollout, /invalid_provenance_observation_count=0/);
  assert.match(rollout, /hybrid-observation-provenance\.md/);
  assert.match(toolAudit, /invalid_provenance_observation_count=0/);
  assert.match(toolAudit, /hybrid-observation-provenance\.md/);
  assert.match(inventory, /invalid_provenance_observation_count=0/);
  assert.match(inventory, /hybrid-observation-provenance\.md/);
});

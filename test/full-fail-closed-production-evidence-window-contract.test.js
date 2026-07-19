import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const RUNBOOK = new URL(
  "../docs/smoke-tests/full-fail-closed-production-evidence-window.md",
  import.meta.url,
);
const SMOKE_INDEX = new URL("../docs/smoke-tests/README.md", import.meta.url);
const DOCS_INDEX = new URL("../docs/README.md", import.meta.url);
const STATUS = new URL("../docs/hybrid-fail-closed-rollout-status.md", import.meta.url);
const DEVLOG = new URL("../docs/devlog.md", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

test("B8-A7 production evidence-window runbook exists and is indexed", () => {
  assert.equal(existsSync(RUNBOOK), true);
  assert.match(read(SMOKE_INDEX), /full-fail-closed-production-evidence-window\.md/);
  assert.match(read(DOCS_INDEX), /full-fail-closed-production-evidence-window\.md/);
});

test("runbook records A7.2 review blockers while preserving the sustained-runtime boundary", () => {
  const doc = read(RUNBOOK);
  for (const token of [
    "B8-A7.1 CLOSED / READY FOR A7.2",
    "implementation checkpoint `caf4373`",
    "local runtime dependency closure",
    "normalized effective AutoRecall/KG/Recent/retrieval configuration",
    "B8-A7.2 IMPLEMENTED / REVIEW CHANGES REQUIRED",
    "Implementation checkpoint `59a4f3e` is not review-closed",
    "before_tool_call",
    "toolExecutionSource",
    "leading and trailing per-surface gaps",
    "refuse `continuity_ready`",
    "B8-A7 sustained runtime window NOT AUTHORIZED",
    "evidence_epoch_id",
    "runtime_build_identity",
    "rollout_config_fingerprint",
    "active_utc_days",
    "maximum_observation_gap_hours",
    "active_days_by_surface",
    "natural_user_turn",
    "natural_agent_tool_call",
    "operator_verification_probe",
    "scheduled_healthcheck",
    "unknown",
    "healthy_collecting",
    "blocked_rollback_required",
    "ready_for_removal_gate",
    "keep `autoRecall.enabled=true` or expand `agentAllowlist` for 30 days",
    "Do not manufacture the missing denominator by repeated probes",
    "B8-B remains `NOT AUTHORIZED`",
  ]) {
    assert.equal(doc.includes(token), true, `missing A7 contract token: ${token}`);
  }
});

test("rollout ledger requires A7.2 review fixes without authorizing sustained runtime", () => {
  const doc = read(STATUS);
  for (const token of [
    "B8-A7 sustained production evidence window",
    "DESIGN AUTHORIZED / RUNTIME NOT AUTHORIZED",
    "B8-A7.1 evidence epoch and deployment identity",
    "CLOSED / READY FOR A7.2",
    "implementation checkpoint `caf4373`",
    "normalized effective AutoRecall/KG/Recent/retrieval configuration",
    "runtime dependency identity",
    "B8-A7.2 continuity and traffic-origin evidence",
    "IMPLEMENTED / REVIEW CHANGES REQUIRED",
    "implementation checkpoint `59a4f3e`",
    "zero threshold overrides",
    "B8-A7.3 read-only health monitor and stop contract",
    "long-running runtime configuration change",
    "B8-B remains unauthorized",
  ]) {
    assert.equal(doc.includes(token), true, `missing A7 ledger token: ${token}`);
  }
});

test("devlog records A7.2 review findings and preserves the runtime authorization boundary", () => {
  const doc = read(DEVLOG);
  for (const token of [
    "F1-D-B8-A7.2: implementation review changes required",
    "implementation checkpoint `59a4f3e`",
    "1562 tests、1554 passed、0 failed、8 skipped",
    "B8-A7.1=CLOSED / READY FOR A7.2",
    "B8-A7.2=IMPLEMENTED / REVIEW CHANGES REQUIRED",
    "traffic_origin_evidence",
    "leading/trailing boundary gap",
    "evidence_epoch_id=null",
    "B8-A7.3=NOT STARTED",
    "F1-D-B8-A7: sustained production evidence-window authorization review",
    "B8-A7 design/tooling=AUTHORIZED",
    "B8-A7 sustained runtime window=NOT AUTHORIZED",
    "long-running autoRecall.enabled=true=NOT AUTHORIZED",
    "long-running KG/Recent full_fail_closed=NOT AUTHORIZED",
    "B8-B removal=NOT AUTHORIZED",
  ]) {
    assert.equal(doc.includes(token), true, `missing A7 devlog token: ${token}`);
  }
});

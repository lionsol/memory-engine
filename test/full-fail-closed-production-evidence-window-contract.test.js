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

test("runbook records final A7.3 review blockers while preserving the sustained-runtime boundary", () => {
  const doc = read(RUNBOOK);
  for (const token of [
    "B8-A7.1 CLOSED / READY FOR A7.2",
    "implementation checkpoint `caf4373`",
    "local runtime dependency closure",
    "normalized effective AutoRecall/KG/Recent/retrieval configuration",
    "B8-A7.2 CLOSED / READY FOR A7.3",
    "implementation checkpoint `47389d3`",
    "`toolCallId` may be reused after expiry",
    "same-lifetime duplicates remain fail closed",
    "decoded threshold JSON",
    "share one threshold contract",
    "B8-A7.3 REVIEW FIXES IMPLEMENTED / FINAL REVIEW CHANGES REQUIRED",
    "Checkpoint `3dcd55c`",
    "`scheduled_healthcheck` on `auto_recall`",
    "trusted resolver",
    "surrounding whitespace",
    "monitor_freshness_status",
    "runtime_parity_status",
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

test("rollout ledger requires final A7.3 review fixes without authorizing sustained runtime", () => {
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
    "CLOSED / READY FOR A7.3",
    "implementation checkpoint `47389d3`",
    "post-TTL `toolCallId` reuse",
    "shared threshold validation",
    "B8-A7.3 read-only health monitor and stop contract",
    "REVIEW FIXES IMPLEMENTED / FINAL REVIEW CHANGES REQUIRED",
    "Checkpoint `3dcd55c`",
    "auto_recall",
    "scheduled_healthcheck",
    "surrounding whitespace",
    "monitor_freshness_status",
    "runtime_parity_status",
    "long-running runtime configuration change",
    "B8-B remains unauthorized",
  ]) {
    assert.equal(doc.includes(token), true, `missing A7 ledger token: ${token}`);
  }
});

test("devlog records final A7.3 review findings and preserves the runtime authorization boundary", () => {
  const doc = read(DEVLOG);
  for (const token of [
    "F1-D-B8-A7.2: final implementation review closed",
    "implementation checkpoint `47389d3`",
    "code-review-graph version=2.3.7",
    "code-review-graph risk score=0.65",
    "focused tests=41/41 passed",
    "full suite=1574 tests / 1566 passed / 0 failed / 8 skipped",
    "B8-A7.2=CLOSED / READY FOR A7.3",
    "F1-D-B8-A7.3: temporal fix final review changes required",
    "implementation checkpoint `3dcd55c`",
    "code-review-graph risk score=0.60",
    "focused tests=99/99 passed",
    "auto_recall scheduled-healthcheck validator result=valid",
    "forged auto_recall healthcheck result=ready_for_removal_gate",
    "canonical timestamp surrounding whitespace accepted=true",
    "stale surface with monitor_freshness_status=fresh",
    "runtime parity drift with runtime_parity_status=fresh",
    "B8-A7.3=REVIEW FIXES IMPLEMENTED / FINAL REVIEW CHANGES REQUIRED",
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

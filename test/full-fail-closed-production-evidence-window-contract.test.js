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

test("runbook closes A7.3 while preserving the sustained-runtime boundary", () => {
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
    "B8-A7.3 CLOSED / READY FOR A7 RUNTIME AUTHORIZATION REVIEW",
    "implementation checkpoint `cc88825`",
    "A forged AutoRecall scheduled healthcheck cannot satisfy freshness or removal readiness",
    "canonical timestamps require exact UTC millisecond ISO",
    "runtime parity health is distinct from report freshness",
    "monitor freshness includes the overall observation plus every production surface",
    "full 1597-test suite with 1589 passed, 0 failed, and 8 skipped",
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

test("rollout ledger closes A7.3 without authorizing sustained runtime", () => {
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
    "CLOSED / READY FOR A7 RUNTIME AUTHORIZATION REVIEW",
    "implementation checkpoint `cc88825`",
    "scheduled healthchecks are restricted to tool surfaces",
    "canonical timestamps reject surrounding whitespace",
    "runtime parity health is separated from parity freshness",
    "monitor freshness includes every production surface",
    "full 1597-test suite with 1589 passed, 0 failed, and 8 skipped",
    "long-running runtime configuration change",
    "B8-B remains unauthorized",
  ]) {
    assert.equal(doc.includes(token), true, `missing A7 ledger token: ${token}`);
  }
});

test("devlog records A7.3 closeout and preserves the runtime authorization boundary", () => {
  const doc = read(DEVLOG);
  for (const token of [
    "F1-D-B8-A7.2: final implementation review closed",
    "implementation checkpoint `47389d3`",
    "code-review-graph version=2.3.7",
    "code-review-graph risk score=0.65",
    "focused tests=41/41 passed",
    "full suite=1574 tests / 1566 passed / 0 failed / 8 skipped",
    "B8-A7.2=CLOSED / READY FOR A7.3",
    "F1-D-B8-A7.3: final implementation review closed",
    "implementation checkpoint `cc88825`",
    "code-review-graph risk score=0.55",
    "focused tests=57/57 passed",
    "forged auto_recall scheduled-healthcheck validator=invalid / origin_evidence_mismatch",
    "single stale tool surface monitor_freshness_status=stale",
    "runtime parity drift runtime_parity_status=drift",
    "canonical timestamp leading/trailing whitespace=null",
    "full suite=1597 tests / 1589 passed / 0 failed / 8 skipped",
    "B8-A7.3=CLOSED / READY FOR A7 RUNTIME AUTHORIZATION REVIEW",
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

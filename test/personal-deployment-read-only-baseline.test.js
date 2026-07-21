import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const BASELINE = new URL(
  "../docs/smoke-tests/personal-deployment-read-only-baseline.md",
  import.meta.url,
);
const INDEX = new URL("../docs/README.md", import.meta.url);
const LEDGER = new URL("../docs/hybrid-fail-closed-rollout-status.md", import.meta.url);
const DEVLOG = new URL("../docs/devlog.md", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

function requireTokens(text, tokens, label) {
  for (const token of tokens) {
    assert.equal(text.includes(token), true, `missing ${label} token: ${token}`);
  }
}

test("R6.1 personal read-only baseline exists and is indexed", () => {
  assert.equal(existsSync(BASELINE), true);
  const index = read(INDEX);
  assert.match(index, /personal-deployment-read-only-baseline\.md/);
});

test("R6.1 baseline correlates repository, host, installed, config, and loaded evidence", () => {
  const baseline = read(BASELINE);
  requireTokens(
    baseline,
    [
      "B8-A7-R6.1 Personal Deployment Read-Only Baseline",
      "Repository Identity",
      "OpenClaw CLI and Gateway Identity",
      "Cold Plugin Inspection",
      "Installed Runtime Parity",
      "Native ABI Identity",
      "Effective Config and Conflict Boundary",
      "Loaded Gateway Evidence",
      "Existing Test and Smoke Evidence",
      "build-runtime-source-parity-report.js",
      "build-effective-hybrid-runtime-config-report.js",
      "build-sustained-runtime-boundary-report.js",
      "memoryEngine.sustainedRuntimePreflight",
      "memoryEngine.productionEvidenceHealthcheck",
      "source_runtime_equal=true",
      "active_memory_enabled=false",
      "kg_fail_closed_mode=legacy_fallback",
      "recent_fail_closed_mode=legacy_fallback",
      "production_evidence_enabled=false",
      "full_fail_closed_safety_smoke=10/10 pass",
      "cold_installed_loaded_identity_consistent",
    ],
    "R6.1 baseline",
  );
});

test("R6.1 baseline is evidence-only and preserves mutation boundaries", () => {
  const baseline = read(BASELINE);
  requireTokens(
    baseline,
    [
      "no mutation authorization",
      "configuration changes",
      "config backup or restoration",
      "plugin installation or reload",
      "Gateway restart",
      "native dependency rebuild",
      "AutoRecall activation",
      "production evidence activation",
      "sustained runtime epoch creation",
      "B8-B removal",
      "BASELINE READY FOR SEPARATE MUTATION AUTHORIZATION",
      "BASELINE BLOCKED",
      "does not authorize the mutation",
      "configuration mutation=NOT AUTHORIZED",
      "plugin install/reload=NOT AUTHORIZED",
      "Gateway restart=NOT AUTHORIZED",
      "B8-A7 sustained runtime window=NOT AUTHORIZED",
    ],
    "R6.1 boundary",
  );
});

test("R6 closure and R6.1 state are recorded in ledger and devlog", () => {
  for (const text of [read(LEDGER), read(DEVLOG)]) {
    assert.match(
      text,
      /B8-A7-R6 personal deployment safety profile(?:=|\s+)PASSED \/ CLOSED/,
    );
    assert.match(
      text,
      /personal deployment remediation runbook(?:=|\s+)VERIFIED \/ CURRENT/,
    );
    assert.match(
      text,
      /B8-A7-R6\.1 read-only baseline audit(?:=|\s+)IMPLEMENTED \/ EDI VERIFICATION PENDING/,
    );
    assert.match(
      text,
      /B8-A7 sustained runtime authorization(?:=|\s+)WITHHELD \/ PERSONAL PROFILE REMEDIATION REQUIRED/,
    );
    assert.match(text, /B8-B removal(?:=|\s+)NOT AUTHORIZED/);
  }
});

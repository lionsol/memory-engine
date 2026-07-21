import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const BASELINE = new URL(
  "../docs/smoke-tests/personal-deployment-read-only-baseline.md",
  import.meta.url,
);
const DECISION = new URL(
  "../docs/smoke-tests/personal-deployment-read-only-baseline-decision-20260721.md",
  import.meta.url,
);
const R6_2 = new URL(
  "../docs/smoke-tests/host-activation-boundary-compatibility.md",
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

test("R6.1 baseline, decision, and R6.2 compatibility contract exist and are indexed", () => {
  assert.equal(existsSync(BASELINE), true);
  assert.equal(existsSync(DECISION), true);
  assert.equal(existsSync(R6_2), true);
  const index = read(INDEX);
  assert.match(index, /personal-deployment-read-only-baseline\.md/);
  assert.match(index, /personal-deployment-read-only-baseline-decision-20260721\.md/);
  assert.match(index, /host-activation-boundary-compatibility\.md/);
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
      "Do not add `--runtime`",
      "plugins inspect --runtime",
      "exclusion from a non-empty `plugins.allow`",
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
      "Gateway stop/start/restart=NOT AUTHORIZED",
      "B8-A7 sustained runtime window=NOT AUTHORIZED",
    ],
    "R6.1 boundary",
  );
});

test("R6.1 decision records the real blocked baseline and next contract repair", () => {
  const decision = read(DECISION);
  requireTokens(
    decision,
    [
      "Decision: BASELINE BLOCKED",
      "16b912fb89a742f702a1912bd6cdbf5eff0c7194",
      "source_runtime_equal=false",
      "difference_count=28",
      "memoryEngine.sustainedRuntimePreflight=unknown method",
      "activation_reason=not in allowlist",
      "active_memory_actual_host_state=disabled",
      "active_memory_boundary_report=invalid for current host semantics",
      "clean_window_observable_memory_mutation=false",
      "static_check_file_count=519",
      "full_fail_closed_safety_smoke=10/10 pass",
      "B8-A7-R6.2 host activation boundary compatibility=REQUIRED / NOT STARTED",
      "plugin install/reload=NOT AUTHORIZED",
      "B8-A7 sustained runtime window=NOT AUTHORIZED",
    ],
    "R6.1 decision",
  );
});

test("R6.2 contract records host activation ordering and live read-only closeout", () => {
  const r6_2 = read(R6_2);
  requireTokens(
    r6_2,
    [
      "B8-A7-R6.2 Host Activation Boundary Compatibility",
      "plugins.enabled=false",
      "active-memory in plugins.deny",
      "non-empty plugins.allow excluding the plugin id",
      "disabled_by_plugins_allowlist",
      "active_memory_allowlist_configured",
      "active_memory_allowlisted",
      "active_memory_denylisted",
      "37 tests passed",
      "status=clean",
      "B8-A7-R6.2 host activation boundary compatibility=PASSED / CLOSED",
      "B8-A7-R6.3 runtime-remediation authorization design=PASSED / CLOSED",
      "B8-A7-R6.4 offline candidate and rollback rehearsal=PASSED / CLOSED",
      "B8-A7-R6.5 live remediation execution authorization packet=PASSED / CLOSED",
      "B8-A7-R6.5 live remediation execution=ROLLED BACK / SAFE",
      "candidate Gateway activation=NOT REACHED",
      "old runtime restored=TRUE",
      "B8-A7-R6.5.1 config semantic equivalence repair=PASSED / CLOSED",
      "R6.5 live retry=NOT AUTHORIZED",
      "explicit retry approval=NOT RECEIVED",
      "live retry plugin install/reload=NOT AUTHORIZED",
    ],
    "R6.2 contract",
  );
});

test("R6 closure, R6.1 blocked state, and the safe R6.5 rollback are recorded", () => {
  for (const text of [read(LEDGER), read(DEVLOG)]) {
    assert.match(
      text,
      /B8-A7-R6 personal deployment safety profile(?:=|\s+)PASSED \/ CLOSED/,
    );
    assert.match(
      text,
      /B8-A7-R6\.1 read-only baseline execution(?:=|\s+)PASSED/,
    );
    assert.match(
      text,
      /B8-A7-R6\.1 baseline decision(?:=|\s+)BASELINE BLOCKED/,
    );
    assert.match(
      text,
      /B8-A7-R6\.2 host activation boundary compatibility(?:=|\s+)PASSED \/ CLOSED/,
    );
    assert.match(
      text,
      /B8-A7-R6\.3 runtime-remediation authorization design(?:=|\s+)PASSED \/ CLOSED/,
    );
    assert.match(
      text,
      /B8-A7-R6\.4 offline candidate and rollback rehearsal(?:=|\s+)PASSED \/ CLOSED/,
    );
    assert.match(
      text,
      /B8-A7-R6\.5 live remediation execution authorization packet(?:=|\s+)PASSED \/ CLOSED/,
    );
    assert.match(text, /B8-A7-R6\.5 live remediation execution(?:=|\s+)ROLLED BACK \/ SAFE/);
    assert.match(text, /candidate Gateway activation(?:=|\s+)NOT REACHED/);
    assert.match(text, /B8-A7-R6\.5\.1 config semantic equivalence repair(?:=|\s+)PASSED \/ CLOSED/);
    assert.match(text, /B8-A7-R6\.5\.2 live remediation retry authorization packet(?:=|\s+)IMPLEMENTED \/ EDI VERIFICATION PENDING/);
    assert.match(text, /R6\.5\.2 live retry execution(?:=|\s+)NOT AUTHORIZED/);
    assert.match(
      text,
      /B8-A7 sustained runtime authorization(?:=|\s+)WITHHELD \/ PERSONAL PROFILE REMEDIATION REQUIRED/,
    );
    assert.match(text, /B8-B removal(?:=|\s+)NOT AUTHORIZED/);
  }
});

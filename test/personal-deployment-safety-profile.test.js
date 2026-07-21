import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const ADR = new URL("../docs/adr/personal-deployment-safety-profile.md", import.meta.url);
const RUNBOOK = new URL(
  "../docs/smoke-tests/personal-deployment-sustained-runtime-remediation.md",
  import.meta.url,
);
const OLD_RUNBOOK = new URL(
  "../docs/smoke-tests/sustained-runtime-remediation.md",
  import.meta.url,
);
const R4 = new URL("../docs/adr/host-plugin-metadata-ownership.md", import.meta.url);
const R5 = new URL(
  "../docs/openclaw-host-plugin-metadata-publisher-integration-design.md",
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

test("personal deployment ADR and runbook exist and are indexed", () => {
  assert.equal(existsSync(ADR), true);
  assert.equal(existsSync(RUNBOOK), true);
  const index = read(INDEX);
  assert.match(index, /adr\/personal-deployment-safety-profile\.md/);
  assert.match(index, /personal-deployment-sustained-runtime-remediation\.md/);
});

test("personal profile removes the host publisher prerequisite but preserves hard safety invariants", () => {
  const adr = read(ADR);
  requireTokens(
    adr,
    [
      "B8-A7-R6 Personal Deployment Safety Profile",
      "OpenClaw upstream pull request",
      "OpenClaw private fork",
      "host-published plugin metadata manifest",
      "OpenClaw core DB remains read-only to memory-engine",
      "installed runtime identity must match the reviewed source closure",
      "Node/native-module ABI must be compatible",
      "active-memory must be explicitly disabled by the effective OpenClaw host activation policy",
      "focused tests, static checks, full tests, and fail-closed safety smoke must pass",
      "AutoRecall=disabled",
      "automatic reinforcement=disabled",
      "B8-A7-R5 strict host publisher integration design=PASSED / CLOSED / REFERENCE ONLY",
      "OpenClaw upstream pull request=NOT REQUIRED / NOT PLANNED",
      "B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED",
    ],
    "personal ADR",
  );
});

test("personal remediation correlates cold, installed-runtime, and loaded Gateway evidence", () => {
  const runbook = read(RUNBOOK);
  requireTokens(
    runbook,
    [
      "operator-controlled cold inspection",
      "exact installed-runtime identity",
      "post-load Gateway inspection",
      "active-memory excluded from a non-empty plugins.allow",
      "C0 = exact pre-change OpenClaw config backup",
      "R0 = exact pre-change installed memory-engine runtime recovery source",
      "active-memory effective enabled=false",
      "Cold operator evidence",
      "Installed-runtime evidence",
      "Loaded Gateway evidence",
      "The three evidence groups must agree",
      "AutoRecall disabled",
      "KG mode=legacy_fallback",
      "Recent mode=legacy_fallback",
      "A5 fail-closed safety smoke=10/10 PASS",
      "configuration mutation=NOT AUTHORIZED",
      "plugin install/reload=NOT AUTHORIZED",
      "B8-A7 sustained runtime window=NOT AUTHORIZED",
    ],
    "personal runbook",
  );
});

test("strict R4/R5 and the old R1 runbook remain as historical references", () => {
  const r4 = read(R4);
  const r5 = read(R5);
  const oldRunbook = read(OLD_RUNBOOK);
  requireTokens(
    r4,
    [
      "strict platform profile reference",
      "absence of this publisher is no longer a current B8-A7 blocker",
      "REQUIRED ONLY FOR STRICT PLATFORM PROFILE",
    ],
    "R4 reference",
  );
  requireTokens(
    r5,
    [
      "Accepted strict-profile reference",
      "upstream implementation not planned for the personal deployment",
      "Dormant Strict-Profile Implementation Gate",
    ],
    "R5 reference",
  );
  requireTokens(
    oldRunbook,
    [
      "Historical strict no-load runbook",
      "superseded for the current personal deployment",
      "personal-deployment-sustained-runtime-remediation.md",
    ],
    "old R1 runbook",
  );
});

test("ledger and devlog record the current R6 boundary", () => {
  const ledger = read(LEDGER);
  const devlog = read(DEVLOG);
  for (const text of [ledger, devlog]) {
    requireTokens(
      text,
      [
        "B8-A7-R4 strict host ownership architecture=PASSED / CLOSED / REFERENCE ONLY",
        "B8-A7-R5 strict host publisher integration design=PASSED / CLOSED / REFERENCE ONLY",
        "B8-A7-R6 personal deployment safety profile=PASSED / CLOSED",
        "OpenClaw upstream pull request=NOT REQUIRED / NOT PLANNED",
        "B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED",
        "B8-A7 sustained runtime window=NOT AUTHORIZED",
        "B8-B removal=NOT AUTHORIZED",
      ],
      "R6 ledger/devlog",
    );
  }
});

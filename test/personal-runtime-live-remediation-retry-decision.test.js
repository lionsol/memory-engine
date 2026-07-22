import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const DECISION = new URL("../docs/smoke-tests/personal-runtime-live-remediation-retry-decision-20260721.md", import.meta.url);
const LEDGER = new URL("../docs/hybrid-fail-closed-rollout-status.md", import.meta.url);
const DEVLOG = new URL("../docs/devlog.md", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

function requireTokens(text, tokens, label) {
  for (const token of tokens) assert.equal(text.includes(token), true, `missing ${label} token: ${token}`);
}

test("R6.5.2 blocked retry decision records missing authorities and no mutation", () => {
  const decision = read(DECISION);
  requireTokens(decision, [
    "Result: BLOCKED / NO MUTATION",
    "/tmp/memory-engine-r6.4-9b6b734/candidate=ABSENT",
    "/tmp/memory-engine-r6.5-live-2415dfe=ABSENT",
    "R6.5.2 RETRY AUTHORIZATION BLOCKED / REBUILD OR REBASE REQUIRED",
    "config SHA-256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a",
    "active runtime identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1",
    "R6.5.2 retry authorization=CONSUMED / NOT REUSABLE",
    "installed-plugin recovery sourcePath=DANGLING",
    "B8-A7-R6.5.3 persistent artifact rebuild/recovery-source rebase design=PASSED / CLOSED",
    "B8-A7-R6.5.3A persistent artifact preparation authorization packet=PASSED / CLOSED",
    "R6.5.3A persistent artifact preparation execution=NOT AUTHORIZED",
    "R6.5.3B recovery-source rebase execution=NOT AUTHORIZED",
  ], "R6.5.2 blocked decision");
});

test("current ledger and devlog record blocked retry without authorizing rebuild", () => {
  for (const text of [read(LEDGER), read(DEVLOG)]) {
    assert.match(text, /B8-A7-R6\.5\.2 live retry execution(?:=|\s+)BLOCKED \/ NO MUTATION/);
    assert.match(text, /R6\.5\.2 retry authorization(?:=|\s+)CONSUMED \/ NOT REUSABLE/);
    assert.match(text, /B8-A7-R6\.5\.3 persistent artifact rebuild\/recovery-source rebase design(?:=|\s+)PASSED \/ CLOSED/);
    assert.match(text, /B8-A7-R6\.5\.3A persistent artifact preparation authorization packet(?:=|\s+)PASSED \/ CLOSED/);
    assert.match(text, /R6\.5\.3A persistent artifact preparation execution(?:=|\s+)NOT AUTHORIZED/);
    assert.match(text, /R6\.5\.3B recovery-source rebase execution(?:=|\s+)NOT AUTHORIZED/);
    assert.match(text, /B8-A7 sustained runtime authorization(?:=|\s+)WITHHELD \/ PERSONAL PROFILE REMEDIATION REQUIRED/);
  }
});

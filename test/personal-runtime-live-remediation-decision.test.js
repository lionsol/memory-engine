import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const DECISION = new URL(
  "../docs/smoke-tests/personal-runtime-live-remediation-decision-20260721.md",
  import.meta.url,
);
const INDEX = new URL("../docs/README.md", import.meta.url);
const LEDGER = new URL("../docs/hybrid-fail-closed-rollout-status.md", import.meta.url);
const DEVLOG = new URL("../docs/devlog.md", import.meta.url);
const CONFIG_CLI = new URL("../bin/build-config-semantic-equivalence-report.js", import.meta.url);
const CONFIG_LIB = new URL("../bin/config-semantic-equivalence-lib.js", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

function requireTokens(text, tokens, label) {
  for (const token of tokens) {
    assert.equal(text.includes(token), true, `missing ${label} token: ${token}`);
  }
}

test("R6.5 execution decision and semantic config tooling exist and are indexed", () => {
  assert.equal(existsSync(DECISION), true);
  assert.equal(existsSync(CONFIG_CLI), true);
  assert.equal(existsSync(CONFIG_LIB), true);
  const index = read(INDEX);
  assert.match(index, /personal-runtime-live-remediation-decision-20260721\.md/);
  assert.match(index, /build-config-semantic-equivalence-report\.js/);
});

test("R6.5 decision records exact authorization and pre-start rollback", () => {
  const decision = read(DECISION);
  requireTokens(decision, [
    "Execution result: ROLLED BACK / SAFE",
    "Candidate activation: **NOT REACHED**",
    "candidate artifact identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42",
    "candidate runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718",
    "conditional rollback to fresh R0 and exact pre-start D0=AUTHORIZED",
    "plugins install /tmp/memory-engine-r6.4-9b6b734/candidate --force=pass",
    "source/installed difference_count=0",
    "installed runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718",
    "candidate Gateway activation=NOT REACHED",
  ], "R6.5 transaction");
});

test("R6.5 decision proves D0 and install-time data identities remained stable", () => {
  const decision = read(DECISION);
  requireTokens(decision, [
    "D_PRE_INSTALL identity=3de94ff539e9fd1758bb6bd4c6aeb1168ba3a9993a64262d11581ee2d6eedda3",
    "D_PRE_INSTALL identity=8b09acea01890e3d3470bde8d9139cb547f0a43410b4c8804087daeb215e8044",
    "engine D_POST_INSTALL=D_PRE_INSTALL=true",
    "LanceDB D_POST_INSTALL=D_PRE_INSTALL=true",
    "engine post-rollback=D_PRE_INSTALL=true",
    "LanceDB post-rollback=D_PRE_INSTALL=true",
    "memory data restored from D0=false / NOT REQUIRED",
    "core DB metadata recorded only=true",
  ], "R6.5 data gate");
});

test("R6.5 decision identifies only monotonic meta.lastTouchedAt config drift", () => {
  const decision = read(DECISION);
  requireTokens(decision, [
    "C0 SHA-256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a",
    "post-install SHA-256=e6fcbb6ec1eb8a339b6b1dc7614435c3a69358b1d4403f2381cc215d2ec0e2a9",
    "changed_path_count=1",
    "changed_paths=[meta.lastTouchedAt]",
    "unexpected_changed_paths=[]",
    "before=2026-07-19T08:01:53.000Z",
    "after=2026-07-21T11:55:54.599Z",
    "policy=memory-engine-config-semantic-equivalence-v1",
    "status=approved_host_metadata_change",
    "canonical_semantic_equal=true",
    "errors=[]",
  ], "R6.5 config root cause");
});

test("R6.5 rollback restores old runtime exact C0 Gateway health and A5", () => {
  const decision = read(DECISION);
  requireTokens(decision, [
    "installed old runtime identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1",
    "final config=C0 exact bytes=true",
    "Gateway PID=275493",
    "RPC healthy=true",
    "Gateway Node=/home/lionsol/.local/node24/bin/node",
    "Gateway ABI=137",
    "active-memory=false / disabled_by_plugins_allowlist",
    "AutoRecall=false",
    "KG=legacy_fallback",
    "Recent=legacy_fallback",
    "A5 full fail-closed smoke=10/10 pass",
    "final engine=D_PRE_INSTALL=true",
    "final LanceDB=D_PRE_INSTALL=true",
  ], "R6.5 rollback closeout");
});

test("R6.5.1 is closed and R6.5.2 still requires new approval", () => {
  const decision = read(DECISION);
  requireTokens(decision, [
    "B8-A7-R6.5.1 config semantic equivalence repair=PASSED / CLOSED",
    "B8-A7-R6.5.2 live remediation retry authorization packet=PASSED / CLOSED",
    "R6.5.2 live retry execution=NOT AUTHORIZED",
    "explicit R6.5.2 retry approval=NOT RECEIVED",
    "closed R6.5.1 implementation and independent verification",
    "fresh C0 and R0",
    "fresh D0",
    "new exact operator retry authorization",
    "B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED",
    "B8-B removal=NOT AUTHORIZED",
  ], "R6.5.1 boundary");
});

test("ledger and devlog record safe rollback and pending R6.5.2 packet", () => {
  for (const text of [read(LEDGER), read(DEVLOG)]) {
    assert.match(text, /B8-A7-R6\.5 live remediation execution(?:=|\s+)ROLLED BACK \/ SAFE/);
    assert.match(text, /candidate Gateway activation(?:=|\s+)NOT REACHED/);
    assert.match(text, /old runtime restored(?:=|\s+)TRUE/i);
    assert.match(
      text,
      /B8-A7-R6\.5\.1 config semantic equivalence repair(?:=|\s+)PASSED \/ CLOSED/,
    );
    assert.match(text, /B8-A7-R6\.5\.2 live remediation retry authorization packet(?:=|\s+)PASSED \/ CLOSED/);
    assert.match(text, /R6\.5\.2 live retry execution(?:=|\s+)NOT AUTHORIZED/);
    assert.match(
      text,
      /B8-A7 sustained runtime authorization(?:=|\s+)WITHHELD \/ PERSONAL PROFILE REMEDIATION REQUIRED/,
    );
  }
});
